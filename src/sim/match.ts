/**
 * Match state and the fixed-step simulation. Milestone 1: the player walks
 * the map with their party following in a line; wild Pokémon idle and wander
 * by biome.
 */
import { dirFromVector, type Dir8 } from '../core/math';
import type { Input } from '../core/input';
import { Rng } from '../core/rng';
import type { GroundRenderer, Biome } from '../ground/types';
import { AnimPlayer, type SpriteRegistry } from '../sprites/pokemonSprite';
import { CONFIG, SPAWNS, species, statsAtLevel } from './data';
import type { Mon, Trainer } from './entities';
import { lead } from './entities';
import { pointBehind, tryMove } from './movement';

export interface MatchDeps {
  ground: GroundRenderer;
  rng: Rng;
  sprites: SpriteRegistry;
}

let nextId = 1;

export class Match {
  readonly ground: GroundRenderer;
  readonly rng: Rng;
  readonly sprites: SpriteRegistry;
  time = 0;
  player: Trainer;
  trainers: Trainer[] = [];
  wilds: Mon[] = [];
  /** Centre of the map, where the Shadow Crystal stands. */
  readonly centerX: number;
  readonly centerY: number;

  constructor(deps: MatchDeps, starterDexes: string[]) {
    this.ground = deps.ground;
    this.rng = deps.rng;
    this.sprites = deps.sprites;
    this.centerX = this.ground.cols / 2;
    this.centerY = this.ground.rows / 2;
    const spawn = this.edgeSpawn();
    this.player = this.makeTrainer('You', 'player', true, spawn.x, spawn.y);
    for (const dex of starterDexes) this.player.party.push(this.makeMon(dex, CONFIG.player.level, this.player, spawn.x, spawn.y));
    this.spawnWilds();
  }

  /** A reachable tile as far from the centre as possible: the map edge. */
  edgeSpawn(exclude: Array<{ x: number; y: number }> = []): { x: number; y: number } {
    let best = { x: this.centerX, y: this.centerY };
    let bestScore = -1;
    for (let ty = 0; ty < this.ground.rows; ty++) {
      for (let tx = 0; tx < this.ground.cols; tx++) {
        if (!this.ground.reachable(tx, ty)) continue;
        // Prefer open ground: count reachable tiles in the 7x7 around it.
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
    const mon: Mon = {
      id: nextId++, dex, species: sp, name: sp.name, level, hp: stats.hp, maxHp: stats.hp, stats,
      stages: { atk: 0, def: 0 }, types: [...sp.types], moves: [...sp.moves], cooldowns: sp.moves.map(() => 0),
      x, y, px: x, py: y, dir: 0, anim: new AnimPlayer(sprites), sprites, owner, wild: owner === null, boss: false,
      fainted: false, status: null, statusTimer: 0, flash: 0, homeX: x, homeY: y, targetX: x, targetY: y,
      idleTimer: this.rng.range(0.5, 3), moving: false, inDark: false, drowsy: 0, outsideDark: 0, aura: false,
      heldItem: null, busy: 0, casting: null,
    };
    return mon;
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
        // Water Pokémon stand on walkable tiles that touch water.
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

  /** Every Pokémon on the field (for rendering and queries). */
  *mons(): Generator<Mon> {
    for (const t of [this.player, ...this.trainers]) for (const m of t.party) if (!m.fainted) yield m;
    for (const w of this.wilds) if (!w.fainted) yield w;
  }

  step(dt: number, input: Input): void {
    this.time += dt;
    for (const m of this.mons()) {
      m.px = m.x;
      m.py = m.y;
    }
    for (const t of [this.player, ...this.trainers]) {
      t.px = t.x;
      t.py = t.y;
    }
    this.stepPlayer(dt, input);
    this.stepFollowers(this.player, dt);
    for (const w of this.wilds) this.stepWild(w, dt);
    for (const m of this.mons()) m.anim.update(dt);
  }

  private stepPlayer(dt: number, input: Input): void {
    const p = this.player;
    const axis = input.moveAxis();
    const speed = CONFIG.player.speedTilesPerSec;
    let moved = 0;
    if (axis.x !== 0 || axis.y !== 0) {
      moved = tryMove(this.ground, p, axis.x * speed * dt, axis.y * speed * dt, CONFIG.player.radius);
      p.dir = dirFromVector(axis.x, axis.y, p.dir);
    }
    p.moving = moved > 1e-4;
    if (p.moving) {
      p.walkPhase = (p.walkPhase + (moved / 0.9)) % 1;
      const last = p.history[p.history.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 0.05) {
        p.history.push({ x: p.x, y: p.y });
        if (p.history.length > 400) p.history.shift();
      }
    }
    p.stats.timeSurvived = this.time;
  }

  /** Party members trail the trainer along the position history. */
  stepFollowers(t: Trainer, dt: number): void {
    const spacing = CONFIG.player.followSpacingTiles;
    const active = t.party.filter((m) => !m.fainted);
    const first = lead(t);
    active.forEach((m, i) => {
      if (m.casting || (t.engaged && m === first)) return; // battle positions are handled by the battle system
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
      if (movedNow !== m.moving) {
        m.moving = movedNow;
        m.anim.play(movedNow ? 'Walk' : 'Idle');
      }
      m.anim.dir = m.dir;
    });
  }

  private stepWild(w: Mon, dt: number): void {
    if (w.fainted) return;
    w.anim.dir = w.dir;
    if (w.casting || w.status === 'sleep') return;
    if (!w.moving) {
      w.idleTimer -= dt;
      if (w.anim.action !== 'Idle' && w.anim.done) w.anim.play('Idle');
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
}
