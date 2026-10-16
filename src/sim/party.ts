/**
 * Party behaviour: every party member steers on its own instead of
 * following in a line. A loose leash keeps it near its trainer with a
 * preferred offset per slot, separation keeps members off each other, idle
 * members wander and pause, the lead turns toward the nearest threat.
 *
 * Behaviours (data/config.json "party"):
 *   aggressive  chase any hostile within 8 tiles, stay within the leash
 *   guard       fight only what comes within 3 tiles of the trainer
 *   passive     never attack, dodge telegraphs, stay close
 *   hold        stand still, attack only what is adjacent
 *   roam        leave the trainer: wander the map, hunt wild Pokémon, keep
 *               all XP, flee to the trainer under 25% HP
 *   roam-aggressive  roam, but fight to the end
 */
import { DIR_VECTORS, dirFromVector, type Dir8 } from '../core/math';
import type { Rng } from '../core/rng';
import type { GroundRenderer } from '../ground/types';
import { CONFIG, hitPad, statsAtLevel } from './data';
import { incapable, type Mon, type Trainer } from './entities';
import { canStand, tryMove } from './movement';
import type { Nav } from './nav';

export type Behavior = 'aggressive' | 'guard' | 'passive' | 'hold' | 'roam' | 'roam-aggressive';
/**
 * The choices the player cycles through: Attack (go after anything in range), Guard (fight what
 * comes near) and Follow (stay out of fights). Hold and the roaming modes are for rivals and scripts.
 */
export const BEHAVIORS: readonly Behavior[] = ['aggressive', 'guard', 'passive'];
export const BEHAVIOR_LABEL: Record<Behavior, string> = {
  aggressive: 'Attack',
  guard: 'Guard',
  passive: 'Follow',
  hold: 'Hold',
  roam: 'Roam',
  'roam-aggressive': 'Roam (Aggr.)',
};

export function isRoaming(m: Mon): boolean {
  return m.behavior === 'roam' || m.behavior === 'roam-aggressive';
}

export function nextBehavior(b: Behavior): Behavior {
  const i = BEHAVIORS.indexOf(b);
  return BEHAVIORS[i < 0 ? 0 : (i + 1) % BEHAVIORS.length] as Behavior;
}

/** Preferred spot relative to the trainer for the member in formation slot `slot` (0 = lead). */
export function formationOffset(slot: number, dir: Dir8): { x: number; y: number } {
  const f = DIR_VECTORS[dir] as { x: number; y: number };
  const n = Math.hypot(f.x, f.y) || 1;
  const fx = f.x / n;
  const fy = f.y / n;
  const px = -fy;
  const py = fx;
  if (slot === 0) return { x: fx * 0.35 + px * 0.75, y: fy * 0.35 + py * 0.75 };
  const side = slot % 2 === 1 ? -1 : 1;
  const back = 1.1 + Math.floor((slot + 1) / 2) * 0.55;
  return { x: -fx * back + px * side * 0.9, y: -fy * back + py * side * 0.9 };
}

export interface PartyWorld {
  ground: GroundRenderer;
  rng: Rng;
  /** All active Pokémon on the field (for separation, threats, hunting). */
  mons: () => Iterable<Mon>;
  isEnemy: (a: Mon, b: Mon) => boolean;
  active: (m: Mon) => boolean;
  /** Point inside a hostile telegraph? (passive members dodge) */
  inHostileTelegraph: (m: Mon) => boolean;
  /** Ask a member to attack a target now (cooldowns permitting). */
  attack: (m: Mon, target: Mon, range: number) => void;
  centerX: number;
  centerY: number;
  /** Routes around cliffs and water when the way to the goal is not a straight line. */
  nav?: Nav;
}

function nearestHostile(m: Mon, w: PartyWorld, range: number, from = { x: m.x, y: m.y }, wildOnly = false): Mon | null {
  let best: Mon | null = null;
  let bd = range;
  for (const o of w.mons()) {
    if (o === m || !w.active(o) || !w.isEnemy(m, o)) continue;
    if (wildOnly && !o.wild) continue;
    const d = Math.hypot(o.x - from.x, o.y - from.y);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

function separation(m: Mon, t: Trainer, w: PartyWorld): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  const mine = hitPad(m.species);
  const push = (ox: number, oy: number, weight: number, pad = 0) => {
    // Big bodies keep each other (and their trainer) further off.
    const R = CONFIG.party.separation + mine + pad;
    const dx = m.x - ox;
    const dy = m.y - oy;
    const d = Math.hypot(dx, dy);
    if (d >= R || d < 1e-4) return;
    const k = ((R - d) / R) * weight;
    sx += (dx / d) * k;
    sy += (dy / d) * k;
  };
  for (const o of t.party) if (o !== m && w.active(o) && !isRoaming(o)) push(o.x, o.y, 1, hitPad(o.species));
  push(t.x, t.y, 1.4);
  for (const o of w.mons()) if (o.owner !== t && w.active(o)) push(o.x, o.y, 0.6, hitPad(o.species));
  return { x: sx, y: sy };
}

/** Moves one member toward `px, py` with separation; returns distance moved. */
function steer(m: Mon, t: Trainer, w: PartyWorld, px: number, py: number, speed: number, dt: number, stopAt: number): number {
  const dx = px - m.x;
  const dy = py - m.y;
  const d = Math.hypot(dx, dy);
  let vx = 0;
  let vy = 0;
  if (d > stopAt) {
    let ux = dx / d;
    let uy = dy / d;
    if (w.nav && d > 1.2 && !w.nav.clearLine(m.x, m.y, px, py)) {
      const step = w.nav.dir(m.x, m.y, px, py);
      if (step) {
        ux = step.x;
        uy = step.y;
      }
    }
    vx = ux * speed;
    vy = uy * speed;
  }
  const s = separation(m, t, w);
  vx += s.x * CONFIG.party.separationForce;
  vy += s.y * CONFIG.party.separationForce;
  const v = Math.hypot(vx, vy);
  if (v < 0.05) return 0;
  const cap = Math.max(speed, 1.5);
  if (v > cap) {
    vx = (vx / v) * cap;
    vy = (vy / v) * cap;
  }
  const moved = tryMove(w.ground, m, vx * dt, vy * dt, 0.22);
  if (moved > 1e-4) m.dir = dirFromVector(vx, vy, m.dir);
  return moved;
}

function setWalking(m: Mon, walking: boolean): void {
  if (m.casting || incapable(m) || m.anim.action === 'Hurt') return;
  if (walking !== m.moving) {
    m.moving = walking;
    m.anim.play(walking ? 'Walk' : 'Idle');
  }
}

/** Advances every active member of a trainer's party for one step. */
export function stepParty(t: Trainer, lead: Mon | null, dt: number, w: PartyWorld): void {
  const c = CONFIG.party;
  let slot = 0;
  for (const m of t.party) {
    if (!w.active(m) || incapable(m)) continue;
    if (m.casting) {
      m.anim.dir = m.dir;
      continue;
    }
    const distT = Math.hypot(t.x - m.x, t.y - m.y);
    const isLead = m === lead;

    // ---- Roaming: alone on the map.
    if (isRoaming(m)) {
      const low = m.hp < m.maxHp * c.roamFleeFraction && m.behavior === 'roam';
      if (m.recall || low) {
        // Path back to the trainer; rejoin as a guard on arrival.
        const moved = steer(m, t, w, t.x, t.y, c.hurrySpeed, dt, 1.4);
        setWalking(m, moved > 1e-4);
        if (distT < 2) {
          m.recall = false;
          m.behavior = 'guard';
          m.roamTarget = null;
        }
        continue;
      }
      const prey = m.target && w.active(m.target) ? m.target : nearestHostile(m, w, c.roamHuntRange, undefined, true);
      m.target = prey;
      if (prey) {
        const dp = Math.hypot(prey.x - m.x, prey.y - m.y);
        m.dir = dirFromVector(prey.x - m.x, prey.y - m.y, m.dir);
        if (dp > 2.2) {
          const moved = steer(m, t, w, prey.x, prey.y, c.chaseSpeed, dt, 2.0);
          setWalking(m, moved > 1e-4);
        } else {
          setWalking(m, false);
          m.dir = dirFromVector(prey.x - m.x, prey.y - m.y, m.dir);
        }
        w.attack(m, prey, 4);
        continue;
      }
      if (!m.roamTarget || Math.hypot(m.roamTarget.x - m.x, m.roamTarget.y - m.y) < 0.4) {
        m.roamTarget = null;
        for (let i = 0; i < 8 && !m.roamTarget; i++) {
          const ang = w.rng.range(0, Math.PI * 2);
          const r = w.rng.range(3, 7);
          const x = m.x + Math.cos(ang) * r;
          const y = m.y + Math.sin(ang) * r;
          if (w.ground.reachable(Math.floor(x), Math.floor(y))) m.roamTarget = { x, y };
        }
      }
      if (m.roamTarget) {
        const moved = steer(m, t, w, m.roamTarget.x, m.roamTarget.y, c.wanderSpeed * 1.4, dt, 0.3);
        setWalking(m, moved > 1e-4);
        if (moved < 1e-4) m.roamTarget = null;
      }
      continue;
    }

    // ---- Formation members.
    const off = formationOffset(slot, t.dir);
    slot++;
    const desiredX = t.x + off.x;
    const desiredY = t.y + off.y;
    const leash = m.behavior === 'passive' ? c.leashPassive : isLead ? c.leashLead : c.leash;
    const threat = nearestHostile(m, w, m.behavior === 'aggressive' ? c.aggressiveRange : 6);
    const threatNearTrainer = threat ? Math.hypot(threat.x - t.x, threat.y - t.y) : Infinity;

    // Hold: stand still, hit what is adjacent.
    if (m.behavior === 'hold') {
      setWalking(m, false);
      if (threat && Math.hypot(threat.x - m.x, threat.y - m.y) < 1.3) {
        m.dir = dirFromVector(threat.x - m.x, threat.y - m.y, m.dir);
        w.attack(m, threat, 1.4);
      }
      continue;
    }

    // Passive: dodge any hostile telegraph it is standing in.
    if (m.behavior === 'passive' && w.inHostileTelegraph(m)) {
      const f = DIR_VECTORS[m.dir] as { x: number; y: number };
      const moved = steer(m, t, w, m.x - f.y * 1.5, m.y + f.x * 1.5, c.hurrySpeed, dt, 0.1);
      setWalking(m, moved > 1e-4);
      continue;
    }

    // Aggressive: chase hostiles within range, as long as the trainer stays inside the leash.
    let chasing: Mon | null = null;
    if (m.behavior === 'aggressive' && threat && threatNearTrainer < leash + 2) chasing = threat;
    if (m.behavior === 'guard' && threat && threatNearTrainer < c.guardRange) chasing = threat;
    if (chasing) {
      const dp = Math.hypot(chasing.x - m.x, chasing.y - m.y);
      if (dp > 2.4) {
        const moved = steer(m, t, w, chasing.x, chasing.y, c.chaseSpeed, dt, 2.2);
        setWalking(m, moved > 1e-4);
      } else {
        setWalking(m, false);
        m.dir = dirFromVector(chasing.x - m.x, chasing.y - m.y, m.dir);
      }
      m.target = chasing;
      w.attack(m, chasing, 4);
      continue;
    }

    // Formation: hurry back when past the leash, settle onto the preferred spot, otherwise wander and pause.
    const dDesired = Math.hypot(desiredX - m.x, desiredY - m.y);
    if (distT > leash || t.moving || dDesired > 1.2) {
      const speed = distT > leash + 1 ? c.hurrySpeed : c.followSpeed;
      const moved = steer(m, t, w, desiredX, desiredY, speed, dt, 0.25);
      setWalking(m, moved > 1e-4);
      m.wanderPause = w.rng.range(c.pauseMin, c.pauseMax);
      m.wander = null;
      continue;
    }
    if (m.wanderPause > 0) {
      m.wanderPause -= dt;
      setWalking(m, false);
      if (isLead) m.dir = threat ? dirFromVector(threat.x - m.x, threat.y - m.y, m.dir) : t.dir;
      continue;
    }
    if (!m.wander) {
      m.wander = { x: desiredX + w.rng.range(-0.8, 0.8), y: desiredY + w.rng.range(-0.8, 0.8), t: w.rng.range(1.5, 3.5) };
      if (!canStand(w.ground, m.wander.x, m.wander.y, 0.22)) m.wander = { x: desiredX, y: desiredY, t: 1 };
    }
    m.wander.t -= dt;
    const moved = steer(m, t, w, m.wander.x, m.wander.y, c.wanderSpeed, dt, 0.15);
    setWalking(m, moved > 1e-4);
    if (moved < 1e-4 || m.wander.t <= 0) {
      m.wander = null;
      m.wanderPause = w.rng.range(c.pauseMin, c.pauseMax);
    }
    if (isLead && threat) m.dir = dirFromVector(threat.x - m.x, threat.y - m.y, m.dir);
  }
}

// ---------------------------------------------------------------- XP

export function xpToNext(level: number): number {
  const p = CONFIG.party as typeof CONFIG.party & { xpPerLevelSq?: number };
  return Math.round(p.xpBase + level * p.xpPerLevel + level * level * (p.xpPerLevelSq ?? 0));
}

/** XP for knocking out `target`; beating something above your level pays up to double. */
export function xpForKnockout(target: Mon, dealerLevel = target.level): number {
  const p = CONFIG.party;
  const base = p.xpKoBase + target.level * p.xpKoPerLevel;
  const gap = Math.max(0, target.level - dealerLevel);
  const bonus = target.landBoss ? p.xpBossMultiplier : target.alpha ? p.xpAlphaMultiplier : target.elite ? p.xpEliteMultiplier : 1;
  return Math.round(base * Math.min(2, 1 + 0.1 * gap) * bonus);
}

/** Adds XP, levelling up as needed. Returns the number of levels gained. */
export function gainXp(m: Mon, amount: number): number {
  if (m.fainted || amount <= 0) return 0;
  m.xp += amount;
  let gained = 0;
  while (m.xp >= xpToNext(m.level) && m.level < 100) {
    m.xp -= xpToNext(m.level);
    m.level++;
    gained++;
    const before = m.maxHp;
    m.stats = statsAtLevel(m.species.stats, m.level);
    m.maxHp = m.boss ? m.maxHp : m.stats.hp;
    m.hp = Math.min(m.maxHp, m.hp + Math.max(0, m.maxHp - before));
  }
  return gained;
}

/**
 * XP from a knockout: the dealer gets the full amount; unless it roams,
 * every other party member out on the field within `shareRange` tiles of the
 * knockout gets half, and those waiting in their balls get benchShare.
 * Fainted Pokémon get nothing.
 */
export function shareKnockoutXp(dealer: Mon, target: Mon, party: Mon[], shareRange: number): Array<{ mon: Mon; xp: number; levels: number }> {
  const out: Array<{ mon: Mon; xp: number; levels: number }> = [];
  const total = xpForKnockout(target, dealer.level);
  // A Lucky Egg makes its holder's share half again as big.
  const egg = (m: Mon, xp: number) => (m.heldItem === 'lucky-egg' ? Math.round(xp * 1.5) : xp);
  if (!dealer.fainted) {
    const xp = egg(dealer, total);
    out.push({ mon: dealer, xp, levels: gainXp(dealer, xp) });
  }
  if (isRoaming(dealer)) return out;
  const bench = (CONFIG.party as typeof CONFIG.party & { benchShare?: number }).benchShare ?? 0;
  for (const m of party) {
    if (m === dealer || m.fainted || isRoaming(m)) continue;
    // An Exp. Share holder takes the full amount wherever it is.
    if (m.heldItem === 'exp-share') {
      const xp = egg(m, total);
      out.push({ mon: m, xp, levels: gainXp(m, xp) });
      continue;
    }
    // Waiting in a ball: a small share. Out on the field nearby: half.
    if (m.stowed) {
      const part = egg(m, Math.floor(total * bench));
      if (part > 0) out.push({ mon: m, xp: part, levels: gainXp(m, part) });
      continue;
    }
    if (Math.hypot(m.x - target.x, m.y - target.y) > shareRange) continue;
    const half = egg(m, Math.floor(total / 2));
    out.push({ mon: m, xp: half, levels: gainXp(m, half) });
  }
  return out;
}
