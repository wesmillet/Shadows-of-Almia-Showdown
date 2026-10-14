/**
 * Catching: hold to aim an arc, release to throw. The chance comes from the
 * target's HP fraction, its status and the ball tier; the ball wobbles one
 * to three times before the result.
 */
import { clamp } from '../core/math';
import type { Rng } from '../core/rng';
import { CONFIG } from './data';
import type { Mon } from './entities';

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
  // Three wobbles on a catch; otherwise the ball breaks after 1 to 3 wobbles, more when it was close.
  const wobbles = caught ? 3 : clamp(1 + Math.floor(chance * 2.6 + rng.next() * 0.6), 1, 3);
  return { chance, caught, wobbles };
}

export interface Throw {
  x: number;
  y: number;
  z: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  t: number;
  flight: number;
  ballId: string;
  tier: number;
  thrower: import('./entities').Trainer;
  /** Set once the ball lands on a Pokémon. */
  target: Mon | null;
  roll: CatchRoll | null;
  /** Wobble phase in seconds since landing. */
  wobbleT: number;
  done: boolean;
}

export function newThrow(thrower: Throw['thrower'], from: { x: number; y: number }, to: { x: number; y: number }, ballId: string, tier: number): Throw {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  return {
    x: from.x, y: from.y, z: 0, startX: from.x, startY: from.y, targetX: to.x, targetY: to.y,
    t: 0, flight: Math.max(0.35, d / 7), ballId, tier, thrower, target: null, roll: null, wobbleT: 0, done: false,
  };
}

/** Advances a throw; returns 'landed' the step the ball touches down, 'result' when the wobbles finish. */
export function stepThrow(th: Throw, dt: number): 'flying' | 'landed' | 'wobbling' | 'result' {
  if (th.done) return 'result';
  if (th.target === null && th.roll === null) {
    th.t += dt;
    const p = Math.min(1, th.t / th.flight);
    th.x = th.startX + (th.targetX - th.startX) * p;
    th.y = th.startY + (th.targetY - th.startY) * p;
    th.z = Math.sin(p * Math.PI) * (0.6 + th.flight * 0.6);
    if (p >= 1) {
      th.z = 0;
      return 'landed';
    }
    return 'flying';
  }
  th.wobbleT += dt;
  const total = (th.roll?.wobbles ?? 1) * CONFIG.catch.wobbleSeconds + 0.5;
  if (th.wobbleT >= total) {
    th.done = true;
    return 'result';
  }
  return 'wobbling';
}
