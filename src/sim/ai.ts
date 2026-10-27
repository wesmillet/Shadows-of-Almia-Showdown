/**
 * AI trainer brain: roam, seek item, hunt wild Pokémon for XP, engage, flee below 30% party HP,
 * heal at an outpost. One decision tick every few hundred milliseconds; movement
 * is continuous.
 */
import type { Rng } from '../core/rng';
import type { GroundRenderer } from '../ground/types';
import { CONFIG } from './data';
import type { GroundItem, Mon, Trainer, TrainerAi } from './entities';
import { activeParty, incapable, lead } from './entities';

export interface AiWorld {
  ground: GroundRenderer;
  rng: Rng;
  items: GroundItem[];
  outposts: Array<{ x: number; y: number; cost?: number }>;
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
  /** Targets this trainer gave up on (couldn't reach), by key: 'm<id>', 'i<id>', 'o<index>'. */
  banned?: (key: string) => boolean;
  /** Match time (outpost cooldowns). */
  time?: number;
  /** When only two trainers are left: the other one, whom this trainer goes looking for. */
  lastFoe?: Trainer | null;
}

/** The decision and, for something the trainer walks to, its key (for giving up when stuck). */
export interface AiDecision {
  ai: TrainerAi;
  target: { x: number; y: number } | null;
  rival: Trainer | null;
  key?: string | null;
}

/** The strongest level in a trainer's team that can still fight. */
export function teamLevel(t: Trainer): number {
  return activeParty(t).reduce((a, m) => Math.max(a, m.level), 1);
}

/** Levels above the team at which a wild Pokémon is worth steering clear of. */
const DANGER_LEVELS = 6;

/** The closest wild Pokémon within `range` that is well above the team's level. */
export function dangerNear(t: Trainer, wilds: Mon[] | undefined, range: number, x = t.x, y = t.y): Mon | null {
  if (!wilds) return null;
  const lv = teamLevel(t);
  let best: Mon | null = null;
  let bd = range;
  for (const m of wilds) {
    if (m.fainted || m.captured || m.level < lv + DANGER_LEVELS) continue;
    const d = Math.hypot(m.x - x, m.y - y);
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}

/**
 * A wild Pokémon worth hunting for XP: the best pick within `range` at or below the team's level
 * (up to `over` levels above it), out of the dark. Closer is better and a level nearer the team's
 * pays more, so the score trades a tile of walking for a level. Bosses, Alphas, legends and wilds
 * already fighting someone else's Pokémon are left alone.
 */
export function huntTarget(t: Trainer, wilds: Mon[] | undefined, range: number, over = 2, inLight: (x: number, y: number) => boolean = () => true, banned: (key: string) => boolean = () => false): Mon | null {
  if (!wilds) return null;
  const lv = teamLevel(t);
  let best: Mon | null = null;
  let bs = Infinity;
  for (const m of wilds) {
    if (m.fainted || m.captured || m.boss || m.landBoss || m.alpha || m.legend || m.leap) continue;
    if (m.level > lv + over || m.level < lv - 12) continue;
    if (m.target && m.target.owner && m.target.owner !== t) continue;
    const d = Math.hypot(m.x - t.x, m.y - t.y);
    if (d > range || !inLight(m.x, m.y) || banned(`m${m.id}`)) continue;
    const score = d - Math.min(0, m.level - lv) * 0.8 - (m.target?.owner === t ? 6 : 0);
    if (score < bs) {
      bs = score;
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

export function nearestItem(t: Trainer, items: GroundItem[], range: number, banned: (key: string) => boolean = () => false): GroundItem | null {
  if (!t.items.includes(null)) return null;
  let best: GroundItem | null = null;
  let bd = range;
  for (const it of items) {
    if (banned(`i${it.id}`)) continue;
    const d = Math.hypot(it.x - t.x, it.y - t.y);
    if (d < bd) {
      bd = d;
      best = it;
    }
  }
  return best;
}

/** Picks the next state for a trainer. Pure: returns the state and target without moving anyone. */
export function decide(t: Trainer, w: AiWorld): AiDecision {
  const hpFrac = partyHpFraction(t);
  const rival = nearestRival(t, w.rivals, 6.5);
  const inDark = Math.hypot(t.x - w.centerX, t.y - w.centerY) > w.darkRadius - 1.5;
  const banned = w.banned ?? (() => false);
  let outpostIdx = -1;
  w.outposts.forEach((o, i) => {
    if (banned(`o${i}`)) return;
    // A paid healer is only worth the walk with the money for it.
    if ((o.cost ?? 0) > (t.money ?? 0)) return;
    const best = w.outposts[outpostIdx];
    if (!best || Math.hypot(o.x - t.x, o.y - t.y) < Math.hypot(best.x - t.x, best.y - t.y)) outpostIdx = i;
  });
  const outpost = w.outposts[outpostIdx] ?? null;

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
    if (outpost) return { ai: 'heal', target: outpost, rival: null, key: `o${outpostIdx}` };
  }
  if (rival) return { ai: 'engage', target: { x: rival.x, y: rival.y }, rival };
  // The last two: go and find the other one (after patching up if the team is in a bad way).
  if (w.lastFoe && w.lastFoe.alive && hpFrac > CONFIG.trainers.huntHpFraction && !(w.banned?.('last') ?? false)) {
    return { ai: 'engage', target: { x: w.lastFoe.x, y: w.lastFoe.y }, rival: null, key: 'last' };
  }
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
  // Items close by first, then the best wild to train on, then items further off.
  const item = nearestItem(t, w.items, 9, banned);
  const itemOk = item && !dangerNear(t, w.wilds, 6, item.x, item.y);
  const seek = (it: GroundItem): AiDecision => ({ ai: 'seekItem', target: { x: it.x, y: it.y }, rival: null, key: `i${it.id}` });
  if (item && itemOk && Math.hypot(item.x - t.x, item.y - t.y) < 4) return seek(item);
  // Worn down (or a member fainted): patch up at the nearest outpost it can reach, then hunt again.
  // Just healed (the outpost is cooling down) and the rest are fine: keep training meanwhile.
  const fainted = t.party.some((m) => m.fainted && !m.captured);
  const standing = activeParty(t);
  const standingHp = standing.reduce((a, m) => a + m.hp, 0) / Math.max(1, standing.reduce((a, m) => a + m.maxHp, 0));
  const cooling = (w.time ?? 0) < t.outpostReady && standing.length > 0 && standingHp > CONFIG.trainers.huntHpFraction;
  if ((fainted || hpFrac <= CONFIG.trainers.huntHpFraction) && !cooling && outpost && Math.hypot(outpost.x - t.x, outpost.y - t.y) < CONFIG.trainers.healTripRange) {
    return { ai: 'heal', target: outpost, rival: null, key: `o${outpostIdx}` };
  }
  // Hunt: train on a wild at or a little above the team's level while the Pokémon still standing are in shape.
  if (standing.length && standingHp > CONFIG.trainers.huntHpFraction) {
    const lightR = Number.isFinite(w.darkRadius) ? w.darkRadius - 3 : Infinity;
    const prey = huntTarget(t, w.wilds, CONFIG.trainers.huntRange, CONFIG.trainers.huntOverLevel, (x, y) => Math.hypot(x - w.centerX, y - w.centerY) < lightR, banned);
    // Nothing that easy about and the whole team fresh: take on something a few levels up.
    const stretch = !prey && !fainted && hpFrac > 0.85 ? huntTarget(t, w.wilds, CONFIG.trainers.huntRange, DANGER_LEVELS - 1, (x, y) => Math.hypot(x - w.centerX, y - w.centerY) < lightR, banned) : null;
    const pick = prey ?? stretch;
    if (pick) return { ai: 'hunt', target: { x: pick.x, y: pick.y }, rival: null, key: `m${pick.id}` };
  }
  if (item && itemOk) return seek(item);
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
  if (attacker.casting || incapable(attacker)) return -1;
  return choose(attacker, target);
}
