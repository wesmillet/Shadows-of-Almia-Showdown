/**
 * Overworld battles: engagement, telegraphed casts, area shapes, damage,
 * status and knockouts. Pure simulation; it reports what happened through
 * `events`, which the renderer turns into VFX, numbers and hit-stop.
 */
import { DIR_VECTORS, dirFromVector, type Dir8 } from '../core/math';
import type { Rng } from '../core/rng';
import { CONFIG, effectiveness, hitPad, move, type MoveDef, type StatusKind } from './data';
import { ITEMS, type BallKind } from './items';
import type { InventorySlot, Mon, Trainer } from './entities';

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
  | { type: 'resolve'; attacker: Mon; move: MoveDef; area: Area; hits: Mon[] }
  | { type: 'hit'; attacker: Mon; target: Mon; move: MoveDef; damage: number; effectiveness: number; crit: boolean }
  | { type: 'status'; target: Mon; status: StatusKind }
  | { type: 'stages'; target: Mon; stat: 'atk' | 'def' | 'spe'; delta: number }
  | { type: 'tick'; target: Mon; damage: number; source: 'burn' | 'dreams' }
  | { type: 'faint'; mon: Mon; by: Mon | null }
  | { type: 'wake'; mon: Mon }
  | { type: 'text'; mon: Mon; text: string }
  | { type: 'notice'; text: string; seconds?: number }
  | { type: 'caught'; mon: Mon; by: Trainer }
  | { type: 'broke-free'; mon: Mon }
  | { type: 'pickup'; trainer: Trainer; items: InventorySlot[]; ball: BallKind; healed: boolean }
  | { type: 'eliminated'; trainer: Trainer }
  | { type: 'xp'; mon: Mon; xp: number; levels: number }
  | { type: 'evolve-start'; mon: Mon }
  | { type: 'evolved'; mon: Mon; from: string }
  | { type: 'ball-hit'; mon: Mon; x: number; y: number }
  | { type: 'ball-absorb'; mon: Mon; x: number; y: number }
  | { type: 'ball-click'; mon: Mon; x: number; y: number }
  | { type: 'ball-burst'; mon: Mon; x: number; y: number };

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
}

export function computeDamage(rng: Rng, attacker: Mon, defender: Mon, m: MoveDef): DamageResult {
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
  dmg *= rng.range(0.85, 1);
  return { damage: Math.max(1, Math.floor(dmg)), effectiveness: eff, crit };
}

/** Score a move for AI selection: expected damage with a bonus for applying a fresh status. */
export function moveScore(attacker: Mon, target: Mon, m: MoveDef): number {
  const eff = effectiveness(m.type, target.types);
  let score = m.power * eff * (attacker.types.includes(m.type) ? 1.5 : 1);
  if (m.status && !target.status && eff > 0) score += 45 * m.status.chance;
  if (m.stages?.self && attacker.stages.atk < 2) score += 25;
  if (m.shape === 'self' && !m.stages) score = 0;
  return score;
}

export class BattleSystem {
  events: BattleEvent[] = [];
  /** Seconds of hit-stop left; the match skips simulation while positive. */
  hitStop = 0;
  /** Pokémon whose Faint animation is still playing. */
  fainting: Array<{ mon: Mon; t: number }> = [];

  constructor(private readonly rng: Rng) {}

  /** Can `m` act and be hit right now? */
  static active(m: Mon): boolean {
    return !m.fainted && !m.captured;
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
    if (m.shape === 'single') {
      const t = this.pickTarget(attacker, candidates, range, 70);
      if (t) {
        tx = t.x;
        ty = t.y;
        tid = t.id;
      }
    }
    return this.tryCast(attacker, slot, tx, ty, tid);
  }

  /** Begins a cast if the move is ready and the mon can act. */
  tryCast(attacker: Mon, slot: number, targetX: number, targetY: number, targetId: number | null): boolean {
    const id = attacker.moves[slot];
    if (!id || attacker.fainted || attacker.casting) return false;
    if ((attacker.cooldowns[slot] ?? 0) > 0) return false;
    if (attacker.status === 'sleep') return false;
    const m = move(id);
    if (attacker.status === 'paralysis' && this.rng.chance(CONFIG.battle.paralysisSkipChance)) {
      attacker.cooldowns[slot] = 1;
      this.events.push({ type: 'text', mon: attacker, text: 'paralyzed!' });
      return false;
    }
    // X Speed stages shorten cooldowns (10% per stage).
    attacker.cooldowns[slot] = m.cooldown * Math.max(0.4, 1 - 0.1 * attacker.stages.spe);
    const area = makeArea(m, attacker, targetX, targetY);
    attacker.casting = { moveId: id, t: m.cast ?? CONFIG.battle.castSeconds, targetX, targetY, targetId };
    attacker.dir = dirFromVector(area.fx, area.fy, attacker.dir);
    attacker.anim.dir = attacker.dir;
    attacker.anim.play(m.anim, { restart: true, loop: false });
    this.events.push({ type: 'cast', attacker: attacker, move: m, area });
    return true;
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
    } else if (mon.status === 'burn') {
      mon.statusTimer -= dt;
      if (mon.statusTimer <= 0) {
        mon.statusTimer = 2;
        const dmg = Math.max(1, Math.floor(mon.maxHp * CONFIG.battle.burnDamageFraction));
        this.applyDamage(mon, dmg, null);
        this.events.push({ type: 'tick', target: mon, damage: dmg, source: 'burn' });
      }
    }
    if (mon.casting) {
      mon.casting.t -= dt;
      if (mon.casting.t <= 0) {
        const m = move(mon.casting.moveId);
        const area = makeArea(m, { ...mon, x: mon.x, y: mon.y } as Mon, mon.casting.targetX, mon.casting.targetY);
        // Line, cone and ring areas follow the caster's position at cast start; `single` keeps its locked point.
        this.resolve(mon, m, area, candidates());
        mon.casting = null;
      }
    } else if (mon.anim.done && mon.anim.action !== 'Faint') {
      mon.anim.play(mon.status === 'sleep' ? 'Sleep' : mon.moving ? 'Walk' : 'Idle');
    }
  }

  private resolve(attacker: Mon, m: MoveDef, area: Area, candidates: Iterable<Mon>): void {
    const hits: Mon[] = [];
    if (m.shape === 'self') hits.push(attacker);
    else {
      for (const c of candidates) {
        if (c === attacker || !BattleSystem.active(c)) continue;
        if (!this.isEnemy(attacker, c)) continue;
        if (areaContains(area, c.x, c.y, hitPad(c.species))) hits.push(c);
      }
      // A single-target move lands on the one Pokémon nearest its point.
      if (m.shape === 'single' && hits.length > 1) {
        hits.sort((a, b) => Math.hypot(a.x - area.tx, a.y - area.ty) - Math.hypot(b.x - area.tx, b.y - area.ty));
        hits.length = 1;
      }
    }
    this.events.push({ type: 'resolve', attacker, move: m, area, hits });
    for (const target of hits) {
      if (target !== attacker) {
        const r = computeDamage(this.rng, attacker, target, m);
        if (r.damage > 0) {
          this.applyDamage(target, r.damage, attacker);
          target.flash = 0.06;
          if (!target.fainted) target.anim.play('Hurt', { restart: true, loop: false });
          if (attacker.owner) attacker.owner.stats.damage += r.damage;
          if (attacker.heldItem === 'life-orb' && !attacker.fainted) {
            const recoil = Math.max(1, Math.floor(attacker.maxHp * 0.1));
            this.applyDamage(attacker, recoil, null);
            this.events.push({ type: 'tick', target: attacker, damage: recoil, source: 'burn' });
          }
        }
        this.events.push({ type: 'hit', attacker, target, move: m, damage: r.damage, effectiveness: r.effectiveness, crit: r.crit });
        if (r.effectiveness === 0) continue;
        if (m.status && !target.status && !target.fainted && this.rng.chance(m.status.chance)) this.applyStatus(target, m.status.kind);
        if (m.stages?.target && this.rng.chance(m.stages.chance)) {
          for (const [stat, delta] of Object.entries(m.stages.target) as Array<['atk' | 'def', number]>) this.changeStage(target, stat, delta);
        }
      }
      if (m.stages?.self && this.rng.chance(m.stages.chance)) {
        for (const [stat, delta] of Object.entries(m.stages.self) as Array<['atk' | 'def', number]>) this.changeStage(attacker, stat, delta);
      }
    }
  }

  isEnemy(a: Mon, b: Mon): boolean {
    if (a.owner && b.owner) return a.owner !== b.owner;
    if (!a.owner && !b.owner) return a.boss !== b.boss;
    return true;
  }

  changeStage(mon: Mon, stat: 'atk' | 'def' | 'spe', delta: number): void {
    const before = mon.stages[stat];
    mon.stages[stat] = Math.max(-6, Math.min(6, before + delta));
    if (mon.stages[stat] !== before) this.events.push({ type: 'stages', target: mon, stat, delta });
  }

  applyStatus(mon: Mon, status: StatusKind): void {
    if (mon.status || mon.fainted) return;
    mon.status = status;
    if (status === 'sleep') {
      mon.statusTimer = this.rng.range(CONFIG.battle.sleepSeconds[0] ?? 3, CONFIG.battle.sleepSeconds[1] ?? 6);
      mon.casting = null;
      mon.moving = false;
      mon.anim.play('Sleep', { restart: true });
    } else if (status === 'burn') mon.statusTimer = 2;
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
    if (target.heldItem === 'focus-sash' && target.hp === target.maxHp && damage >= target.hp) {
      target.hp = 1;
      target.heldItem = null;
      this.events.push({ type: 'text', mon: target, text: 'Hung on with Focus Sash!' });
      return;
    }
    target.hp = Math.max(0, target.hp - damage);
    target.sinceHit = 0;
    if (target.hp === 0) this.faint(target, by);
  }

  faint(mon: Mon, by: Mon | null): void {
    if (mon.fainted) return;
    mon.fainted = true;
    mon.casting = null;
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

  /** AI: pick the best ready move against a target, or -1. */
  chooseMove(attacker: Mon, target: Mon): number {
    let best = -1;
    let bestScore = 0;
    attacker.moves.forEach((id, i) => {
      if ((attacker.cooldowns[i] ?? 0) > 0) return;
      const s = moveScore(attacker, target, move(id));
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
