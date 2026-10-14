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
import { ballModifier, newThrow, rollCatch, stepThrow, targetVisual, type Throw } from './catching';
import { CONFIG, SPAWNS, move, species, statsAtLevel } from './data';
import { inDarkness, newDarkness, stepDarkness, type DarknessState } from './darkness';
import type { GroundItem, InventorySlot, Mon, Trainer } from './entities';
import { activeParty, lead } from './entities';
import { ballOfTier, isGear, ITEMS, rollLoot, rollTier, type BallKind, type LootTier } from './items';
import { canStand, tryMove } from './movement';
import { areaContains, makeArea } from './battle';
import { isRoaming, shareKnockoutXp, stepParty, type PartyWorld } from './party';

const AI_NAMES: Array<[string, string]> = [
  ['Rook', 'trainer_a'],
  ['Marlo', 'trainer_b'],
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
  /** Crystal Shard clearings: circles the darkness leaves alone while `t` > 0. */
  lightZones: Array<{ x: number; y: number; r: number; t: number }> = [];
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

  /** Player party size limit (demo teams may start above the normal cap). */
  readonly partyCap: number;

  constructor(deps: MatchDeps, starterDexes: string[], opts: { level?: number; partyCap?: number } = {}) {
    this.partyCap = Math.max(CONFIG.player.partyCap, opts.partyCap ?? 0);
    this.ground = deps.ground;
    this.rng = deps.rng;
    this.sprites = deps.sprites;
    this.battle = new BattleSystem(this.rng);
    this.centerX = this.ground.cols / 2;
    this.centerY = this.ground.rows / 2;
    const spawn = this.ground.spawns[0] ? { x: this.ground.spawns[0].x + 0.5, y: this.ground.spawns[0].y + 0.5 } : this.edgeSpawn();
    this.player = this.makeTrainer('You', 'player', true, spawn.x, spawn.y);
    for (const dex of starterDexes) this.player.party.push(this.makeMon(dex, opts.level ?? CONFIG.player.level, this.player, spawn.x, spawn.y));
    this.placeParty(this.player);
    this.spawnWilds();
    this.spawnTrainers();
    this.placeOutposts();
    this.scatterItems();
  }

  private spawnTrainers(): void {
    const taken = [{ x: this.player.x, y: this.player.y }];
    for (let i = 0; i < CONFIG.trainers.count; i++) {
      const [name, role] = AI_NAMES[i % AI_NAMES.length] as [string, string];
      const planned = this.ground.spawns[i + 1];
      const spot = planned ? { x: planned.x + 0.5, y: planned.y + 0.5 } : this.edgeSpawn(taken);
      taken.push(spot);
      const t = this.makeTrainer(name, role, false, spot.x, spot.y);
      const pool = this.rng.shuffle([...SPAWNS.trainerPool]);
      for (let k = 0; k < CONFIG.trainers.partySize; k++) {
        t.party.push(this.makeMon(pool[k % pool.length] as string, CONFIG.trainers.level, t, spot.x, spot.y));
      }
      t.items[0] = { id: 'potion', count: 1 };
      t.aiTimer = this.rng.range(0.5, 2);
      t.roamTimer = CONFIG.party.aiRoamEverySeconds * this.rng.range(0.6, 1.2);
      this.placeParty(t);
      this.trainers.push(t);
    }
  }

  /** The outposts the island generator laid trails to, each with a member of staff on patrol. */
  private placeOutposts(): void {
    for (let i = 0; i < 2; i++) {
      const planned = this.ground.outposts[i];
      if (!planned) continue;
      const best = { x: planned.x + 0.5, y: planned.y + 0.5 };
      this.outposts.push({ ...best, users: [], beacon: 0 });
      const npc = this.makeTrainer(i === 0 ? 'Outpost staff' : 'Outpost staff', i === 0 ? 'staff_a' : 'staff_b', false, best.x + 1.5, best.y + 1.2);
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
    const near = spots.filter((p) => Math.hypot(p.x - this.player.x, p.y - this.player.y) < 9).slice(0, 3);
    let id = 0;
    for (const p of near) this.items.push({ id: nextId++, ball: 'poke', tier: null, contents: [{ id: 'poke-ball', count: 2 }], x: p.x, y: p.y, bob: id++ });
    for (let i = 0; i < CONFIG.items.groundItems && i < spots.length; i++) {
      const p = spots[i] as { x: number; y: number };
      if (near.includes(p)) continue;
      this.dropLoot(p.x, p.y);
    }
  }

  /** An unopened item ball of a rolled tier at a point. */
  dropLoot(x: number, y: number): void {
    const tier = rollTier(this.rng);
    this.items.push({ id: nextId++, ball: ballOfTier(tier), tier, contents: null, x, y, bob: this.rng.next() * 6 });
  }

  /** A ball with known contents at a point (Master, Premier, Cherish and dropped bags). */
  placeBall(ball: BallKind, contents: InventorySlot[], x: number, y: number, heal = false): void {
    this.items.push({ id: nextId++, ball, tier: null, contents, heal, x, y, bob: this.rng.next() * 6 });
  }

  /** Adds an item to the right tab (bag, or gear for held items and TMs); returns false when it is full. */
  giveItem(t: Trainer, itemId: string, count = 1): boolean {
    const def = ITEMS[itemId];
    const tab = isGear(itemId) ? t.held : t.items;
    if (def?.stack) {
      const slot = tab.find((s) => s?.id === itemId);
      if (slot) {
        slot.count += count;
        return true;
      }
    }
    const free = tab.indexOf(null);
    if (free < 0) return false;
    tab[free] = { id: itemId, count };
    return true;
  }

  takeItem(t: Trainer, slot: number, tab: 'items' | 'held' = 'items'): InventorySlot | null {
    const list = t[tab];
    const s = list[slot];
    if (!s) return null;
    s.count--;
    if (s.count <= 0) list[slot] = null;
    return s;
  }

  /** Equips a held item from the gear tab on the lead; the previous item returns to the tab. */
  equip(t: Trainer, slot: number): string {
    const entry = t.held[slot];
    const def = entry ? ITEMS[entry.id] : undefined;
    const m = lead(t);
    if (!entry || !def || def.kind !== 'hold') return '';
    if (!m) return 'No Pokémon to hold it';
    const previous = m.heldItem;
    m.heldItem = def.id;
    this.takeItem(t, slot, 'held');
    if (previous) this.giveItem(t, previous);
    return `${m.name} holds the ${def.name}`;
  }

  /** Teaches a TM's move to the lead in move slot `replace` (0-3). */
  teach(t: Trainer, slot: number, replace: number): string {
    const entry = t.held[slot];
    const def = entry ? ITEMS[entry.id] : undefined;
    const m = lead(t);
    if (!entry || !def || def.kind !== 'tm' || !def.move) return '';
    if (!m) return 'No Pokémon to teach';
    if (!m.types.includes(def.tmType ?? '')) return `${m.name} cannot learn ${move(def.move).name} (${def.tmType} type)`;
    if (replace < 0 || replace > 3) return '';
    const old = m.moves[replace];
    m.moves[replace] = def.move;
    m.cooldowns[replace] = 0;
    this.takeItem(t, slot, 'held');
    return `${m.name} forgot ${old ? move(old).name : '?'} and learned ${move(def.move).name}!`;
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
        down.behavior = 'guard';
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
        const label = def.stat === 'def' ? 'Defense' : def.stat === 'spe' ? 'Speed' : 'Attack';
        return `${m.name}'s ${label} rose sharply!`;
      }
      case 'hold':
        return this.equip(t, slot);
      case 'tm':
        return 'Pick a move slot to replace';
      case 'shard': {
        if (!Number.isFinite(this.darkness.radius)) return 'The darkness has not come yet';
        this.lightZones.push({ x: t.x, y: t.y, r: def.radius ?? 5, t: def.seconds ?? 10 });
        this.takeItem(t, slot);
        this.battle.events.push({ type: 'notice', text: 'The shard blazes: the darkness pulls back', seconds: 2 });
        return '';
      }
      case 'styler': {
        if (activeParty(t).length >= this.partyCap) return `Party is full (${this.partyCap})`;
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
    if (activeParty(t).length >= this.partyCap) {
      this.battle.events.push({ type: 'notice', text: `Party is full (${this.partyCap})` });
      return false;
    }
    this.takeItem(t, slot);
    this.throws.push(newThrow(t, { x: t.x, y: t.y }, to, def.id));
    return true;
  }

  private stepThrows(dt: number): void {
    for (const th of this.throws) {
      const ev = stepThrow(th, dt);
      if (th.target) th.target.visual = targetVisual(th);
      if (ev === 'landed') {
        let best: Mon | null = null;
        let bd = 1.4;
        for (const w of this.wilds) {
          if (!BattleSystem.active(w)) continue;
          const d = Math.hypot(w.x - th.x, w.y - th.y);
          if (d < bd) {
            bd = d;
            best = w;
          }
        }
        if (!best) {
          th.phase = 'done';
          this.battle.events.push({ type: 'notice', text: 'The ball missed', seconds: 1 });
          continue;
        }
        if (best.aura) {
          th.phase = 'done';
          this.battle.events.push({ type: 'text', mon: best, text: 'The darkness repels the ball!' });
          continue;
        }
        // Hit: the target reels, then gets pulled into the ball. The ball's rule is judged where it lands.
        th.target = best;
        th.modifier = ballModifier(th.ballId, {
          target: best, thrower: th.thrower, matchTime: this.time,
          inWater: this.ground.inWater(Math.floor(best.x), Math.floor(best.y)),
          inDark: this.isDark(best.x, best.y),
        });
        th.roll = rollCatch(this.rng, best, th.modifier);
        th.phase = 'hit';
        th.phaseT = 0;
        th.x = best.x;
        th.y = best.y + 0.05;
        best.flash = 0.06;
        best.anim.play('Hurt', { restart: true, loop: false });
        best.casting = null;
        best.moving = false;
        best.target = null;
        this.battle.events.push({ type: 'ball-hit', mon: best, x: th.x, y: th.y });
        continue;
      }
      if (!th.target) continue;
      const w = th.target;
      if (ev === 'absorb') {
        w.captured = true; // inside the ball: no acting, no targeting, AI suspended
        this.battle.events.push({ type: 'ball-absorb', mon: w, x: th.x, y: th.y });
      } else if (ev === 'click') {
        this.battle.events.push({ type: 'ball-click', mon: w, x: th.x, y: th.y });
      } else if (ev === 'burst') {
        this.battle.events.push({ type: 'ball-burst', mon: w, x: th.x, y: th.y });
      } else if (ev === 'done') {
        w.visual = { scale: 1, alpha: 1, flash: 0 };
        if (th.roll?.caught) {
          this.wilds.splice(this.wilds.indexOf(w), 1);
          w.captured = false;
          w.owner = th.thrower;
          w.wild = false;
          w.aura = false;
          w.behavior = 'guard';
          w.target = null;
          if (ITEMS[th.ballId]?.special === 'heal') {
            w.hp = w.maxHp;
            this.battle.cureStatus(w);
          }
          th.thrower.party.push(w);
          th.thrower.stats.catches++;
          this.battle.events.push({ type: 'caught', mon: w, by: th.thrower });
        } else {
          w.captured = false;
          w.anim.play('Idle', { restart: true });
          w.target = lead(th.thrower);
          this.battle.events.push({ type: 'broke-free', mon: w });
        }
      }
    }
    this.throws = this.throws.filter((th) => th.phase !== 'done');
  }

  private stepItems(dt: number): void {
    for (const it of this.items) it.bob += dt;
    for (const t of this.allTrainers) {
      if (!t.alive) continue;
      for (let i = this.items.length - 1; i >= 0; i--) {
        const it = this.items[i] as GroundItem;
        if (Math.hypot(it.x - t.x, it.y - t.y) > CONFIG.items.pickupRadius) continue;
        // Contents are revealed when the ball is opened; whatever does not fit stays in the ball.
        if (!it.contents) it.contents = [rollLoot(this.rng, it.tier ?? 'common')];
        const got: InventorySlot[] = [];
        it.contents = it.contents.filter((c) => {
          if (!this.giveItem(t, c.id, c.count)) return true;
          got.push(c);
          return false;
        });
        if (got.length) {
          const healed = !!it.heal;
          if (healed) for (const m of t.party) if (!m.fainted) {
            m.hp = m.maxHp;
            this.battle.cureStatus(m);
          }
          it.heal = false;
          if (it.contents.length === 0) this.items.splice(i, 1);
          this.battle.events.push({ type: 'pickup', trainer: t, items: got, ball: it.ball, healed });
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
        const needs = t.party.some((m) => !isRoaming(m) && (m.fainted || m.hp < m.maxHp || m.status));
        if (!needs) continue;
        o.users.push(t);
        if (t.healing === 0 && !t.isPlayer) this.battle.events.push({ type: 'notice', text: `Beacon: ${t.name} is healing at an outpost`, seconds: 2 });
        t.healing += dt;
        if (t.healing >= CONFIG.outpost.healSeconds) {
          t.healing = 0;
          t.outpostReady = this.time + 20;
          for (const m of t.party) {
            if (isRoaming(m)) continue;
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
      if (d.ai === 'roam') {
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
      if (t.ai === 'engage') stop = 2.4;
      if (t.ai === 'heal') stop = 0.5;
      if (d > stop) {
        dx /= d;
        dy /= d;
        const speed = CONFIG.trainers.speed * (t.ai === 'flee' ? 1.1 : 1);
        moved = tryMove(this.ground, t, dx * speed * dt, dy * speed * dt, CONFIG.player.radius);
        t.dir = dirFromVector(dx, dy, t.dir);
        if (moved < speed * dt * 0.2) t.aiTimer = Math.min(t.aiTimer, 0.1);
      }
    }
    this.separate(t);
    this.afterTrainerMove(t, moved);
    // Occasionally send one member roaming so lone enemy Pokémon can be met on the map.
    t.roamTimer -= dt;
    if (t.roamTimer <= 0) {
      t.roamTimer = CONFIG.party.aiRoamEverySeconds;
      const standing = t.party.filter((m) => BattleSystem.active(m) && !isRoaming(m));
      const roamer = t.party.find((m) => isRoaming(m));
      if (roamer) roamer.recall = true;
      else if (standing.length >= 2 && this.rng.chance(CONFIG.party.aiRoamChance)) {
        const pick = standing[standing.length - 1] as Mon;
        pick.behavior = 'roam';
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

  /** Drops party members onto their formation spots (or the trainer's tile when blocked). */
  placeParty(t: Trainer): void {
    t.party.forEach((m, i) => {
      const ang = (i / Math.max(1, t.party.length)) * Math.PI * 2;
      const r = 0.9 + i * 0.3;
      const x = t.x + Math.cos(ang) * r;
      const y = t.y + Math.sin(ang) * r;
      const ok = canStand(this.ground, x, y, 0.22);
      m.x = m.px = ok ? x : t.x;
      m.y = m.py = ok ? y : t.y;
      m.dir = t.dir;
    });
  }

  makeTrainer(name: string, role: string, isPlayer: boolean, x: number, y: number): Trainer {
    return {
      id: nextId++, name, role, isPlayer, x, y, px: x, py: y, dir: 4 as Dir8, moving: false, walkPhase: 0,
      party: [], items: new Array<InventorySlot | null>(CONFIG.items.inventorySize).fill(null),
      held: new Array<InventorySlot | null>(CONFIG.items.inventorySize).fill(null), alive: true,
      stats: { catches: 0, knockouts: 0, damage: 0, timeSurvived: 0 },
      ai: 'roam', aiTimer: 0, aiTarget: null, healing: 0, outpostReady: 0, attackTimer: 1, roamTimer: 0,
    };
  }

  makeMon(dex: string, level: number, owner: Trainer | null, x: number, y: number): Mon {
    const sp = species(dex);
    const stats = statsAtLevel(sp.stats, level);
    const sprites = this.sprites.get(dex);
    return {
      id: nextId++, dex, species: sp, name: sp.name, level, hp: stats.hp, maxHp: stats.hp, stats,
      stages: { atk: 0, def: 0, spe: 0 }, types: [...sp.types], moves: [...sp.moves], cooldowns: sp.moves.map(() => 0),
      x, y, px: x, py: y, dir: 0, anim: new AnimPlayer(sprites), sprites, owner, wild: owner === null, boss: false,
      fainted: false, status: null, statusTimer: 0, flash: 0, homeX: x, homeY: y, targetX: x, targetY: y,
      idleTimer: this.rng.range(0.5, 3), moving: false, inDark: false, drowsy: 0, outsideDark: 0, aura: false,
      heldItem: null, busy: 0, casting: null, target: null, captured: false,
      behavior: owner ? (owner.party.length === 0 ? 'aggressive' : 'guard') : 'guard', xp: 0, wander: null, wanderPause: 0,
      roamTarget: null, recall: false, sinceHit: 999, visual: { scale: 1, alpha: 1, flash: 0 },
    };
  }

  private spawnWilds(): void {
    const g = this.ground;
    const byBiome: Record<Biome, Array<{ x: number; y: number }>> = { meadow: [], forest: [], shore: [], water: [] };
    for (let ty = 0; ty < g.rows; ty++) {
      for (let tx = 0; tx < g.cols; tx++) {
        if (!g.reachable(tx, ty)) continue;
        if (Math.hypot(tx + 0.5 - this.centerX, ty + 0.5 - this.centerY) < 2) continue;
        if (Math.hypot(tx + 0.5 - this.player.x, ty + 0.5 - this.player.y) < 10) continue;
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
    for (const [biome, table] of Object.entries(SPAWNS.biomes) as Array<[Biome, { count: number; levels: number[]; table: Array<{ dex: string; weight: number }> }]>) {
      const spots = this.rng.shuffle([...byBiome[biome]]);
      const n = Math.min(table.count, spots.length);
      for (let i = 0; i < n; i++) {
        const spot = spots[i] as { x: number; y: number };
        const row = this.rng.weighted(table.table, (r) => r.weight);
        const level = this.rng.int(table.levels[0] ?? 10, table.levels[1] ?? 12);
        const mon = this.makeMon(row.dex, level, null, spot.x, spot.y);
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

  /**
   * Player input: the lead casts move `slot` from where it stands, aimed by
   * its facing. The lead faces the nearest threat when one is close, else
   * the way the trainer faces.
   */
  playerCast(slot: number): 'cast' | 'cooldown' | 'no-lead' | 'asleep' | 'busy' {
    const p = this.player;
    const m = lead(p);
    if (!m) return 'no-lead';
    if (m.status === 'sleep') return 'asleep';
    if (m.casting) return 'busy';
    if ((m.cooldowns[slot] ?? 0) > 0) return 'cooldown';
    const threat = this.battle.pickTarget(m, this.mons(), 6);
    m.dir = threat ? dirFromVector(threat.x - m.x, threat.y - m.y, m.dir) : p.dir;
    m.anim.dir = m.dir;
    return this.battle.castAt(m, slot, this.mons()) ? 'cast' : 'cooldown';
  }

  /** Hostile Pokémon pick their own targets: nearest enemy within `aggro`, then cast on cooldown. */
  private stepHostile(m: Mon, dt: number, aggro: number): boolean {
    if (!BattleSystem.active(m) || m.casting || m.status === 'sleep') return false;
    if (m.target && (!BattleSystem.active(m.target) || Math.hypot(m.target.x - m.x, m.target.y - m.y) > aggro + 1.5)) m.target = null;
    if (!m.target) m.target = this.battle.pickTarget(m, this.mons(), aggro);
    const t = m.target;
    if (!t) return false;
    m.dir = dirFromVector(t.x - m.x, t.y - m.y, m.dir);
    m.busy -= dt;
    if (m.busy <= 0) {
      m.busy = this.rng.range(0.7, 1.6);
      const slot = this.battle.chooseMove(m, t);
      if (slot >= 0 && Math.hypot(t.x - m.x, t.y - m.y) < 4) this.battle.castAt(m, slot, this.mons(), 4);
    }
    return true;
  }

  /** Makes party member `index` the lead (fainted members cannot lead). */
  swapLead(index: number): boolean {
    const p = this.player;
    const m = p.party[index];
    if (!m || m.fainted || isRoaming(m) || m.captured) return false;
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
    this.ground.update(dt);
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
    const pw = this.partyWorld();
    for (const t of this.allTrainers) {
      if (!t.alive) continue;
      for (const m of t.party) {
        if (m.busy > 0) m.busy -= dt;
        m.sinceHit += dt;
      }
      stepParty(t, lead(t), dt, pw);
    }
    for (const w of this.wilds) {
      w.sinceHit += dt;
      this.stepWild(w, dt);
    }
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
    this.handleKnockouts();
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
    const minD = 1.0;
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
      for (const m of o.party) if (!m.fainted && !m.captured) push(m.x, m.y);
    }
    if (this.darkrai && !this.darkrai.fainted) push(this.darkrai.x, this.darkrai.y);
  }

  /** Walk-cycle phase for the overworld sheet. */
  afterTrainerMove(t: Trainer, moved: number): void {
    t.moving = moved > 1e-4;
    if (t.moving) t.walkPhase = (t.walkPhase + moved / 0.9) % 1;
  }

  /** The world a party sees when it steers and fights. */
  private partyWorld(): PartyWorld {
    return {
      ground: this.ground,
      rng: this.rng,
      mons: () => this.mons(),
      isEnemy: (a, b) => this.battle.isEnemy(a, b),
      active: (m) => BattleSystem.active(m),
      inHostileTelegraph: (m) => this.inHostileTelegraph(m),
      attack: (m, target, range) => this.autoAttack(m, target, range),
      centerX: this.centerX,
      centerY: this.centerY,
    };
  }

  private inHostileTelegraph(m: Mon): boolean {
    for (const o of this.mons()) {
      if (!o.casting || o === m || !this.battle.isEnemy(o, m)) continue;
      const def = move(o.casting.moveId);
      if (areaContains(makeArea(def, o, o.casting.targetX, o.casting.targetY), m.x, m.y)) return true;
    }
    return false;
  }

  /** A party member attacks on its own timer (the player's 1-4 casts bypass this). */
  private autoAttack(m: Mon, target: Mon, range: number): void {
    if (m.casting || m.status === 'sleep') return;
    if (Math.hypot(target.x - m.x, target.y - m.y) > range) return;
    if (m.busy > 0) return;
    const slot = this.battle.chooseMove(m, target);
    if (slot < 0) return;
    m.dir = dirFromVector(target.x - m.x, target.y - m.y, m.dir);
    if (this.battle.castAt(m, slot, this.mons(), range)) m.busy = this.rng.range(0.8, 1.6);
  }

  private stepWild(w: Mon, dt: number): void {
    if (w.fainted || w.captured || w.casting || w.status === 'sleep') return;
    // Anything hostile that wanders close gets attacked.
    if (this.stepHostile(w, dt, CONFIG.wild.aggroRange)) {
      if (w.moving) {
        w.moving = false;
        w.anim.play('Idle');
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

  /** XP for knockouts and item drops from wild Pokémon (read off this step's faint events). */
  private handleKnockouts(): void {
    for (const ev of this.battle.events) {
      if (ev.type === 'faint' && ev.mon.boss) {
        // Darkrai's defeat: a Cherish Ball with a Dark-type held item that also heals the finder's party.
        this.placeBall('cherish', [{ id: 'black-glasses', count: 1 }], ev.mon.x, ev.mon.y + 0.6, true);
        this.battle.events.push({ type: 'notice', text: 'Darkrai is down! It left a Cherish Ball behind', seconds: 3 });
      }
      if (ev.type !== 'faint' || !ev.by || ev.by.boss) continue;
      const owner = ev.by.owner;
      if (owner) {
        for (const r of shareKnockoutXp(ev.by, ev.mon, owner.party, CONFIG.party.xpShareRange)) {
          this.battle.events.push({ type: 'xp', mon: r.mon, xp: r.xp, levels: r.levels });
        }
      }
      if (ev.mon.wild && this.rng.chance(CONFIG.party.wildDropChance)) this.dropLoot(ev.mon.x, ev.mon.y);
    }
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
      if (d.finale && !this.darkrai) {
        this.spawnDarkrai();
        // The one Master Ball of the match appears at the crystal's foot.
        this.placeBall('master', [{ id: 'master-ball', count: 1 }], this.centerX + 1.5, this.centerY + 1.2);
        this.battle.events.push({ type: 'notice', text: 'A Master Ball glints beside the crystal', seconds: 3 });
      }
    }
    void wasPhase;
    for (let i = this.lightZones.length - 1; i >= 0; i--) {
      const z = this.lightZones[i] as (typeof this.lightZones)[number];
      z.t -= dt;
      if (z.t <= 0) this.lightZones.splice(i, 1);
    }
    if (!Number.isFinite(d.radius)) return;
    const c = CONFIG.darkness;
    for (const m of this.mons()) {
      if (m.boss) continue;
      const dark = this.isDark(m.x, m.y);
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
      if (mo.life <= 0 || !this.isDark(mo.x, mo.y)) this.motes.splice(i, 1);
    }
    if (this.motes.length < 90) {
      for (let k = 0; k < 3; k++) {
        const x = p.x + this.rng.range(-7, 7);
        const y = p.y + this.rng.range(-4, 4);
        if (this.isDark(x, y)) {
          this.motes.push({ x, y, vx: this.rng.range(-0.25, 0.25), vy: this.rng.range(-0.35, -0.05), life: this.rng.range(2, 5), size: this.rng.range(0.03, 0.09) });
        }
      }
    }
  }

  /** Inside the darkness and outside every shard clearing. */
  isDark(x: number, y: number): boolean {
    if (!inDarkness(this.darkness, x, y, this.centerX, this.centerY)) return false;
    return !this.lightZones.some((z) => Math.hypot(z.x - x, z.y - y) < z.r);
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
      if (slot >= 0) this.battle.castAt(d, slot, this.mons(), 10);
    }
  }

  eliminate(t: Trainer): void {
    t.alive = false;
    // The trainer's whole inventory drops as one Premier Ball.
    const bag = [...t.items, ...t.held].filter((e): e is InventorySlot => !!e).map((e) => ({ id: e.id, count: e.count }));
    if (bag.length) this.placeBall('premier', bag, t.x + 0.8, t.y + 0.4);
    t.items.fill(null);
    t.held.fill(null);
    this.battle.events.push({ type: 'eliminated', trainer: t });
  }
}

export function dirVec(d: Dir8): { x: number; y: number } {
  const v = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]][d] as [number, number];
  const n = Math.hypot(v[0], v[1]);
  return { x: v[0] / n, y: v[1] / n };
}
