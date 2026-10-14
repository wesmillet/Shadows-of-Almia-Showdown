/**
 * Catching: hold to aim an arc, release to throw. The ball arcs and hits,
 * the target plays Hurt, shrinks and fades into the ball (red flash), the
 * ball drops and wobbles one to three times, then clicks (caught) or bursts
 * open and the Pokémon scales back out. While inside the ball the Pokémon
 * cannot act or be targeted and its AI is suspended.
 */
import { clamp } from '../core/math';
import type { Rng } from '../core/rng';
import { CONFIG } from './data';
import type { Mon, Trainer } from './entities';

export interface CatchRoll {
  chance: number;
  caught: boolean;
  wobbles: number;
}

export function catchChance(target: Mon, ballTier: number): number {
  const hpFrac = target.maxHp > 0 ? target.hp / target.maxHp : 1;
  const base = 0.12 + 0.78 * (1 - hpFrac);
  const statusBonus = target.status ? (CONFIG.catch.statusBonus as Record<string, number>)[target.status] ?? 1 : 1;
  return clamp(base * ballTier * statusBonus, 0.03, 0.98);
}

export function rollCatch(rng: Rng, target: Mon, ballTier: number): CatchRoll {
  const chance = catchChance(target, ballTier);
  const caught = rng.chance(chance);
  const wobbles = caught ? 3 : clamp(1 + Math.floor(chance * 2.6 + rng.next() * 0.6), 1, 3);
  return { chance, caught, wobbles };
}

export type ThrowPhase = 'flying' | 'hit' | 'absorb' | 'drop' | 'wobble' | 'click' | 'burst' | 'done';

/** Seconds each phase lasts (wobble = per wobble). */
export const PHASE_SECONDS: Record<Exclude<ThrowPhase, 'flying' | 'done'>, number> = {
  hit: 0.16,
  absorb: 0.3,
  drop: 0.26,
  wobble: CONFIG.catch.wobbleSeconds,
  click: 0.45,
  burst: 0.3,
};

export interface Throw {
  x: number;
  y: number;
  /** Height above the ground in tiles. */
  z: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  t: number;
  flight: number;
  ballId: string;
  tier: number;
  thrower: Trainer;
  phase: ThrowPhase;
  /** Seconds into the current phase. */
  phaseT: number;
  /** The Pokémon the ball landed on (set at 'hit'). */
  target: Mon | null;
  roll: CatchRoll | null;
  /** Wobbles completed so far. */
  wobblesDone: number;
}

export function newThrow(thrower: Trainer, from: { x: number; y: number }, to: { x: number; y: number }, ballId: string, tier: number): Throw {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  return {
    x: from.x, y: from.y, z: 0, startX: from.x, startY: from.y, targetX: to.x, targetY: to.y,
    t: 0, flight: Math.max(0.35, d / 7), ballId, tier, thrower, phase: 'flying', phaseT: 0,
    target: null, roll: null, wobblesDone: 0,
  };
}

/** Kind of ball sprite for an item id (poke-ball -> poke). */
export function ballKind(ballId: string): 'poke' | 'great' | 'ultra' {
  if (ballId.startsWith('great')) return 'great';
  if (ballId.startsWith('ultra')) return 'ultra';
  return 'poke';
}

/**
 * Advances a throw. Returns the phase that just *started* this step (so the
 * match can apply its side effects once), or null when nothing changed.
 * 'landed' is reported when the flight ends, before the match decides
 * between 'hit' (a target) and 'done' (a miss).
 */
export function stepThrow(th: Throw, dt: number): ThrowPhase | 'landed' | null {
  if (th.phase === 'done') return null;
  if (th.phase === 'flying') {
    th.t += dt;
    const p = Math.min(1, th.t / th.flight);
    th.x = th.startX + (th.targetX - th.startX) * p;
    th.y = th.startY + (th.targetY - th.startY) * p;
    th.z = Math.sin(p * Math.PI) * (0.6 + th.flight * 0.6);
    if (p >= 1) {
      th.z = 0;
      return 'landed';
    }
    return null;
  }
  th.phaseT += dt;
  const len = PHASE_SECONDS[th.phase];
  switch (th.phase) {
    case 'hit':
      th.z = 0.7; // the ball hangs over the target while it is pulled in
      break;
    case 'absorb':
      th.z = 0.7;
      break;
    case 'drop':
      th.z = 0.7 * (1 - Math.min(1, th.phaseT / len)) ** 1.6;
      break;
    default:
      th.z = 0;
  }
  if (th.phaseT < len) return null;
  th.phaseT = 0;
  switch (th.phase) {
    case 'hit':
      th.phase = 'absorb';
      break;
    case 'absorb':
      th.phase = 'drop';
      break;
    case 'drop':
      th.phase = 'wobble';
      break;
    case 'wobble':
      th.wobblesDone++;
      if (th.wobblesDone >= (th.roll?.wobbles ?? 1)) th.phase = th.roll?.caught ? 'click' : 'burst';
      else return null; // next wobble
      break;
    case 'click':
    case 'burst':
      th.phase = 'done';
      break;
  }
  return th.phase;
}

/** Visual state of the target during the sequence: scale, alpha and red flash in [0,1]. */
export function targetVisual(th: Throw): { scale: number; alpha: number; flash: number } {
  const p = Math.min(1, th.phaseT / PHASE_SECONDS[th.phase === 'flying' || th.phase === 'done' ? 'hit' : th.phase]);
  switch (th.phase) {
    case 'hit':
      return { scale: 1, alpha: 1, flash: 0.6 };
    case 'absorb':
      return { scale: 1 - p, alpha: 1 - p, flash: 1 - p * 0.5 };
    case 'drop':
    case 'wobble':
    case 'click':
      return { scale: 0, alpha: 0, flash: 0 };
    case 'burst':
      return { scale: p, alpha: p, flash: 0.4 * (1 - p) };
    default:
      return { scale: 1, alpha: 1, flash: 0 };
  }
}

/** Ball rotation in radians for the wobble phase, 0 otherwise. */
export function ballWobble(th: Throw): number {
  if (th.phase !== 'wobble') return 0;
  const k = th.phaseT / PHASE_SECONDS.wobble;
  return Math.sin(k * Math.PI * 2) * 0.5 * (1 - k * 0.3);
}
