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
import { ballKindOf, ITEMS, type BallKind } from './items';

export interface CatchRoll {
  chance: number;
  caught: boolean;
  wobbles: number;
}

/** What a ball's rule looks at when it lands. */
export interface CatchContext {
  target: Mon;
  thrower: Trainer;
  /** Seconds since the match started. */
  matchTime: number;
  /** The target stands on a water tile. */
  inWater: boolean;
  /** The target stands inside the darkness. */
  inDark: boolean;
}

/**
 * The ball's catch modifier: its base tier times its special rule.
 * Master Ball returns Infinity (a guaranteed catch).
 */
export function ballModifier(ballId: string, ctx: CatchContext): number {
  const def = ITEMS[ballId];
  const base = def?.tier ?? 1;
  const types = ctx.target.types;
  switch (def?.special) {
    case 'master':
      return Infinity;
    case 'net':
      return base * (types.includes('bug') || types.includes('water') ? 3 : 1);
    case 'dive':
      return base * (ctx.inWater ? 3.5 : 1);
    case 'nest':
      return base * clamp((41 - ctx.target.level) / 10, 1, 4);
    case 'repeat':
      return base * (ctx.thrower.party.some((m) => m.dex === ctx.target.dex) ? 3 : 1);
    case 'timer':
      return base * clamp(1 + ctx.matchTime / 200, 1, 4);
    case 'dusk':
      return base * (ctx.inDark ? 3 : 1);
    case 'quick':
      // Thrown first, before anything has attacked it.
      return base * (ctx.target.everHit ? 1 : 5);
    case 'heal':
    default:
      return base;
  }
}

export function catchChance(target: Mon, modifier: number): number {
  if (!Number.isFinite(modifier)) return 1;
  const hpFrac = target.maxHp > 0 ? target.hp / target.maxHp : 1;
  const base = 0.12 + 0.78 * (1 - hpFrac);
  const statusBonus = target.status ? (CONFIG.catch.statusBonus as Record<string, number>)[target.status] ?? 1 : 1;
  return clamp(base * modifier * statusBonus, 0.03, 0.98);
}

export function rollCatch(rng: Rng, target: Mon, modifier: number): CatchRoll {
  const chance = catchChance(target, modifier);
  const caught = chance >= 1 || rng.chance(chance);
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
  /** Catch modifier, decided when the ball lands (Infinity = Master Ball). */
  modifier: number;
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

export function newThrow(thrower: Trainer, from: { x: number; y: number }, to: { x: number; y: number }, ballId: string): Throw {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  return {
    x: from.x, y: from.y, z: 0, startX: from.x, startY: from.y, targetX: to.x, targetY: to.y,
    t: 0, flight: Math.max(0.35, d / 7), ballId, modifier: ITEMS[ballId]?.tier ?? 1, thrower, phase: 'flying', phaseT: 0,
    target: null, roll: null, wobblesDone: 0,
  };
}

/** Kind of ball sprite for an item id (poke-ball -> poke). */
export function ballKind(ballId: string): BallKind {
  return ballKindOf(ballId);
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

/** Ball rotation in radians for the wobble phase (±20°, easing out), 0 otherwise. */
export const WOBBLE_RADIANS = (20 * Math.PI) / 180;
export function ballWobble(th: Throw): number {
  if (th.phase !== 'wobble') return 0;
  const k = th.phaseT / PHASE_SECONDS.wobble;
  return Math.sin(k * Math.PI * 2) * WOBBLE_RADIANS * (1 - k * 0.3);
}
