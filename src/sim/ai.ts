/**
 * AI trainer brain: what a computer trainer walks to next. One decision every few hundred
 * milliseconds; the match moves it there (Match.stepAi) and src/sim/bot.ts plays its hands (moves,
 * balls, items) the way a player would.
 *
 * Fights are sized up, not judged by level alone: fightMargin plays out the matchup in the
 * Pokémon's own numbers (their HP now, their moves against the other side's types and stats, how
 * many of the team fight at once), so a strong team takes on an Alpha it can beat and a worn-down
 * one leaves a wild of its own level alone.
 */
import { DIR_VECTORS } from '../core/math';
import type { Rng } from '../core/rng';
import type { GroundRenderer } from '../ground/types';
import { damageRate } from './battle';
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
  /** Pokémon out at once per trainer (config party.fieldLimit). */
  fieldLimit?: number;
  /** Whether this wild Pokémon is one the trainer would catch (room, a ball, worth having). */
  wantsCatch?: (m: Mon) => boolean;
  /** A shop to restock at (no balls left and the money for them), if one is in reach. */
  shop?: { x: number; y: number } | null;
  /** A straight walk from one point to another stays on open ground (Nav.clearLine). */
  clearLine?: (ax: number, ay: number, bx: number, by: number) => boolean;
  /** With a team too weak to fight what is about: a wild to throw a ball at from out of its reach. */
  throwAt?: Mon | null;
  /** Its nerve: 0 cautious to 1 bold (how readily it seeks or avoids a trainer battle). */
  bold?: number;
  /** Spots it backed away from lately (a wild that would beat it): no wandering or hunting back there. */
  avoid?: Array<{ x: number; y: number }>;
  /** Seconds it has had nothing to hunt: past half a minute it sets off to look further afield. */
  idle?: number;
  /** A wild Pokémon already fighting its team (it stays to finish that fight rather than walk off). */
  fighting?: Mon | null;
  /** Seconds since it last had something to hunt (a weak team takes on fair fights after a while). */
  sinceHunt?: number;
  /** Where it is exploring toward, if it already set off. */
  exploring?: { x: number; y: number } | null;
}

/** The decision and, for something the trainer walks to, its key (for giving up when stuck). */
export interface AiDecision {
  ai: TrainerAi;
  target: { x: number; y: number } | null;
  rival: Trainer | null;
  key?: string | null;
  /** Hunting this wild Pokémon to catch it (its team holds back once it is weak, then a ball). */
  catchTarget?: Mon | null;
  /** Catching it with a ball alone, from out of its reach (no fight first). */
  throwOnly?: boolean;
  /** Why it is fleeing: low HP, a stronger rival, a wild that would beat it (reports and tests). */
  why?: 'hurt' | 'rival' | 'wild';
}

/** The strongest level in a trainer's team that can still fight. */
export function teamLevel(t: Trainer): number {
  return activeParty(t).reduce((a, m) => Math.max(a, m.level), 1);
}

/** The team's Pokémon that can fight, in the order they come out. */
function fighters(t: Trainer): Mon[] {
  return t.party.filter((m) => !m.fainted && !m.captured);
}

/**
 * How a fight between a trainer's team and one wild Pokémon would go: the seconds the wild needs to
 * knock out the whole team (one at a time, at their HP now) over the seconds the team needs to
 * knock it out (with as many out at once as the field allows). Above 1 the team wins; at 2 it wins
 * with about half its HP to spare. 0 when the team can't hurt it at all.
 */
export function fightMargin(t: Trainer, w: Mon, fieldLimit = 2): number {
  const team = fighters(t);
  if (!team.length) return 0;
  const out = team.slice(0, Math.max(1, fieldLimit));
  const ourRate = out.reduce((a, m) => a + damageRate(m, w), 0);
  if (ourRate <= 0) return 0;
  const toBeat = w.hp / ourRate;
  // The wild picks on whoever is nearest: on average the ones out first.
  let toLose = 0;
  for (const m of team) {
    const r = damageRate(w, m, 1.45, true);
    toLose += r > 0 ? m.hp / r : 999;
  }
  return toLose / Math.max(0.01, toBeat);
}

/**
 * Two trainers' teams one-on-one (a trainer battle), judged on what can be seen of the rival: the
 * Pokémon it has out (their species, level and HP), not its whole party. Its bench is unknown, so a
 * rival with a full field out counts as half again as tough. Seconds for the rival to knock out this
 * team over seconds for this team to knock out the rival.
 */
export function duelMargin(t: Trainer, rival: Trainer, fieldLimit = 2): number {
  const a = fighters(t);
  const b = rival.party.filter((m) => !m.fainted && !m.captured && !m.stowed);
  if (!a.length) return 0;
  // Nothing of its team in sight (all in their balls): no idea, call it even.
  if (!b.length) return 1;
  const rate = (xs: Mon[], ys: Mon[], seen: boolean) => xs.reduce((s, x) => s + ys.reduce((q, y) => q + damageRate(x, y, 1.0, seen), 0) / ys.length, 0) / xs.length;
  const hp = (xs: Mon[]) => xs.reduce((s, x) => s + x.hp, 0);
  const ours = rate(a, b, false);
  const theirs = rate(b, a, true);
  if (ours <= 0) return 0;
  if (theirs <= 0) return 99;
  const unseen = b.length >= fieldLimit ? 1.5 : 1;
  return hp(a) / theirs / ((hp(b) * unseen) / ours);
}

/** Margins under which a wild Pokémon is trouble, and over which one is worth taking on. */
export const DANGER_MARGIN = 1.0;
export const HUNT_MARGIN = 1.6;
/** With nothing easier about and the team fresh: a fight it should still win. */
export const CLOSE_MARGIN = 1.35;
/** A weak team that has found nothing easier for most of a minute: a fair fight, fresh, is better than none. */
export const EVEN_MARGIN = 1.0;
/** An Alpha or a land boss hits hard and hits often: only with a clear edge and a healthy team. */
export const BIG_MARGIN = 2.6;
/** Against a rival team: the edge it wants before seeking a battle (none in the first two minutes, more up to four) and below which it keeps away; a trainer's nerve adds to both (decide). */
export const SEEK_DUEL = 1.15;
export const SEEK_DUEL_EARLY = 1.7;
export const AVOID_DUEL = 0.75;

/** A wild Pokémon nobody hunts: legends in their bouts, Darkrai, Hoopa, Shadow Pokémon, mid-leap. */
function untouchable(m: Mon): boolean {
  return !!(m.legend || m.npc || m.shadow || m.leap || (m.boss && !m.landBoss));
}

/** Can the trainer see this spot? About a screen's worth around it (huntRange), as a player would. */
export function inView(t: Trainer, x: number, y: number): boolean {
  return Math.hypot(x - t.x, y - t.y) <= CONFIG.trainers.huntRange;
}

/**
 * The closest wild Pokémon within `range` (of the trainer, or of x, y) that would beat the team.
 * Only wilds the trainer can see count, even around a spot further off (a player can't know what
 * waits past the edge of the screen).
 */
export function dangerNear(t: Trainer, wilds: Mon[] | undefined, range: number, x = t.x, y = t.y, fieldLimit = 2, skip: Mon | null = null): Mon | null {
  if (!wilds) return null;
  let best: Mon | null = null;
  let bd = range;
  const lv = teamLevel(t);
  for (const m of wilds) {
    if (m.fainted || m.captured || incapable(m)) continue;
    if (!inView(t, m.x, m.y)) continue;
    const d = Math.hypot(m.x - x, m.y - y);
    if (d >= bd) continue;
    // Far below the team: no threat whatever its matchup (and spares the sums).
    if (m.level < lv - 4 && !m.alpha && !m.landBoss && !m.boss) continue;
    // The one it is creeping up on to throw a ball at, while it hasn't noticed the team.
    if (m === skip && m.target?.owner !== t) continue;
    if (fightMargin(t, m, fieldLimit) >= DANGER_MARGIN) continue;
    bd = d;
    best = m;
  }
  return best;
}

/**
 * A wild Pokémon worth hunting: the best pick within `range` that the team beats comfortably, out of
 * the dark. Closer is better, and so is more XP (a level nearer or above the team's, an Alpha);
 * one the trainer wants to catch is worth more still. Wilds already fighting someone else are left alone.
 */
export function huntTarget(
  t: Trainer, wilds: Mon[] | undefined, range: number, inLight: (x: number, y: number) => boolean = () => true,
  banned: (key: string) => boolean = () => false, fieldLimit = 2, wantsCatch: (m: Mon) => boolean = () => false, minMargin = HUNT_MARGIN,
): { mon: Mon; catch: boolean } | null {
  if (!wilds) return null;
  const lv = teamLevel(t);
  const hp = partyHpFraction(t);
  let best: { mon: Mon; catch: boolean } | null = null;
  let bs = Infinity;
  for (const m of wilds) {
    if (m.fainted || m.captured || untouchable(m)) continue;
    if (m.level < lv - 12) continue;
    if (m.target && m.target.owner && m.target.owner !== t) continue;
    const d = Math.hypot(m.x - t.x, m.y - t.y);
    if (d > range || !inLight(m.x, m.y) || banned(`m${m.id}`)) continue;
    const big = !!(m.alpha || m.landBoss);
    // Others close by join in once the fight starts (a wild fights whatever hits its neighbours'
    // attackers): each one there that could matter cuts the margin.
    let pack = 0;
    // (Only the ones the trainer can see.)
    for (const o of wilds) if (o !== m && !o.fainted && !o.captured && o.level >= lv - 4 && Math.hypot(o.x - m.x, o.y - m.y) < 5 && inView(t, o.x, o.y)) pack++;
    const margin = fightMargin(t, m, fieldLimit) / (1 + pack);
    // Next to something that would beat the team: it would only have to back off again.
    if (margin >= minMargin && dangerNear(t, wilds, 8, m.x, m.y, fieldLimit)) continue;
    if (margin < (big ? Math.max(BIG_MARGIN, minMargin) : minMargin)) continue;
    if (big && hp < 0.7) continue;
    const catching = wantsCatch(m);
    const xp = Math.max(-6, Math.min(6, m.level - lv)) + (big ? 8 : m.elite ? 3 : 0);
    // The one it is already after (or already fighting) stays the pick: no dropping a fight half-won.
    const current = t.aiKey === `m${m.id}`;
    const score = d - xp * 1.2 - (catching ? 8 : 0) - (m.target?.owner === t ? 6 : 0) - (current ? 15 : 0);
    if (score < bs) {
      bs = score;
      best = { mon: m, catch: catching };
    }
  }
  return best;
}

export function partyHpFraction(t: Trainer): number {
  let hp = 0;
  let max = 0;
  for (const m of t.party) {
    if (m.captured) continue;
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
  if (!t.items.includes(null) && !t.held.includes(null)) return null;
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

/**
 * Where to back off to: a point `dist` tiles from the trainer, away from (x, y). It prefers the
 * straight-away direction but takes the nearest one (up to a right angle off it) that is open
 * walking ground in a straight line and out of the storm, so it doesn't run into a wall or a cliff
 * and stand there, or out into the dark. This only picks where to walk; the walking, the storm's
 * exposure and everything else are as for anyone.
 */
function awayFrom(t: Trainer, x: number, y: number, dist: number, w?: AiWorld): { x: number; y: number } {
  const dx = t.x - x;
  const dy = t.y - y;
  const d = Math.hypot(dx, dy) || 1;
  const base = Math.atan2(dy / d, dx / d);
  const safe = w && Number.isFinite(w.darkRadius) ? w.darkRadius - 4 : Infinity;
  const lit = (px: number, py: number) => !w || Math.hypot(px - w.centerX, py - w.centerY) < safe;
  if (w) {
    for (const off of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
      for (const len of [dist, dist * 0.6]) {
        const px = t.x + Math.cos(base + off) * len;
        const py = t.y + Math.sin(base + off) * len;
        if (!lit(px, py) || !w.ground.reachable(Math.floor(px), Math.floor(py))) continue;
        if (w.clearLine && !w.clearLine(t.x, t.y, px, py)) continue;
        return { x: px, y: py };
      }
    }
    // Nothing open that way: toward the crystal (the light), then straight away as a last resort.
    if (Number.isFinite(safe)) {
      const cx = w.centerX - t.x;
      const cy = w.centerY - t.y;
      const cl = Math.hypot(cx, cy) || 1;
      if (!lit(t.x, t.y)) return { x: t.x + (cx / cl) * dist, y: t.y + (cy / cl) * dist };
    }
  }
  return { x: t.x + Math.cos(base) * dist, y: t.y + Math.sin(base) * dist };
}

/** Picks the next state for a trainer. Pure: returns the state and target without moving anyone. */
export function decide(t: Trainer, w: AiWorld): AiDecision {
  const hpFrac = partyHpFraction(t);
  const field = w.fieldLimit ?? 2;
  const rival = nearestRival(t, w.rivals, 12);
  const inDark = Math.hypot(t.x - w.centerX, t.y - w.centerY) > w.darkRadius - 1.5;
  const banned = w.banned ?? (() => false);
  let outpostIdx = -1;
  w.outposts.forEach((o, i) => {
    if (banned(`o${i}`)) return;
    // A healer out in the storm is no use.
    if (Number.isFinite(w.darkRadius) && Math.hypot(o.x - w.centerX, o.y - w.centerY) > w.darkRadius - 2) return;
    // A paid healer is only worth the walk with the money for it.
    if ((o.cost ?? 0) > (t.money ?? 0)) return;
    const best = w.outposts[outpostIdx];
    if (!best || Math.hypot(o.x - t.x, o.y - t.y) < Math.hypot(best.x - t.x, best.y - t.y)) outpostIdx = i;
  });
  const outpost = w.outposts[outpostIdx] ?? null;
  const avoided = (x: number, y: number) => (w.avoid ?? []).some((a) => Math.hypot(a.x - x, a.y - y) < 12);

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
      return { ai: 'flee', target: awayFrom(t, t.x - ax, t.y - ay, 4, w), rival: null, why: 'hurt' };
    }
    if (outpost) return { ai: 'heal', target: outpost, rival: null, key: `o${outpostIdx}` };
  }
  // In the storm: out of it first, whatever else is going on.
  if (inDark && Number.isFinite(w.darkRadius)) {
    // Head for the light.
    const ang = Math.atan2(t.y - w.centerY, t.x - w.centerX);
    const r = Math.max(2, w.darkRadius - 4);
    return { ai: 'roam', target: { x: w.centerX + Math.cos(ang) * r, y: w.centerY + Math.sin(ang) * r }, rival: null };
  }
  // A rival close by: battle one this team can take, keep away from one that would crush it.
  // (Within the battle range a battle starts either way: backing off is the only way out.)
  if (rival) {
    const edge = duelMargin(t, rival, field);
    // Each trainer has its own nerve (`bold`, 0 cautious to 1 bold): how big an edge it wants before
    // it goes looking for a battle, and how far behind it has to be before it runs. In the first two
    // minutes (one Pokémon each, everyone still levelling) nobody goes looking for one; up to four
    // minutes in, only with a big edge.
    const bold = w.bold ?? 0.5;
    const time = w.time ?? 999;
    const seek = time < 120 ? Infinity : (time < 240 ? SEEK_DUEL_EARLY : SEEK_DUEL) + 0.4 * (1 - bold);
    const avoid = AVOID_DUEL + 0.2 * (1 - bold);
    const dr = Math.hypot(rival.x - t.x, rival.y - t.y);
    // The last two have to settle it: no running from that one (unless hurt, above).
    if (rival === w.lastFoe && hpFrac > CONFIG.trainers.huntHpFraction) return { ai: 'engage', target: { x: rival.x, y: rival.y }, rival, key: 'last' };
    // Goes after it; one that keeps running is given up on (the walk-progress check bans its key).
    if (edge >= seek && dr < 9 && !banned(`r${rival.id}`)) return { ai: 'engage', target: { x: rival.x, y: rival.y }, rival, key: `r${rival.id}` };
    // Clearly behind: keep well out of battle range (a battle starts within it either way).
    if (edge < avoid) return { ai: 'flee', target: awayFrom(t, rival.x, rival.y, 5, w), rival: null, why: 'rival' };
    // In between: neither looks for the battle nor runs from it; it gets on with its own business.
  }
  // The last two: go and find the other one (after patching up if the team is in a bad way).
  // (Where the other one is can't be seen from here, as for a player: it heads in toward the crystal,
  // where the storm is pushing them both, and battles them on sight above.)
  if (w.lastFoe && w.lastFoe.alive && hpFrac > CONFIG.trainers.huntHpFraction && !(w.banned?.('last') ?? false)) {
    const inner = Number.isFinite(w.darkRadius) ? Math.max(4, w.darkRadius * 0.4) : 30;
    const dc = Math.hypot(t.x - w.centerX, t.y - w.centerY);
    if (dc > inner) {
      const k = inner / dc;
      return { ai: 'engage', target: { x: w.centerX + (t.x - w.centerX) * k, y: w.centerY + (t.y - w.centerY) * k }, rival: null, key: 'last' };
    }
  }
  // Back away from a wild Pokémon that would beat the team as it stands.
  const danger = dangerNear(t, w.wilds, 8, t.x, t.y, field, w.throwAt ?? null);
  if (danger) return { ai: 'flee', target: awayFrom(t, danger.x, danger.y, 6, w), rival: null, why: 'wild' };
  // Already in a fight with a wild it can take: finish it (no walking off to a shop or an item mid-fight).
  const foe = w.fighting;
  if (foe && !foe.fainted && !banned(`m${foe.id}`) && (foe.captured || fightMargin(t, foe, field) >= DANGER_MARGIN)) {
    return { ai: 'hunt', target: { x: foe.x, y: foe.y }, rival: null, key: `m${foe.id}`, catchTarget: w.wantsCatch?.(foe) ? foe : null };
  }
  // Items close by first, then the best wild to train on, then items further off.
  const lightItems = Number.isFinite(w.darkRadius) ? w.items.filter((it) => Math.hypot(it.x - w.centerX, it.y - w.centerY) < w.darkRadius - 3) : w.items;
  const item = nearestItem(t, lightItems, 9, banned);
  const itemOk = item && !dangerNear(t, w.wilds, 8, item.x, item.y, field);
  const seek = (it: GroundItem): AiDecision => ({ ai: 'seekItem', target: { x: it.x, y: it.y }, rival: null, key: `i${it.id}` });
  if (item && itemOk && Math.hypot(item.x - t.x, item.y - t.y) < 4) return seek(item);
  // Worn down (or half the team fainted): patch up at the nearest outpost it can reach, then hunt again.
  // Just healed (the outpost is cooling down) and the rest are fine: keep training meanwhile.
  const team = t.party.filter((m) => !m.captured);
  const fainted = team.filter((m) => m.fainted).length >= Math.max(1, Math.ceil(team.length / 2));
  const standing = activeParty(t);
  const standingHp = standing.reduce((a, m) => a + m.hp, 0) / Math.max(1, standing.reduce((a, m) => a + m.maxHp, 0));
  const cooling = (w.time ?? 0) < t.outpostReady && standing.length > 0 && standingHp > CONFIG.trainers.huntHpFraction;
  if ((fainted || hpFrac <= CONFIG.trainers.huntHpFraction) && !cooling && outpost && Math.hypot(outpost.x - t.x, outpost.y - t.y) < CONFIG.trainers.healTripRange) {
    return { ai: 'heal', target: outpost, rival: null, key: `o${outpostIdx}` };
  }
  // Out of balls with the money for more and a shop in reach: restock.
  if (w.shop && !banned('shop')) return { ai: 'shop', target: w.shop, rival: null, key: 'shop' };
  // Hunt: train on (or catch) a wild the team beats comfortably, while the Pokémon standing are in shape.
  if (standing.length && standingHp > CONFIG.trainers.huntHpFraction) {
    const lightR = Number.isFinite(w.darkRadius) ? w.darkRadius - 3 : Infinity;
    const inLight = (x: number, y: number) => Math.hypot(x - w.centerX, y - w.centerY) < lightR && !avoided(x, y);
    // Something it beats comfortably; failing that, with the team fresh, a closer fight it still wins.
    const pick = huntTarget(t, w.wilds, CONFIG.trainers.huntRange, inLight, banned, field, w.wantsCatch)
      ?? (hpFrac > 0.8 ? huntTarget(t, w.wilds, CONFIG.trainers.huntRange, inLight, banned, field, w.wantsCatch, (w.sinceHunt ?? 0) > 45 ? EVEN_MARGIN : CLOSE_MARGIN) : null);
    if (pick) return { ai: 'hunt', target: { x: pick.mon.x, y: pick.mon.y }, rival: null, key: `m${pick.mon.id}`, catchTarget: pick.catch ? pick.mon : null };
  }
  // Nothing it can beat in sight, a small team and a ball: try for a catch from out of reach.
  const shot = w.throwAt;
  if (shot && !shot.fainted && !banned(`m${shot.id}`)) return { ai: 'hunt', target: { x: shot.x, y: shot.y }, rival: null, key: `m${shot.id}`, catchTarget: shot, throwOnly: true };
  if (item && itemOk) return seek(item);
  // Nothing to hunt here for a while: set off for another part of the island (another land has other
  // Pokémon, some its team can beat), as a player would rather than pace the same few tiles.
  const safeR = Math.max(4, w.darkRadius - 6);
  if (w.exploring && Math.hypot(w.exploring.x - t.x, w.exploring.y - t.y) > 2 && Math.hypot(w.exploring.x - w.centerX, w.exploring.y - w.centerY) < safeR && !banned('explore')) {
    return { ai: 'roam', target: w.exploring, rival: null, key: 'explore' };
  }
  if ((w.idle ?? 0) > 12 && !banned('explore')) {
    for (let i = 0; i < 16; i++) {
      const ang = w.rng.range(0, Math.PI * 2);
      const dist = w.rng.range(25, 45);
      const x = t.x + Math.cos(ang) * dist;
      const y = t.y + Math.sin(ang) * dist;
      if (!w.ground.reachable(Math.floor(x), Math.floor(y)) || Math.hypot(x - w.centerX, y - w.centerY) >= safeR || avoided(x, y)) continue;
      return { ai: 'roam', target: { x, y }, rival: null, key: 'explore' };
    }
  }
  // Roam: a random reachable point inside the light, no nearer the crystal than the team can handle
  // (unless the darkness has pushed everyone in), and away from wild Pokémon that outclass it.
  // Mostly onward (the way it was already heading), so it covers ground instead of pacing a corner.
  const safe = Math.max(4, w.darkRadius - 2);
  const comfort = Math.min(w.comfortRadius?.(teamLevel(t)) ?? 0, safe - 8);
  const f = DIR_VECTORS[t.dir] as { x: number; y: number } | undefined;
  const heading = f ? Math.atan2(f.y, f.x) : null;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < 10; i++) {
      const ang = heading !== null && i < 6 ? heading + w.rng.range(-1.1, 1.1) : w.rng.range(0, Math.PI * 2);
      const dist = w.rng.range(5, 11);
      const x = t.x + Math.cos(ang) * dist;
      const y = t.y + Math.sin(ang) * dist;
      const dc = Math.hypot(x - w.centerX, y - w.centerY);
      if (!w.ground.reachable(Math.floor(x), Math.floor(y)) || dc >= safe) continue;
      if (pass === 0 && (dc < comfort || avoided(x, y) || dangerNear(t, w.wilds, 8, x, y, field))) continue;
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
