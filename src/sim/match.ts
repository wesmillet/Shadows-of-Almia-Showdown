/**
 * Match state and the fixed-step simulation: the player and their party,
 * wild Pokémon by biome, AI trainers, items, the Ranger outpost, the
 * darkness and the battle system. Pure: no canvas access.
 */
import { dirFromVector, type Dir8 } from '../core/math';
import type { Input } from '../core/input';
import { Rng } from '../core/rng';
import type { GroundRenderer, Biome } from '../ground/types';
import { AnimPlayer, type SpriteRegistry } from '../sprites/pokemonSprite';
import { BattleSystem } from './battle';
import { CONFIG, SPAWNS, species, statsAtLevel } from './data';
import type { GroundItem, Mon, Trainer } from './entities';
import { lead } from './entities';
import { canStand, pointBehind, tryMove } from './movement';

export interface MatchDeps {
  ground: GroundRenderer;
  rng: Rng;
  sprites: SpriteRegistry;
}

export type MatchOutcome = null | 'win' | 'loss';

let nextId = 1;

export class Match {
  readonly ground: GroundRenderer;
  readonly rng: Rng;
  readonly sprites: SpriteRegistry;
  readonly battle: BattleSystem;
  time = 0;
  player: Trainer;
  trainers: Trainer[] = [];
  wilds: Mon[] = [];
  items: GroundItem[] = [];
  outposts: Array<{ x: number; y: number; users: Trainer[] }> = [];
  darkrai: Mon | null = null;
  outcome: MatchOutcome = null;
  /** Centre of the map, where the Shadow Crystal stands. */
  readonly centerX: number;
  readonly centerY: number;
  /** Movement intent the screen feeds in each step (player only). */
  moveX = 0;
  moveY = 0;

  constructor(deps: MatchDeps, starterDexes: string[]) {
    this.ground = deps.ground;
    this.rng = deps.rng;
    this.sprites = deps.sprites;
    this.battle = new BattleSystem(this.rng);
    this.centerX = this.ground.cols / 2;
    this.centerY = this.ground.rows / 2;
    const spawn = this.edgeSpawn();
    this.player = this.makeTrainer('You', 'player', true, spawn.x, spawn.y);
    for (const dex of starterDexes) this.player.party.push(this.makeMon(dex, CONFIG.player.level, this.player, spawn.x, spawn.y));
    this.spawnWilds();
  }

  /** A reachable, open tile as far from the centre as possible: the map edge. */
  edgeSpawn(exclude: Array<{ x: number; y: number }> = []): { x: number; y: number } {
    let best = { x: this.centerX, y: this.centerY };
    let bestScore = -Infinity;
    for (let ty = 0; ty < this.ground.rows; ty++) {
      for (let tx = 0; tx < this.ground.cols; tx++) {
        if (!this.ground.reachable(tx, ty)) continue;
        let open = 0;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (this.ground.reachable(tx + dx, ty + dy)) open++;
        if (open < 30) continue;
        const dc = Math.hypot(tx + 0.5 - this.centerX, ty + 0.5 - this.centerY);
        let score = dc + this.rng.next() * 2;
        for (const e of exclude) score -= Math.max(0, 30 - Math.hypot(tx + 0.5 - e.x, ty + 0.5 - e.y));
        if (score > bestScore) {
          bestScore = score;
          best = { x: tx + 0.5, y: ty + 0.5 };
        }
      }
    }
    return best;
  }

  makeTrainer(name: string, role: string, isPlayer: boolean, x: number, y: number): Trainer {
    return {
      id: nextId++, name, role, isPlayer, x, y, px: x, py: y, dir: 4 as Dir8, moving: false, walkPhase: 0,
      party: [], history: [{ x, y }], items: new Array<string | null>(CONFIG.items.inventorySize).fill(null), alive: true,
      stats: { catches: 0, knockouts: 0, damage: 0, timeSurvived: 0 },
      engaged: null, engagedTrainer: null, ai: 'roam', aiTimer: 0, aiTarget: null, healing: 0,
    };
  }

  makeMon(dex: string, level: number, owner: Trainer | null, x: number, y: number): Mon {
    const sp = species(dex);
    const stats = statsAtLevel(sp.stats, level);
    const sprites = this.sprites.get(dex);
    return {
      id: nextId++, dex, species: sp, name: sp.name, level, hp: stats.hp, maxHp: stats.hp, stats,
      stages: { atk: 0, def: 0 }, types: [...sp.types], moves: [...sp.moves], cooldowns: sp.moves.map(() => 0),
      x, y, px: x, py: y, dir: 0, anim: new AnimPlayer(sprites), sprites, owner, wild: owner === null, boss: false,
      fainted: false, status: null, statusTimer: 0, flash: 0, homeX: x, homeY: y, targetX: x, targetY: y,
      idleTimer: this.rng.range(0.5, 3), moving: false, inDark: false, drowsy: 0, outsideDark: 0, aura: false,
      heldItem: null, busy: 0, casting: null,
    };
  }

  private spawnWilds(): void {
    const g = this.ground;
    const byBiome: Record<Biome, Array<{ x: number; y: number }>> = { meadow: [], forest: [], shore: [], water: [] };
    for (let ty = 0; ty < g.rows; ty++) {
      for (let tx = 0; tx < g.cols; tx++) {
        if (!g.reachable(tx, ty)) continue;
        if (Math.hypot(tx + 0.5 - this.centerX, ty + 0.5 - this.centerY) < 5) continue;
        if (Math.hypot(tx + 0.5 - this.player.x, ty + 0.5 - this.player.y) < 4) continue;
        const b = g.biomeAt(tx, ty);
        byBiome[b].push({ x: tx + 0.5, y: ty + 0.5 });
        if (b !== 'water') {
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            if (g.biomeAt(tx + dx, ty + dy) === 'water') {
              byBiome.water.push({ x: tx + 0.5, y: ty + 0.5 });
              break;
            }
          }
        }
      }
    }
    for (const [biome, table] of Object.entries(SPAWNS.biomes) as Array<[Biome, { count: number; table: Array<{ dex: string; weight: number }> }]>) {
      const spots = this.rng.shuffle([...byBiome[biome]]);
      const n = Math.min(table.count, spots.length);
      for (let i = 0; i < n; i++) {
        const spot = spots[i] as { x: number; y: number };
        const row = this.rng.weighted(table.table, (r) => r.weight);
        const mon = this.makeMon(row.dex, SPAWNS.wildLevel, null, spot.x, spot.y);
        mon.dir = this.rng.int(0, 7) as Dir8;
        this.wilds.push(mon);
      }
    }
  }

  get allTrainers(): Trainer[] {
    return [this.player, ...this.trainers];
  }

  /** Every active Pokémon on the field. */
  *mons(): Generator<Mon> {
    for (const t of this.allTrainers) if (t.alive) for (const m of t.party) if (!m.fainted) yield m;
    for (const w of this.wilds) if (!w.fainted) yield w;
    if (this.darkrai && !this.darkrai.fainted) yield this.darkrai;
  }

  /** Pokémon to draw: active ones plus those still playing Faint. */
  *renderMons(): Generator<Mon> {
    yield* this.mons();
    for (const f of this.battle.fainting) yield f.mon;
  }

  /** Nearest enemy Pokémon of a trainer within `range` tiles of a point. */
  nearestEnemyMon(t: Trainer, x: number, y: number, range: number): Mon | null {
    let best: Mon | null = null;
    let bd = range;
    for (const m of this.mons()) {
      if (m.owner === t) continue;
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  /** Player input: cast the lead's move in `slot` at the engaged enemy (or straight ahead). */
  playerCast(slot: number): 'cast' | 'cooldown' | 'no-lead' | 'asleep' | 'busy' {
    const p = this.player;
    const m = lead(p);
    if (!m) return 'no-lead';
    if (m.status === 'sleep') return 'asleep';
    if (m.casting) return 'busy';
    if ((m.cooldowns[slot] ?? 0) > 0) return 'cooldown';
    let tx: number;
    let ty: number;
    let tid: number | null = null;
    const enemy = p.engaged && !p.engaged.fainted ? p.engaged : this.nearestEnemyMon(p, m.x, m.y, 3.5);
    if (enemy) {
      tx = enemy.x;
      ty = enemy.y;
      tid = enemy.id;
    } else {
      const d = dirVec(p.dir);
      tx = m.x + d.x * 1.5;
      ty = m.y + d.y * 1.5;
    }
    return this.battle.tryCast(m, slot, tx, ty, tid) ? 'cast' : 'cooldown';
  }

  /** Makes party member `index` the lead (fainted members cannot lead). */
  swapLead(index: number): boolean {
    const p = this.player;
    const m = p.party[index];
    if (!m || m.fainted) return false;
    p.party.splice(index, 1);
    p.party.unshift(m);
    return true;
  }

  step(dt: number, input: Input): void {
    if (this.outcome) return;
    if (this.battle.hitStop > 0) {
      this.battle.hitStop -= dt;
      return;
    }
    this.time += dt;
    for (const m of this.renderMons()) {
      m.px = m.x;
      m.py = m.y;
    }
    for (const t of this.allTrainers) {
      t.px = t.x;
      t.py = t.y;
    }
    const axis = input.moveAxis();
    this.moveX = axis.x;
    this.moveY = axis.y;
    this.stepPlayer(dt);
    this.stepEngagement();
    for (const t of this.allTrainers) {
      if (!t.alive) continue;
      this.stepLead(t, dt);
      this.stepFollowers(t, dt);
    }
    for (const w of this.wilds) this.stepWild(w, dt);
    for (const m of this.mons()) {
      this.battle.stepMon(m, dt, () => this.mons());
      m.anim.dir = m.dir;
      m.anim.update(dt);
    }
    for (const gone of this.battle.stepFainting(dt)) {
      const i = this.wilds.indexOf(gone);
      if (i >= 0) this.wilds.splice(i, 1);
    }
    this.checkElimination();
  }

  private stepPlayer(dt: number): void {
    const p = this.player;
    const speed = CONFIG.player.speedTilesPerSec;
    let moved = 0;
    if (this.moveX !== 0 || this.moveY !== 0) {
      moved = tryMove(this.ground, p, this.moveX * speed * dt, this.moveY * speed * dt, CONFIG.player.radius);
      p.dir = dirFromVector(this.moveX, this.moveY, p.dir);
    }
    this.separate(p);
    this.afterTrainerMove(p, moved);
    p.stats.timeSurvived = this.time;
  }

  /** Trainers cannot walk through wild Pokémon, other trainers or Darkrai: push them apart. */
  separate(t: Trainer): void {
    const minD = 0.7;
    const push = (ox: number, oy: number) => {
      const dx = t.x - ox;
      const dy = t.y - oy;
      const d = Math.hypot(dx, dy);
      if (d >= minD || d < 1e-4) return;
      const k = (minD - d) / d;
      const nx = t.x + dx * k;
      const ny = t.y + dy * k;
      if (canStand(this.ground, nx, ny, CONFIG.player.radius)) {
        t.x = nx;
        t.y = ny;
      }
    };
    for (const w of this.wilds) if (!w.fainted) push(w.x, w.y);
    for (const o of this.allTrainers) {
      if (o === t || !o.alive) continue;
      push(o.x, o.y);
      for (const m of o.party) if (!m.fainted) push(m.x, m.y);
    }
    if (this.darkrai && !this.darkrai.fainted) push(this.darkrai.x, this.darkrai.y);
  }

  /** Walk-cycle phase and the position history every trainer shares. */
  afterTrainerMove(t: Trainer, moved: number): void {
    t.moving = moved > 1e-4;
    if (!t.moving) return;
    t.walkPhase = (t.walkPhase + moved / 0.9) % 1;
    const last = t.history[t.history.length - 1];
    if (!last || Math.hypot(t.x - last.x, t.y - last.y) >= 0.05) {
      t.history.push({ x: t.x, y: t.y });
      if (t.history.length > 400) t.history.shift();
    }
  }

  /** Touching a wild Pokémon starts a fight; distance ends it. */
  private stepEngagement(): void {
    const p = this.player;
    if (p.engaged) {
      const e = p.engaged;
      const far = Math.hypot(e.x - p.x, e.y - p.y) > CONFIG.battle.disengageDistance;
      if (e.fainted || far || !lead(p)) this.battle.disengage(p);
    }
    if (!p.engaged && lead(p)) {
      for (const w of this.wilds) {
        if (w.fainted || w.status === 'sleep') continue;
        if (Math.hypot(w.x - p.x, w.y - p.y) < 0.8) {
          this.battle.engage(p, w);
          break;
        }
      }
    }
  }

  /** The lead mirrors its trainer at a one-tile offset toward the enemy while engaged. */
  private stepLead(t: Trainer, dt: number): void {
    const m = lead(t);
    if (!m || !t.engaged) return;
    const e = t.engaged;
    let fx = e.x - t.x;
    let fy = e.y - t.y;
    const d = Math.hypot(fx, fy) || 1;
    fx /= d;
    fy /= d;
    const off = Math.min(CONFIG.battle.leadOffsetTiles, Math.max(0.35, d - 0.7));
    let tx = t.x + fx * off;
    let ty = t.y + fy * off;
    if (!canStand(this.ground, tx, ty, 0.2)) {
      // Blocked ahead: stand beside the trainer instead.
      tx = t.x - fy * 0.6;
      ty = t.y + fx * 0.6;
      if (!canStand(this.ground, tx, ty, 0.2)) {
        tx = t.x;
        ty = t.y;
      }
    }
    const dx = tx - m.x;
    const dy = ty - m.y;
    const dist = Math.hypot(dx, dy);
    const maxStep = 8 * dt;
    if (dist > 0.02 && m.status !== 'sleep') {
      const k = Math.min(1, maxStep / dist);
      m.x += dx * k;
      m.y += dy * k;
    }
    const movedNow = dist > 0.08;
    if (!m.casting && m.status !== 'sleep' && m.anim.action !== 'Hurt') {
      if (movedNow !== m.moving) {
        m.moving = movedNow;
        m.anim.play(movedNow ? 'Walk' : 'Idle');
      }
    }
    if (!m.casting) m.dir = dirFromVector(e.x - m.x, e.y - m.y, m.dir);
  }

  /** Party members trail the trainer along the position history. */
  stepFollowers(t: Trainer, dt: number): void {
    const spacing = CONFIG.player.followSpacingTiles;
    const active = t.party.filter((m) => !m.fainted);
    const first = lead(t);
    active.forEach((m, i) => {
      if (m.casting || (t.engaged && m === first) || m.status === 'sleep') return;
      const target = pointBehind(t.history, spacing * (i + 1)) ?? { x: t.x, y: t.y };
      const dx = target.x - m.x;
      const dy = target.y - m.y;
      const d = Math.hypot(dx, dy);
      const maxStep = CONFIG.player.speedTilesPerSec * 1.3 * dt;
      if (d > 0.01) {
        const k = Math.min(1, maxStep / d);
        m.x += dx * k;
        m.y += dy * k;
        m.dir = dirFromVector(dx, dy, m.dir);
      }
      const movedNow = d > 0.03;
      if (movedNow !== m.moving && m.anim.action !== 'Hurt') {
        m.moving = movedNow;
        m.anim.play(movedNow ? 'Walk' : 'Idle');
      }
    });
  }

  private stepWild(w: Mon, dt: number): void {
    if (w.fainted || w.casting || w.status === 'sleep') return;
    // In a fight: face the opponent's lead and attack on cooldown.
    const foe = this.opponentOf(w);
    if (foe) {
      w.moving = false;
      w.dir = dirFromVector(foe.x - w.x, foe.y - w.y, w.dir);
      w.busy -= dt;
      if (w.busy <= 0) {
        w.busy = this.rng.range(0.7, 1.6);
        const slot = this.battle.chooseMove(w, foe);
        if (slot >= 0) this.battle.tryCast(w, slot, foe.x, foe.y, foe.id);
      }
      return;
    }
    if (!w.moving) {
      w.idleTimer -= dt;
      if (w.idleTimer <= 0) {
        const r = CONFIG.wild.wanderRadius;
        for (let tries = 0; tries < 6; tries++) {
          const tx = w.homeX + this.rng.range(-r, r);
          const ty = w.homeY + this.rng.range(-r, r);
          if (this.ground.reachable(Math.floor(tx), Math.floor(ty))) {
            w.targetX = tx;
            w.targetY = ty;
            w.moving = true;
            w.anim.play('Walk');
            break;
          }
        }
        w.idleTimer = this.rng.range(CONFIG.wild.idleMin, CONFIG.wild.idleMax);
      }
      return;
    }
    const dx = w.targetX - w.x;
    const dy = w.targetY - w.y;
    const d = Math.hypot(dx, dy);
    const speed = CONFIG.wild.wanderSpeed * (w.status === 'paralysis' ? CONFIG.battle.paralysisSpeed : 1);
    if (d < 0.05) {
      w.moving = false;
      w.anim.play('Idle');
      return;
    }
    const step = Math.min(d, speed * dt);
    const moved = tryMove(this.ground, w, (dx / d) * step, (dy / d) * step, 0.25);
    w.dir = dirFromVector(dx, dy, w.dir);
    if (moved < step * 0.2) {
      w.moving = false;
      w.anim.play('Idle');
    }
  }

  /** The lead Pokémon of whichever trainer is fighting this wild one. */
  opponentOf(w: Mon): Mon | null {
    for (const t of this.allTrainers) {
      if (t.alive && t.engaged === w) return lead(t);
    }
    return null;
  }

  private checkElimination(): void {
    for (const t of this.allTrainers) {
      if (t.alive && t.party.length > 0 && !lead(t)) this.eliminate(t);
    }
    if (!this.player.alive) this.outcome = 'loss';
    else if (this.trainers.length > 0 && this.trainers.every((t) => !t.alive)) this.outcome = 'win';
  }

  eliminate(t: Trainer): void {
    t.alive = false;
    this.battle.disengage(t);
    for (const o of this.allTrainers) if (o.engagedTrainer === t) this.battle.disengage(o);
    // Dropped items are scattered around the trainer.
    t.items.forEach((id, i) => {
      if (!id) return;
      const a = (i / t.items.length) * Math.PI * 2;
      this.items.push({ id: nextId++, itemId: id, x: t.x + Math.cos(a) * 0.9, y: t.y + Math.sin(a) * 0.9, bob: this.rng.next() * 6 });
      t.items[i] = null;
    });
  }
}

export function dirVec(d: Dir8): { x: number; y: number } {
  const v = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]][d] as [number, number];
  const n = Math.hypot(v[0], v[1]);
  return { x: v[0] / n, y: v[1] / n };
}
