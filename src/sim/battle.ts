/**
 * Overworld battles: engagement, telegraphed casts, area shapes, damage,
 * status and knockouts. Pure simulation; it reports what happened through
 * `events`, which the renderer turns into VFX, numbers and hit-stop.
 */
import { hasAction, strikeTime } from './strikeTimes';
import { DIR_VECTORS, dirFromVector, type Dir8 } from '../core/math';
import type { Rng } from '../core/rng';
import { CONFIG, MOVES, bodyRadius, contactReach, drawScale, effectiveness, hitPad, isContact, move, moveSpeed, movesAt, type MoveDef, type StatusKind } from './data';
import { ITEMS, type BallKind } from './items';
import { incapable, type InventorySlot, type Mon, type Trainer } from './entities';
import type { Duel } from './match';

export interface Area {
  shape: MoveDef['shape'];
  /** Origin (caster position at cast start) and target point / facing, in tiles. */
  ox: number;
  oy: number;
  tx: number;
  ty: number;
  /** Unit facing vector for line and cone. */
  fx: number;
  fy: number;
}

export type BattleEvent =
  | { type: 'cast'; attacker: Mon; move: MoveDef; area: Area }
  | { type: 'resolve'; attacker: Mon; move: MoveDef; area: Area; hits: Mon[]; /** One pulse of a channelled beam. */ pulse?: boolean }
  | { type: 'hit'; attacker: Mon; target: Mon; move: MoveDef; damage: number; effectiveness: number; crit: boolean; /** One pulse of a channelled beam. */ pulse?: boolean }
  | { type: 'status'; target: Mon; status: StatusKind }
  | { type: 'stages'; target: Mon; stat: 'atk' | 'def' | 'spe'; delta: number }
  | { type: 'tick'; target: Mon; damage: number; source: 'burn' | 'dreams' | 'poison' | 'recoil' }
  | { type: 'heal'; mon: Mon; amount: number; move: MoveDef }
  | { type: 'thaw'; mon: Mon }
  | { type: 'dodged'; mon: Mon }
  | { type: 'dodge-start'; mon: Mon }
  | { type: 'channel-start'; mon: Mon; move: MoveDef }
  | { type: 'channel-end'; mon: Mon }
  | { type: 'styler-loop'; mon: Mon; loops: number; needed: number }
  | { type: 'styler-break'; mon: Mon }
  | { type: 'calmed'; mon: Mon }
  | { type: 'darkrai-grab'; trainer: Trainer; x: number; y: number }
  | { type: 'scene-fx'; id: string; x: number; y: number; scale: number; ground?: boolean; tint?: string; fps?: number; lift?: number; shake?: number; /** Lugia, Darkrai or Shadow Mewtwo: the only moments the camera shakes. */ epic?: boolean }
  | { type: 'yield'; mon: Mon; by: Mon | null }
  | { type: 'confused'; mon: Mon }
  | { type: 'faint'; mon: Mon; by: Mon | null }
  | { type: 'wake'; mon: Mon }
  | { type: 'text'; mon: Mon; text: string }
  | { type: 'notice'; text: string; seconds?: number; /** Online: the one player (trainer id) it is for; everyone when absent. */ to?: number }
  | { type: 'downed'; trainer: Trainer; seconds: number }
  | { type: 'mega-start'; mon: Mon }
  | { type: 'fish'; stage: 'cast' | 'land' | 'bite'; x: number; y: number }
  | { type: 'respawned'; trainer: Trainer }
  | { type: 'caught'; mon: Mon; by: Trainer }
  | { type: 'broke-free'; mon: Mon }
  | { type: 'pickup'; trainer: Trainer; items: InventorySlot[]; ball: BallKind; healed: boolean }
  | { type: 'eliminated'; trainer: Trainer }
  | { type: 'xp'; mon: Mon; xp: number; levels: number }
  | { type: 'evolve-start'; mon: Mon }
  | { type: 'money'; trainer: Trainer; amount: number; x: number; y: number }
  | { type: 'evolved'; mon: Mon; from: string }
  | { type: 'ball-hit'; mon: Mon; x: number; y: number }
  | { type: 'ball-absorb'; mon: Mon; x: number; y: number }
  | { type: 'ball-click'; mon: Mon; x: number; y: number }
  | { type: 'ball-burst'; mon: Mon; x: number; y: number }
  | { type: 'learned'; mon: Mon; moveId: string; forgot: string | null }
  | { type: 'released'; mon: Mon }
  | { type: 'extracted'; mon: Mon; via: 'win' | 'voucher' }
  | { type: 'duel-start'; duel: Duel }
  | { type: 'duel-send'; duel: Duel; mon: Mon; trainer: Trainer }
  | { type: 'duel-end'; duel: Duel; winner: Trainer };

/** The white hit flash: two frames (it also runs down through a hit-stop: Match.step). */
export const HIT_FLASH = 2 / 60;

const STAGE_MULT = (s: number): number => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));

/** Shape sizes are designed in "big" tiles; the 16 px tileset packs more tiles per sprite, so they scale up. */
export const R = (): number => CONFIG.battle.rangeScale;

/** True when a body at (x, y) is inside the area; `pad` widens it for big bodies (tiles). */
export function areaContains(a: Area, x: number, y: number, pad = 0): boolean {
  const k = R();
  switch (a.shape) {
    case 'single':
      return Math.hypot(x - a.tx, y - a.ty) < 0.65 * k + pad;
    case 'self':
      return Math.hypot(x - a.ox, y - a.oy) < 0.4 * k + pad;
    case 'ring': {
      const d = Math.hypot(x - a.ox, y - a.oy);
      return d > 0.3 * k - pad && d < 2.3 * k + pad;
    }
    case 'line':
    case 'cone': {
      const dx = x - a.ox;
      const dy = y - a.oy;
      const along = dx * a.fx + dy * a.fy;
      const perp = Math.abs(dx * -a.fy + dy * a.fx);
      if (a.shape === 'line') return along > 0.25 * k - pad && along < 3.4 * k + pad && perp < 0.55 * k + pad;
      return along > 0.25 * k - pad && along < 2.9 * k + pad && perp < (0.45 + along / k * 0.5) * k + pad;
    }
  }
}

export function makeArea(move: MoveDef, caster: Mon, targetX: number, targetY: number): Area {
  let fx = targetX - caster.x;
  let fy = targetY - caster.y;
  const d = Math.hypot(fx, fy);
  if (d < 1e-3) {
    fx = 0;
    fy = 1;
  } else {
    fx /= d;
    fy /= d;
  }
  return { shape: move.shape, ox: caster.x, oy: caster.y, tx: targetX, ty: targetY, fx, fy };
}

export interface DamageResult {
  damage: number;
  effectiveness: number;
  crit: boolean;
  /** With a `scale` (a beam's pulse): the damage before rounding down. */
  raw?: number;
}

/**
 * `scale`: the share of one full hit this hit carries (a channelled beam's pulse); it scales the
 * whole formula, the flat +2 included, so a beam's pulses add up to its multiple of one hit.
 * With `scale`, `raw` holds the unrounded damage and `damage` is not floored to a minimum of 1:
 * the beam carries the fraction to its next pulse on the same target (BattleSystem.landPulse).
 */
export function computeDamage(rng: Rng, attacker: Mon, defender: Mon, m: MoveDef, scale?: number): DamageResult {
  const eff = effectiveness(m.type, defender.types);
  if (m.category === 'status' || m.power <= 0 || eff === 0) return { damage: 0, effectiveness: eff, crit: false };
  const a = (m.category === 'physical' ? attacker.stats.atk : attacker.stats.spa) * STAGE_MULT(attacker.stages.atk);
  const d = (m.category === 'physical' ? defender.stats.def : defender.stats.spd) * STAGE_MULT(defender.stages.def);
  let dmg = (((2 * attacker.level) / 5 + 2) * m.power * (a / d)) / 50 + 2;
  if (attacker.types.includes(m.type)) dmg *= CONFIG.battle.stab;
  dmg *= eff;
  // Held items.
  const held = attacker.heldItem ? ITEMS[attacker.heldItem] : undefined;
  if (held?.effect === 'choice-band' && m.category === 'physical') dmg *= 1.5;
  if (held?.effect === 'life-orb') dmg *= 1.3;
  if (held?.effect === 'type-boost' && held.boostType === m.type) dmg *= 1.2;
  const crit = rng.chance(CONFIG.battle.critChance);
  if (crit) dmg *= 1.5;
  if (attacker.status === 'burn' && m.category === 'physical') dmg *= 0.5;
  if (attacker.boss) dmg *= CONFIG.battle.bossDamageScale;
  if (attacker.shadow && attacker.owner?.legendBout) dmg *= CONFIG.shadowLugia.damageScale;
  dmg *= (CONFIG.battle as typeof CONFIG.battle & { damageScale?: number }).damageScale ?? 1;
  dmg *= rng.range(0.85, 1);
  if (scale !== undefined) {
    dmg *= scale;
    return { damage: Math.floor(dmg), effectiveness: eff, crit, raw: dmg };
  }
  return { damage: Math.max(1, Math.floor(dmg)), effectiveness: eff, crit };
}

/**
 * The damage a move does on average (computeDamage without the dice: the 0.85-1 roll at its middle,
 * crits at their odds). For trainers sizing up a fight.
 */
export function expectedDamage(attacker: Mon, defender: Mon, m: MoveDef, seen = false): number {
  const eff = effectiveness(m.type, defender.types);
  if (m.category === 'status' || m.power <= 0 || eff === 0) return 0;
  const a = (m.category === 'physical' ? attacker.stats.atk : attacker.stats.spa) * STAGE_MULT(attacker.stages.atk);
  const d = Math.max(1, (m.category === 'physical' ? defender.stats.def : defender.stats.spd) * STAGE_MULT(defender.stages.def));
  let dmg = (((2 * attacker.level) / 5 + 2) * m.power * (a / d)) / 50 + 2;
  if (attacker.types.includes(m.type)) dmg *= CONFIG.battle.stab;
  dmg *= eff;
  // Someone else's Pokémon (`seen`): what it holds can't be seen, so it isn't counted.
  const held = attacker.heldItem && !seen ? ITEMS[attacker.heldItem] : undefined;
  if (held?.effect === 'choice-band' && m.category === 'physical') dmg *= 1.5;
  if (held?.effect === 'life-orb') dmg *= 1.3;
  if (held?.effect === 'type-boost' && held.boostType === m.type) dmg *= 1.2;
  dmg *= 1 + 0.5 * CONFIG.battle.critChance;
  if (attacker.status === 'burn' && m.category === 'physical') dmg *= 0.5;
  if (attacker.boss) dmg *= CONFIG.battle.bossDamageScale;
  dmg *= (CONFIG.battle as typeof CONFIG.battle & { damageScale?: number }).damageScale ?? 1;
  return dmg * 0.925;
}

/**
 * Damage a second `attacker` deals `defender` while it keeps casting: each damaging move's average
 * hit over its cooldown, capped by how often a Pokémon gets a move off at all (`actEvery` seconds).
 * `seen`: someone else's Pokémon, judged only on what a player could see or know of it (its species,
 * level, HP bar and stat changes): the moves its species knows at that level, no held item.
 */
export function damageRate(attacker: Mon, defender: Mon, actEvery = 1.1, seen = false): number {
  let sum = 0;
  let top = 0;
  for (const id of seen ? movesAt(attacker.species, attacker.level) : attacker.moves) {
    if (!MOVES.has(id)) continue;
    const mv = move(id);
    const dmg = expectedDamage(attacker, defender, mv, seen);
    if (dmg <= 0) continue;
    sum += dmg / Math.max(0.5, mv.cooldown + (mv.cast ?? CONFIG.battle.castSeconds));
    top = Math.max(top, dmg);
  }
  return Math.min(sum, top / actEvery);
}

/** Score a move for AI selection: expected damage with a bonus for applying a fresh status. */
export function moveScore(attacker: Mon, target: Mon, m: MoveDef): number {
  const eff = effectiveness(m.type, target.types);
  // What it would actually hit with: the attack stat the move uses against the target's matching
  // defence, as computeDamage reckons it (an Infernape with Fire Punch and Flamethrower punches
  // when its Attack is the better stat, or the target's Sp. Def is the higher wall).
  const atk = (m.category === 'physical' ? attacker.stats.atk : attacker.stats.spa) * STAGE_MULT(attacker.stages.atk);
  const def = Math.max(1, m.category === 'physical' ? target.stats.def : target.stats.spd);
  let score = m.power * eff * (attacker.types.includes(m.type) ? CONFIG.battle.stab : 1) * (m.power > 0 ? (atk / def) / ((attacker.stats.atk + attacker.stats.spa) / 2 / Math.max(1, (target.stats.def + target.stats.spd) / 2)) : 0);
  if (m.status && !target.status && eff > 0) score += 45 * m.status.chance;
  // Stat moves: worth a turn while the stat has room to move, never spammed past +2 / -2.
  const self = m.stages?.self;
  if (self) {
    const room = (Object.entries(self) as Array<['atk' | 'def' | 'spe', number]>).some(([k, d]) => d > 0 && attacker.stages[k] < 2);
    if (room) score += m.power > 0 ? 10 : 28;
  }
  const tgt = m.stages?.target;
  if (tgt && m.power <= 0) {
    const room = (Object.entries(tgt) as Array<['atk' | 'def' | 'spe', number]>).some(([k]) => target.stages[k] > -2);
    score += room ? 22 : 0;
  }
  if (m.shape === 'self' && !m.stages) score = 0;
  return score;
}

/**
 * Seconds from a move resolving to it reaching a target: a thrown move (a projectile) flies there,
 * a falling one (from the sky) drops onto the middle of its body, a beam takes a moment to reach;
 * anything else lands at once. The damage waits for this, so HP drops as the effect arrives.
 */
/**
 * How far off a move can be used to effect, in tiles: a ring reaches round its user, a cone and a
 * line out ahead of it, a contact move as far as its lunge comfortably carries, a ranged single
 * move a good way. AI Pokémon get within this before using the move (Match.holdRange).
 */
export function moveReach(m: MoveDef): number {
  const k = R();
  switch (m.shape) {
    case 'self':
      return 99;
    case 'ring':
      return 2.3 * k * 0.8;
    case 'cone':
      return 2.9 * k * 0.85;
    case 'line':
      return 3.4 * k * 0.85;
    default:
      // A lunge covers lunge.maxTiles (more for a dash) and ends with the bodies touching; a slam
      // jumps a little further; anything thrown, shot or called down reaches a good way.
      if (isContact(m)) return 0.6 + CONFIG.battle.lunge.maxTiles * (m.dash ?? 1) + (m.reach ?? 0);
      if (m.leap) return 4.2;
      return 5;
  }
}

/** Does a shot from (ax, ay) to (bx, by) get there? Set by the match (walls, trees, buildings stop it). */
export type ShotLine = (ax: number, ay: number, bx: number, by: number) => boolean;

/** Seconds into an attack animation to its strike frame (HitFrame), or null when it has none. */
export function strikeSeconds(def: { durations: number[]; hitFrame: number | undefined } | undefined): number | null {
  if (!def || def.hitFrame === undefined) return null;
  let ticks = 0;
  for (let i = 0; i < Math.min(def.hitFrame, def.durations.length); i++) ticks += def.durations[i] ?? 0;
  return ticks / 60;
}

/** Is this move a channelled beam (config battle.channel.moves)? */
export function isChannel(id: string): boolean {
  return (CONFIG.battle.channel.moves as readonly string[]).includes(id);
}

export function impactDelay(attacker: Mon, target: Mon, m: MoveDef): number {
  return travelDelay(attacker, target, m) + strikeDelay(m);
}

/** Seconds the carrier takes to get there: a projectile's flight, a fall from the sky, a beam reaching out. */
export function travelDelay(attacker: Mon, target: Mon, m: MoveDef): number {
  const carrier = m.fx?.find((p) => p.anchor === 'projectile' || p.anchor === 'sky');
  const wait = carrier?.delay ?? 0;
  if (carrier?.anchor === 'projectile') return wait + Math.max(0.12, Math.hypot(target.x - attacker.x, target.y - attacker.y) / (carrier.speed ?? 11));
  if (carrier?.anchor === 'sky') {
    const lift = Math.max(0.2, (target.species.body[1] * drawScale(target.species)) / 16 / 2);
    return wait + Math.max(0.12, Math.abs((carrier.height ?? 6) - lift) / (carrier.speed ?? 14));
  }
  if (m.fx?.some((p) => p.anchor === 'attacker' && (p.mode === 'beam' || p.mode === 'stream'))) return BEAM_REACH;
  return 0;
}

/** Seconds a beam takes to reach out to its target (its impacts wait for it too, matchScreen.spawnFx). */
export const BEAM_REACH = 0.1;

/**
 * Seconds after the carrier arrives until the move's first impact on the target shows: the smallest
 * `delay` among its parts played on the target (a ring that rolls out from its user, an eruption that
 * rises first). The damage waits for it, so the HP drops in the frame the impact appears.
 */
/** One pulse of a channelled beam (BattleSystem.resolve). */
interface Pulse {
  scale: number;
  carry: Map<Mon, number>;
}

export function strikeDelay(m: MoveDef): number {
  const parts = (m.fx ?? []).filter((p) => p.anchor === 'target' && p.mode !== 'status');
  if (!parts.length) return 0;
  return Math.min(...parts.map((p) => p.delay ?? 0));
}

export class BattleSystem {
  events: BattleEvent[] = [];
  /** Each beam's leftover fractions of a point, per target (see landHit); gone with the beam. */
  private readonly beamCarry = new WeakMap<object, Map<Mon, number>>();
  /** Hits on their way to their targets (see impactDelay). */
  inFlight: Array<{ t: number; attacker: Mon; target: Mon; m: MoveDef; x: number; y: number }> = [];
  /** Line of fire for shots and area moves (set by the match from its map; none in tests). */
  shotLine: ShotLine | null = null;
  /** Seconds of hit-stop left; the match skips simulation while positive. */
  hitStop = 0;
  /** Pokémon whose Faint animation is still playing. */
  fainting: Array<{ mon: Mon; t: number }> = [];

  constructor(private readonly rng: Rng) {}

  /** Can `m` act and be hit right now? */
  static active(m: Mon): boolean {
    return !m.fainted && !m.captured && !m.stowed;
  }

  /** Nearest hostile to `m` within `range` tiles; with `coneDeg` only those inside the facing cone. */
  pickTarget(m: Mon, candidates: Iterable<Mon>, range: number, coneDeg?: number): Mon | null {
    const f = DIR_VECTORS[m.dir] as { x: number; y: number };
    const fl = Math.hypot(f.x, f.y) || 1;
    let best: Mon | null = null;
    let bd = range;
    for (const c of candidates) {
      if (c === m || !BattleSystem.active(c) || !this.isEnemy(m, c)) continue;
      const dx = c.x - m.x;
      const dy = c.y - m.y;
      const d = Math.hypot(dx, dy);
      if (d >= bd) continue;
      if (coneDeg !== undefined && d > 0.3) {
        const cos = (dx * f.x + dy * f.y) / (d * fl);
        if (cos < Math.cos((coneDeg * Math.PI) / 180)) continue;
      }
      bd = d;
      best = c;
    }
    return best;
  }

  /**
   * Free-aim cast: resolves the move's shape from the caster's position and
   * facing. A single-target move aims at the nearest hostile inside the
   * facing cone (within `range`), or straight ahead when nothing is there.
   */
  castAt(attacker: Mon, slot: number, candidates: Iterable<Mon>, range = 3.5 * R()): boolean {
    const id = attacker.moves[slot];
    if (!id) return false;
    const m = move(id);
    const f = DIR_VECTORS[attacker.dir] as { x: number; y: number };
    const fl = Math.hypot(f.x, f.y) || 1;
    let tx = attacker.x + (f.x / fl) * 1.5 * R();
    let ty = attacker.y + (f.y / fl) * 1.5 * R();
    let tid: number | null = null;
    let target: Mon | null = null;
    if (m.shape === 'single') {
      const t = this.pickTarget(attacker, candidates, range, 70);
      if (t) {
        tx = t.x;
        ty = t.y;
        tid = t.id;
        target = t;
      }
    }
    // An AI or auto cast: a beam from it is not steered by the cursor.
    const ok = this.tryCast(attacker, slot, tx, ty, tid, target);
    if (ok) attacker.manualCast = false;
    return ok;
  }

  /**
   * Aimed cast (the player): the move goes toward a point with no lock-on. A
   * single-target move lands on that point, held to `maxRange`, and hits
   * whoever is there when it lands; lines and cones point that way.
   */
  castToward(attacker: Mon, slot: number, x: number, y: number, maxRange = 3.5 * R(), target: Mon | null = null): boolean {
    let dx = x - attacker.x;
    let dy = y - attacker.y;
    let d = Math.hypot(dx, dy);
    if (d < 0.05) {
      const f = DIR_VECTORS[attacker.dir] as { x: number; y: number };
      const fl = Math.hypot(f.x, f.y) || 1;
      dx = f.x / fl;
      dy = f.y / fl;
      d = 1;
    }
    const k = Math.min(1, maxRange / d);
    // Aimed at a Pokémon (auto-battle): a single-target move follows it, a contact move lunges after it.
    const id = attacker.moves[slot];
    if (target && id && move(id).shape === 'single') return this.tryCast(attacker, slot, target.x, target.y, target.id, target);
    return this.tryCast(attacker, slot, attacker.x + dx * k, attacker.y + dy * k, null);
  }

  /**
   * Casts a move that is not in the caster's four slots (Shadow Lugia's Shadow Storm): the same
   * telegraph, wind-up and resolve as a slotted move, with no cooldown of its own.
   */
  castExtra(attacker: Mon, id: string, targetX: number, targetY: number): boolean {
    if (attacker.fainted || attacker.casting || attacker.channel || incapable(attacker)) return false;
    const m = move(id);
    const area = makeArea(m, attacker, targetX, targetY);
    attacker.castSeq = (attacker.castSeq ?? 0) + 1;
    attacker.casting = { moveId: id, t: m.cast ?? CONFIG.battle.castSeconds, targetX, targetY, targetId: null };
    attacker.anim.play(m.anim, { restart: true, loop: false });
    this.events.push({ type: 'cast', attacker, move: m, area });
    return true;
  }

  /** Begins a cast if the move is ready and the mon can act. */
  tryCast(attacker: Mon, slot: number, targetX: number, targetY: number, targetId: number | null, target: Mon | null = null): boolean {
    const id = attacker.moves[slot];
    if (!id || attacker.fainted || attacker.casting || attacker.channel) return false;
    if ((attacker.cooldowns[slot] ?? 0) > 0) return false;
    if (incapable(attacker)) return false;
    const m = move(id);
    if (attacker.status === 'paralysis' && this.rng.chance(CONFIG.battle.paralysisSkipChance)) {
      attacker.cooldowns[slot] = 1;
      this.events.push({ type: 'text', mon: attacker, text: 'paralyzed!' });
      return false;
    }
    // X Speed stages shorten cooldowns (10% per stage).
    attacker.cooldowns[slot] = m.cooldown * Math.max(0.4, 1 - 0.1 * attacker.stages.spe);
    attacker.lastSlot = slot;
    // Confused: the move often flies off somewhere else.
    if (attacker.status === 'confusion' && m.shape !== 'self' && this.rng.chance(CONFIG.battle.confusionMissChance ?? 0.4)) {
      const a = Math.atan2(targetY - attacker.y, targetX - attacker.x) + (this.rng.chance(0.5) ? 1 : -1) * this.rng.range(0.9, 2.6);
      const d = Math.hypot(targetX - attacker.x, targetY - attacker.y) || 2;
      targetX = attacker.x + Math.cos(a) * d;
      targetY = attacker.y + Math.sin(a) * d;
      targetId = null;
      target = null;
      this.events.push({ type: 'confused', mon: attacker });
    }
    const area = makeArea(m, attacker, targetX, targetY);
    attacker.castSeq = (attacker.castSeq ?? 0) + 1;
    attacker.casting = { moveId: id, t: m.cast ?? CONFIG.battle.castSeconds, targetX, targetY, targetId };
    attacker.dir = dirFromVector(area.fx, area.fy, attacker.dir);
    attacker.anim.dir = attacker.dir;
    if (m.leap && !attacker.leap) {
      // A slam: up in an arc over the cast and down onto the target, landing just short of it.
      const dx = targetX - attacker.x;
      const dy = targetY - attacker.y;
      const d = Math.hypot(dx, dy);
      // Land in front of the target, not on it: big Pokémon stop further out.
      const back = Math.min(d, 0.45 + bodyRadius(attacker.species) * 1.1);
      const k = d > 0.01 ? (d - back) / d : 0;
      attacker.leap = { t: 0, dur: attacker.casting.t, h: 1.4 + 0.3 * Math.min(3, attacker.species.heightM ?? 1), fx: attacker.x, fy: attacker.y, tx: attacker.x + dx * k, ty: attacker.y + dy * k, slam: true };
      attacker.anim.play(hasAction(attacker.dex, 'Hop') ? 'Hop' : m.anim, { restart: true, loop: false });
    } else {
      attacker.anim.play(m.anim, { restart: true, loop: false });
      // The move goes off on the attack animation's strike frame (SpriteCollab's HitFrame), so the
      // swing, the shot and the impact line up; moves with their own wind-up keep it. The strike
      // frame comes from the build-time table (strikeTimes.ts), following the same fallback chain
      // the sprite plays, so it never depends on which sheets have loaded.
      if (m.cast === undefined) {
        const strike = strikeTime(attacker.dex, m.anim).seconds;
        if (strike !== null) attacker.casting.t = Math.max(0.12, Math.min(0.6, strike));
      }
      // A contact move: rush in and strike on arrival.
      if (isContact(m)) this.startLunge(attacker, targetX, targetY, target);
    }
    this.events.push({ type: 'cast', attacker: attacker, move: m, area });
    return true;
  }

  /**
   * Sets a contact move's lunge going: from the user to just short of its target (the two bodies
   * touching, or as far as a whip reaches), fast; the cast resolves the moment it arrives. The strike
   * still comes on the move's planned strike time (its own wind-up, `cast`, or the attack
   * animation's strike frame) when that is later than the lunge needs: the user winds up where it
   * stands, then rushes in. A priority dash (`dash`) skips the wait and strikes on arrival. Already
   * close enough, it simply strikes where it stands, on the planned time.
   */
  private startLunge(a: Mon, tx: number, ty: number, target: Mon | null): void {
    const L = CONFIG.battle.lunge;
    if (!a.casting) return;
    const gx = target ? target.x : tx;
    const gy = target ? target.y : ty;
    const m = move(a.casting.moveId);
    // Stop with the two bodies touching, not overlapping (a Gyarados used to end up on top of its
    // target); a whip stops as far off as it reaches.
    const stop = 0.15 + Math.min(1.2, bodyRadius(a.species) * 0.75) + (target ? bodyRadius(target.species) * 0.75 : 0.2) + (m.reach ?? 0);
    const dash = m.dash ?? 1;
    // It covers at most maxTiles (a dash further): a target further off is lunged at and missed.
    const travel = Math.min(L.maxTiles * dash, Math.hypot(gx - a.x, gy - a.y) - stop);
    if (travel < L.minTiles) return;
    const speed = L.speed * dash * moveSpeed(a);
    const dur = Math.max(0.08, Math.min(L.maxSeconds, travel / speed));
    const planned = a.casting.t;
    const wait = m.dash ? 0 : Math.max(0, planned - dur);
    a.lunge = { t: 0, dur, target, tx: gx, ty: gy, stop, speed: Math.max(speed, travel / dur) * 1.15, budget: travel + 0.15, wait };
    a.casting.t = wait + dur + 0.04;
  }

  /** A contact hit shoves its target back a little (not bosses, legends, Alphas or much bigger bodies). */
  private shove(a: Mon, target: Mon, m: MoveDef): void {
    if (target.boss || target.legend || target.landBoss || target.alpha || target.leap || target.shadow || target.knock) return;
    if (bodyRadius(target.species) > bodyRadius(a.species) * 1.6 + 0.2) return;
    const L = CONFIG.battle.lunge;
    const dx = target.x - a.x;
    const dy = target.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const [lo, hi] = L.knockScale;
    const dist = L.knockTiles * Math.max(lo ?? 0.6, Math.min(hi ?? 1.6, m.power / 80)) * (m.knock ?? 1);
    const v = dist / L.knockSeconds;
    target.knock = { vx: (dx / d) * v, vy: (dy / d) * v, t: L.knockSeconds };
  }

  /** Advances cooldowns, casts and status for one Pokémon. `candidates` are the Pokémon a resolving cast may hit. */
  stepMon(mon: Mon, dt: number, candidates: () => Iterable<Mon>): void {
    for (let i = 0; i < mon.cooldowns.length; i++) {
      const c = mon.cooldowns[i] ?? 0;
      if (c > 0) mon.cooldowns[i] = Math.max(0, c - dt);
    }
    if (mon.flash > 0) mon.flash -= dt;
    if (mon.status === 'sleep') {
      mon.statusTimer -= dt;
      if (mon.statusTimer <= 0 && !mon.inDark) {
        mon.status = null;
        mon.anim.play('Idle');
        this.events.push({ type: 'wake', mon });
      }
    } else if (mon.status === 'freeze' || mon.status === 'confusion') {
      mon.statusTimer -= dt;
      if (mon.statusTimer <= 0) {
        const was = mon.status;
        mon.status = null;
        if (was === 'freeze') {
          mon.anim.play('Idle');
          this.events.push({ type: 'thaw', mon });
        }
      }
    } else if (mon.status === 'poison') {
      mon.statusTimer -= dt;
      if (mon.statusTimer <= 0) {
        mon.statusTimer = 2;
        const dmg = Math.max(1, Math.floor(mon.maxHp * (CONFIG.battle.poisonDamageFraction ?? 0.07)));
        this.applyDamage(mon, dmg, null);
        this.events.push({ type: 'tick', target: mon, damage: dmg, source: 'poison' });
      }
    } else if (mon.status === 'burn') {
      mon.statusTimer -= dt;
      if (mon.statusTimer <= 0) {
        mon.statusTimer = 2;
        const dmg = Math.max(1, Math.floor(mon.maxHp * CONFIG.battle.burnDamageFraction));
        this.applyDamage(mon, dmg, null);
        this.events.push({ type: 'tick', target: mon, damage: dmg, source: 'burn' });
      }
    }
    if (mon.channel) {
      this.stepChannel(mon, dt, candidates);
    } else if (mon.casting) {
      mon.casting.t -= dt;
      if (mon.casting.t <= 0) {
        const m = move(mon.casting.moveId);
        if (isChannel(m.id) && !mon.fainted) {
          // A channelled beam: it keeps pouring out, steerable, for a couple of seconds.
          const c = CONFIG.battle.channel;
          const dx = mon.casting.targetX - mon.x;
          const dy = mon.casting.targetY - mon.y;
          const d = Math.hypot(dx, dy) || 1;
          // Shadow Lugia's beam pours out longer and sweeps slower, toward its foe (Match.steerChannels).
          const span = mon.shadow && mon.owner?.legendBout ? CONFIG.shadowLugia.beamSeconds : c.seconds;
          // The first pulse lands when the beam has reached out and its impact shows (the same
          // wait a single hit has, impactDelay); then one every `tick`, each landing the moment it
          // pulses, on whatever is in the beam right then. The beam (and its user's rooting) ends
          // with its last pulse, so no damage arrives after the beam is gone.
          const reach = BEAM_REACH + strikeDelay(m);
          const pulses = Math.round(span / c.tick) + 1;
          mon.channel = { manual: !!mon.manualCast, moveId: m.id, left: reach + (pulses - 1) * c.tick, next: reach, pulses, fired: 0, dirX: dx / d, dirY: dy / d, aimX: mon.casting.targetX, aimY: mon.casting.targetY };
          this.events.push({ type: 'channel-start', mon, move: m });
          this.stepChannel(mon, 0, candidates);
          return;
        }
        const area = makeArea(m, { ...mon, x: mon.x, y: mon.y } as Mon, mon.casting.targetX, mon.casting.targetY);
        // Line, cone and ring areas follow the caster's position at cast start; `single` keeps its locked point.
        this.resolve(mon, m, area, candidates());
        mon.casting = null;
      }
    } else if (mon.anim.done && mon.anim.action !== 'Faint') {
      mon.anim.play(mon.status === 'sleep' ? 'Sleep' : mon.moving ? 'Walk' : 'Idle');
    }
  }

  /**
   * `pulse`: one pulse of a channelled beam. It lands at once on what is in the beam now (the beam
   * is already there), carrying `scale` of a full hit, and keeps each target's leftover fraction
   * of a point in `carry` (one map per beam, so fractions never pass between casts or targets).
   */
  private resolve(attacker: Mon, m: MoveDef, area: Area, candidates: Iterable<Mon>, pulse?: Pulse): void {
    const hits: Mon[] = [];
    if (m.shape === 'self') hits.push(attacker);
    else {
      for (const c of candidates) {
        if (c === attacker || !BattleSystem.active(c)) continue;
        if (!this.isEnemy(attacker, c)) continue;
        if (!areaContains(area, c.x, c.y, hitPad(c.species))) continue;
        // A contact move or a slam lands only on a body its user is actually touching: a lunge cut
        // short by a wall, or a target that got away, is a miss, whatever the cast was aimed at.
        if ((isContact(m) || m.leap) && Math.hypot(c.x - attacker.x, c.y - attacker.y) > contactReach(attacker.species, c.species, m)) continue;
        // Shots, beams and blasts do not pass through walls, trees or buildings (one falling from the
        // sky does, and so does a slam or a strike from right beside it).
        if (this.shotLine && !(isContact(m) || m.leap) && !m.fx?.some((p) => p.anchor === 'sky') && !this.shotLine(attacker.x, attacker.y, c.x, c.y)) continue;
        // Mid-dodge: the move passes through.
        if (c.dodge && c.dodge.safe > 0) {
          this.events.push({ type: 'dodged', mon: c });
          continue;
        }
        hits.push(c);
      }
      // A single-target move lands on the one Pokémon nearest its point.
      if (m.shape === 'single' && hits.length > 1) {
        hits.sort((a, b) => Math.hypot(a.x - area.tx, a.y - area.ty) - Math.hypot(b.x - area.tx, b.y - area.ty));
        hits.length = 1;
      }
    }
    this.events.push({ type: 'resolve', attacker, move: m, area, hits, ...(pulse ? { pulse: true } : {}) });
    for (const target of hits) {
      if (target === attacker) continue;
      if (pulse) {
        this.landHit(attacker, target, m, pulse);
        continue;
      }
      const wait = impactDelay(attacker, target, m);
      if (wait > 0.04) this.inFlight.push({ t: wait, attacker, target, m, x: target.x, y: target.y });
      else this.landHit(attacker, target, m);
    }
    // The user's own stat changes come once per cast, not once per Pokémon hit. A drawback (Close
    // Combat, Draco Meteor) always lands; a boost from an attack (Charge Beam) only when it hit.
    if (m.stages?.self && this.rng.chance(m.stages.chance)) {
      const boost = Object.values(m.stages.self).some((d) => (d ?? 0) > 0);
      if (!boost || m.category === 'status' || hits.some((h) => h !== attacker)) {
        for (const [stat, delta] of Object.entries(m.stages.self) as Array<['atk' | 'def', number]>) this.changeStage(attacker, stat, delta);
      }
    }
  }

  /**
   * One frame of a channelled beam: the beam turns toward where its user aims (at a limited rate),
   * and every `tick` seconds it pulses, hitting what is in the line with a share of the power.
   * The user stays rooted (its cast stays open) until the beam runs out or it is knocked out of it.
   */
  private stepChannel(mon: Mon, dt: number, candidates: () => Iterable<Mon>): void {
    const ch = mon.channel;
    if (!ch) return;
    const c = CONFIG.battle.channel;
    if (!BattleSystem.active(mon) || incapable(mon)) {
      this.endChannel(mon);
      return;
    }
    // Turn toward the aim.
    const ax = ch.aimX - mon.x;
    const ay = ch.aimY - mon.y;
    const al = Math.hypot(ax, ay);
    if (al > 0.2) {
      const cur = Math.atan2(ch.dirY, ch.dirX);
      let want = Math.atan2(ay, ax) - cur;
      while (want > Math.PI) want -= Math.PI * 2;
      while (want < -Math.PI) want += Math.PI * 2;
      const maxTurn = (c.turnDegPerSec * Math.PI / 180) * dt * (mon.shadow && mon.owner?.legendBout ? CONFIG.shadowLugia.beamTurnScale : 1);
      const a = cur + Math.max(-maxTurn, Math.min(maxTurn, want));
      ch.dirX = Math.cos(a);
      ch.dirY = Math.sin(a);
    }
    mon.dir = dirFromVector(ch.dirX, ch.dirY, mon.dir);
    mon.anim.dir = mon.dir;
    if (mon.casting) mon.casting.t = Math.max(mon.casting.t, 0.05);
    ch.left -= dt;
    ch.next -= dt;
    if (ch.next <= 0 && (ch.fired ?? 0) < (ch.pulses ?? 1)) {
      ch.next += c.tick;
      ch.fired = (ch.fired ?? 0) + 1;
      const base = move(ch.moveId);
      // A standard beam's pulses add up to powerMult times one hit (a longer beam simply deals more).
      const standard = Math.max(1, Math.round(c.seconds / c.tick) + 1);
      // Status rolls a little each pulse; no stat changes.
      const pulse: MoveDef = {
        ...base,
        status: base.status ? { ...base.status, chance: Math.min(1, (base.status.chance * 1.5) / standard) } : base.status,
        stages: undefined,
      };
      let carry = this.beamCarry.get(ch);
      if (!carry) this.beamCarry.set(ch, (carry = new Map()));
      const tx = mon.x + ch.dirX * 3;
      const ty = mon.y + ch.dirY * 3;
      this.resolve(mon, pulse, makeArea(base, mon, tx, ty), candidates(), { scale: c.powerMult / standard, carry });
    }
    // It ends with its last pulse (`left` counts down to that same moment).
    if ((ch.fired ?? 0) >= (ch.pulses ?? 1) || ch.left <= -c.tick) this.endChannel(mon);
  }

  /** Cuts off whatever a Pokémon is doing: its cast, and a channelled beam (with its end event). */
  interrupt(mon: Mon): void {
    if (mon.channel) this.endChannel(mon);
    else mon.casting = null;
    mon.lunge = null;
  }

  private endChannel(mon: Mon): void {
    mon.channel = null;
    mon.casting = null;
    this.events.push({ type: 'channel-end', mon });
  }

  /** Advances hits in flight; each lands if its target can still be hit. */
  stepFlights(dt: number): void {
    if (!this.inFlight.length) return;
    const due: typeof this.inFlight = [];
    this.inFlight = this.inFlight.filter((f) => {
      f.t -= dt;
      if (f.t > 1e-6) return true;
      due.push(f);
      return false;
    });
    // Only if it can still be hit and is still a foe (a snag, a calm or a change of sides in between spares it).
    // The shot lands where its target stood when it was thrown (that is where the effect goes): a
    // target that has since moved well clear of that spot is missed, not chased.
    for (const f of due) {
      if (!BattleSystem.active(f.target) || !this.isEnemy(f.attacker, f.target)) continue;
      if (Math.hypot(f.target.x - f.x, f.target.y - f.y) > 0.8 * R() + hitPad(f.target.species)) {
        this.events.push({ type: 'text', mon: f.target, text: 'Missed!' });
        continue;
      }
      this.landHit(f.attacker, f.target, f.m);
    }
  }

  /** One Pokémon struck by a move: damage, the hit event, status and stat changes. */
  private landHit(attacker: Mon, target: Mon, m: MoveDef, pulse?: Pulse): void {
    const r = computeDamage(this.rng, attacker, target, m, pulse?.scale);
    if (pulse && r.raw !== undefined) {
      // A beam's pulse deals the whole points of what it has built up on this target and keeps the rest.
      const sum = (pulse.carry.get(target) ?? 0) + r.raw;
      r.damage = Math.floor(sum);
      pulse.carry.set(target, sum - r.damage);
    }
    // A Pokémon set to Catch holds back like False Swipe: a wild Pokémon is left with at least 1 HP.
    if (attacker.behavior === 'catch' && target.wild && !target.owner) r.damage = Math.min(r.damage, Math.max(0, target.hp - 1));
    if (r.damage > 0) {
      const hpBefore = target.hp;
      this.applyDamage(target, r.damage, attacker);
      // A draining move (Absorb, Giga Drain, Draining Kiss): its user gets back a share of the HP it
      // actually took (a Focus Sash or a legend's last stand counts for what was really lost), never
      // past full, and not once it has fainted.
      if (m.drain && !attacker.fainted && attacker.hp < attacker.maxHp) {
        const took = Math.max(0, hpBefore - target.hp);
        const back = Math.min(attacker.maxHp - attacker.hp, Math.max(took > 0 ? 1 : 0, Math.floor(took * m.drain)));
        if (back > 0) {
          attacker.hp += back;
          this.events.push({ type: 'heal', mon: attacker, amount: back, move: m });
        }
      }
      target.flash = HIT_FLASH;
      if (!target.fainted) target.anim.play('Hurt', { restart: true, loop: false });
      if (!target.fainted && (isContact(m) || m.leap)) this.shove(attacker, target, m);
      if (attacker.owner) attacker.owner.stats.damage += r.damage;
      // Recoil (Double-Edge, Flare Blitz): a share of the damage dealt, never the last HP from it.
      if (m.recoil && !attacker.fainted) {
        const r2 = Math.min(attacker.hp - 1, Math.max(1, Math.floor(r.damage * m.recoil)));
        if (r2 > 0) {
          this.applyDamage(attacker, r2, null);
          this.events.push({ type: 'tick', target: attacker, damage: r2, source: 'recoil' });
        }
      }
      // Life Orb's recoil comes once per move used, not per Pokémon hit or per pulse of a beam.
      if (attacker.heldItem === 'life-orb' && !attacker.fainted && attacker.orbPaid !== attacker.castSeq) {
        attacker.orbPaid = attacker.castSeq;
        const recoil = Math.max(1, Math.floor(attacker.maxHp * 0.1));
        this.applyDamage(attacker, recoil, null);
        this.events.push({ type: 'tick', target: attacker, damage: recoil, source: 'recoil' });
      }
    }
    this.events.push({ type: 'hit', attacker, target, move: m, damage: r.damage, effectiveness: r.effectiveness, crit: r.crit, ...(pulse ? { pulse: true } : {}) });
    // A Fire hit thaws a frozen Pokémon.
    if (target.status === 'freeze' && m.type === 'fire' && r.damage > 0) {
      target.status = null;
      target.statusTimer = 0;
      target.anim.play('Idle');
      this.events.push({ type: 'thaw', mon: target });
    }
    if (r.effectiveness === 0) return;
    if (m.status && !target.status && !target.fainted && this.rng.chance(m.status.chance)) this.applyStatus(target, m.status.kind);
    if (m.stages?.target && this.rng.chance(m.stages.chance)) {
      for (const [stat, delta] of Object.entries(m.stages.target) as Array<['atk' | 'def', number]>) this.changeStage(target, stat, delta);
    }
  }

  isEnemy(a: Mon, b: Mon): boolean {
    // Hoopa (a visitor) never fights, and only a Pokémon the player is steering can hit it:
    // doing so unbinds it into Hoopa Unbound (Visitors.hoopaStruck).
    if (b.npc === 'hoopa') return !!a.steered && !!a.owner?.isPlayer;
    if (a.npc === 'hoopa') return false;
    // A Pokémon calmed by the Capture Styler is nobody's enemy until it wears off.
    if ((a.calm ?? 0) > 0 || (b.calm ?? 0) > 0) return false;
    // A one-on-one battle is sealed off: its two Pokémon fight only each other.
    if (a.duelId || b.duelId) return a.duelId === b.duelId && a.owner !== b.owner;
    // Squads: teammates' Pokémon never fight each other.
    if (a.owner && b.owner) return a.owner !== b.owner && (a.owner.team === undefined || a.owner.team !== b.owner.team);
    if (!a.owner && !b.owner) return a.boss !== b.boss;
    return true;
  }

  changeStage(mon: Mon, stat: 'atk' | 'def' | 'spe', delta: number): void {
    const before = mon.stages[stat];
    // Stages stop at +/-3 (a stage is +/-50% here, and Speed also shortens cooldowns).
    mon.stages[stat] = Math.max(-3, Math.min(3, before + delta));
    if (mon.stages[stat] !== before) this.events.push({ type: 'stages', target: mon, stat, delta });
  }

  applyStatus(mon: Mon, status: StatusKind): void {
    if (mon.status || mon.fainted) return;
    // Type immunities.
    const t = mon.types;
    if (status === 'poison' && (t.includes('poison') || t.includes('steel'))) return;
    if (status === 'freeze' && (t.includes('ice') || t.includes('fire'))) return;
    if (status === 'burn' && t.includes('fire')) return;
    if (status === 'paralysis' && t.includes('electric')) return;
    mon.status = status;
    if (status === 'sleep') {
      mon.statusTimer = this.rng.range(CONFIG.battle.sleepSeconds[0] ?? 3, CONFIG.battle.sleepSeconds[1] ?? 6);
      this.interrupt(mon);
      mon.moving = false;
      mon.anim.play('Sleep', { restart: true });
    } else if (status === 'burn' || status === 'poison') mon.statusTimer = 2;
    else if (status === 'freeze') {
      const [a, b] = CONFIG.battle.freezeSeconds ?? [2.5, 4];
      mon.statusTimer = this.rng.range(a ?? 2.5, b ?? 4);
      this.interrupt(mon);
      mon.moving = false;
    } else if (status === 'confusion') {
      const [a, b] = CONFIG.battle.confusionSeconds ?? [4, 6];
      mon.statusTimer = this.rng.range(a ?? 4, b ?? 6);
    }
    this.events.push({ type: 'status', target: mon, status });
  }

  cureStatus(mon: Mon): void {
    if (!mon.status) return;
    const was = mon.status;
    mon.status = null;
    mon.statusTimer = 0;
    if (was === 'sleep') {
      mon.anim.play('Idle');
      this.events.push({ type: 'wake', mon });
    }
  }

  applyDamage(target: Mon, damage: number, by: Mon | null): void {
    if (target.fainted) return;
    // A legendary is never knocked out: at its last HP it yields to whoever wore it down.
    if (target.legend && target.hp - damage <= 0) {
      target.hp = 1;
      this.events.push({ type: 'yield', mon: target, by });
      return;
    }
    if (target.heldItem === 'focus-sash' && target.hp === target.maxHp && damage >= target.hp) {
      target.hp = 1;
      target.heldItem = null;
      this.events.push({ type: 'text', mon: target, text: 'Hung on with Focus Sash!' });
      return;
    }
    target.hp = Math.max(0, target.hp - damage);
    target.sinceHit = 0;
    target.everHit = true;
    if (target.hp === 0) this.faint(target, by);
  }

  faint(mon: Mon, by: Mon | null): void {
    if (mon.fainted) return;
    mon.fainted = true;
    this.interrupt(mon);
    mon.status = null;
    mon.moving = false;
    mon.flash = 0;
    mon.aura = false;
    mon.anim.play('Faint', { restart: true, loop: false });
    this.fainting.push({ mon, t: 1.1 });
    if (by?.owner && by.owner !== mon.owner) by.owner.stats.knockouts++;
    this.events.push({ type: 'faint', mon, by });
  }

  /** Advances Faint animations; returns the Pokémon whose animation finished this step. */
  stepFainting(dt: number): Mon[] {
    const done: Mon[] = [];
    this.fainting = this.fainting.filter((f) => {
      f.t -= dt;
      f.mon.anim.update(dt);
      if (f.t <= 0) {
        done.push(f.mon);
        return false;
      }
      return true;
    });
    return done;
  }

  /**
   * AI: pick the best ready move against a target, or -1. `careful` (trainers' Pokémon) also skips a
   * move that would be wasted from here: out of its reach (a ring or cone short of the target, a
   * shot past its range) or with a wall, cliff or building in the way.
   */
  chooseMove(attacker: Mon, target: Mon, careful = false): number {
    let best = -1;
    let bestScore = 0;
    const d = Math.hypot(target.x - attacker.x, target.y - attacker.y);
    const blocked = careful && !!this.shotLine && !this.shotLine(attacker.x, attacker.y, target.x, target.y);
    const pad = careful ? bodyRadius(target.species) * 0.5 : 0;
    attacker.moves.forEach((id, i) => {
      if ((attacker.cooldowns[i] ?? 0) > 0) return;
      const mv = move(id);
      // A contact move or a slam is no use until the target is within its lunge or jump.
      if ((isContact(mv) || mv.leap) && d > moveReach(mv) + 0.2) return;
      if (careful && mv.shape !== 'self') {
        if (d > moveReach(mv) + pad) return;
        if (blocked && !isContact(mv) && !mv.leap) return;
      }
      // The best move that is ready, every time: no marking down a move for having been used last
      // (wild Pokémon, challengers and bosses included). Variety comes from cooldowns alone.
      const s = moveScore(attacker, target, mv);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    });
    return best;
  }

  facing(from: Mon, to: { x: number; y: number }): Dir8 {
    return dirFromVector(to.x - from.x, to.y - from.y, from.dir);
  }
}
