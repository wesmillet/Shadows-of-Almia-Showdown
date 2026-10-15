/**
 * Match state and the fixed-step simulation: the player and their party,
 * wild Pokémon by biome, AI trainers, items, the Ranger outpost, the
 * darkness and the battle system. Pure: no canvas access.
 */
import { DIR_VECTORS, dirFromVector, type Dir8 } from '../core/math';
import type { Input } from '../core/input';
import { Rng } from '../core/rng';
import type { GroundRenderer, Biome } from '../ground/types';
import { AnimPlayer, type SpriteRegistry } from '../sprites/pokemonSprite';
import { decide, type AiWorld } from './ai';
import { BattleSystem } from './battle';
import { ballModifier, newThrow, rollCatch, stepThrow, targetVisual, type Throw } from './catching';
import { CONFIG, MOVES, SPAWNS, hitPad, move, movesAt, movesLearnedBetween, species, statsAtLevel } from './data';
import { inDarkness, newDarkness, stepDarkness, type DarknessState } from './darkness';
import type { GroundItem, InventorySlot, Mon, Trainer } from './entities';
import { activeParty, lead } from './entities';
import { ballOfTier, isGear, ITEMS, rollLoot, rollTier, type BallKind, type LootTier } from './items';
import { canStand, tryMove } from './movement';
import { Nav } from './nav';
import { areaContains, makeArea } from './battle';
import { SHOPS, challengerLevel, inArena, koMoney, stallStock, type Challenge, type MapNpc, type Shop } from './town';
import { applyEvolution, EVOLVE_SECONDS, EVOLVE_SWAP, formAtLevel, pickEvolution } from './evolution';
import { gainXp, isRoaming, shareKnockoutXp, stepParty, xpForKnockout, type PartyWorld } from './party';

const AI_NAMES: Array<[string, string]> = [
  ['Rook', 'trainer_a'],
  ['Marlo', 'trainer_b'],
  ['Wynne', 'trainer_c'],
  ['Brigg', 'trainer_d'],
  ['Tamsin', 'trainer_e'],
  ['Dale', 'trainer_f'],
  ['Juniper', 'trainer_g'],
];

export interface MatchDeps {
  ground: GroundRenderer;
  rng: Rng;
  sprites: SpriteRegistry;
}

export type MatchOutcome = null | 'win' | 'loss';

let nextId = 1;

/** One side of a one-on-one trainer battle. */
export interface DuelSide {
  trainer: Trainer;
  /** The Pokémon out on the field, or null between Pokémon. */
  mon: Mon | null;
  /** Where the trainer stands for the battle. */
  spotX: number;
  spotY: number;
  /** Match time the next Pokémon comes out (a rival's automatic pick). */
  nextAt: number;
  /** The player has to choose the next Pokémon. */
  awaitingPick: boolean;
  /** Which way the opponent is (unit vector). */
  fx: number;
  fy: number;
}

/**
 * A one-on-one trainer battle: both parties go back into their balls, each
 * trainer sends out one Pokémon, and they fight until one side has nobody left.
 */
export interface Duel {
  id: number;
  a: DuelSide;
  b: DuelSide;
  cx: number;
  cy: number;
  state: 'intro' | 'fight' | 'over';
  /** Seconds in the current state. */
  t: number;
  winner: Trainer | null;
}

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
  /** Market stall vendors (maps with towns). */
  shops: Shop[] = [];
  /** The castle challenger and his battlefield (maps with one). */
  challenge: Challenge | null = null;
  /** Patrolling Rangers: decorative trainers with routes and no party. */
  npcs: Trainer[] = [];
  routes = new Map<number, { points: Array<{ x: number; y: number }>; index: number; wait: number }>();
  throws: Throw[] = [];
  /** Moves the player's Pokémon want to learn with four moves already known (answered with 1-4 or Esc). */
  pendingLearn: Array<{ mon: Mon; moveId: string }> = [];
  /** One-on-one trainer battles in progress (and just finished ones for endSeconds). */
  duels: Duel[] = [];
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
  /** Routes around cliffs, water and buildings (ladders and bridges are the only crossings). */
  readonly nav: Nav;

  constructor(deps: MatchDeps, starterDexes: string[], opts: { level?: number; partyCap?: number } = {}) {
    this.partyCap = Math.max(CONFIG.player.partyCap, opts.partyCap ?? 0);
    this.ground = deps.ground;
    this.nav = new Nav(this.ground);
    this.rng = deps.rng;
    this.sprites = deps.sprites;
    this.battle = new BattleSystem(this.rng);
    this.centerX = this.ground.cols / 2;
    this.centerY = this.ground.rows / 2;
    // Everyone starts somewhere new each match, spread round the coast.
    this.startSpots = this.pickStartSpots(1 + CONFIG.trainers.count);
    const spawn = this.startSpots[0] as { x: number; y: number };
    this.player = this.makeTrainer('You', 'player', true, spawn.x, spawn.y);
    for (const dex of starterDexes) this.player.party.push(this.makeMon(dex, opts.level ?? CONFIG.player.level, this.player, spawn.x, spawn.y));
    this.placeParty(this.player);
    this.spawnWilds();
    this.spawnTrainers();
    this.placeOutposts();
    this.scatterItems();
  }

  private spawnTrainers(): void {
    for (let i = 0; i < CONFIG.trainers.count; i++) {
      const [name, role] = AI_NAMES[i % AI_NAMES.length] as [string, string];
      const spot = this.startSpots[i + 1] ?? this.edgeSpawn(this.startSpots);
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

  /** Healers, vendors and the challenger the map file places (maps without them get patrolled outposts). */
  private placeServices(npcs: MapNpc[]): void {
    let v = 0;
    for (const n of npcs) {
      if (n.role === 'healer') {
        this.outposts.push({ x: n.x, y: n.y, users: [], beacon: 0 });
        this.npcs.push(this.makeTrainer('Healer', 'healer', false, n.x, n.y - 0.6));
      } else if (n.role === 'vendor') {
        const npc = this.makeTrainer('Vendor', ['vendor_a', 'vendor_b', 'vendor_c'][v++ % 3] as string, false, n.x, n.y);
        npc.dir = 0;
        if (n.standX !== undefined && n.standY !== undefined) {
          npc.counter = this.ground.decor.find((d) => Math.abs(d.x - (n.standX as number)) < 0.1 && Math.abs(d.y - (n.standY as number)) < 0.1) ?? null;
        }
        this.npcs.push(npc);
        const st = stallStock(n.town, n.stand ?? 0);
        this.shops.push({ npc, town: n.town, name: `${n.town} ${st.name}`, stock: st.stock });
      } else if (n.role === 'challenger' && this.ground.features?.arena) {
        const npc = this.makeTrainer(SHOPS.challenger.name, 'challenger', false, n.x, n.y);
        this.npcs.push(npc);
        this.challenge = { npc, arena: this.ground.features.arena, state: 'idle', foe: null, readyAt: 0 };
      }
    }
  }

  /** The vendor, challenger or healer within reach of the player, nearest first. */
  nearService(reach = 1.8): { kind: 'shop'; shop: Shop } | { kind: 'challenge' } | { kind: 'healer' } | null {
    const p = this.player;
    let best: { d: number; s: { kind: 'shop'; shop: Shop } | { kind: 'challenge' } | { kind: 'healer' } } | null = null;
    const consider = (x: number, y: number, s: { kind: 'shop'; shop: Shop } | { kind: 'challenge' } | { kind: 'healer' }, extra = 0) => {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d <= reach + extra && (!best || d < best.d)) best = { d, s };
    };
    // Vendors stand behind their counters, so the stall answers from a little further away.
    for (const sh of this.shops) consider(sh.npc.x, sh.npc.y, { kind: 'shop', shop: sh }, sh.npc.counter ? 0.8 : 0);
    if (this.challenge?.state === 'idle') consider(this.challenge.npc.x, this.challenge.npc.y, { kind: 'challenge' });
    for (const o of this.outposts) consider(o.x, o.y, { kind: 'healer' });
    return best ? (best as { s: { kind: 'shop'; shop: Shop } | { kind: 'challenge' } | { kind: 'healer' } }).s : null;
  }

  /** Buys entry `i` of a shop for the player. Returns what happened. */
  buy(shop: Shop, i: number): string {
    const e = shop.stock[i];
    if (!e) return '';
    const p = this.player;
    const name = ITEMS[e.id]?.name ?? e.id;
    if (p.money < e.price) return `Not enough money for ${name} (₽${e.price})`;
    if (!this.giveItem(p, e.id, 1)) return 'Your bag is full';
    p.money -= e.price;
    return `Bought ${name} for ₽${e.price}`;
  }

  /** The challenger sends out a team a few levels above the player's best (once per match). */
  startChallenge(): string {
    const c = this.challenge;
    if (!c || c.state !== 'idle') return '';
    if (this.time < c.readyAt) return `${SHOPS.challenger.name}: "Rest up first. Come back in ${Math.ceil(c.readyAt - this.time)}s."`;
    const lvl = challengerLevel(this.player);
    const foe = this.makeTrainer(SHOPS.challenger.name, 'challenger', false, c.npc.x, c.npc.y);
    foe.challenger = true;
    for (const dex of SHOPS.challenger.party) {
      const m = this.makeMon(dex, lvl, foe, foe.x, foe.y + 1);
      m.behavior = 'aggressive';
      foe.party.push(m);
    }
    this.placeParty(foe);
    this.trainers.push(foe);
    this.npcs = this.npcs.filter((n) => n !== c.npc);
    c.foe = foe;
    c.state = 'battle';
    // A one-on-one bout across the battlefield: the champion at the north end, the player at the south end.
    const midX = (c.arena.x0 + c.arena.x1) / 2;
    this.startDuel(this.player, foe, { x: midX, y: c.arena.y1 - 1 }, { x: midX, y: c.arena.y0 + 1 });
    return `${SHOPS.challenger.name}: "Show me what you've got!" (Lv ${lvl})`;
  }

  /** The challenger holds his ground at the battlefield's north end, facing the action. */
  private stepChallenger(t: Trainer): void {
    const c = this.challenge;
    if (!c) return;
    t.x = t.px = (c.arena.x0 + c.arena.x1) / 2;
    t.y = t.py = c.arena.y0 + 1;
    t.moving = false;
    t.dir = dirFromVector(this.player.x - t.x, this.player.y - t.y, t.dir);
  }

  /** The outposts the island generator laid trails to, each with a member of staff on patrol. */
  private placeOutposts(): void {
    const npcs = this.ground.features?.npcs;
    if (npcs?.length) {
      this.placeServices(npcs);
      return;
    }
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
    // And a pair of Quick Balls, best thrown before the first pulse.
    const quick = spots.find((p) => !near.includes(p) && Math.hypot(p.x - this.player.x, p.y - this.player.y) < 12);
    if (quick) this.items.push({ id: nextId++, ball: 'quick', tier: null, contents: [{ id: 'quick-ball', count: 2 }], x: quick.x, y: quick.y, bob: id++ });
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
    if (m.moves.includes(def.move)) return `${m.name} already knows ${move(def.move).name}`;
    if (m.moves.length < 4) {
      m.moves.push(def.move);
      m.cooldowns.push(0);
      this.takeItem(t, slot, 'held');
      return `${m.name} learned ${move(def.move).name}!`;
    }
    if (replace < 0 || replace > 3) return '';
    const old = m.moves[replace];
    m.moves[replace] = def.move;
    m.cooldowns[replace] = 0;
    this.takeItem(t, slot, 'held');
    return `${m.name} forgot ${old ? move(old).name : '?'} and learned ${move(def.move).name}!`;
  }

  /**
   * New moves on levelling up. A free slot takes the move at once; with four moves the player
   * is asked which to forget, and everyone else drops their weakest move for a stronger one.
   */
  learnOnLevelUp(m: Mon, fromLevel: number): void {
    for (const id of movesLearnedBetween(m.species, fromLevel, m.level)) {
      if (m.moves.includes(id) || !MOVES.has(id)) continue;
      if (m.moves.length < 4) {
        m.moves.push(id);
        m.cooldowns.push(0);
        this.battle.events.push({ type: 'learned', mon: m, moveId: id, forgot: null });
      } else if (m.owner?.isPlayer) {
        if (!this.pendingLearn.some((p) => p.mon === m && p.moveId === id)) this.pendingLearn.push({ mon: m, moveId: id });
      } else {
        let weakest = 0;
        m.moves.forEach((mid, i) => {
          if (move(mid).power < move(m.moves[weakest] as string).power) weakest = i;
        });
        if (move(id).power > move(m.moves[weakest] as string).power) {
          m.moves[weakest] = id;
          m.cooldowns[weakest] = 0;
        }
      }
    }
  }

  /** Answers the first pending move: replace slot `slot` (0-3), or -1 to keep the current moves. */
  answerLearn(slot: number): string {
    const p = this.pendingLearn.shift();
    if (!p) return '';
    const name = move(p.moveId).name;
    if (slot < 0 || slot >= p.mon.moves.length) return `${p.mon.name} did not learn ${name}`;
    const old = move(p.mon.moves[slot] as string).name;
    p.mon.moves[slot] = p.moveId;
    p.mon.cooldowns[slot] = 0;
    this.battle.events.push({ type: 'learned', mon: p.mon, moveId: p.moveId, forgot: old });
    return `${p.mon.name} forgot ${old} and learned ${name}!`;
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
        return 'Hold F to aim, release to throw';
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
          // The lead that wore it down learns from the catch too.
          const leadMon = lead(th.thrower);
          const share = (CONFIG.party as typeof CONFIG.party & { catchXpShare?: number }).catchXpShare ?? 0;
          if (leadMon && leadMon !== w && share > 0) {
            const xp = Math.round(xpForKnockout(w, leadMon.level) * share);
            const levels = gainXp(leadMon, xp);
            this.battle.events.push({ type: 'xp', mon: leadMon, xp, levels });
            if (levels > 0) this.learnOnLevelUp(leadMon, leadMon.level - levels);
          }
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

  /** The ground ball nearest the player within reach, if any. */
  nearestItem(reach = CONFIG.items.playerReach): GroundItem | null {
    let best: GroundItem | null = null;
    let bd = reach;
    for (const it of this.items) {
      const d = Math.hypot(it.x - this.player.x, it.y - this.player.y);
      if (d <= bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  /** Space: the player picks up the nearest ball in reach. Returns false when there is none. */
  pickUp(): boolean {
    const it = this.nearestItem();
    if (!it) return false;
    if (!this.openBall(this.player, this.items.indexOf(it))) this.battle.events.push({ type: 'notice', text: 'Bag is full', seconds: 1 });
    return true;
  }

  /** Opens ground ball `i` for a trainer: whatever fits goes in the bag, the rest stays in the ball. */
  private openBall(t: Trainer, i: number): boolean {
    const it = this.items[i] as GroundItem | undefined;
    if (!it) return false;
    if (!it.contents) it.contents = [rollLoot(this.rng, it.tier ?? 'common')];
    const got: InventorySlot[] = [];
    it.contents = it.contents.filter((c) => {
      if (!this.giveItem(t, c.id, c.count)) return true;
      got.push(c);
      return false;
    });
    if (!got.length) return false;
    const healed = !!it.heal;
    if (healed) for (const m of t.party) if (!m.fainted) {
      m.hp = m.maxHp;
      this.battle.cureStatus(m);
    }
    it.heal = false;
    if (it.contents.length === 0) this.items.splice(i, 1);
    this.battle.events.push({ type: 'pickup', trainer: t, items: got, ball: it.ball, healed });
    return true;
  }

  /** Space beside a healer: the whole party is restored (once every 20 s). */
  healAtHealer(): string {
    const t = this.player;
    if (this.time < t.outpostReady) return `The healer needs a moment (${Math.ceil(t.outpostReady - this.time)}s)`;
    const needs = t.party.some((m) => !isRoaming(m) && (m.fainted || m.hp < m.maxHp || m.status));
    if (!needs) return 'Your party is already in top shape';
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
    return 'Your Pokémon are fully healed!';
  }

  private stepItems(dt: number): void {
    for (const it of this.items) it.bob += dt;
    for (const t of this.allTrainers) {
      if (!t.alive) continue;
      // Rivals scoop balls up as they pass; the player picks them up with Space (pickUp).
      if (!t.isPlayer) {
        for (let i = this.items.length - 1; i >= 0; i--) {
          const it = this.items[i] as GroundItem;
          if (Math.hypot(it.x - t.x, it.y - t.y) > CONFIG.items.pickupRadius) continue;
          this.openBall(t, i);
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
        if (t.isPlayer && this.ground.features?.npcs?.length) continue;
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
      wilds: this.wilds,
      comfortRadius: (level: number) => this.comfortRadius(level),
    };
  }

  /**
   * How close to the crystal a team of `level` can wander before the wild
   * Pokémon outclass it (wilds up to about three levels above it).
   */
  comfortRadius(level: number): number {
    const w = CONFIG.wild as typeof CONFIG.wild & { centerLevelCurve?: number };
    const allowed = level + 3 - 5;
    if (allowed >= w.centerLevelBonus) return 0;
    if (allowed <= 0) return w.centerLevelRadius;
    return w.centerLevelRadius * (1 - (allowed / w.centerLevelBonus) ** (1 / (w.centerLevelCurve ?? 1.2)));
  }

  private stepAi(t: Trainer, dt: number): void {
    const world = this.aiWorld();
    world.rivals = this.allTrainers.filter((o) => o !== t && o.alive && !o.challenger);
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
        if (!this.nav.clearLine(t.x, t.y, target.x, target.y)) {
          const step = this.nav.dir(t.x, t.y, target.x, target.y);
          if (step) {
            dx = step.x;
            dy = step.y;
          }
        }
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
  /** Where the player (first) and the rival trainers start this match. */
  startSpots: Array<{ x: number; y: number }> = [];

  /**
   * Random starting points near the coast: open, reachable ground a few tiles
   * from the sea and far from the crystal, clear of towns and the arena. The
   * player's is any of them; each rival takes the one farthest from those
   * already taken (from a random handful), so nobody starts on top of anyone.
   */
  pickStartSpots(n: number): Array<{ x: number; y: number }> {
    const g = this.ground;
    const W = g.cols;
    const H = g.rows;
    // Distance (in steps) from every tile to the nearest sea or map edge.
    const sea = new Int32Array(W * H).fill(-1);
    let q: number[] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (g.biomeAt(x, y) === 'water' || x === 0 || y === 0 || x === W - 1 || y === H - 1) {
          sea[y * W + x] = 0;
          q.push(y * W + x);
        }
      }
    }
    while (q.length) {
      const next: number[] = [];
      for (const i of q) {
        const x = i % W;
        const y = (i - x) / W;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (sea[j] !== -1) continue;
          sea[j] = (sea[i] ?? 0) + 1;
          next.push(j);
        }
      }
      q = next;
    }
    const services = this.mapServices();
    const maxD = Math.hypot(W, H) / 2;
    const pool: Array<{ x: number; y: number }> = [];
    for (let ty = 4; ty < H - 4; ty += 2) {
      for (let tx = 4; tx < W - 4; tx += 2) {
        const d = sea[ty * W + tx] ?? 0;
        if (d < 3 || d > 9 || !g.reachable(tx, ty)) continue;
        const x = tx + 0.5;
        const y = ty + 0.5;
        if (Math.hypot(x - this.centerX, y - this.centerY) < maxD * 0.45) continue;
        let open = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (g.reachable(tx + dx, ty + dy)) open++;
        if (open < 22) continue;
        if (services.some((s) => Math.hypot(s.x - x, s.y - y) < 14)) continue;
        if (g.features?.arena && inArena(g.features.arena, x, y, 6)) continue;
        pool.push({ x, y });
      }
    }
    if (!pool.length) {
      const out: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < n; i++) out.push(this.edgeSpawn(out));
      return out;
    }
    const out: Array<{ x: number; y: number }> = [this.rng.pick(pool)];
    while (out.length < n) {
      let best = pool[0] as { x: number; y: number };
      let bd = -1;
      for (let k = 0; k < 40; k++) {
        const c = this.rng.pick(pool);
        const d = Math.min(...out.map((o) => Math.hypot(o.x - c.x, o.y - c.y)));
        if (d > bd) {
          bd = d;
          best = c;
        }
      }
      out.push(best);
    }
    return out;
  }

  /** Towns' healers, vendors and challenger from the map file, for keeping starts away from them. */
  private mapServices(): Array<{ x: number; y: number }> {
    const npcs = this.ground.features?.npcs ?? [];
    return npcs.map((n) => ({ x: n.x, y: n.y }));
  }

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
      ai: 'roam', aiTimer: 0, aiTarget: null, healing: 0, outpostReady: 0, attackTimer: 1, roamTimer: 0, money: SHOPS.startMoney,
    };
  }

  makeMon(dex: string, level: number, owner: Trainer | null, x: number, y: number): Mon {
    const sp = species(dex);
    const stats = statsAtLevel(sp.stats, level);
    const sprites = this.sprites.get(dex);
    const moves = movesAt(sp, level);
    return {
      id: nextId++, dex, species: sp, name: sp.name, level, hp: stats.hp, maxHp: stats.hp, stats,
      stages: { atk: 0, def: 0, spe: 0 }, types: [...sp.types], moves, cooldowns: moves.map(() => 0),
      x, y, px: x, py: y, dir: 0, anim: new AnimPlayer(sprites), sprites, owner, wild: owner === null, boss: false,
      fainted: false, status: null, statusTimer: 0, flash: 0, homeX: x, homeY: y, targetX: x, targetY: y,
      idleTimer: this.rng.range(0.5, 3), moving: false, inDark: false, drowsy: 0, outsideDark: 0, aura: false,
      heldItem: null, busy: 0, casting: null, target: null, captured: false,
      behavior: owner ? (owner.party.length === 0 ? 'aggressive' : 'guard') : 'guard', xp: 0, wander: null, wanderPause: 0,
      roamTarget: null, recall: false, sinceHit: 999, visual: { scale: 1, alpha: 1, flash: 0 }, evolving: null,
    };
  }

  private spawnWilds(): void {
    const g = this.ground;
    const byBiome: Record<Biome, Array<{ x: number; y: number }>> = { meadow: [], forest: [], shore: [], water: [], snow: [], desert: [], autumn: [], castle: [] };
    const clear = CONFIG.wild.spawnClearance;
    for (let ty = 0; ty < g.rows; ty++) {
      for (let tx = 0; tx < g.cols; tx++) {
        if (!g.reachable(tx, ty)) continue;
        if (Math.hypot(tx + 0.5 - this.centerX, ty + 0.5 - this.centerY) < 2) continue;
        // none right beside a trainer's starting point (the planned starts, or the player)
        if (Math.hypot(tx + 0.5 - this.player.x, ty + 0.5 - this.player.y) < clear) continue;
        if (this.startSpots.some((s) => Math.hypot(tx + 0.5 - s.x, ty + 0.5 - s.y) < clear)) continue;
        if (this.ground.features?.arena && inArena(this.ground.features.arena, tx + 0.5, ty + 0.5, 3)) continue;
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
    type Row = { dex: string; weight: number; levels?: number[] };
    type Table = { count: number; levels?: number[]; table?: Row[]; use?: string };
    const tables = SPAWNS.biomes as unknown as Record<Biome, Table>;
    const nearest = (tables.meadow?.use || tables.shore?.use) ? this.nearestLand(tables) : null;
    for (const [biome, table] of Object.entries(tables) as Array<[Biome, Table]>) {
      const spots = this.rng.shuffle([...byBiome[biome]]);
      const n = Math.min(table.count, spots.length);
      for (let i = 0; i < n; i++) {
        const spot = spots[i] as { x: number; y: number };
        // Meadows and beaches borrow the table of the land they border.
        const land = table.use && nearest ? nearest[Math.floor(spot.y) * g.cols + Math.floor(spot.x)] : biome;
        const t = land ? tables[land as Biome] : undefined;
        if (!t?.table?.length) continue;
        const row = this.rng.weighted(t.table, (r) => r.weight);
        const lv = row.levels ?? t.levels ?? [3, 6];
        // Stronger the closer to the Shadow Crystal: up to centerLevelBonus extra levels at the centre,
        // easing to none at the coast, so the outer lands stay gentle for fresh teams.
        // Round every starting point the land stays at its base levels, so a fresh team can train there.
        const nearStart = Math.min(...this.startSpots.map((s) => Math.hypot(s.x - spot.x, s.y - spot.y)));
        const calm = Math.min(1, Math.max(0, (nearStart - 20) / 25));
        let level = this.rng.int(lv[0] ?? 3, lv[1] ?? 6) + Math.round(this.centerBonus(spot.x, spot.y) * calm);
        // Now and then an elite: a few levels higher (often evolved), worth more XP. None right by the starts.
        const w = CONFIG.wild as typeof CONFIG.wild & { eliteChance?: number; eliteLevels?: number[] };
        const elite = nearStart > 22 && this.rng.chance(w.eliteChance ?? 0);
        if (elite) level += this.rng.int(w.eliteLevels?.[0] ?? 5, w.eliteLevels?.[1] ?? 9);
        // Past an evolution level a wild Pokémon is met already evolved (Luxio, Gyarados...).
        const mon = this.makeMon(formAtLevel(row.dex, level, this.rng, true), level, null, spot.x, spot.y);
        if (elite) mon.elite = true;
        mon.dir = this.rng.int(0, 7) as Dir8;
        this.wilds.push(mon);
      }
    }
    this.spawnBosses(byBiome);
  }

  /** Extra wild levels at a spot: centerLevelBonus at the Shadow Crystal, none past centerLevelRadius. */
  centerBonus(x: number, y: number): number {
    const w = CONFIG.wild as typeof CONFIG.wild & { centerLevelCurve?: number };
    const far = Math.min(1, Math.hypot(x - this.centerX, y - this.centerY) / w.centerLevelRadius);
    return Math.round(w.centerLevelBonus * (1 - far) ** (w.centerLevelCurve ?? 1.2));
  }

  /** For every tile, the nearest of the lands that have their own table (one breadth-first sweep). */
  private nearestLand(tables: Record<Biome, { table?: unknown[]; use?: string }>): Array<Biome | null> {
    const g = this.ground;
    const own = (b: Biome) => !tables[b]?.use && (tables[b]?.table?.length ?? 0) > 0;
    const out: Array<Biome | null> = new Array(g.cols * g.rows).fill(null);
    let queue: number[] = [];
    for (let ty = 0; ty < g.rows; ty++) {
      for (let tx = 0; tx < g.cols; tx++) {
        const b = g.biomeAt(tx, ty);
        if (own(b)) {
          out[ty * g.cols + tx] = b;
          queue.push(ty * g.cols + tx);
        }
      }
    }
    while (queue.length) {
      const next: number[] = [];
      for (const i of queue) {
        const x = i % g.cols;
        const y = (i - x) / g.cols;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) continue;
          const j = ny * g.cols + nx;
          if (out[j] !== null) continue;
          out[j] = out[i] ?? null;
          next.push(j);
        }
      }
      queue = next;
    }
    return out;
  }

  /** One boss per land, at the reachable spot nearest the middle of that land. */
  private spawnBosses(byBiome: Record<Biome, Array<{ x: number; y: number }>>): void {
    const bosses = (SPAWNS as unknown as { bosses?: Array<{ biome: Biome; dex: string; level: number }> }).bosses ?? [];
    for (const b of bosses) {
      const spots = byBiome[b.biome];
      if (!spots?.length) continue;
      let cx = 0;
      let cy = 0;
      for (const p of spots) {
        cx += p.x;
        cy += p.y;
      }
      cx /= spots.length;
      cy /= spots.length;
      let best = spots[0] as { x: number; y: number };
      let bd = Infinity;
      for (const p of spots) {
        const d = Math.hypot(p.x - cx, p.y - cy);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      const mon = this.makeMon(b.dex, b.level, null, best.x, best.y);
      mon.landBoss = true;
      mon.dir = 0 as Dir8;
      this.wilds.push(mon);
    }
  }

  get allTrainers(): Trainer[] {
    return [this.player, ...this.trainers];
  }

  /** Every active Pokémon on the field. */
  *mons(): Generator<Mon> {
    for (const t of this.allTrainers) if (t.alive) for (const m of t.party) if (!m.fainted && !m.stowed) yield m;
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

  /** Where the player is aiming (the cursor on the field, in tiles), or null to fire the way the trainer faces. */
  aim: { x: number; y: number } | null = null;

  /**
   * Player input: the lead casts move `slot` toward the aim point. Nothing
   * locks on; a single-target move lands where it was aimed, so a moving
   * Pokémon can step out of it.
   */
  playerCast(slot: number): 'cast' | 'cooldown' | 'no-lead' | 'asleep' | 'busy' {
    const p = this.player;
    const m = lead(p);
    if (!m) return 'no-lead';
    if (m.status === 'sleep') return 'asleep';
    if (m.casting) return 'busy';
    if ((m.cooldowns[slot] ?? 0) > 0) return 'cooldown';
    const f = DIR_VECTORS[p.dir] as { x: number; y: number };
    const a = this.aim ?? { x: m.x + f.x * 3, y: m.y + f.y * 3 };
    m.dir = dirFromVector(a.x - m.x, a.y - m.y, m.dir);
    m.anim.dir = m.dir;
    return this.battle.castToward(m, slot, a.x, a.y) ? 'cast' : 'cooldown';
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
    if (p.duelId) return false;
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
    this.nav.tick(dt);
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
    for (const t of this.trainers) if (t.alive && !t.duelId) (t.challenger ? this.stepChallenger(t) : this.stepAi(t, dt));
    this.stepNpcs(dt);
    const pw = this.partyWorld();
    for (const t of this.allTrainers) {
      if (!t.alive) continue;
      for (const m of t.party) {
        if (m.busy > 0) m.busy -= dt;
        m.sinceHit += dt;
      }
      if (!t.duelId) {
        this.fieldParty(t);
        // Freshly sent out: grow from the ball's flash to full size.
        for (const m of t.party) if (!m.stowed && !m.captured && !m.fainted && m.visual.scale < 1) m.visual.scale = Math.min(1, m.visual.scale + dt * 3.5);
        stepParty(t, lead(t), dt, pw);
      }
    }
    this.stepDuels(dt);
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
      // Pokémon on a ladder face the cliff while they climb.
      m.anim.dir = this.ground.onLadder?.(Math.floor(m.x), Math.floor(m.y)) ? 4 : m.dir;
      m.anim.update(dt);
    }
    for (const gone of this.battle.stepFainting(dt)) {
      const i = this.wilds.indexOf(gone);
      if (i >= 0) this.wilds.splice(i, 1);
    }
    this.handleKnockouts();
    this.stepEvolutions(dt);
    this.checkElimination();
  }

  /** Party Pokémon past an evolution level start evolving; evolutions in progress tick on. */
  private stepEvolutions(dt: number): void {
    for (const t of this.allTrainers) {
      if (!t.alive) continue;
      for (const m of t.party) {
        const e = m.evolving;
        if (!e) {
          if (m.fainted || m.captured || m.stowed || m.visual.scale < 1) continue;
          const to = pickEvolution(m.species, m.level, this.rng);
          if (!to) continue;
          m.evolving = { to, t: 0, swapped: false };
          this.battle.events.push({ type: 'evolve-start', mon: m });
          continue;
        }
        e.t += dt;
        if (!e.swapped && e.t >= EVOLVE_SWAP) {
          e.swapped = true;
          const from = m.name;
          applyEvolution(m, species(e.to), this.sprites.get(e.to));
          this.battle.events.push({ type: 'evolved', mon: m, from });
        }
        if (e.t >= EVOLVE_SECONDS) m.evolving = null;
      }
    }
  }

  private stepPlayer(dt: number): void {
    const p = this.player;
    const climbing = this.ground.onLadder?.(Math.floor(p.x), Math.floor(p.y)) ?? false;
    const speed = CONFIG.player.speedTilesPerSec * (climbing ? 0.6 : 1);
    let moved = 0;
    // In a one-on-one battle the trainer stands back; the movement keys steer the Pokémon instead.
    if (p.duelId) {
      p.stats.timeSurvived = this.time;
      return;
    }
    if (this.moveX !== 0 || this.moveY !== 0) {
      // Walking up or down at a ladder lines the player up with it, so the one-tile gap is easy to take.
      if (this.ground.onLadder && Math.abs(this.moveY) >= Math.abs(this.moveX)) {
        const ahead = Math.floor(p.y + Math.sign(this.moveY) * 0.8);
        for (const dx of [0, -1, 1]) {
          const tx = Math.floor(p.x) + dx;
          if (this.ground.onLadder(tx, ahead) || this.ground.onLadder(tx, Math.floor(p.y))) {
            const off = tx + 0.5 - p.x;
            if (Math.abs(off) > 0.02) tryMove(this.ground, p, Math.sign(off) * Math.min(Math.abs(off), speed * dt), 0, CONFIG.player.radius);
            break;
          }
        }
      }
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
      for (const m of o.party) if (!m.fainted && !m.captured && !m.stowed) push(m.x, m.y);
    }
    if (this.darkrai && !this.darkrai.fainted) push(this.darkrai.x, this.darkrai.y);
  }

  /** Walk-cycle phase for the overworld sheet. */
  afterTrainerMove(t: Trainer, moved: number): void {
    t.moving = moved > 1e-4;
    // One walk cycle per 2.2 tiles: the side run has two strides in it, so feet land about five times a second at full speed.
    if (t.moving) t.walkPhase = (t.walkPhase + moved / 2.2) % 1;
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
      nav: this.nav,
      centerX: this.centerX,
      centerY: this.centerY,
    };
  }

  private inHostileTelegraph(m: Mon): boolean {
    for (const o of this.mons()) {
      if (!o.casting || o === m || !this.battle.isEnemy(o, m)) continue;
      const def = move(o.casting.moveId);
      if (areaContains(makeArea(def, o, o.casting.targetX, o.casting.targetY), m.x, m.y, hitPad(m.species))) return true;
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
    if (this.stepHostile(w, dt, w.landBoss ? CONFIG.wild.bossAggroRange : CONFIG.wild.aggroRange)) {
      if (w.moving) {
        w.moving = false;
        w.anim.play('Idle');
      }
      return;
    }
    if (!w.moving) {
      w.idleTimer -= dt;
      if (w.idleTimer <= 0) {
        const r = w.landBoss ? CONFIG.wild.bossWanderRadius : CONFIG.wild.wanderRadius;
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
        const cash = koMoney(ev.mon);
        owner.money += cash;
        this.battle.events.push({ type: 'money', trainer: owner, amount: cash, x: ev.mon.x, y: ev.mon.y });
        for (const r of shareKnockoutXp(ev.by, ev.mon, owner.party, CONFIG.party.xpShareRange)) {
          this.battle.events.push({ type: 'xp', mon: r.mon, xp: r.xp, levels: r.levels });
          if (r.levels > 0) this.learnOnLevelUp(r.mon, r.mon.level - r.levels);
        }
      }
      if (ev.mon.wild && this.rng.chance(CONFIG.party.wildDropChance)) this.dropLoot(ev.mon.x, ev.mon.y);
    }
  }

  /** A lost bout with the challenger: he withdraws, the player's team is patched up at the castle. */
  private loseChallenge(c: Challenge): void {
    const foe = c.foe;
    if (foe) {
      foe.alive = false;
      for (const m of foe.party) m.captured = true;
      this.trainers = this.trainers.filter((t) => t !== foe);
    }
    c.foe = null;
    c.state = 'idle';
    c.readyAt = this.time + SHOPS.challenger.retrySeconds;
    this.npcs.push(c.npc);
    const p = this.player;
    for (const m of p.party) {
      if (m.captured) continue;
      m.fainted = false;
      m.hp = Math.max(1, Math.round(m.maxHp * 0.25));
      m.status = null;
      m.anim.play('Idle', { restart: true });
      m.x = m.px = p.x;
      m.y = m.py = p.y + 0.6;
    }
    this.battle.events.push({ type: 'notice', text: `${SHOPS.challenger.name} wins this bout. Your Pokémon were patched up.`, seconds: 3.5 });
  }

  private checkElimination(): void {
    const ch = this.challenge;
    const pl = this.player;
    if (ch?.state === 'battle' && pl.alive && pl.party.length > 0 && !pl.party.some((m) => !m.fainted && !m.captured)) this.loseChallenge(ch);
    for (const t of this.allTrainers) {
      // Out only when nothing is left standing; members out roaming still count.
      if (t.alive && t.party.length > 0 && !t.party.some((m) => !m.fainted && !m.captured)) this.eliminate(t);
    }
    const c = this.challenge;
    if (c?.state === 'battle' && c.foe && !c.foe.alive) {
      c.state = 'won';
      const r = SHOPS.challenger.reward;
      this.player.money += r.money;
      const spill: InventorySlot[] = [];
      for (const [id, n] of r.items) if (!this.giveItem(this.player, id, n)) spill.push({ id, count: n });
      if (spill.length) this.placeBall('cherish', spill, c.foe.x, c.foe.y + 1);
      this.battle.events.push({ type: 'notice', text: `You beat the ${SHOPS.challenger.name}! +₽${r.money} and his prizes`, seconds: 3.5 });
    }
    const rivals = this.trainers.filter((t) => !t.challenger);
    if (!this.player.alive) this.outcome = 'loss';
    else if (rivals.length > 0 && rivals.every((t) => !t.alive)) this.outcome = 'win';
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
    // Darkrai stays a threat however far the survivors have levelled: five above the strongest.
    let top = 0;
    for (const t of this.allTrainers) if (t.alive) for (const m of t.party) if (!m.fainted) top = Math.max(top, m.level);
    const d = this.makeMon('0491', Math.min(100, Math.max(CONFIG.battle.bossLevel, top + 5)), null, this.centerX, this.centerY - 0.6);
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

  /** The battle the player is in (or just finished), if any. */
  get playerDuel(): Duel | null {
    return this.duels.find((d) => d.a.trainer === this.player || d.b.trainer === this.player) ?? null;
  }

  /** Has a Pokémon able to come out. */
  private canBattle(t: Trainer): boolean {
    return t.party.some((m) => !m.fainted && !m.captured);
  }

  /** Two trainers who see each other within startRange start a one-on-one battle. */
  private findDuels(): void {
    const c = CONFIG.duel;
    const free = this.allTrainers.filter((t) => t.alive && !t.duelId && !t.challenger && this.time >= (t.duelReadyAt ?? 0) && this.canBattle(t));
    for (let i = 0; i < free.length; i++) {
      const a = free[i] as Trainer;
      if (a.duelId) continue;
      for (let j = i + 1; j < free.length; j++) {
        const b = free[j] as Trainer;
        if (b.duelId || a.duelId) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) > c.startRange) continue;
        if (!this.nav.clearLine(a.x, a.y, b.x, b.y)) continue;
        this.startDuel(a, b);
      }
    }
  }

  /** Both parties go back into their balls; the trainers step apart and each sends out one Pokémon. */
  startDuel(a: Trainer, b: Trainer, spotA?: { x: number; y: number }, spotB?: { x: number; y: number }): Duel {
    const c = CONFIG.duel;
    const id = nextId++;
    let cx = (a.x + b.x) / 2;
    let cy = (a.y + b.y) / 2;
    if (spotA && spotB) {
      cx = (spotA.x + spotB.x) / 2;
      cy = (spotA.y + spotB.y) / 2;
    }
    let ux = (spotB ?? b).x - (spotA ?? a).x;
    let uy = (spotB ?? b).y - (spotA ?? a).y;
    const n = Math.hypot(ux, uy) || 1;
    ux /= n;
    uy /= n;
    const spot = (t: Trainer, sign: number, given?: { x: number; y: number }) => {
      if (given) return given;
      const x = cx + sign * ux * (c.standGap / 2);
      const y = cy + sign * uy * (c.standGap / 2);
      return canStand(this.ground, x, y, CONFIG.player.radius) && this.nav.clearLine(t.x, t.y, x, y) ? { x, y } : { x: t.x, y: t.y };
    };
    const sa = spot(a, -1, spotA);
    const sb = spot(b, 1, spotB);
    const side = (t: Trainer, s: { x: number; y: number }, fx: number, fy: number): DuelSide => ({
      trainer: t, mon: null, spotX: s.x, spotY: s.y, nextAt: this.time + c.introSeconds * 0.6, awaitingPick: false, fx, fy,
    });
    const duel: Duel = { id, a: side(a, sa, ux, uy), b: side(b, sb, -ux, -uy), cx, cy, state: 'intro', t: 0, winner: null };
    for (const t of [a, b]) {
      t.duelId = id;
      t.aiTarget = null;
      t.healing = 0;
      for (const m of t.party) {
        if (m.fainted || m.captured) continue;
        m.stowed = true;
        m.casting = null;
        m.target = null;
        m.recall = false;
        m.moving = false;
        if (isRoaming(m)) m.behavior = 'guard';
      }
    }
    this.duels.push(duel);
    this.battle.events.push({ type: 'duel-start', duel });
    if (a.isPlayer || b.isPlayer) {
      const foe = a.isPlayer ? b : a;
      this.battle.events.push({ type: 'notice', text: `${foe.name} wants to battle!`, seconds: 2.2 });
    }
    return duel;
  }

  /** Sends out party member `index` (or the first able one) for a side of a battle. */
  private sendOut(duel: Duel, side: DuelSide, index = -1): boolean {
    const t = side.trainer;
    const i = index >= 0 ? index : t.party.findIndex((m) => !m.fainted && !m.captured);
    const m = t.party[i];
    if (!m || m.fainted || m.captured) return false;
    t.party.splice(i, 1);
    t.party.unshift(m);
    const c = CONFIG.duel;
    let x = side.spotX + side.fx * c.sendOut;
    let y = side.spotY + side.fy * c.sendOut;
    if (!canStand(this.ground, x, y, 0.22)) {
      x = side.spotX;
      y = side.spotY;
    }
    m.stowed = false;
    m.duelId = duel.id;
    m.behavior = 'aggressive';
    m.x = m.px = x;
    m.y = m.py = y;
    m.dir = dirFromVector(side.fx, side.fy, m.dir);
    m.anim.dir = m.dir;
    m.anim.play('Idle', { restart: true });
    m.casting = null;
    m.busy = 0.6;
    m.visual.scale = 0.15;
    m.visual.flash = 1;
    side.mon = m;
    side.awaitingPick = false;
    side.nextAt = Infinity;
    this.battle.events.push({ type: 'duel-send', duel, mon: m, trainer: t });
    return true;
  }

  /** The player chooses who goes out next after a knockout. */
  duelPick(index: number): string {
    const duel = this.playerDuel;
    if (!duel || duel.state === 'over') return '';
    const side = duel.a.trainer === this.player ? duel.a : duel.b;
    if (!side.awaitingPick) return '';
    const m = this.player.party[index];
    if (!m || m.fainted || m.captured) return m ? `${m.name} can't battle` : '';
    this.sendOut(duel, side, index);
    return `Go, ${m.name}!`;
  }

  private stepDuels(dt: number): void {
    this.findDuels();
    for (let i = this.duels.length - 1; i >= 0; i--) {
      const d = this.duels[i] as Duel;
      d.t += dt;
      if (d.state === 'over') {
        if (d.t >= CONFIG.duel.endSeconds) this.duels.splice(i, 1);
        continue;
      }
      this.stepDuel(d, dt);
    }
  }

  private stepDuel(d: Duel, dt: number): void {
    const c = CONFIG.duel;
    const sides = [d.a, d.b];
    for (const s of sides) {
      const t = s.trainer;
      // A side whose trainer left the field (the champion withdrawing) loses.
      if (!t.alive) return this.endDuel(d, (s === d.a ? d.b : d.a).trainer);
      // Trainers walk to their spots and stand facing each other.
      const dx = s.spotX - t.x;
      const dy = s.spotY - t.y;
      const dist = Math.hypot(dx, dy);
      let moved = 0;
      if (dist > 0.05) {
        const step = Math.min(dist, CONFIG.trainers.speed * dt);
        moved = tryMove(this.ground, t, (dx / dist) * step, (dy / dist) * step, CONFIG.player.radius);
        t.dir = dirFromVector(dx, dy, t.dir);
        if (moved < step * 0.2) {
          s.spotX = t.x;
          s.spotY = t.y;
        }
      } else {
        const o = s === d.a ? d.b : d.a;
        t.dir = dirFromVector(o.trainer.x - t.x, o.trainer.y - t.y, t.dir);
      }
      this.afterTrainerMove(t, moved);
      // Knocked out: the next Pokémon, or the end of the battle.
      if (s.mon && s.mon.fainted) {
        s.mon.duelId = undefined;
        s.mon = null;
        if (!this.canBattle(t)) return this.endDuel(d, (s === d.a ? d.b : d.a).trainer);
        if (t.isPlayer) s.awaitingPick = true;
        else s.nextAt = this.time + c.aiPickSeconds;
      }
      if (!s.mon && !s.awaitingPick && this.time >= s.nextAt) this.sendOut(d, s);
      const m = s.mon;
      if (m && m.visual.scale < 1) m.visual.scale = Math.min(1, m.visual.scale + dt * 3.5);
      if (m && m.visual.flash > 0) m.visual.flash = Math.max(0, m.visual.flash - dt * 2.5);
    }
    if (d.state === 'intro' && d.a.mon && d.b.mon) {
      d.state = 'fight';
      d.t = 0;
    }
    for (const s of sides) {
      const m = s.mon;
      if (!m || m.fainted) continue;
      const foe = (s === d.a ? d.b : d.a).mon;
      if (s.trainer.isPlayer) this.stepDuelPlayerMon(m, dt);
      else this.stepDuelAiMon(m, foe, dt);
      // The battle stays in its ring.
      const r = Math.hypot(m.x - d.cx, m.y - d.cy);
      if (r > c.arenaRadius) {
        const k = c.arenaRadius / r;
        const nx = d.cx + (m.x - d.cx) * k;
        const ny = d.cy + (m.y - d.cy) * k;
        if (canStand(this.ground, nx, ny, 0.22)) {
          m.x = nx;
          m.y = ny;
        }
      }
    }
  }

  /** The player's Pokémon follows the movement keys; 1-4 cast as usual. */
  private stepDuelPlayerMon(m: Mon, dt: number): void {
    if (m.casting || m.status === 'sleep') {
      if (m.moving) {
        m.moving = false;
        m.anim.play('Idle');
      }
      return;
    }
    const mx = this.moveX;
    const my = this.moveY;
    if (mx === 0 && my === 0) {
      if (m.moving) {
        m.moving = false;
        m.anim.play('Idle');
      }
      return;
    }
    const speed = CONFIG.duel.monSpeed * (m.status === 'paralysis' ? CONFIG.battle.paralysisSpeed : 1);
    const moved = tryMove(this.ground, m, mx * speed * dt, my * speed * dt, 0.22);
    m.dir = dirFromVector(mx, my, m.dir);
    const walking = moved > 1e-4;
    if (walking !== m.moving) {
      m.moving = walking;
      m.anim.play(walking ? 'Walk' : 'Idle');
    }
  }

  /** A rival's Pokémon keeps to mid range, circles, and attacks on its own timer. */
  private stepDuelAiMon(m: Mon, foe: Mon | null, dt: number): void {
    if (m.casting || m.status === 'sleep') return;
    if (!foe || foe.fainted || m.visual.scale < 1) {
      if (m.moving) {
        m.moving = false;
        m.anim.play('Idle');
      }
      return;
    }
    const dx = foe.x - m.x;
    const dy = foe.y - m.y;
    const d = Math.hypot(dx, dy) || 1;
    m.target = foe;
    // Approach to about three tiles, back off when crowded, otherwise circle slowly.
    let vx = 0;
    let vy = 0;
    if (d > 3.4) {
      vx = dx / d;
      vy = dy / d;
    } else if (d < 1.6) {
      vx = -dx / d;
      vy = -dy / d;
    } else {
      const side = Math.sin(this.time * 0.7 + m.id) > 0 ? 1 : -1;
      vx = (-dy / d) * side * 0.45;
      vy = (dx / d) * side * 0.45;
    }
    const speed = CONFIG.duel.monSpeed * 0.8 * (m.status === 'paralysis' ? CONFIG.battle.paralysisSpeed : 1);
    const moved = vx || vy ? tryMove(this.ground, m, vx * speed * dt, vy * speed * dt, 0.22) : 0;
    const walking = moved > 1e-4;
    if (walking !== m.moving) {
      m.moving = walking;
      m.anim.play(walking ? 'Walk' : 'Idle');
    }
    m.dir = dirFromVector(dx, dy, m.dir);
    if (m.busy <= 0) {
      m.busy = this.rng.range(0.9, 1.8);
      const slot = this.battle.chooseMove(m, foe);
      if (slot >= 0) this.battle.castAt(m, slot, this.mons(), 6);
    }
  }

  /** The battle is over: the winner's party comes back out round its trainer. */
  private endDuel(d: Duel, winner: Trainer): void {
    if (d.state === 'over') return;
    d.state = 'over';
    d.t = 0;
    d.winner = winner;
    for (const s of [d.a, d.b]) {
      const t = s.trainer;
      t.duelId = undefined;
      t.duelReadyAt = this.time + CONFIG.duel.cooldownSeconds;
      for (const m of t.party) {
        m.duelId = undefined;
        m.stowed = false;
        m.visual.scale = 1;
      }
      if (t === winner) {
        // Everyone comes back out round the trainer; the one who won stays where it stood.
        const out = s.mon;
        const keep = out ? { x: out.x, y: out.y } : null;
        this.placeParty(t);
        if (out && keep) {
          out.x = out.px = keep.x;
          out.y = out.py = keep.y;
        }
      }
      s.mon = null;
      s.awaitingPick = false;
    }
    this.battle.events.push({ type: 'duel-end', duel: d, winner });
  }

  /**
   * At most fieldLimit Pokémon out per trainer: the first ones in party order that can fight
   * (roamers count). The rest wait in their balls; one comes out, popping up beside the trainer,
   * when an outside one faints or the order changes.
   */
  fieldParty(t: Trainer): void {
    const limit = (CONFIG.party as typeof CONFIG.party & { fieldLimit?: number }).fieldLimit ?? 99;
    let out = 0;
    for (const m of t.party) {
      if (m.fainted || m.captured) continue;
      if (out < limit) {
        out++;
        if (m.stowed) {
          m.stowed = false;
          const a = Math.random() * Math.PI * 2;
          const x = t.x + Math.cos(a) * 0.9;
          const y = t.y + Math.sin(a) * 0.9;
          const ok = canStand(this.ground, x, y, 0.22);
          m.x = m.px = ok ? x : t.x;
          m.y = m.py = ok ? y : t.y;
          m.casting = null;
          m.visual.scale = 0.15;
          m.visual.flash = 1;
        }
      } else if (!m.stowed) {
        m.stowed = true;
        m.casting = null;
        m.target = null;
        m.moving = false;
      }
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
