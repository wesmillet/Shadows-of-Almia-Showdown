/**
 * AI trainer brain: roam, seek item, engage, flee below 30% party HP, heal
 * at an outpost. One decision tick every few hundred milliseconds; movement
 * is continuous.
 */
import type { Rng } from '../core/rng';
import type { GroundRenderer } from '../ground/types';
import { CONFIG } from './data';
import type { GroundItem, Mon, Trainer, TrainerAi } from './entities';
import { activeParty, lead } from './entities';

export interface AiWorld {
  ground: GroundRenderer;
  rng: Rng;
  items: GroundItem[];
  outposts: Array<{ x: number; y: number }>;
  /** Trainers this one may fight (alive, not itself). */
  rivals: Trainer[];
  /** Safe radius of the darkness in tiles, centre of the map. */
  darkRadius: number;
  centerX: number;
  centerY: number;
  /** Wild Pokémon, so trainers can steer clear of ones that outclass their team. */
  wilds?: Mon[];
  /** Nearest the crystal a team of that level wants to roam (stronger wilds live further in). */
  comfortRadius?: (level: number) => number;
}

/** The strongest level in a trainer's team that can still fight. */
export function teamLevel(t: Trainer): number {
  return activeParty(t).reduce((a, m) => Math.max(a, m.level), 1);
}

/** The closest wild Pokémon within `range` that is well above the team's level. */
export function dangerNear(t: Trainer, wilds: Mon[] | undefined, range: number, x = t.x, y = t.y): Mon | null {
  if (!wilds) return null;
  const lv = teamLevel(t);
  let best: Mon | null = null;
  let bd = range;
  for (const m of wilds) {
    if (m.fainted || m.captured || m.level < lv + 5) continue;
    const d = Math.hypot(m.x - x, m.y - y);
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}

export function partyHpFraction(t: Trainer): number {
  let hp = 0;
  let max = 0;
  for (const m of t.party) {
    hp += m.hp;
    max += m.maxHp;
  }
  return max > 0 ? hp / max : 0;
}

export function nearestRival(t: Trainer, rivals: Trainer[], range: number): Trainer | null {
  let best: Trainer | null = null;
  let bd = range;
  for (const r of rivals) {
    if (!r.alive || !lead(r)) continue;
    const d = Math.hypot(r.x - t.x, r.y - t.y);
    if (d < bd) {
      bd = d;
      best = r;
    }
  }
  return best;
}

export function nearestItem(t: Trainer, items: GroundItem[], range: number): GroundItem | null {
  if (!t.items.includes(null)) return null;
  let best: GroundItem | null = null;
  let bd = range;
  for (const it of items) {
    const d = Math.hypot(it.x - t.x, it.y - t.y);
    if (d < bd) {
      bd = d;
      best = it;
    }
  }
  return best;
}

/** Picks the next state for a trainer. Pure: returns the state and target without moving anyone. */
export function decide(t: Trainer, w: AiWorld): { ai: TrainerAi; target: { x: number; y: number } | null; rival: Trainer | null } {
  const hpFrac = partyHpFraction(t);
  const rival = nearestRival(t, w.rivals, 6.5);
  const inDark = Math.hypot(t.x - w.centerX, t.y - w.centerY) > w.darkRadius - 1.5;
  const outpost = w.outposts.length ? w.outposts.reduce((a, b) => (Math.hypot(a.x - t.x, a.y - t.y) < Math.hypot(b.x - t.x, b.y - t.y) ? a : b)) : null;

  if (hpFrac < CONFIG.trainers.fleeHpFraction && activeParty(t).length > 0) {
    if (rival) {
      // Run directly away from the threat, biased toward the nearest outpost.
      let ax = t.x - rival.x;
      let ay = t.y - rival.y;
      const d = Math.hypot(ax, ay) || 1;
      ax /= d;
      ay /= d;
      if (outpost) {
        ax += (outpost.x - t.x) * 0.1;
        ay += (outpost.y - t.y) * 0.1;
      }
      return { ai: 'flee', target: { x: t.x + ax * 4, y: t.y + ay * 4 }, rival: null };
    }
    if (outpost) return { ai: 'heal', target: outpost, rival: null };
  }
  if (rival) return { ai: 'engage', target: { x: rival.x, y: rival.y }, rival };
  if (inDark && Number.isFinite(w.darkRadius)) {
    // Head for the light.
    const ang = Math.atan2(t.y - w.centerY, t.x - w.centerX);
    const r = Math.max(2, w.darkRadius - 4);
    return { ai: 'roam', target: { x: w.centerX + Math.cos(ang) * r, y: w.centerY + Math.sin(ang) * r }, rival: null };
  }
  // Back away from a wild Pokémon that would flatten the team.
  const danger = dangerNear(t, w.wilds, 7);
  if (danger) {
    const dx = t.x - danger.x;
    const dy = t.y - danger.y;
    const d = Math.hypot(dx, dy) || 1;
    return { ai: 'flee', target: { x: t.x + (dx / d) * 5, y: t.y + (dy / d) * 5 }, rival: null };
  }
  const item = nearestItem(t, w.items, 9);
  if (item && !dangerNear(t, w.wilds, 6, item.x, item.y)) return { ai: 'seekItem', target: { x: item.x, y: item.y }, rival: null };
  // Roam: a random reachable point inside the light, no nearer the crystal than the team can handle
  // (unless the darkness has pushed everyone in), and away from wild Pokémon that outclass it.
  const safe = Math.max(4, w.darkRadius - 2);
  const comfort = Math.min(w.comfortRadius?.(teamLevel(t)) ?? 0, safe - 8);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < 8; i++) {
      const ang = w.rng.range(0, Math.PI * 2);
      const dist = w.rng.range(3, 8);
      const x = t.x + Math.cos(ang) * dist;
      const y = t.y + Math.sin(ang) * dist;
      const dc = Math.hypot(x - w.centerX, y - w.centerY);
      if (!w.ground.reachable(Math.floor(x), Math.floor(y)) || dc >= safe) continue;
      if (pass === 0 && (dc < comfort || dangerNear(t, w.wilds, 6, x, y))) continue;
      return { ai: 'roam', target: { x, y }, rival: null };
    }
  }
  if (Math.hypot(t.x - w.centerX, t.y - w.centerY) < safe) return { ai: 'roam', target: { x: t.x, y: t.y }, rival: null };
  return { ai: 'roam', target: { x: w.centerX, y: w.centerY }, rival: null };
}

/** The AI's lead picks a move at its opponent. Returns the slot or -1. */
export function pickMove(attacker: Mon, target: Mon, choose: (a: Mon, t: Mon) => number): number {
  if (attacker.casting || attacker.status === 'sleep') return -1;
  return choose(attacker, target);
}
