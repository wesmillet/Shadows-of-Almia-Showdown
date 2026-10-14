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
import { decide, type AiWorld } from './ai';
import { BattleSystem } from './battle';
import { newThrow, rollCatch, stepThrow, type Throw } from './catching';
import { CONFIG, SPAWNS, species, statsAtLevel } from './data';
import { inDarkness, newDarkness, stepDarkness, type DarknessState } from './darkness';
import type { GroundItem, InventorySlot, Mon, Trainer } from './entities';
import { activeParty, lead } from './entities';
import { ITEM_LIST, ITEMS } from './items';
import { canStand, pointBehind, tryMove } from './movement';

const AI_NAMES: Array<[string, string]> = [
  ['Sven', 'trainer_a'],
  ['Wendy', 'trainer_b'],
];

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
  outposts: Array<{ x: number; y: number; users: Trainer[]; beacon: number }> = [];
  /** Patrolling Rangers: decorative trainers with routes and no party. */
  npcs: Trainer[] = [];
  routes = new Map<number, { points: Array<{ x: number; y: number }>; index: number; wait: number }>();
  throws: Throw[] = [];
  darkrai: Mon | null = null;
  outcome: MatchOutcome = null;
  readonly darkness: DarknessState = newDarkness();
  /** Safe radius of the darkness in tiles (Infinity until the first pulse). */
  get darkRadius(): number {
    return this.darkness.radius;
  }
  /** Drifting motes in the dark, in world tiles (render-only state kept here so it is deterministic). */
  motes: Array<{ x: number; y: number; vx: number; vy: number; life: number; size: number }> = [];
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
    this.seedTrail(this.player);
    this.spawnWilds();
    this.spawnTrainers();
    this.placeOutposts();
    this.scatterItems();
  }

  private spawnTrainers(): void {
    const taken = [{ x: this.player.x, y: this.player.y }];
    for (let i = 0; i < CONFIG.trainers.count; i++) {
      const [name, role] = AI_NAMES[i % AI_NAMES.length] as [string, string];
      const spot = this.edgeSpawn(taken);
      taken.push(spot);
      const t = this.makeTrainer(name, role, false, spot.x, spot.y);
      const pool = this.rng.shuffle([...SPAWNS.trainerPool]);
      for (let k = 0; k < CONFIG.trainers.partySize; k++) {
        t.party.push(this.makeMon(pool[k % pool.length] as string, CONFIG.trainers.level, t, spot.x, spot.y));
      }
      t.items[0] = { id: 'potion', count: 1 };
      t.aiTimer = this.rng.range(0.5, 2);
      this.seedTrail(t);
      this.trainers.push(t);
    }
  }

  /** Two outposts on opposite sides, a third of the way out from the centre, each with a patrol Ranger. */
  private placeOutposts(): void {
    const base = this.rng.range(0, Math.PI * 2);
    for (let i = 0; i < 2; i++) {
      const ang = base + i * Math.PI;
      let best: { x: number; y: number } | null = null;
      for (let r = 9; r < 18 && !best; r += 0.5) {
        for (let da = 0; da < 0.9 && !best; da += 0.15) {
          for (const sgn of [1, -1]) {
            const x = this.centerX + Math.cos(ang + da * sgn) * r;
            const y = this.centerY + Math.sin(ang + da * sgn) * r;
            const tx = Math.floor(x);
            const ty = Math.floor(y);
            let open = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (this.ground.reachable(tx + dx, ty + dy)) open++;
            if (open === 9) {
              best = { x: tx + 0.5, y: ty + 0.5 };
              break;
            }
          }
        }
      }
      if (!best) continue;
      this.outposts.push({ ...best, users: [], beacon: 0 });
      const npc = this.makeTrainer(`Ranger ${i + 1}`, 'ranger', false, best.x + 1.5, best.y + 1.2);
      const pts = [
        { x: best.x + 1.5, y: best.y + 1.2 },
        { x: best.x - 1.5, y: best.y + 1.2 },
        { x: best.x - 1.5, y: best.y - 1.4 },
        { x: best.x + 1.5, y: best.y - 1.4 },
      ].filter((p) => this.ground.reachable(Math.floor(p.x), Math.floor(p.y)));
      this.npcs.push(npc);
      this.routes.set(npc.id, { points: pts.length ? pts : [{ x: best.x, y: best.y }], index: 0, wait: 1 });
    }
  }

  private scatterItems(): void {
    const spots: Array<{ x: number; y: number }> = [];
    for (let ty = 1; ty < this.ground.rows - 1; ty++) {
      for (let tx = 1; tx < this.ground.cols - 1; tx++) {
        if (!this.ground.reachable(tx, ty)) continue;
        if (Math.hypot(tx + 0.5 - this.player.x, ty + 0.5 - this.player.y) < 2.5) continue;
        spots.push({ x: tx + 0.5, y: ty + 0.5 });
      }
    }
    this.rng.shuffle(spots);
    // Guarantee the player a few balls nearby, then weight the rest.
    const near = spots.filter((p) => Math.hypot(p.x - this.player.x, p.y - this.player.y) < 7).slice(0, 3);
    let id = 0;
    for (const p of near) this.items.push({ id: nextId++, itemId: 'poke-ball', x: p.x, y: p.y, bob: id++ });
    for (let i = 0; i < CONFIG.items.groundItems && i < spots.length; i++) {
      const p = spots[i] as { x: number; y: number };
      if (near.includes(p)) continue;
      const def = this.rng.weighted(ITEM_LIST, (d) => d.weight);
      this.items.push({ id: nextId++, itemId: def.id, x: p.x, y: p.y, bob: this.rng.next() * 6 });
    }
  }

  /** Adds an item to a bag; returns false when it is full. */
  giveItem(t: Trainer, itemId: string): boolean {
    const def = ITEMS[itemId];
    if (def?.stack) {
      const slot = t.items.find((s) => s?.id === itemId);
      if (slot) {
        slot.count += def.stack;
        return true;
      }
    }
    const free = t.items.indexOf(null);
    if (free < 0) return false;
    t.items[free] = { id: itemId, count: def?.stack ?? 1 };
    return true;
  }

  takeItem(t: Trainer, slot: number): InventorySlot | null {
    const s = t.items[slot];
    if (!s) return null;
    s.count--;
    if (s.count <= 0) t.items[slot] = null;
    return s;
  }

  /** Uses a non-ball item from a bag slot. Returns a message for the HUD. */
  useItem(t: Trainer, slot: number): string {
    const entry = t.items[slot];
    if (!entry) return '';
    const def = ITEMS[entry.id];
    if (!def) return '';
    const m = lead(t);
    switch (def.kind) {
      case 'ball':
        return 'Hold Space to aim, release to throw';
      case 'heal': {
        if (!m) return 'No Pokémon to heal';
        if (m.hp >= m.maxHp) return `${m.name} is at full HP`;
        m.hp = Math.min(m.maxHp, m.hp + (def.amount ?? 20));
        this.takeItem(t, slot);
        this.battle.events.push({ type: 'text', mon: m, text: `+${def.amount}` });
        return `${m.name} recovered HP`;
      }
      case 'revive': {
        const down = t.party.find((p) => p.fainted);
        if (!down) return 'Nobody has fainted';
        down.fainted = false;
        down.hp = Math.max(1, Math.floor(down.maxHp * (def.fraction ?? 0.5)));
        down.x = t.x;
        down.y = t.y;
        down.anim.play('Idle', { restart: true });
        this.takeItem(t, slot);
        return `${down.name} was revived!`;
      }
      case 'cure': {
        const target = t.party.find((p) => !p.fainted && p.status) ?? m;
        if (!target || !target.status) return 'No status to cure';
        this.battle.cureStatus(target);
        target.drowsy = 0;
        this.takeItem(t, slot);
        return `${target.name} is cured`;
      }
      case 'boost': {
        if (!m) return 'No Pokémon';
        this.battle.changeStage(m, def.stat ?? 'atk', def.stages ?? 2);
        this.takeItem(t, slot);
        return `${m.name}'s ${def.stat === 'def' ? 'Defense' : 'Attack'} rose sharply!`;
      }
      case 'hold': {
        if (!m) return 'No Pokémon';
        if (m.heldItem) return `${m.name} already holds ${ITEMS[m.heldItem]?.name ?? 'an item'}`;
        m.heldItem = def.id;
        this.takeItem(t, slot);
        return `${m.name} holds the ${def.name}`;
      }
      case 'styler': {
        if (activeParty(t).length >= CONFIG.player.partyCap) return `Party is full (${CONFIG.player.partyCap})`;
        let best: Mon | null = null;
        let bd = 3.5;
        for (const o of this.allTrainers) {
          if (o === t) continue;
          for (const p of o.party) {
            if (!p.fainted) continue;
            const d = Math.hypot(p.x - t.x, p.y - t.y);
            if (d < bd) {
              bd = d;
              best = p;
            }
          }
        }
        if (!best) return 'No fainted enemy Pokémon nearby to claim';
        const owner = best.owner as Trainer;
        owner.party.splice(owner.party.indexOf(best), 1);
        best.owner = t;
        best.wild = false;
        best.fainted = false;
        best.hp = Math.max(1, Math.floor(best.maxHp * 0.5));
        best.status = null;
        best.anim.play('Idle', { restart: true });
        t.party.push(best);
        t.stats.catches++;
        this.takeItem(t, slot);
        this.battle.events.push({ type: 'caught', mon: best, by: t });
        return `Captured ${best.name} with the Styler!`;
      }
    }
  }

  /** First bag slot holding a ball, preferring the given slot. */
  ballSlot(t: Trainer, preferred = -1): number {
    const isBall = (i: number) => ITEMS[t.items[i]?.id ?? '']?.kind === 'ball';
    if (preferred >= 0 && isBall(preferred)) return preferred;
    for (let i = 0; i < t.items.length; i++) if (isBall(i)) return i;
    return -1;
  }

  /** Throws the ball in `slot` toward a point; the ball is spent either way. */
  throwBall(t: Trainer, slot: number, to: { x: number; y: number }): boolean {
    const entry = t.items[slot];
    const def = entry ? ITEMS[entry.id] : undefined;
    if (!entry || !def || def.kind !== 'ball') return false;
    if (activeParty(t).length >= CONFIG.player.partyCap) {
      this.battle.events.push({ type: 'notice', text: `Party is full (${CONFIG.player.partyCap})` });
      return false;
    }
    this.takeItem(t, slot);
    this.throws.push(newThrow(t, { x: t.x, y: t.y }, to, def.id, def.tier ?? 1));
    return true;
  }

  private stepThrows(dt: number): void {
    for (const th of this.throws) {
      const state = stepThrow(th, dt);
      if (state === 'landed') {
        let best: Mon | null = null;
        let bd = 0.9;
        for (const w of this.wilds) {
          if (w.fainted) continue;
          const d = Math.hypot(w.x - th.x, w.y - th.y);
          if (d < bd) {
            bd = d;
            best = w;
          }
        }
        if (!best) {
          th.done = true;
          this.battle.events.push({ type: 'notice', text: 'The ball missed', seconds: 1 });
          continue;
        }
        if (best.aura) {
          th.done = true;
          this.battle.events.push({ type: 'text', mon: best, text: 'The darkness repels the ball!' });
          continue;
        }
        th.target = best;
        th.roll = rollCatch(this.rng, best, th.tier);
        th.x = best.x;
        th.y = best.y + 0.1;
        best.flash = 0.06;
        best.anim.play('Hurt', { restart: true, loop: false });
        best.casting = null;
        best.moving = false;
      } else if (state === 'result' && th.target && th.roll && !th.target.fainted) {
        const w = th.target;
        if (th.roll.caught) {
          this.wilds.splice(this.wilds.indexOf(w), 1);
          w.owner = th.thrower;
          w.wild = false;
          w.aura = false;
          th.thrower.party.push(w);
          th.thrower.stats.catches++;
          if (th.thrower.engaged === w) this.battle.disengage(th.thrower);
          this.battle.events.push({ type: 'caught', mon: w, by: th.thrower });
        } else {
          this.battle.events.push({ type: 'broke-free', mon: w });
          if (!th.thrower.engaged && th.thrower.isPlayer && lead(th.thrower)) this.battle.engage(th.thrower, w);
        }
        th.target = null;
      }
    }
    this.throws = this.throws.filter((th) => !th.done);
  }

  private stepItems(dt: number): void {
    for (const it of this.items) it.bob += dt;
    for (const t of this.allTrainers) {
      if (!t.alive) continue;
      for (let i = this.items.length - 1; i >= 0; i--) {
        const it = this.items[i] as GroundItem;
        if (Math.hypot(it.x - t.x, it.y - t.y) > CONFIG.items.pickupRadius) continue;
        if (this.giveItem(t, it.itemId)) {
          this.items.splice(i, 1);
          this.battle.events.push({ type: 'pickup', trainer: t, itemId: it.itemId });
        } else if (t.isPlayer && it.bob % 3 < dt) {
          this.battle.events.push({ type: 'notice', text: 'Bag is full', seconds: 0.8 });
        }
      }
      // Leftovers regenerate the holder.
      for (const m of t.party) {
        if (m.fainted || m.heldItem !== 'leftovers' || m.hp >= m.maxHp) continue;
        m.busy = (m.busy ?? 0) + dt;
        if (m.owner && m.busy >= 3) {
          m.busy = 0;
          m.hp = Math.min(m.maxHp, m.hp + Math.max(1, Math.floor(m.maxHp / 16)));
          this.battle.events.push({ type: 'text', mon: m, text: '+Leftovers' });
        }
      }
    }
  }

  private stepOutposts(dt: number): void {
    for (const o of this.outposts) {
      o.users = [];
      for (const t of this.allTrainers) {
        if (!t.alive || this.time < t.outpostReady) continue;
        if (Math.hypot(t.x - o.x, t.y - o.y) > CONFIG.outpost.radius) {
          if (t.healing > 0 && !this.outposts.some((p) => p !== o && Math.hypot(t.x - p.x, t.y - p.y) <= CONFIG.outpost.radius)) t.healing = 0;
          continue;
        }
        const needs = t.party.some((m) => m.fainted || m.hp < m.maxHp || m.status);
        if (!needs) continue;
        o.users.push(t);
        if (t.healing === 0 && !t.isPlayer) this.battle.events.push({ type: 'notice', text: `Beacon: ${t.name} is healing at an outpost`, seconds: 2 });
        t.healing += dt;
        if (t.healing >= CONFIG.outpost.healSeconds) {
          t.healing = 0;
          t.outpostReady = this.time + 20;
          for (const m of t.party) {
            m.fainted = false;
            m.hp = m.maxHp;
            m.status = null;
            m.drowsy = 0;
            m.anim.play('Idle', { restart: true });
            m.x = t.x;
            m.y = t.y;
          }
          this.battle.events.push({ type: 'notice', text: t.isPlayer ? 'Party fully healed!' : `${t.name} healed at the outpost`, seconds: 1.5 });
        }
      }
      // The beacon broadcasts whoever is healing to every trainer.
      o.beacon = o.users.length ? 1 : Math.max(0, o.beacon - dt * 0.5);
    }
  }

  private stepNpcs(dt: number): void {
    for (const n of this.npcs) {
      const r = this.routes.get(n.id);
      if (!r) continue;
      const p = r.points[r.index] as { x: number; y: number };
      const dx = p.x - n.x;
      const dy = p.y - n.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.08) {
        n.moving = false;
        r.wait -= dt;
        if (r.wait <= 0) {
          r.index = (r.index + 1) % r.points.length;
          r.wait = this.rng.range(0.8, 2);
        }
        continue;
      }
      const step = Math.min(d, 1.6 * dt);
      const moved = tryMove(this.ground, n, (dx / d) * step, (dy / d) * step, 0.2);
      n.dir = dirFromVector(dx, dy, n.dir);
      this.afterTrainerMove(n, moved);
      if (moved < step * 0.2) {
        r.index = (r.index + 1) % r.points.length;
      }
    }
  }

  private aiWorld(): AiWorld {
    return {
      ground: this.ground,
      rng: this.rng,
      items: this.items,
      outposts: this.outposts,
      rivals: [],
      darkRadius: this.darkRadius,
      centerX: this.centerX,
      centerY: this.centerY,
    };
  }

  private stepAi(t: Trainer, dt: number): void {
    const world = this.aiWorld();
    world.rivals = this.allTrainers.filter((o) => o !== t && o.alive);
    // Beacons draw healthy trainers in.
    t.aiTimer -= dt;
    if (t.aiTimer <= 0) {
      t.aiTimer = this.rng.range(0.4, 0.9);
      const d = decide(t, world);
      t.ai = d.ai;
      t.aiTarget = d.target;
      if (d.ai === 'engage' && d.rival) {
        const foe = lead(d.rival);
        if (foe && t.engaged !== foe && Math.hypot(d.rival.x - t.x, d.rival.y - t.y) < 4.5) {
          this.battle.engage(t, foe);
          if (d.rival.isPlayer && d.rival.engaged !== lead(t)) {
            const myLead = lead(t);
            if (myLead) this.battle.engage(d.rival, myLead);
          }
        }
      } else if (d.ai === 'roam' && !t.engaged) {
        const beacon = this.outposts.find((o) => o.beacon > 0.5 && o.users.some((u) => u !== t));
        if (beacon && Math.hypot(beacon.x - t.x, beacon.y - t.y) < 20) {
          t.aiTarget = { x: beacon.x, y: beacon.y };
          t.ai = 'engage';
        }
      }
      // Use a potion when the lead is low.
      const m = lead(t);
      if (m && m.hp < m.maxHp * 0.5) {
        const slot = t.items.findIndex((s) => s && ITEMS[s.id]?.kind === 'heal');
        if (slot >= 0) this.useItem(t, slot);
      }
    }
    // Movement toward the target.
    let moved = 0;
    const target = t.aiTarget;
    if (target) {
      let dx = target.x - t.x;
      let dy = target.y - t.y;
      const d = Math.hypot(dx, dy);
      let stop = 0.35;
      if (t.ai === 'engage' && t.engaged) stop = 2.1;
      if (t.ai === 'heal') stop = 0.5;
      if (d > stop) {
        dx /= d;
        dy /= d;
        const speed = CONFIG.trainers.speed * (t.ai === 'flee' ? 1.1 : 1);
        moved = tryMove(this.ground, t, dx * speed * dt, dy * speed * dt, CONFIG.player.radius);
        t.dir = dirFromVector(dx, dy, t.dir);
        if (moved < speed * dt * 0.2) t.aiTimer = Math.min(t.aiTimer, 0.1);
      } else if (t.engaged) {
        t.dir = dirFromVector(t.engaged.x - t.x, t.engaged.y - t.y, t.dir);
      }
    }
    this.separate(t);
    this.afterTrainerMove(t, moved);
    // Fighting: the lead attacks on its own timer.
    const m = lead(t);
    const foe = t.engaged;
    if (m && foe && !foe.fainted && t.ai !== 'flee') {
      t.attackTimer -= dt;
      if (t.attackTimer <= 0) {
        t.attackTimer = this.rng.range(0.8, 1.7);
        const slot = this.battle.chooseMove(m, foe);
        if (slot >= 0 && Math.hypot(foe.x - m.x, foe.y - m.y) < 4) this.battle.tryCast(m, slot, foe.x, foe.y, foe.id);
      }
    }
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

  /** Starts a trainer's position history with a short walkable trail so followers line up behind them. */
  seedTrail(t: Trainer): void {
    let bestDir: { x: number; y: number } | null = null;
    let bestLen = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const d = { x: Math.cos(a), y: Math.sin(a) };
      let len = 0;
      for (let k = 0.25; k <= 3.5; k += 0.25) {
        if (!canStand(this.ground, t.x + d.x * k, t.y + d.y * k, 0.25)) break;
        len = k;
      }
      // Prefer trails that point away from the centre (the player faces inward).
      const away = (d.x * (t.x - this.centerX) + d.y * (t.y - this.centerY)) > 0 ? 0.5 : 0;
      if (len + away > bestLen) {
        bestLen = len + away;
        bestDir = d;
      }
    }
    if (!bestDir) return;
    t.history = [];
    for (let k = Math.min(3.5, bestLen); k > 0; k -= 0.25) t.history.push({ x: t.x + bestDir.x * k, y: t.y + bestDir.y * k });
    t.history.push({ x: t.x, y: t.y });
    t.dir = dirFromVector(-bestDir.x, -bestDir.y, t.dir);
    t.party.forEach((m, i) => {
      const p = pointBehind(t.history, CONFIG.player.followSpacingTiles * (i + 1)) ?? { x: t.x, y: t.y };
      m.x = m.px = p.x;
      m.y = m.py = p.y;
      m.dir = t.dir;
    });
  }

  makeTrainer(name: string, role: string, isPlayer: boolean, x: number, y: number): Trainer {
    return {
      id: nextId++, name, role, isPlayer, x, y, px: x, py: y, dir: 4 as Dir8, moving: false, walkPhase: 0,
      party: [], history: [{ x, y }], items: new Array<InventorySlot | null>(CONFIG.items.inventorySize).fill(null), alive: true,
      stats: { catches: 0, knockouts: 0, damage: 0, timeSurvived: 0 },
      engaged: null, engagedTrainer: null, ai: 'roam', aiTimer: 0, aiTarget: null, healing: 0, outpostReady: 0, attackTimer: 1,
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
    for (const t of this.trainers) if (t.alive) this.stepAi(t, dt);
    this.stepNpcs(dt);
    this.stepEngagement();
    for (const t of this.allTrainers) {
      if (!t.alive) continue;
      this.stepLead(t, dt);
      this.stepFollowers(t, dt);
    }
    for (const w of this.wilds) this.stepWild(w, dt);
    this.stepItems(dt);
    this.stepOutposts(dt);
    this.stepThrows(dt);
    this.stepDarkness(dt);
    if (this.darkrai) this.stepDarkrai(this.darkrai, dt);
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

  /** Touching a wild Pokémon or an enemy lead starts a fight; distance or a knockout ends it. */
  private stepEngagement(): void {
    for (const t of this.allTrainers) {
      if (!t.alive || !t.engaged) continue;
      const e = t.engaged;
      const far = Math.hypot(e.x - t.x, e.y - t.y) > CONFIG.battle.disengageDistance;
      if (e.fainted || far || !lead(t) || (e.owner && !e.owner.alive)) {
        const rival = t.engagedTrainer;
        this.battle.disengage(t);
        // A trainer fight continues against the rival's next Pokémon.
        const next = rival && rival.alive ? lead(rival) : null;
        if (next && !far && lead(t)) this.battle.engage(t, next);
      }
    }
    const p = this.player;
    if (!p.engaged && lead(p)) {
      for (const w of this.wilds) {
        if (w.fainted || w.status === 'sleep') continue;
        if (Math.hypot(w.x - p.x, w.y - p.y) < 0.8) {
          this.battle.engage(p, w);
          break;
        }
      }
      for (const t of this.trainers) {
        const m = lead(t);
        if (!t.alive || !m) continue;
        if (Math.hypot(m.x - p.x, m.y - p.y) < 0.9 || Math.hypot(t.x - p.x, t.y - p.y) < 0.9) {
          this.battle.engage(p, m);
          const mine = lead(p);
          if (mine && !t.engaged) this.battle.engage(t, mine);
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

  private stepDarkness(dt: number): void {
    const d = this.darkness;
    const mapRadius = Math.hypot(this.centerX, this.centerY) + 1;
    const wasPhase = d.phase;
    stepDarkness(d, dt, mapRadius);
    if (d.pulsed) {
      this.battle.events.push({ type: 'notice', text: d.finale ? 'The crystal shatters. Darkrai awakens!' : `Darkness pulse ${d.phase}: the night closes in`, seconds: 3 });
      if (d.finale && !this.darkrai) this.spawnDarkrai();
    }
    void wasPhase;
    if (!Number.isFinite(d.radius)) return;
    const c = CONFIG.darkness;
    for (const m of this.mons()) {
      if (m.boss) continue;
      const dark = inDarkness(d, m.x, m.y, this.centerX, this.centerY);
      m.inDark = dark;
      if (m.wild) m.aura = dark;
      if (dark) {
        m.outsideDark = 0;
        if (m.status === null) {
          m.drowsy += dt;
          if (m.drowsy >= c.drowsySeconds) {
            m.drowsy = 0;
            this.battle.applyStatus(m, 'sleep');
            m.statusTimer = 1e9; // only Full Heal or the light wakes a darkness sleeper
            this.battle.events.push({ type: 'text', mon: m, text: 'The darkness lulls it to sleep…' });
          }
        }
        if (m.status === 'sleep') {
          m.busy -= dt;
          if (m.busy <= 0) {
            m.busy = 1;
            const dmg = Math.max(1, Math.floor(m.maxHp * c.badDreamsFraction));
            this.battle.applyDamage(m, dmg, this.darkrai);
            this.battle.events.push({ type: 'tick', target: m, damage: dmg, source: 'dreams' });
          }
        }
      } else {
        m.drowsy = Math.max(0, m.drowsy - dt * 2);
        if (m.status === 'sleep' && m.statusTimer > 1e8) {
          m.outsideDark += dt;
          if (m.outsideDark >= c.wakeAfterSecondsOutside) this.battle.cureStatus(m);
        }
      }
    }
    // Motes drift through the dark part of the screen around the player.
    const p = this.player;
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const mo = this.motes[i] as (typeof this.motes)[number];
      mo.x += mo.vx * dt;
      mo.y += mo.vy * dt;
      mo.life -= dt;
      if (mo.life <= 0 || !inDarkness(d, mo.x, mo.y, this.centerX, this.centerY)) this.motes.splice(i, 1);
    }
    if (this.motes.length < 90) {
      for (let k = 0; k < 3; k++) {
        const x = p.x + this.rng.range(-7, 7);
        const y = p.y + this.rng.range(-4, 4);
        if (inDarkness(d, x, y, this.centerX, this.centerY)) {
          this.motes.push({ x, y, vx: this.rng.range(-0.25, 0.25), vy: this.rng.range(-0.35, -0.05), life: this.rng.range(2, 5), size: this.rng.range(0.03, 0.09) });
        }
      }
    }
  }

  private spawnDarkrai(): void {
    const d = this.makeMon('0491', CONFIG.battle.bossLevel, null, this.centerX, this.centerY - 0.6);
    d.boss = true;
    d.wild = false;
    d.maxHp = d.hp = d.stats.hp * CONFIG.battle.bossHpMultiplier;
    d.busy = 2.5;
    this.darkrai = d;
  }

  /** Darkrai hovers by the crystal and punishes whoever is closest: Dark Void rings, Dark Pulse lines. */
  private stepDarkrai(d: Mon, dt: number): void {
    if (d.fainted) return;
    let target: Mon | null = null;
    let bd = 10;
    for (const t of this.allTrainers) {
      const m = lead(t);
      if (!t.alive || !m) continue;
      const dist = Math.hypot(m.x - d.x, m.y - d.y);
      if (dist < bd) {
        bd = dist;
        target = m;
      }
    }
    if (!target) {
      d.anim.dir = d.dir;
      return;
    }
    // Drift toward the target, never far from the crystal.
    const toC = Math.hypot(d.x - this.centerX, d.y - this.centerY);
    if (bd > 2.6 && toC < 4 && !d.casting) {
      const k = (1.4 * dt) / bd;
      d.x += (target.x - d.x) * k;
      d.y += (target.y - d.y) * k;
      if (!d.moving) {
        d.moving = true;
        d.anim.play('Walk');
      }
    } else if (d.moving && !d.casting) {
      d.moving = false;
      d.anim.play('Idle');
    }
    d.dir = dirFromVector(target.x - d.x, target.y - d.y, d.dir);
    d.busy -= dt;
    if (d.busy <= 0 && !d.casting) {
      d.busy = this.rng.range(1.8, 3);
      // Dark Void (ring) when the target is close, otherwise Dark Pulse (line).
      const slot = bd < 2.3 && (d.cooldowns[0] ?? 0) <= 0 ? 0 : (d.cooldowns[1] ?? 0) <= 0 ? 1 : this.battle.chooseMove(d, target);
      if (slot >= 0) this.battle.tryCast(d, slot, target.x, target.y, target.id);
    }
  }

  eliminate(t: Trainer): void {
    t.alive = false;
    this.battle.disengage(t);
    for (const o of this.allTrainers) if (o.engagedTrainer === t) this.battle.disengage(o);
    // Dropped items are scattered around the trainer.
    t.items.forEach((entry, i) => {
      if (!entry) return;
      const a = (i / t.items.length) * Math.PI * 2;
      for (let k = 0; k < entry.count; k++) {
        this.items.push({ id: nextId++, itemId: entry.id, x: t.x + Math.cos(a + k * 0.4) * (0.9 + k * 0.3), y: t.y + Math.sin(a + k * 0.4) * (0.9 + k * 0.3), bob: this.rng.next() * 6 });
      }
      t.items[i] = null;
    });
    this.battle.events.push({ type: 'eliminated', trainer: t });
  }
}

export function dirVec(d: Dir8): { x: number; y: number } {
  const v = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]][d] as [number, number];
  const n = Math.hypot(v[0], v[1]);
  return { x: v[0] / n, y: v[1] / n };
}
