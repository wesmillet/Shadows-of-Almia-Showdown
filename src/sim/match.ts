/**
 * Match state and the fixed-step simulation: the player and their party,
 * wild Pokémon by biome, AI trainers, items, the Ranger outpost, the
 * darkness and the battle system. Pure: no canvas access.
 */
import { DIR_VECTORS, dirFromVector, type Dir8 } from '../core/math';
import type { Input } from '../core/input';
import { Rng } from '../core/rng';
import type { GroundRenderer, Biome } from '../ground/types';
import { AnimPlayer, SpriteRegistry } from '../sprites/pokemonSprite';
import { decide, type AiWorld } from './ai';
import { BattleSystem } from './battle';
import { ballModifier, newThrow, rollCatch, stepThrow, targetVisual, type Throw } from './catching';
import { CONFIG, MOVES, MOVE_SLOTS, SPAWNS, SPECIES, hitPad, move, movesAt, movesLearnedBetween, species, statsAtLevel } from './data';
import { inDarkness, newDarkness, stepDarkness, type DarknessState } from './darkness';
import type { GroundItem, InventorySlot, Mon, Trainer } from './entities';
import { activeParty, incapable, lead } from './entities';
import { ballOfTier, isGear, ITEMS, rollLoot, rollTier, TM_LIST, type BallKind, type LootTier } from './items';
import { canStand, moveAround, tryMove } from './movement';
import { DEV_CHEST, isDev } from '../dev';
import { loadChest, saveChest } from '../chest';
import { Nav } from './nav';
import { areaContains, makeArea } from './battle';
import { SHOPS, challengerLevel, inArena, koMoney, stallStock, type Challenge, type MapNpc, type Shop } from './town';
import { Visitors } from './visitors';
import { applyEvolution, EVOLVE_SECONDS, EVOLVE_SWAP, finalForm, formAtLevel, pickEvolution, stoneEvolution } from './evolution';
import { baseDex, canMega, megaFormOf, stoneFor } from './mega';
import { startFishing, stepFishing, type FishingState } from './fishing';
import { gainXp, isRoaming, shareKnockoutXp, stepParty, xpForKnockout, xpToNext, type PartyWorld } from './party';

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
/** What the Castle Champion can hand over as a shiny prize. */
const CHAMPION_SHINIES = ['0448', '0445', '0130', '0149', '0373', '0376', '0248', '0635', '0887', '0706', '0143'];

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

/** A town's storage chest: its bottom-centre (tiles) and the town. */
export interface StorageChest {
  x: number;
  y: number;
  town: string;
}

/** Something the player can use with Space when standing by it. */
export type Service = { kind: 'shop'; shop: Shop } | { kind: 'challenge' } | { kind: 'healer' } | { kind: 'chest'; index: number };

/** Chest spots per island (the ground is shared by every match played on it). */
const CHEST_SPOTS = new WeakMap<object, StorageChest[]>();

/** "2 min" or "90s" for the Storm Mask's messages. */
function maskTime(secs: number): string {
  return secs % 60 ? `${secs}s` : `${secs / 60} min`;
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
    this.visitors = new Visitors(this);
  }

  /** The merchant, Ace Trainer Celeste, Hoopa and Lugia (visitors.ts). */
  visitors!: Visitors;

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
    this.placeChests(npcs);
  }

  /**
   * The storage chests, one beside every town healer (the chest's bottom-centre, in tiles). Spots are
   * picked once per island and its two tiles blocked, so later matches on the same island reuse them.
   */
  chests: StorageChest[] = [];

  private placeChests(npcs: MapNpc[]): void {
    const g = this.ground;
    const known = CHEST_SPOTS.get(g);
    if (known) {
      this.chests = known.map((c) => ({ ...c }));
      return;
    }
    const people = npcs.map((n) => ({ x: n.x, y: n.y }));
    const offsets: Array<[number, number]> = [[-3, 0], [-3, -1], [-4, 0], [-4, -1], [2, -1], [2, 0], [-3, 1], [2, 1], [-1, -2], [-1, 2]];
    for (const n of npcs) {
      if (n.role !== 'healer') continue;
      const hx = Math.floor(n.x);
      const hy = Math.floor(n.y);
      for (const [dx, dy] of offsets) {
        const tx = hx + dx;
        const ty = hy + dy;
        // Two tiles for the chest, open ground in front of it to stand on, nobody in the way.
        const free = [tx, tx + 1].every((x) => g.walkable(x, ty) && g.walkable(x, ty + 1) && g.walkable(x, ty - 1));
        if (!free) continue;
        const cx = tx + 1;
        const cy = ty + 1;
        if (people.some((p) => Math.hypot(p.x - cx, p.y - (cy - 0.5)) < 2)) continue;
        g.block?.(tx, ty);
        g.block?.(tx + 1, ty);
        this.chests.push({ x: cx, y: cy, town: n.town });
        break;
      }
    }
    CHEST_SPOTS.set(g, this.chests.map((c) => ({ ...c })));
  }

  /** A trainer's chest store (created empty on first use). */
  storageOf(t: Trainer): Array<InventorySlot | null> {
    if (t.storage) return t.storage;
    // The player's chest is kept between games in this browser (src/chest.ts); a tester's first
    // chest starts stocked with the rare things (src/dev.ts).
    const dev = isDev();
    const saved = t.isPlayer ? loadChest(dev) : null;
    const stock = t.isPlayer && !saved && dev ? DEV_CHEST.filter(([id]) => ITEMS[id]) : [];
    const kept = (saved ?? []).filter((e) => ITEMS[e.id]);
    const box = new Array<InventorySlot | null>(Math.max(CONFIG.items.storageSlots, stock.length + 6, kept.length)).fill(null);
    stock.forEach(([id, count], i) => (box[i] = { id, count }));
    kept.forEach((e, i) => (box[i] = { id: e.id, count: e.count }));
    // Tester mode: every rare thing is always there, topped back up at the start of each match.
    if (t.isPlayer && dev && saved) {
      for (const [id, count] of DEV_CHEST) {
        if (!ITEMS[id]) continue;
        const have = box.find((e) => e?.id === id);
        if (have) have.count = Math.max(have.count, count);
        else {
          const free = box.indexOf(null);
          if (free >= 0) box[free] = { id, count };
          else box.push({ id, count });
        }
      }
      // And room to store things too.
      while (box.filter((e) => !e).length < 6) box.push(null);
    }
    t.storage = box;
    if (t.isPlayer) saveChest(box, isDev());
    return box;
  }

  /** Puts a whole bag (or gear) stack in the chest. Returns what happened. */
  deposit(t: Trainer, tab: 'items' | 'held', slot: number): string {
    const list = t[tab];
    const entry = list[slot];
    if (!entry) return '';
    const box = this.storageOf(t);
    const same = box.find((s) => s?.id === entry.id);
    if (same) same.count += entry.count;
    else {
      const free = box.indexOf(null);
      if (free < 0) return 'The chest is full';
      box[free] = { id: entry.id, count: entry.count };
    }
    list[slot] = null;
    if (t.isPlayer) saveChest(box, isDev());
    const name = ITEMS[entry.id]?.name ?? entry.id;
    return `Stored ${name}${entry.count > 1 ? ` x${entry.count}` : ''}`;
  }

  /** Takes a whole chest stack back into the bag (or gear). Returns what happened. */
  withdraw(t: Trainer, slot: number): string {
    const box = this.storageOf(t);
    const entry = box[slot];
    if (!entry) return '';
    if (!this.giveItem(t, entry.id, entry.count)) return isGear(entry.id) ? 'No room in your Held & TMs tab' : 'No room in your bag';
    box[slot] = null;
    if (t.isPlayer) saveChest(box, isDev());
    const name = ITEMS[entry.id]?.name ?? entry.id;
    return `Took ${name}${entry.count > 1 ? ` x${entry.count}` : ''}`;
  }

  /** The vendor, challenger or healer within reach of the player, nearest first. */
  nearService(reach = 1.8): Service | null {
    const p = this.player;
    let best: { d: number; s: Service } | null = null;
    const consider = (x: number, y: number, s: Service, extra = 0) => {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d <= reach + extra && (!best || d < best.d)) best = { d, s };
    };
    // Vendors stand behind their counters, so the stall answers from a little further away.
    for (const sh of this.shops) consider(sh.npc.x, sh.npc.y, { kind: 'shop', shop: sh }, sh.npc.counter ? 0.8 : 0);
    if (this.challenge?.state === 'idle') consider(this.challenge.npc.x, this.challenge.npc.y, { kind: 'challenge' });
    for (const o of this.outposts) consider(o.x, o.y, { kind: 'healer' });
    this.chests.forEach((c, i) => consider(c.x, c.y - 0.3, { kind: 'chest', index: i }, 0.3));
    return best ? (best as { s: Service }).s : null;
  }

  /** Buys entry `i` of a shop for the player. Returns what happened. */
  /**
   * What a shop pays for one of an item: half the lowest price any shop in this match asks for it,
   * or half a typical price for its kind when no shop sells it (TMs, Mega Stones, vouchers...).
   */
  sellPrice(id: string): number {
    let buy = Infinity;
    for (const s of this.shops) for (const e of s.stock) if (e.id === id) buy = Math.min(buy, e.price);
    if (!Number.isFinite(buy)) {
      const def = ITEMS[id];
      const byKind: Record<string, number> = {
        ball: 300, heal: 300, revive: 1200, cure: 300, boost: 350, hold: 2000, tm: def?.rare ? 3000 : 1500, styler: 3000,
        shard: 1500, candy: 1200, stone: 1800, voucher: 6000, rod: 1500,
      };
      buy = def?.effect === 'mega' ? 4000 : byKind[def?.kind ?? ''] ?? 200;
    }
    return Math.max(10, Math.floor(buy / 2));
  }

  /** Sells one of the item in a bag slot (`tab` 'items' or 'held') at any shop: half its price. */
  sell(t: Trainer, tab: 'items' | 'held', slot: number): string {
    const entry = t[tab][slot];
    if (!entry) return '';
    const name = ITEMS[entry.id]?.name ?? entry.id;
    const price = this.sellPrice(entry.id);
    this.takeItem(t, slot, tab);
    t.money += price;
    return `Sold ${name} for ₽${price.toLocaleString()}`;
  }

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
    for (const p of near) this.items.push({ id: nextId++, ball: 'poke', tier: null, contents: [{ id: 'poke-ball', count: 1 }], x: p.x, y: p.y, bob: id++ });
    // And a pair of Quick Balls, best thrown before the first pulse.
    const quick = spots.find((p) => !near.includes(p) && Math.hypot(p.x - this.player.x, p.y - this.player.y) < 12);
    if (quick) this.items.push({ id: nextId++, ball: 'quick', tier: null, contents: [{ id: 'quick-ball', count: 1 }], x: quick.x, y: quick.y, bob: id++ });
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

  /**
   * The guaranteed Alpha prize, dropped when one is knocked out or caught: a
   * rare TM, two Rare Candies or a rare-tier roll, plus a small chance at an
   * Extraction Voucher on top. It lands as a rare-tier ball with known contents.
   */
  alphaReward(x: number, y: number, by: Trainer | null, alpha: Mon | null = null): void {
    const contents: InventorySlot[] = [];
    const r = this.rng.next();
    const rareTms = TM_LIST.filter((t) => t.rare);
    if (r < 0.4 && rareTms.length) contents.push({ id: this.rng.pick(rareTms).id, count: 1 });
    else if (r < 0.75) contents.push({ id: 'rare-candy', count: 2 });
    else contents.push(rollLoot(this.rng, 'rare'));
    const voucher = this.rng.chance(0.12);
    if (voucher) contents.push({ id: 'extraction-voucher', count: 1 });
    // An Alpha of a line that can Mega Evolve sometimes carries its Mega Stone (alphaMegaStoneChance).
    const stoneChance = (CONFIG.items as { alphaMegaStoneChance?: number }).alphaMegaStoneChance ?? 0.3;
    const stone = alpha && this.rng.chance(stoneChance) ? stoneFor(alpha.dex) : null;
    if (stone) contents.push({ id: stone, count: 1 });
    this.placeBall(ballOfTier('rare'), contents, x, y);
    if (by?.isPlayer) {
      const names = contents.map((c) => `${ITEMS[c.id]?.name ?? c.id}${c.count > 1 ? ` x${c.count}` : ''}`).join(' + ');
      this.battle.events.push({ type: 'notice', text: `Alpha prize dropped: ${names}`, seconds: voucher ? 3.2 : 2.4 });
    }
  }

  /** A ball with known contents at a point (Master, Premier, Cherish and dropped bags). */
  placeBall(ball: BallKind, contents: InventorySlot[], x: number, y: number, heal = false): void {
    this.items.push({ id: nextId++, ball, tier: null, contents, heal, x, y, bob: this.rng.next() * 6 });
  }

  /** Adds an item to the right tab (bag, or gear for held items and TMs); returns false when it is full. */
  giveItem(t: Trainer, itemId: string, count = 1): boolean {
    const tab = isGear(itemId) ? t.held : t.items;
    // Every item stacks: more of one you already carry joins its slot.
    const slot = tab.find((s) => s?.id === itemId);
    if (slot) {
      slot.count += count;
      return true;
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

  /**
   * Mega Evolution (src/sim/mega.ts): the Pokémon holding its own Mega Stone glows and becomes
   * its Mega form for the rest of the match. Once a match per trainer.
   */
  megaEvolve(t: Trainer, m: Mon | null = t.isPlayer ? this.actingMon : lead(t)): string {
    if (t.megaUsed) return 'You already Mega Evolved this match';
    if (!m) return 'No Pokémon out';
    const form = megaFormOf(m.dex);
    if (!form) return `${m.name} can't Mega Evolve`;
    if (m.heldItem !== form.stone) return `${m.name} needs to hold its ${ITEMS[form.stone ?? '']?.name ?? 'Mega Stone'}`;
    if (!canMega(t, m)) return `${m.name} can't Mega Evolve right now`;
    t.megaUsed = true;
    m.evolving = { to: form.dex, t: 0, swapped: false, mega: true };
    m.busy = Math.max(m.busy, 1.2);
    this.battle.events.push({ type: 'mega-start', mon: m });
    return '';
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
    // Holding its Mega Stone: start loading the Mega's sprites now so the change is instant.
    const form = def.effect === 'mega' ? megaFormOf(m.dex) : null;
    if (form && form.stone === def.id) this.sprites.get(form.dex, !!m.shiny);
    if (previous) this.giveItem(t, previous);
    return `${m.name} holds the ${def.name}`;
  }

  /** Takes party member `index`'s held item back into the Held & TMs tab. */
  unequip(t: Trainer, index: number): string {
    const m = t.party[index];
    const id = m?.heldItem;
    if (!m || !id) return '';
    const def = ITEMS[id];
    if (m.mega && def?.effect === 'mega') return `${m.name} needs its ${def.name} while Mega Evolved`;
    if (!this.giveItem(t, id)) return 'No room in your Held & TMs tab';
    m.heldItem = null;
    return `Took the ${def?.name ?? 'item'} from ${m.name}`;
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
    if (m.moves.length < MOVE_SLOTS) {
      m.moves.push(def.move);
      m.cooldowns.push(0);
      this.takeItem(t, slot, 'held');
      return `${m.name} learned ${move(def.move).name}!`;
    }
    if (replace < 0 || replace >= MOVE_SLOTS) return '';
    const old = m.moves[replace];
    m.moves[replace] = def.move;
    m.cooldowns[replace] = 0;
    this.takeItem(t, slot, 'held');
    return `${m.name} forgot ${old ? move(old).name : '?'} and learned ${move(def.move).name}!`;
  }

  /**
   * New moves on levelling up. A free slot takes the move at once; with both slots full, a
   * stronger move replaces the weaker one by itself (no prompt mid-fight), for everyone.
   */
  learnOnLevelUp(m: Mon, fromLevel: number): void {
    for (const id of movesLearnedBetween(m.species, fromLevel, m.level)) {
      if (m.moves.includes(id) || !MOVES.has(id)) continue;
      if (m.moves.length < MOVE_SLOTS) {
        m.moves.push(id);
        m.cooldowns.push(0);
        this.battle.events.push({ type: 'learned', mon: m, moveId: id, forgot: null });
        continue;
      }
      // Never drops a signature move.
      let weakest = -1;
      m.moves.forEach((mid, i) => {
        if (move(mid).signature) return;
        if (weakest < 0 || move(mid).power < move(m.moves[weakest] as string).power) weakest = i;
      });
      if (weakest < 0) continue;
      const old = m.moves[weakest] as string;
      if (move(id).power > move(old).power) {
        m.moves[weakest] = id;
        m.cooldowns[weakest] = 0;
        if (m.owner?.isPlayer) this.battle.events.push({ type: 'learned', mon: m, moveId: id, forgot: move(old).name });
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
      case 'candy': {
        if (!m) return 'No Pokémon to use it on';
        if (m.level >= 100) return `${m.name} can't level up any more`;
        const before = m.level;
        gainXp(m, Math.max(1, xpToNext(m.level) - m.xp));
        this.takeItem(t, slot);
        this.battle.events.push({ type: 'xp', mon: m, xp: 0, levels: m.level - before });
        this.learnOnLevelUp(m, before);
        return `${m.name} grew to Lv ${m.level}!`;
      }
      case 'stone': {
        if (!m) return 'No Pokémon to use it on';
        const to = stoneEvolution(m.species, def.id);
        if (!to || m.evolving) return `The ${def.name} had no effect on ${m.name}`;
        this.takeItem(t, slot);
        m.evolving = { to, t: 0, swapped: false };
        this.battle.events.push({ type: 'evolve-start', mon: m });
        return '';
      }
      case 'tm':
        return 'Pick a move slot to replace';
      case 'voucher':
        return 'Pick a Pokémon to extract';
      case 'rod':
        return t.isPlayer ? startFishing(this, def.id) : '';
      case 'charm': {
        const secs = (CONFIG.darkness as { stormMaskSeconds?: number }).stormMaskSeconds ?? 120;
        return `The ${def.name} works from your bag: your Pokémon last ${maskTime(secs)} in the storm before falling asleep`;
      }
      case 'shard': {
        if (!Number.isFinite(this.darkness.radius)) return 'The darkness has not come yet';
        this.lightZones.push({ x: t.x, y: t.y, r: def.radius ?? 5, t: def.seconds ?? 10 });
        this.takeItem(t, slot);
        this.battle.events.push({ type: 'notice', text: 'The shard blazes: the darkness pulls back', seconds: 2 });
        return '';
      }
      case 'styler': {
        if (t.isPlayer && this.shadowBoutFoe()) return this.snagShadow(slot);
        if (t.party.length >= this.partyCap) return `Your party is full (${this.partyCap}). Release one from its card to make room`;
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

  /** After beating a trainer with a Snag Machine in the bag: whose Pokémon the player may take one of. */
  snagOffer: { from: Trainer } | null = null;

  /** The bag slot of a Snag Machine, or -1. */
  snagSlot(t: Trainer): number {
    return t.items.findIndex((e) => ITEMS[e?.id ?? '']?.kind === 'styler');
  }

  /**
   * Takes Pokémon `index` of the beaten trainer's party with the Snag Machine (spent). It joins
   * the player's party at half HP. Returns what happened.
   */
  snag(index: number): string {
    const offer = this.snagOffer;
    const p = this.player;
    if (!offer) return '';
    const from = offer.from;
    const m = from.party.filter((x) => !x.captured)[index];
    if (!m) return '';
    if (p.party.length >= this.partyCap) return `Your party is full (${this.partyCap}): hover a party card and click its X to release one, then pick again`;
    const slot = this.snagSlot(p);
    if (slot < 0) {
      this.snagOffer = null;
      return '';
    }
    from.party.splice(from.party.indexOf(m), 1);
    m.owner = p;
    m.wild = false;
    m.fainted = false;
    m.duelId = undefined;
    m.hp = Math.max(1, Math.floor(m.maxHp * 0.5));
    m.status = null;
    m.target = null;
    m.behavior = 'guard';
    m.x = m.px = p.x + 0.8;
    m.y = m.py = p.y + 0.4;
    m.anim.play('Idle', { restart: true });
    p.party.push(m);
    p.stats.catches++;
    this.takeItem(p, slot);
    this.snagOffer = null;
    this.fieldParty(p);
    this.battle.events.push({ type: 'caught', mon: m, by: p });
    return `Snagged ${from.name}'s ${m.name}!`;
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
    if (t.party.length >= this.partyCap) {
      this.battle.events.push({ type: 'notice', text: `Your party is full (${this.partyCap}). Release one from its card to make room`, seconds: 2.4 });
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
        const sh = this.shadowBoutFoe() ?? this.wilds.find((w) => w.shadow && w.legend && !w.captured) ?? null;
        if (sh && Math.hypot(sh.x - th.x, sh.y - th.y) < 2) {
          th.phase = 'done';
          this.battle.events.push({ type: 'scene-fx', id: 'fx_187', x: sh.x, y: sh.y, scale: 1.4, fps: 16, tint: '#8a3dff' });
          this.battle.events.push({ type: 'text', mon: sh, text: 'The ball bounced off!' });
          this.battle.events.push({ type: 'notice', text: 'Balls bounce off its dark aura. Wear it under 10% HP and use a Snag Machine', seconds: 2.6 });
          continue;
        }
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
        // Calmed by the Capture Styler: much easier to catch.
        if ((best.calm ?? 0) > 0) th.modifier *= CONFIG.styler.catchMultiplier;
        th.roll = rollCatch(this.rng, best, th.modifier);
        th.phase = 'hit';
        th.phaseT = 0;
        th.x = best.x;
        th.y = best.y + 0.05;
        best.flash = 0.06;
        best.anim.play('Hurt', { restart: true, loop: false });
        this.battle.interrupt(best);
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
          if (w.alpha) this.alphaReward(th.thrower.x, th.thrower.y, th.thrower, w);
          // The lead that wore it down learns from the catch too.
          const leadMon = lead(th.thrower);
          const share = (CONFIG.party as typeof CONFIG.party & { catchXpShare?: number }).catchXpShare ?? 0;
          if (leadMon && leadMon !== w && share > 0) {
            const xp = Math.round(xpForKnockout(w, leadMon.level) * share * (leadMon.heldItem === 'lucky-egg' ? 1.5 : 1));
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
    if (!this.openBall(this.player, this.items.indexOf(it))) {
      // Held items and TMs go to their own tab, so say which one is out of room.
      const gear = (it.contents ?? []).every((c) => isGear(c.id));
      this.battle.events.push({ type: 'notice', text: gear ? 'The Held & TMs tab is full (G to look, the red X throws one away)' : 'The bag is full (the red X on a slot throws it away)', seconds: 2.2 });
    } else if (it.contents?.length && this.items.includes(it)) {
      this.battle.events.push({ type: 'notice', text: 'Some of it did not fit; the rest is still in the ball', seconds: 1.8 });
    }
    return true;
  }

  /** Opens ground ball `i` for a trainer: whatever fits goes in the bag, the rest stays in the ball. */
  private openBall(t: Trainer, i: number): boolean {
    const it = this.items[i] as GroundItem | undefined;
    if (!it) return false;
    if (!it.contents) it.contents = [rollLoot(this.rng, it.tier ?? 'common', t.party.map((m) => baseDex(m.megaFrom?.dex ?? m.dex)))];
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
    if (t.duelId) return "The healer can't help mid-battle";
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
        // No healing in the middle of a battle, even standing right by the healer.
        if (t.duelId) {
          t.healing = 0;
          continue;
        }
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
   * Gives up on a target the trainer is not getting any closer to (behind a cliff, across water,
   * inside a building): after `stuckSeconds` without a tile of progress it is banned for a while.
   */
  private watchAiProgress(t: Trainer): void {
    if (!t.aiKey || !t.aiTarget) {
      t.aiProgress = undefined;
      return;
    }
    const d = Math.hypot(t.aiTarget.x - t.x, t.aiTarget.y - t.y);
    const p = t.aiProgress;
    if (!p || d < p.best - 1) {
      t.aiProgress = { best: d, since: this.time };
      return;
    }
    const near = t.ai === 'hunt' ? 4 : t.ai === 'heal' ? CONFIG.outpost.radius : 1;
    if (d > near && this.time - p.since > 6) {
      (t.aiBans ??= {})[t.aiKey] = this.time + 40;
      t.aiKey = null;
      t.aiProgress = undefined;
      t.aiTimer = 0;
    }
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
    world.rivals = this.allTrainers.filter((o) => o !== t && o.alive && !o.challenger && !o.visitor);
    // Beacons draw healthy trainers in.
    t.aiTimer -= dt;
    if (t.aiTimer <= 0) {
      t.aiTimer = this.rng.range(0.4, 0.9);
      const bans = t.aiBans ?? {};
      world.banned = (key) => (bans[key] ?? 0) > this.time;
      world.time = this.time;
      const left = this.allTrainers.filter((o) => o.alive && !o.challenger && !o.visitor);
      world.lastFoe = left.length === 2 && left.includes(t) ? (left.find((o) => o !== t) ?? null) : null;
      const d = decide(t, world);
      t.ai = d.ai;
      t.aiTarget = d.target;
      if ((d.key ?? null) !== (t.aiKey ?? null)) t.aiProgress = undefined;
      t.aiKey = d.key ?? null;
      if (d.ai === 'roam') {
        const beacon = this.outposts.find((o) => o.beacon > 0.5 && o.users.some((u) => u !== t));
        if (beacon && Math.hypot(beacon.x - t.x, beacon.y - t.y) < 20) {
          t.aiTarget = { x: beacon.x, y: beacon.y };
          t.ai = 'engage';
          t.aiKey = null;
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
      if (t.ai === 'hunt') stop = 3;
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
        moved = moveAround(this.ground, t, dx * speed * dt, dy * speed * dt, CONFIG.player.radius, dt);
        t.dir = dirFromVector(dx, dy, t.dir);
        if (moved < speed * dt * 0.2) t.aiTimer = Math.min(t.aiTimer, 0.1);
      }
    }
    this.watchAiProgress(t);
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

  /**
   * Seconds in the darkness before a Pokémon falls asleep. A trainer carrying the Storm Mask
   * (bought from the Wandering Merchant) keeps their Pokémon awake stormMaskSeconds (2 minutes) in the darkness.
   */
  drowsySeconds(m: Mon): number {
    const base = CONFIG.darkness.drowsySeconds;
    const owner = m.owner;
    const masked = !!owner && (owner.items.some((e) => e?.id === 'storm-mask') || owner.held.some((e) => e?.id === 'storm-mask'));
    return masked ? ((CONFIG.darkness as { stormMaskSeconds?: number }).stormMaskSeconds ?? 120) : base;
  }

  /** The species each land's wild Pokémon were drawn from this match (for checks and tests). */
  spawnRotation: Record<string, string[]> = {};

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

  makeMon(dex: string, level: number, owner: Trainer | null, x: number, y: number, shiny = false): Mon {
    const sp = species(dex);
    const stats = statsAtLevel(sp.stats, level);
    const sprites = this.sprites.get(dex, shiny);
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
      shiny: shiny && SpriteRegistry.hasShiny(dex),
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
        if (this.ground.features?.finalArena && inArena(this.ground.features.finalArena, tx + 0.5, ty + 0.5, 3)) continue;
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
    // Every match differs: each land keeps its own table (weights jittered) plus a few species drawn
    // from its rotation pool for this match, and every line that can Mega Evolve is placed in its land.
    const extra = SPAWNS as unknown as {
      rotation?: Record<string, Row[]>; rotationPicks?: number; tableJitter?: [number, number];
      megaLines?: Array<{ dex: string; land: string }>;
    };
    const tables = {} as Record<Biome, Table>;
    for (const [b, t] of Object.entries(SPAWNS.biomes as unknown as Record<Biome, Table>) as Array<[Biome, Table]>) {
      if (!t.table) {
        tables[b] = t;
        continue;
      }
      const [j0, j1] = extra.tableJitter ?? [1, 1];
      const rows: Row[] = t.table.map((r) => ({ ...r, weight: r.weight * this.rng.range(j0, j1) }));
      const lv = t.levels ?? [3, 6];
      for (const r of this.rng.shuffle([...(extra.rotation?.[b] ?? [])]).slice(0, extra.rotationPicks ?? 0)) {
        if (rows.some((x) => x.dex === r.dex)) continue;
        // Rare picks (starters, pseudo-legendaries) come a little stronger, like a table's rare entries.
        rows.push(r.weight <= 1.5 ? { ...r, levels: [(lv[0] ?? 3) + 3, (lv[1] ?? 6) + 2] } : { ...r });
      }
      tables[b] = { ...t, table: rows };
    }
    this.spawnRotation = Object.fromEntries(Object.entries(tables).map(([b, t]) => [b, (t.table ?? []).map((r) => r.dex)]));
    const nearest = (tables.meadow?.use || tables.shore?.use) ? this.nearestLand(tables) : null;
    for (const [biome, table] of Object.entries(tables) as Array<[Biome, Table]>) {
      const spots = this.rng.shuffle([...byBiome[biome]]);
      const n = Math.min(table.count, spots.length);
      const forced: Row[] = (extra.megaLines ?? []).filter((l) => l.land === biome).map((l) => ({ dex: l.dex, weight: 1 }));
      for (let i = 0; i < n; i++) {
        const spot = spots[i] as { x: number; y: number };
        // Meadows and beaches borrow the table of the land they border.
        const land = table.use && nearest ? nearest[Math.floor(spot.y) * g.cols + Math.floor(spot.x)] : biome;
        const t = land ? tables[land as Biome] : undefined;
        if (!t?.table?.length) continue;
        let row = forced[i] ?? this.rng.weighted(t.table, (r) => r.weight);
        const lv = row.levels ?? t.levels ?? [3, 6];
        // Stronger the closer to the Shadow Crystal: up to centerLevelBonus extra levels at the centre,
        // easing to none at the coast, so the outer lands stay gentle for fresh teams.
        // Round every starting point the land stays at its base levels, so a fresh team can train there.
        const nearStart = Math.min(...this.startSpots.map((s) => Math.hypot(s.x - spot.x, s.y - spot.y)));
        const calm = Math.min(1, Math.max(0, (nearStart - 20) / 25));
        // Round the crystal the bonus is spread a little, so the middle holds levels from the 30s to about 60.
        const w = CONFIG.wild;
        const spread = this.rng.range(w.centerLevelSpread[0] ?? 0.75, w.centerLevelSpread[1] ?? 1.1);
        let level = this.rng.int(lv[0] ?? 3, lv[1] ?? 6) + Math.round(this.centerBonus(spot.x, spot.y) * calm * spread);
        // Close to the crystal, now and then an Alpha: huge, fully evolved, level 75.
        const toCenter = Math.hypot(spot.x - this.centerX, spot.y - this.centerY);
        const alpha = nearStart > 30 && toCenter <= w.alphaRadius && this.rng.chance(w.alphaChance);
        // Now and then an elite: a few levels higher (often evolved), worth more XP. None right by the starts.
        const elite = !alpha && nearStart > 22 && this.rng.chance(w.eliteChance ?? 0);
        if (elite) level += this.rng.int(w.eliteLevels?.[0] ?? 5, w.eliteLevels?.[1] ?? 9);
        if (alpha) {
          // A cut above the wilds around it: alphaLevelBonus over the local level, at most alphaLevelMax.
          level = Math.min(w.alphaLevelMax, level + w.alphaLevelBonus + this.rng.int(-2, 2));
          // An Alpha is a line's last form: prefer a row that actually evolves.
          for (let k = 0; k < 8 && finalForm(row.dex, this.rng) === row.dex; k++) row = this.rng.weighted(t.table, (r) => r.weight);
        }
        level = Math.min(100, level);
        // Past an evolution level a wild Pokémon is met already evolved (Luxio, Gyarados...); an Alpha always is.
        const dex = alpha ? finalForm(row.dex, this.rng) : formAtLevel(row.dex, level, this.rng, true);
        // Now and then a shiny (Alphas a little more often).
        const shiny = this.rng.chance(alpha ? w.shinyChance * 4 : w.shinyChance);
        const mon = this.makeMon(dex, level, null, spot.x, spot.y, shiny);
        if (elite) mon.elite = true;
        if (alpha) mon.alpha = true;
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
  /** Auto-battle: the lead picks its own moves and targets while the player steers (R toggles). */
  auto = true;
  private autoTimer = 0;

  /**
   * Aim assist: the enemy nearest the cursor, if one is within 1.6 tiles of it. Moves then go
   * where that Pokémon stands when they are cast; they still land on that spot, so it can step out.
   */
  aimSnap(): Mon | null {
    const m = lead(this.player);
    const a = this.aim;
    if (!m || !a) return null;
    let best: Mon | null = null;
    let bd = 1.6;
    for (const c of this.mons()) {
      if (c === m || !BattleSystem.active(c) || !this.battle.isEnemy(m, c)) continue;
      const d = Math.hypot(c.x - a.x, c.y - a.y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /**
   * Ball lock-on: the wild Pokémon a thrown ball goes at. It is the nearest catchable wild (one
   * already fighting your team counts as closer) until the player picks another with Tab or by
   * pointing at it; a pick (a click works on any wild on screen) holds until that Pokémon faints, is caught, or
   * gets about a screen away; the marker is green when a throw can reach it and red when not.
   */
  lockTarget: Mon | null = null;
  private lockPicked = false;
  static readonly LOCK_RANGE = 9;
  /** A wild picked by hand (a click) stays the target out to about a screen away. */
  static readonly PICK_RANGE = 24;

  private lockScore(c: Mon): number {
    const p = this.player;
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    const engaged = !!c.target && c.target.owner === p;
    return d - (engaged ? 4 : 0);
  }

  private lockable(c: Mon, range = Match.LOCK_RANGE): boolean {
    const p = this.player;
    return !c.fainted && !c.captured && !c.npc && !c.leap && this.wilds.includes(c) && Math.hypot(c.x - p.x, c.y - p.y) <= range;
  }

  /** Catchable wilds in lock range, best first. */
  lockCandidates(): Mon[] {
    return this.wilds.filter((c) => this.lockable(c)).sort((a, b) => this.lockScore(a) - this.lockScore(b));
  }

  private stepLock(): void {
    const t = this.lockTarget;
    const valid = !!t && this.lockable(t, this.lockPicked ? Match.PICK_RANGE : Match.LOCK_RANGE);
    if (valid && this.lockPicked) return;
    const best = this.lockCandidates()[0] ?? null;
    if (!valid) {
      this.lockTarget = best;
      this.lockPicked = false;
    } else if (best && best !== t && this.lockScore(best) < this.lockScore(t!) - 1.5) {
      // Not picked by hand: follow the nearest, with a little stickiness so it does not flicker.
      this.lockTarget = best;
    }
  }

  /** Tab: the next wild in range (nearest first), held until it is gone. */
  cycleLock(): Mon | null {
    const list = this.lockCandidates();
    if (!list.length) return null;
    const i = this.lockTarget ? list.indexOf(this.lockTarget) : -1;
    this.lockTarget = list[(i + 1) % list.length] ?? null;
    this.lockPicked = true;
    return this.lockTarget;
  }

  /** Lock onto a wild the player pointed at. */
  pickLock(c: Mon): void {
    if (!this.lockable(c, Match.PICK_RANGE)) return;
    this.lockTarget = c;
    this.lockPicked = true;
  }

  /**
   * Player input: the lead casts move `slot` toward the aim point (snapped onto an enemy near
   * the cursor). Nothing tracks the target after the cast, so a moving Pokémon can step out.
   */
  playerCast(slot: number): 'cast' | 'cooldown' | 'no-lead' | 'asleep' | 'busy' {
    const p = this.player;
    const m = this.actingMon;
    if (!m) return 'no-lead';
    if (incapable(m)) return 'asleep';
    if (m.casting) return 'busy';
    if ((m.cooldowns[slot] ?? 0) > 0) return 'cooldown';
    let a: { x: number; y: number };
    const duel = this.playerDuel;
    if (this.controlled === m && !duel) {
      // Pokémon mode: moves go where the player aims (the reticle on the cursor).
      const f = DIR_VECTORS[m.dir] as { x: number; y: number };
      a = this.aim ?? { x: m.x + f.x * 3, y: m.y + f.y * 3 };
    } else if (duel) {
      // A battle: moves go where the player aims (the reticle on the cursor), as in Pokémon mode.
      const f = DIR_VECTORS[m.dir] as { x: number; y: number };
      a = this.aim ?? { x: m.x + f.x * 3, y: m.y + f.y * 3 };
    } else {
      const f = DIR_VECTORS[p.dir] as { x: number; y: number };
      const snap = this.aimSnap();
      a = snap ? { x: snap.x, y: snap.y } : this.aim ?? { x: m.x + f.x * 3, y: m.y + f.y * 3 };
    }
    m.dir = dirFromVector(a.x - m.x, a.y - m.y, m.dir);
    m.anim.dir = m.dir;
    if (!this.battle.castToward(m, slot, a.x, a.y)) return 'cooldown';
    m.manualCast = true;
    return 'cast';
  }

  /** Dodge: the lead dashes the way the player is moving (or the trainer faces), briefly untouchable. */
  playerDodge(): 'ok' | 'cooldown' | 'none' {
    const m = this.actingMon;
    if (!m || incapable(m)) return 'none';
    if ((m.dodgeCd ?? 0) > 0 || m.dodge) return 'cooldown';
    let dx = this.moveX;
    let dy = this.moveY;
    if (!dx && !dy) {
      const f = DIR_VECTORS[m.dir] as { x: number; y: number };
      dx = f.x;
      dy = f.y;
    }
    this.startDodge(m, dx, dy);
    return 'ok';
  }

  startDodge(m: Mon, dx: number, dy: number): void {
    const c = CONFIG.dodge;
    const n = Math.hypot(dx, dy) || 1;
    const speed = c.dashTiles / c.dashSeconds;
    m.dodge = { vx: (dx / n) * speed, vy: (dy / n) * speed, dash: c.dashSeconds, safe: c.safeSeconds };
    m.dodgeCd = c.cooldown;
    this.battle.interrupt(m);
    m.dir = dirFromVector(dx, dy, m.dir);
    this.battle.events.push({ type: 'dodge-start', mon: m });
  }

  /** Dashes in progress move their Pokémon; cooldowns tick. */
  private stepDodges(dt: number): void {
    for (const m of this.mons()) {
      if ((m.dodgeCd ?? 0) > 0) m.dodgeCd = Math.max(0, (m.dodgeCd ?? 0) - dt);
      const d = m.dodge;
      if (!d) continue;
      if (d.dash > 0) {
        const step = Math.min(dt, d.dash);
        tryMove(this.ground, m, d.vx * step, d.vy * step, 0.22);
        d.dash -= step;
      }
      d.safe -= dt;
      if (d.safe <= 0 && d.dash <= 0) m.dodge = null;
    }
  }

  /** Auto-battle for the player's lead: the best ready move at the nearest enemy in reach. */
  private stepAutoLead(dt: number): void {
    // Battles are the player's to fight: auto-battle only runs out on the field.
    if (!this.auto || this.playerDuel) return;
    const m = this.actingMon;
    // A Pokémon set to Passive never picks fights, auto-battle or not (you can still fire its moves yourself).
    if (!m || m.casting || incapable(m) || m.behavior === 'passive') return;
    this.autoTimer -= dt;
    if (this.autoTimer > 0) return;
    this.autoTimer = 0.45;
    const t = this.battle.pickTarget(m, [...this.mons()].filter((c) => !this.sparing(m, c)), 5.5);
    if (!t) return;
    const slot = this.battle.chooseMove(m, t);
    if (slot < 0) return;
    m.dir = dirFromVector(t.x - m.x, t.y - m.y, m.dir);
    m.anim.dir = m.dir;
    // A beam from auto-battle keeps on its target (steerChannels), not the cursor.
    if (this.battle.castToward(m, slot, t.x, t.y)) {
      m.manualCast = false;
      m.target = t;
    }
  }

  /**
   * Points every channelled beam where its user wants it: the player's Pokémon follows the cursor,
   * anything else tracks the Pokémon it is fighting.
   */
  private steerChannels(): void {
    const mine = this.playerDuel ? (this.playerDuel.a.trainer === this.player ? this.playerDuel.a.mon : this.playerDuel.b.mon) : this.actingMon;
    for (const m of this.mons()) {
      const ch = m.channel;
      if (!ch) continue;
      if (m === mine && this.aim && ch.manual) {
        ch.aimX = this.aim.x;
        ch.aimY = this.aim.y;
      } else if (m.target && BattleSystem.active(m.target)) {
        ch.aimX = m.target.x;
        ch.aimY = m.target.y;
      }
    }
  }

  /**
   * What an ordinary wild Pokémon could ever be hostile to: trainers' Pokémon and bosses (wild
   * Pokémon leave each other alone). Built once a step, so hundreds of wilds looking for a target
   * don't each walk every Pokémon on the island.
   */
  private wildTargets(): Mon[] {
    if (this.wildTargetsAt !== this.time) {
      this.wildTargetsAt = this.time;
      this.wildTargetsList = [];
      for (const t of this.allTrainers) if (t.alive) for (const m of t.party) if (!m.fainted && !m.stowed) this.wildTargetsList.push(m);
      for (const w of this.wilds) if (w.boss && !w.fainted) this.wildTargetsList.push(w);
      if (this.darkrai && !this.darkrai.fainted) this.wildTargetsList.push(this.darkrai);
    }
    return this.wildTargetsList;
  }

  private wildTargetsAt = -1;
  private wildTargetsList: Mon[] = [];

  /** Hostile Pokémon pick their own targets: nearest enemy within `aggro`, then cast on cooldown. */
  private stepHostile(m: Mon, dt: number, aggro: number): boolean {
    if (!BattleSystem.active(m) || m.casting || incapable(m)) return false;
    if (m.target && (!BattleSystem.active(m.target) || Math.hypot(m.target.x - m.x, m.target.y - m.y) > aggro + 1.5)) m.target = null;
    if (!m.target) m.target = this.battle.pickTarget(m, m.boss || m.owner ? this.mons() : this.wildTargets(), aggro);
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

  /**
   * A slam in progress (Body Slam, Heavy Slam): the attacker travels along the ground toward its
   * landing spot while the renderer lifts it on the arc; walls stop the travel, not the jump.
   */
  private stepSlam(m: Mon, dt: number): void {
    const l = m.leap;
    if (!l?.slam) return;
    l.t += dt;
    const k = Math.min(1, l.t / l.dur);
    const e = k * k * (3 - 2 * k);
    const x = l.fx + (l.tx - l.fx) * e;
    const y = l.fy + (l.ty - l.fy) * e;
    if (canStand(this.ground, x, y, 0.22)) {
      m.x = x;
      m.y = y;
    }
    if (k >= 1 || m.fainted || incapable(m)) m.leap = null;
  }

  /**
   * Pokémon mode: the player has taken direct control of one of their Pokémon out on the field.
   * The movement keys steer it, its moves fire the way it faces, and the trainer follows a few
   * steps behind. Null in trainer mode.
   */
  controlled: Mon | null = null;
  /** The player's line in the water, if fishing (src/sim/fishing.ts). */
  fishing: FishingState | null = null;
  /** Set when the steered Pokémon faints: control passes to the next one out (until this time). */
  private handoffUntil = 0;

  /** Takes control of a party Pokémon out on the field (Pokémon mode). */
  takeControl(m: Mon): boolean {
    const p = this.player;
    if (p.duelId || p.mount || m.owner !== p || m.stowed || m.fainted || m.captured || isRoaming(m)) return false;
    if (this.controlled) this.controlled.steered = false;
    this.controlled = m;
    m.steered = true;
    m.target = null;
    return true;
  }

  /** The mount rules for a species (data/config.json riding.mounts), if it can be ridden or flown. */
  static mountOf(dex: string): { kind: 'ride' | 'fly'; seat: number; back: number } | null {
    const mounts = CONFIG.riding.mounts as Record<string, { kind: string; seat: number; back: number }>;
    const m = mounts[baseDex(dex)];
    return m ? { kind: m.kind === 'fly' ? 'fly' : 'ride', seat: m.seat, back: m.back } : null;
  }

  /** The nearest point a trainer can stand on, searching outward from (x, y). */
  private nearestStand(x: number, y: number): { x: number; y: number } {
    for (let r = 0.5; r < 20; r += 0.5) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const nx = x + Math.cos(a) * r;
        const ny = y + Math.sin(a) * r;
        if (canStand(this.ground, nx, ny, CONFIG.player.radius)) return { x: nx, y: ny };
      }
    }
    return { x: this.centerX, y: this.centerY + 3 };
  }

  /** The ground as a flyer sees it: water counts as open (cliffs, trees and buildings still block). */
  private flyGround(): GroundRenderer {
    const g = this.ground;
    const proxy = Object.create(g) as GroundRenderer;
    proxy.walkable = (tx: number, ty: number) => g.walkable(tx, ty) || g.biomeAt(tx, ty) === 'water';
    return proxy;
  }

  /**
   * V: ride (or fly on) the first party Pokémon that can carry the trainer, or get off. Riding is
   * faster; flying is faster still, crosses water and stays out of trainer battles. The mount sits
   * out of the fight while carrying the trainer.
   */
  toggleRide(): string {
    const p = this.player;
    if (p.mount) return this.dismount(p);
    if (p.duelId) return "You can't ride during a battle";
    if (p.downUntil !== undefined) return '';
    const mon = p.party.find((m) => !m.fainted && !m.captured && !m.evolving && Match.mountOf(m.dex));
    if (!mon) return 'No Pokémon in your party can carry you (Raikou, Koraidon, Miraidon ride; Latios, Staraptor fly)';
    if (this.controlled) this.releaseControl();
    this.fishing = null;
    const fly = Match.mountOf(mon.dex)?.kind === 'fly';
    p.mount = { mon, fly };
    mon.stowed = true;
    this.battle.interrupt(mon);
    mon.target = null;
    mon.x = mon.px = p.x;
    mon.y = mon.py = p.y;
    mon.visual = { scale: 1, alpha: 1, flash: 0 };
    return fly ? `You take off on ${mon.name}! It can fly over water (V to land)` : `You ride ${mon.name}! (V to get off)`;
  }

  /** Off the mount, where the trainer can stand (not over water). */
  dismount(t: Trainer, force = false): string {
    const mt = t.mount;
    if (!mt) return '';
    if (!force && !canStand(this.ground, t.x, t.y, CONFIG.player.radius)) return "You can't land here";
    t.mount = null;
    mt.mon.stowed = true;
    this.fieldParty(t);
    return `${mt.mon.name} sets you down`;
  }

  /** Recalls a Pokémon and sends it straight back out beside its trainer (ball flash and grow). */
  private regroup(t: Trainer, m: Mon): void {
    const a = this.rng.next() * Math.PI * 2;
    const x = t.x + Math.cos(a) * 0.9;
    const y = t.y + Math.sin(a) * 0.9;
    const ok = canStand(this.ground, x, y, 0.22);
    m.x = m.px = ok ? x : t.x;
    m.y = m.py = ok ? y : t.y;
    m.target = null;
    m.moving = false;
    m.anim.play('Idle', { restart: true });
    m.visual.scale = 0.15;
    m.visual.flash = 1;
  }

  /** Back to the trainer (trainer mode). */
  releaseControl(): void {
    const m = this.controlled;
    this.controlled = null;
    if (m) m.steered = false;
    if (m && m.moving) {
      m.moving = false;
      m.anim.play('Idle');
    }
  }

  /** The Pokémon the player's move keys act for: the controlled one, else the lead. */
  get actingMon(): Mon | null {
    return this.controlled ?? lead(this.player);
  }

  /**
   * Lets a party Pokémon go. It steps out where the player stands and wanders off as a calm wild
   * Pokémon (it could be caught again). Not mid-battle, and never the last one.
   */
  release(index: number): string {
    const p = this.player;
    const m = p.party[index];
    if (!m) return '';
    if (p.duelId) return "You can't release a Pokémon during a battle";
    if (p.party.length <= 1) return "You can't release your last Pokémon";
    p.party.splice(index, 1);
    m.owner = null;
    m.stowed = false;
    m.recall = false;
    m.target = null;
    this.battle.interrupt(m);
    if (this.lockTarget === m) this.lockTarget = null;
    if (!m.fainted) {
      m.x = m.px = p.x + 0.6;
      m.y = m.py = p.y + 0.4;
      m.homeX = m.targetX = m.x;
      m.homeY = m.targetY = m.y;
      m.calm = 20;
      this.wilds.push(m);
    }
    this.battle.events.push({ type: 'released', mon: m });
    return m.fainted ? `${m.name} was released` : `Bye, ${m.name}! It heads off into the wild`;
  }

  /**
   * Extraction Voucher: party member `index` is sent to the player's PC (the UI stores it) and
   * leaves the match for good. Not during a battle, and never the last Pokémon that can fight.
   */
  extractWithVoucher(itemSlot: number, index: number): string {
    const p = this.player;
    const entry = p.items[itemSlot];
    if (!entry || ITEMS[entry.id]?.kind !== 'voucher') return '';
    const m = p.party[index];
    if (!m) return '';
    if (p.duelId) return "You can't extract a Pokémon during a battle";
    if (!p.party.some((o) => o !== m && !o.fainted && !o.captured)) return "You can't extract your last Pokémon that can fight";
    this.takeItem(p, itemSlot);
    p.party.splice(index, 1);
    if (this.controlled === m) this.releaseControl();
    if (this.lockTarget === m) this.lockTarget = null;
    this.battle.interrupt(m);
    m.target = null;
    this.battle.events.push({ type: 'extracted', mon: m, via: 'voucher' });
    return `${m.name} was extracted to your PC!`;
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
    // Everyone who moves this step, townsfolk and visitors included, keeps last step's spot for drawing in between.
    for (const t of [...this.allTrainers, ...this.npcs]) {
      t.px = t.x;
      t.py = t.y;
    }
    const axis = input.moveAxis();
    this.moveX = axis.x;
    this.moveY = axis.y;
    this.stepPlayer(dt);
    stepFishing(this, dt);
    this.visitors.step(dt);
    this.stepDodges(dt);
    this.stepLock();
    this.stepAutoLead(dt);
    for (const t of this.trainers) if (t.alive && !t.duelId && !t.visitor && t.downUntil === undefined) (t.challenger ? this.stepChallenger(t) : this.stepAi(t, dt));
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
        // (The white send-out flash fades with it; left alone it kept the Pokémon tinted red.)
        for (const m of t.party) {
          if (m.stowed || m.captured || m.fainted) continue;
          // One of the player's Pokémon left far behind (off screen) pops back out beside them.
          if (t.isPlayer && !m.steered && !isRoaming(m) && !m.casting && !m.leap && Math.hypot(m.x - t.x, m.y - t.y) > 16) this.regroup(t, m);
          if (m.visual.scale < 1) m.visual.scale = Math.min(1, m.visual.scale + dt * 3.5);
          if (m.visual.flash > 0) m.visual.flash = Math.max(0, m.visual.flash - dt * 2.5);
        }
        stepParty(t, lead(t), dt, pw);
      }
      // Rivals Mega Evolve as soon as a Pokémon holding its stone is in a fight.
      if (!t.isPlayer && !t.megaUsed) {
        const fighter = t.party.find((m) => m.target && canMega(t, m));
        if (fighter) this.megaEvolve(t, fighter);
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
    this.stepDarkraiPortal(dt);
    if (this.darkrai) this.stepDarkrai(this.darkrai, dt);
    this.battle.stepFlights(dt);
    this.steerChannels();
    for (const m of this.mons()) {
      this.stepSlam(m, dt);
      this.battle.stepMon(m, dt, () => this.mons());
      // Pokémon on a ladder face the cliff while they climb.
      m.anim.dir = this.ground.onLadder?.(Math.floor(m.x), Math.floor(m.y)) ? 4 : m.dir;
      // Frozen solid: the pose holds until it thaws.
      if (m.status !== 'freeze') m.anim.update(dt);
    }
    for (const gone of this.battle.stepFainting(dt)) {
      const i = this.wilds.indexOf(gone);
      if (i >= 0) this.wilds.splice(i, 1);
    }
    this.handleKnockouts();
    this.stepEvolutions(dt);
    this.checkElimination();
    // The last two are no longer pulled to the crystal's arena: they find each other on the map.
    if (CONFIG.duel.finalShowdown) this.stepFinalShowdown(dt);
  }

  /** Party Pokémon past an evolution level start evolving; evolutions in progress tick on. */
  private stepEvolutions(dt: number): void {
    for (const t of this.allTrainers) {
      if (!t.alive) continue;
      for (const m of t.party) {
        const e = m.evolving;
        if (!e) {
          if (m.fainted || m.captured || m.stowed || m.mega || m.visual.scale < 1) continue;
          const to = pickEvolution(m.species, m.level, this.rng);
          if (!to) continue;
          m.evolving = { to, t: 0, swapped: false };
          this.battle.events.push({ type: 'evolve-start', mon: m });
          continue;
        }
        e.t += dt;
        if (!e.swapped && e.t >= EVOLVE_SWAP) {
          // The new form's sprites must be in before the swap (or it would vanish while they load).
          const spr = this.sprites.get(e.to, !!m.shiny);
          if (!spr.loaded && e.t < EVOLVE_SWAP + 4) {
            e.t = EVOLVE_SWAP - 0.2;
            continue;
          }
          e.swapped = true;
          const from = m.name;
          if (e.mega) {
            m.mega = true;
            m.megaFrom = { dex: m.dex, name: m.name };
          }
          applyEvolution(m, species(e.to), spr);
          this.battle.events.push({ type: 'evolved', mon: m, from });
        }
        if (e.t >= EVOLVE_SECONDS) m.evolving = null;
      }
    }
  }

  private stepPlayer(dt: number): void {
    const p = this.player;
    if (p.downUntil !== undefined) {
      p.moving = false;
      return;
    }
    // A mount that can no longer carry the trainer (fainted, released, caught by a rival) drops them.
    const mt = p.mount;
    if (mt && (mt.mon.fainted || mt.mon.captured || mt.mon.owner !== p || !p.party.includes(mt.mon))) {
      p.mount = null;
      if (!canStand(this.ground, p.x, p.y, CONFIG.player.radius)) {
        const spot = this.nearestStand(p.x, p.y);
        p.x = p.px = spot.x;
        p.y = p.py = spot.y;
      }
    }
    const climbing = this.ground.onLadder?.(Math.floor(p.x), Math.floor(p.y)) ?? false;
    const ride = p.mount ? (p.mount.fly ? CONFIG.riding.flySpeed : CONFIG.riding.rideSpeed) : 1;
    const speed = CONFIG.player.speedTilesPerSec * (climbing ? 0.6 : 1) * ride;
    let moved = 0;
    // In a one-on-one battle the trainer stands back; the movement keys steer the Pokémon instead.
    if (p.duelId) {
      if (this.controlled) this.releaseControl();
      p.stats.timeSurvived = this.time;
      return;
    }
    const c = this.controlled;
    if (c && (c.fainted || c.stowed || c.captured || c.owner !== p || !p.party.includes(c) || isRoaming(c))) {
      // A knocked-out Pokémon hands control to the next one out, beside the trainer.
      if (c.fainted) this.handoffUntil = this.time + 1.5;
      this.releaseControl();
    }
    if (!this.controlled && this.handoffUntil > this.time) {
      const next = p.party
        .filter((m) => !m.fainted && !m.captured && !m.stowed && !isRoaming(m) && m.visual.scale >= 1)
        .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (next && Math.hypot(next.x - p.x, next.y - p.y) < 10 && this.takeControl(next)) {
        this.handoffUntil = 0;
        this.battle.events.push({ type: 'notice', text: `Go, ${next.name}! You're steering it now (Esc for trainer mode)`, seconds: 2 });
      }
    }
    if (this.controlled) {
      // Pokémon mode: the keys steer the Pokémon; the trainer keeps a few steps behind it.
      const m = this.controlled;
      this.stepDuelPlayerMon(m, dt);
      const d = Math.hypot(m.x - p.x, m.y - p.y);
      if (d > 3.2) {
        const dir = this.nav.dir(p.x, p.y, m.x, m.y) ?? { x: (m.x - p.x) / d, y: (m.y - p.y) / d };
        moved = tryMove(this.ground, p, dir.x * speed * dt, dir.y * speed * dt, CONFIG.player.radius);
        p.dir = dirFromVector(dir.x, dir.y, p.dir);
      }
      this.separate(p);
      this.afterTrainerMove(p, moved);
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
      moved = tryMove(p.mount?.fly ? this.flyGround() : this.ground, p, this.moveX * speed * dt, this.moveY * speed * dt, CONFIG.player.radius);
      p.dir = dirFromVector(this.moveX, this.moveY, p.dir);
    }
    if (p.mount) {
      // The mount walks (or flies) under the trainer.
      const mon = p.mount.mon;
      mon.px = p.px;
      mon.py = p.py;
      mon.x = p.x;
      mon.y = p.y;
      mon.dir = p.dir;
      mon.anim.dir = p.dir;
      const walking = moved > 1e-4 || p.mount.fly;
      if (walking !== mon.moving) {
        mon.moving = walking;
        mon.anim.play(walking ? 'Walk' : 'Idle');
      }
      mon.anim.update(dt);
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
      isEnemy: (a, b) => this.battle.isEnemy(a, b) && !this.sparing(a, b),
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

  /**
   * The wild the player picked to catch, once under 25% HP: their Pokémon stop attacking it on
   * their own (moves fired by hand still hit), so it is not knocked out before the ball goes.
   */
  sparing(attacker: Mon, target: Mon): boolean {
    const p = this.player;
    if (attacker.owner !== p || !target.wild) return false;
    // Catch mode spares every weak wild Pokémon; otherwise only the one picked as the ball's target.
    if (attacker.behavior !== 'catch' && (target !== this.lockTarget || !this.lockPicked)) return false;
    if (target.hp >= target.maxHp * 0.25) return false;
    if (this.sparedNotice !== target) {
      this.sparedNotice = target;
      this.battle.events.push({ type: 'notice', text: `${target.name} is weak: your team holds back. Throw a ball (F)!`, seconds: 2.4 });
    }
    return true;
  }
  private sparedNotice: Mon | null = null;

  /** A party member attacks on its own timer (the player's 1-4 casts bypass this). */
  private autoAttack(m: Mon, target: Mon, range: number): void {
    if (m.casting || incapable(m) || this.sparing(m, target)) return;
    if (Math.hypot(target.x - m.x, target.y - m.y) > range) return;
    if (m.busy > 0) return;
    const slot = this.battle.chooseMove(m, target);
    if (slot < 0) return;
    m.dir = dirFromVector(target.x - m.x, target.y - m.y, m.dir);
    if (this.battle.castAt(m, slot, this.mons(), range)) m.busy = this.rng.range(0.8, 1.6);
  }

  /** Loops of the Capture Styler a wild Pokémon needs before it calms down. */
  stylerLoopsNeeded(m: Mon): number {
    const c = CONFIG.styler;
    return Math.min(c.maxLoops, c.baseLoops + Math.floor(m.level / c.perLevel) + (m.elite ? c.eliteLoops : 0) + (m.landBoss || m.alpha ? c.bossLoops : 0));
  }

  /** One loop of the styler line closed round `m`. */
  stylerLoop(m: Mon): void {
    if (!m.wild || m.fainted || m.captured || (m.calm ?? 0) > 0) return;
    m.styler = (m.styler ?? 0) + 1;
    const needed = this.stylerLoopsNeeded(m);
    this.battle.events.push({ type: 'styler-loop', mon: m, loops: m.styler, needed });
    if (m.styler >= needed) {
      m.styler = 0;
      m.calm = CONFIG.styler.calmSeconds;
      m.target = null;
      this.battle.interrupt(m);
      m.aura = false;
      this.battle.events.push({ type: 'calmed', mon: m });
    }
  }

  /** The Pokémon ran through the line: it breaks and a loop is lost. */
  stylerBreak(m: Mon): void {
    m.styler = Math.max(0, (m.styler ?? 0) - 1);
    this.battle.events.push({ type: 'styler-break', mon: m });
  }

  private stepWild(w: Mon, dt: number): void {
    // Hoopa moves itself (visitors.ts); a leaping legend is mid-air.
    if (w.npc || w.leap) return;
    if (w.fainted || w.captured || w.casting || incapable(w)) return;
    if ((w.calm ?? 0) > 0) w.calm = Math.max(0, (w.calm ?? 0) - dt);
    // Anything hostile that wanders close gets attacked.
    if (this.stepHostile(w, dt, w.landBoss || w.alpha ? CONFIG.wild.bossAggroRange : CONFIG.wild.aggroRange)) {
      if (w.moving) {
        w.moving = false;
        w.anim.play('Idle');
      }
      return;
    }
    if (!w.moving) {
      w.idleTimer -= dt;
      if (w.idleTimer <= 0) {
        const r = w.landBoss || w.alpha ? CONFIG.wild.bossWanderRadius : CONFIG.wild.wanderRadius;
        for (let tries = 0; tries < 6; tries++) {
          const tx = w.homeX + this.rng.range(-r, r);
          const ty = w.homeY + this.rng.range(-r, r);
          // Only spots it can walk straight to, so it never stands pushing into a tree or a wall.
          if (this.ground.reachable(Math.floor(tx), Math.floor(ty)) && canStand(this.ground, tx, ty, 0.3) && this.nav.clearLine(w.x, w.y, tx, ty)) {
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
    // Close enough counts as there (a spot by a wall can be a hair out of reach for its body).
    if (d < 0.3) {
      w.moving = false;
      w.anim.play('Idle');
      return;
    }
    const step = Math.min(d, speed * dt);
    const before = d;
    const moved = moveAround(this.ground, w, (dx / d) * step, (dy / d) * step, 0.25, dt);
    w.dir = dirFromVector(dx, dy, w.dir);
    // Not getting any closer (blocked, or circling the spot): stop here and pick somewhere else next time.
    const closer = before - Math.hypot(w.targetX - w.x, w.targetY - w.y);
    w.stuckT = closer < step * 0.2 ? (w.stuckT ?? 0) + dt : 0;
    if (moved < step * 0.2 || (w.stuckT ?? 0) > 0.6) {
      w.stuckT = 0;
      w.targetX = w.x;
      w.targetY = w.y;
      w.moving = false;
      w.anim.play('Idle');
    }
  }

  /** XP for knockouts and item drops from wild Pokémon (read off this step's faint events). */
  private handleKnockouts(): void {
    for (const ev of [...this.battle.events]) {
      if (ev.type === 'yield') {
        const host = ev.mon.owner?.legendBout ? ev.mon.owner : null;
        if (ev.mon.shadow) {
          // Shadow Lugia worn to nothing without a snag: it comes apart into the storm (in its bout or not).
          if (ev.mon.captured) continue;
          if (host) this.shadowVanishes(ev.mon, host);
          else {
            ev.mon.captured = true;
            this.wilds = this.wilds.filter((w) => w !== ev.mon);
            this.battle.events.push({ type: 'scene-fx', id: 'fx_114', x: ev.mon.x, y: ev.mon.y, scale: 4, ground: true, fps: 12, tint: '#3a1458', shake: 0.5 });
            this.battle.events.push({ type: 'notice', text: `${ev.mon.name} dissolved into the storm...`, seconds: 3.5 });
          }
          continue;
        }
        if (host) {
          // Won a legend bout: the legend joins the player and the battle ends.
          const d = this.duels.find((x) => x.state !== 'over' && (x.a.trainer === host || x.b.trainer === host));
          host.party = host.party.filter((x) => x !== ev.mon);
          if (d) (d.a.trainer === host ? d.a : d.b).mon = null;
          ev.mon.duelId = undefined;
          const by = ev.by?.owner === this.player ? ev.by : lead(this.player) ?? this.player.party.find((x) => !x.fainted) ?? null;
          ev.mon.owner = null;
          ev.mon.wild = true;
          this.visitors.legendYields(ev.mon, by);
          if (d) this.endDuel(d, this.player);
          this.endLegendBout(host);
          continue;
        }
        this.visitors.legendYields(ev.mon, ev.by);
        continue;
      }
      if (ev.type === 'faint' && ev.mon.boss) {
        // Darkrai's defeat: a Cherish Ball with a Dark-type held item that also heals the finder's party.
        this.placeBall('cherish', [{ id: 'black-glasses', count: 1 }], ev.mon.x, ev.mon.y + 0.6, true);
        this.battle.events.push({ type: 'notice', text: 'Darkrai is down! It left a Cherish Ball behind', seconds: 3 });
      }
      if (ev.type === 'faint' && ev.mon.owner) ev.mon.owner.lastKo = !ev.by ? 'other' : ev.by.wild && !ev.by.boss ? 'wild' : ev.by.owner ? 'trainer' : 'other';
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
      if (ev.mon.wild && ev.mon.alpha) this.alphaReward(ev.mon.x, ev.mon.y, owner ?? null, ev.mon);
      else if (ev.mon.wild && this.rng.chance(CONFIG.party.wildDropChance)) this.dropLoot(ev.mon.x, ev.mon.y);
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
    // Celeste's bout is friendly: settled before anyone could be knocked out of the match by it.
    this.visitors.check();
    const ch = this.challenge;
    const pl = this.player;
    if (ch?.state === 'battle' && pl.alive && pl.party.length > 0 && !pl.party.some((m) => !m.fainted && !m.captured)) this.loseChallenge(ch);
    for (const t of this.allTrainers) {
      if (t.alive && t.downUntil !== undefined) {
        if (this.time >= t.downUntil) this.respawn(t);
        continue;
      }
      // Out only when nothing is left standing; members out roaming still count.
      if (t.alive && t.party.length > 0 && !t.party.some((m) => !m.fainted && !m.captured)) {
        if (t.lastKo === 'wild' && !t.challenger && !t.visitor && !this.finalStarted && !this.outcome) this.down(t);
        else this.eliminate(t);
      }
    }
    const c = this.challenge;
    if (c?.state === 'battle' && c.foe && !c.foe.alive) {
      c.state = 'won';
      const r = SHOPS.challenger.reward;
      this.player.money += r.money;
      const spill: InventorySlot[] = [];
      for (const [id, n] of r.items) if (!this.giveItem(this.player, id, n)) spill.push({ id, count: n });
      if (spill.length) this.placeBall('cherish', spill, c.foe.x, c.foe.y + 1);
      // The champion's trophy: a shiny Pokémon at your best level.
      const pool = CHAMPION_SHINIES.filter((d) => SPECIES.has(d) && SpriteRegistry.hasShiny(d));
      let prize = '';
      if (pool.length && this.player.party.length < this.partyCap) {
        const best = Math.max(...this.player.party.map((x) => x.level));
        const mon = this.makeMon(pool[this.rng.int(0, pool.length - 1)] as string, best, this.player, this.player.x + 0.8, this.player.y + 0.5, true);
        mon.stowed = true;
        this.player.party.push(mon);
        prize = ` and a shiny ${mon.name}`;
      } else if (pool.length) prize = ' (no room in your party for his shiny Pokémon)';
      this.battle.events.push({ type: 'notice', text: `You beat the ${SHOPS.challenger.name}! +₽${r.money}, his items${prize}`, seconds: 4 });
    }
    const rivals = this.trainers.filter((t) => !t.challenger && !t.visitor);
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
      // Darkrai, and Shadow Lugia (even after it joins someone), are the storm's own.
      if (m.boss || m.shadow) continue;
      const dark = this.isDark(m.x, m.y);
      m.inDark = dark;
      if (m.wild) m.aura = dark;
      if (dark) {
        m.outsideDark = 0;
        if (m.status === null) {
          m.drowsy += dt;
          if (m.drowsy >= this.drowsySeconds(m)) {
            m.drowsy = 0;
            this.battle.applyStatus(m, 'sleep');
            m.statusTimer = 1e9; // only the light wakes a darkness sleeper
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
    // When the darkness has closed on the crystal, Darkrai comes out at level 100.
    const d = this.makeMon('0491', 100, null, this.centerX, this.centerY + 1.6);
    d.boss = true;
    d.wild = false;
    // Its boss kit: slot 0 Dark Void (sleep ring), slot 1 Dark Pulse (stepDarkrai relies on the order).
    d.moves = ['dark-void', 'dark-pulse'];
    d.cooldowns = [0, 0];
    d.maxHp = d.hp = d.stats.hp * CONFIG.battle.bossHpMultiplier;
    // It steps out of a dark portal (assets/fx/darkrai_portal.png): hidden until the portal is open.
    d.busy = 3;
    d.visual.alpha = 0;
    this.darkrai = d;
    this.darkraiPortal = { x: d.x, y: d.y, t: 0 };
  }

  /** Darkrai's portal: opens (line, small, full) over 0.9 s, Darkrai fades out of it, then it closes. */
  darkraiPortal: { x: number; y: number; t: number } | null = null;
  static readonly PORTAL_SECONDS = 3.6;

  private stepDarkraiPortal(dt: number): void {
    const po = this.darkraiPortal;
    if (!po) return;
    po.t += dt;
    const d = this.darkrai;
    if (d && !d.fainted) d.visual.alpha = Math.max(0, Math.min(1, (po.t - 1.0) / 0.7));
    if (po.t >= Match.PORTAL_SECONDS) {
      if (d) d.visual.alpha = 1;
      this.darkraiPortal = null;
    }
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
    const free = this.allTrainers.filter((t) => t.alive && !t.duelId && !t.challenger && !t.visitor && !t.mount?.fly && this.time >= (t.duelReadyAt ?? 0) && this.canBattle(t));
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
      if (t.mount) this.dismount(t, true);
      t.duelId = id;
      t.aiTarget = null;
      t.healing = 0;
      for (const m of t.party) {
        if (m.fainted || m.captured) continue;
        m.stowed = true;
        // Back in the ball: stat changes wear off.
        m.stages = { atk: 0, def: 0, spe: 0 };
        this.battle.interrupt(m);
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
      if (!foe.legendBout) this.battle.events.push({ type: 'notice', text: `${foe.name} wants to battle!`, seconds: 2.2 });
    }
    return duel;
  }

  /**
   * A legendary's one-on-one bout with the player (portal legends, Lugia), fought like a trainer
   * battle: the player's team goes back in its balls and fights it one at a time in the ring. The
   * legend has its own hard AI (stepLegendMon). Worn down to its last HP it joins the player; beat
   * the player's whole team and it leaves, and the team is patched up (a friendly bout).
   * Returns false (the legend stays a wild boss) when the player cannot battle right now.
   */
  startLegendBout(L: Mon): boolean {
    const p = this.player;
    if (p.duelId || !p.alive || p.downUntil !== undefined || !this.canBattle(p) || this.finalStarted) return false;
    if (p.mount && !canStand(this.ground, p.x, p.y, CONFIG.player.radius)) return false;
    const host = this.makeTrainer(L.name, 'legend', false, L.x, L.y);
    host.visitor = true;
    host.hidden = true;
    host.legendBout = true;
    this.wilds = this.wilds.filter((w) => w !== L);
    L.owner = host;
    L.wild = false;
    L.behavior = 'aggressive';
    L.calm = 0;
    L.target = null;
    L.legendPhase = 0;
    host.party.push(L);
    this.trainers.push(host);
    if (this.controlled) this.releaseControl();
    this.fishing = null;
    const d = this.startDuel(p, host, undefined, { x: L.x, y: L.y });
    // The legend is already out: it does not come from a ball.
    this.sendOut(d, d.b);
    L.visual.flash = 0;
    L.visual.scale = Math.max(L.visual.scale, 0.6);
    return true;
  }

  /** Shadow Lugia's foe in its bout (the player's Pokémon out), or null when it is not in one. */
  shadowBoutFoe(): Mon | null {
    const d = this.playerDuel;
    if (!d) return null;
    const side = d.a.trainer === this.player ? d.b : d.a;
    return side.trainer.legendBout && side.mon?.shadow ? side.mon : null;
  }

  /**
   * The Snag Machine in Shadow Lugia's bout: under config shadowLugia.snagBelow of its HP it is
   * taken (the machine is spent) and joins the party in its dark form; above that, nothing happens.
   */
  snagShadow(slot: number): string {
    const L = this.shadowBoutFoe();
    const p = this.player;
    if (!L) return '';
    const below = CONFIG.shadowLugia.snagBelow;
    if (L.hp / L.maxHp >= below) return `${L.name} is too strong to snag. Wear it under ${Math.round(below * 100)}% HP first`;
    if (p.party.length >= this.partyCap) return `Your party is full (${this.partyCap}). Release one from its card first`;
    const d = this.playerDuel as Duel;
    const host = L.owner as Trainer;
    this.takeItem(p, slot);
    host.party = host.party.filter((x) => x !== L);
    (d.a.trainer === host ? d.a : d.b).mon = null;
    L.duelId = undefined;
    L.legend = false;
    L.landBoss = false;
    L.wild = false;
    L.owner = p;
    L.maxHp = L.stats.hp;
    L.hp = Math.max(1, Math.round(L.maxHp * 0.5));
    L.target = null;
    this.battle.interrupt(L);
    L.channel = null;
    L.status = null;
    L.legendPhase = 0;
    L.stages = { atk: 0, def: 0, spe: 0 };
    L.behavior = 'guard';
    L.anim.play('Idle', { restart: true });
    p.party.push(L);
    p.stats.catches++;
    if (p.duelId) L.stowed = true;
    this.battle.events.push({ type: 'scene-fx', id: 'fx_114', x: L.x, y: L.y, scale: 3.4, ground: true, fps: 14, tint: '#5a1f8f', shake: 0.6 });
    this.battle.events.push({ type: 'scene-fx', id: 'fx_239', x: L.x, y: L.y, scale: 2.6, lift: 1, fps: 10, tint: '#b04dff' });
    this.battle.events.push({ type: 'caught', mon: L, by: p });
    this.endDuel(d, p);
    this.endLegendBout(host);
    return `You snagged ${L.name}! It joins your team, still wrapped in darkness`;
  }

  /** Shadow Lugia worn down to nothing (no snag in time): it dissolves and the bout ends. */
  private shadowVanishes(L: Mon, host: Trainer): void {
    const d = this.duels.find((x) => x.state !== 'over' && (x.a.trainer === host || x.b.trainer === host));
    L.captured = true;
    L.channel = null;
    this.battle.interrupt(L);
    if (d) (d.a.trainer === host ? d.a : d.b).mon = null;
    this.battle.events.push({ type: 'scene-fx', id: 'fx_114', x: L.x, y: L.y, scale: 4, ground: true, fps: 12, tint: '#3a1458', shake: 0.5 });
    this.battle.events.push({ type: 'notice', text: `${L.name} dissolved into the storm... you needed to snag it under 10% HP`, seconds: 4 });
    if (d) this.endDuel(d, this.player);
    this.endLegendBout(host);
  }

  /** A legend bout is over: the legend joined the player (won) or left (lost). The stand-in host goes. */
  private endLegendBout(host: Trainer): void {
    host.alive = false;
    this.trainers = this.trainers.filter((t) => t !== host);
  }

  /**
   * A legendary in a bout: harder than any rival. It keeps to mid range and strafes, reads the
   * player's telegraphs and dashes out of most of them, casts more often as it weakens, chains
   * casts when pressed, and at a third of its HP it is enraged (Attack and Speed up, red flash).
   */
  private stepLegendMon(m: Mon, foe: Mon | null, dt: number): void {
    const frac = m.hp / m.maxHp;
    const phase = frac > 0.66 ? 0 : frac > 0.33 ? 1 : 2;
    if (phase > (m.legendPhase ?? 0)) {
      m.legendPhase = phase;
      if (m.shadow) {
        // Each phase Shadow Lugia shakes off its status and gets faster.
        this.battle.cureStatus(m);
        this.battle.changeStage(m, 'spe', 1);
        this.battle.events.push({ type: 'scene-fx', id: 'fx_114', x: m.x, y: m.y, scale: 3.6, ground: true, fps: 14, tint: '#5a1f8f', shake: 0.4 });
      }
      if (phase === 1) this.battle.events.push({ type: 'notice', text: m.shadow ? `${m.name}'s aura thickens: it shook off its status and moves faster!` : `${m.name} is getting serious!`, seconds: 2.2 });
      else {
        this.battle.changeStage(m, 'atk', 1);
        this.battle.changeStage(m, 'spe', 1);
        m.flash = 0.4;
        this.battle.events.push({ type: 'notice', text: `${m.name} is enraged!`, seconds: 2.4 });
        this.battle.events.push({ type: 'scene-fx', id: 'fx_175', x: m.x, y: m.y, scale: 2.4, ground: true, shake: 0.6, tint: '#ff6b6b' });
      }
    }
    // It recovers faster the lower it gets.
    const haste = [0, 0.35, 0.8][phase] as number;
    for (let i = 0; i < m.cooldowns.length; i++) m.cooldowns[i] = Math.max(0, (m.cooldowns[i] ?? 0) - dt * haste);
    if (m.shadow) {
      const sl = CONFIG.shadowLugia;
      if (!m.snagHinted && m.hp / m.maxHp < sl.snagBelow) {
        m.snagHinted = true;
        this.battle.events.push({ type: 'notice', text: this.snagSlot(this.player) >= 0 ? `${m.name} is weakened! Use the Snag Machine NOW!` : `${m.name} is weakened... but you have no Snag Machine`, seconds: 3 });
      }
      // Shadow Storm: a ring of dark gusts round it every few seconds (faster each phase).
      m.shadowStormT = (m.shadowStormT ?? 0) - dt;
      if (m.shadowStormT <= 0 && !m.casting && !m.channel && !incapable(m)) {
        if (this.battle.castExtra(m, 'shadow-storm', m.x, m.y + 0.01)) m.shadowStormT = sl.stormEvery[phase] as number;
      }
    }
    if (m.casting || incapable(m)) return;
    if (foe && !m.dodge && (m.dodgeCd ?? 0) <= 0 && this.inHostileTelegraph(m)) {
      if (this.rng.chance([0.55, 0.7, 0.85][phase] as number)) {
        const side = this.rng.chance(0.5) ? 1 : -1;
        this.startDodge(m, -(foe.y - m.y) * side, (foe.x - m.x) * side);
        m.dodgeCd = [1.4, 1.0, 0.7][phase] as number;
        return;
      }
      m.dodgeCd = 0.4;
    }
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
    // Mid range, strafing; switches side every couple of seconds; enraged, it rushes in now and then.
    const rush = phase === 2 && Math.sin(this.time * 0.9 + m.id) > 0.75;
    let vx = 0;
    let vy = 0;
    if (rush ? d > 1.8 : d > 4.6) {
      vx = dx / d;
      vy = dy / d;
    } else if (d < 2.4 && !rush) {
      vx = -dx / d;
      vy = -dy / d;
    } else {
      const side = Math.sin(this.time * 1.3 + m.id) > 0 ? 1 : -1;
      vx = (-dy / d) * side * 0.8;
      vy = (dx / d) * side * 0.8;
    }
    const speed = CONFIG.duel.monSpeed * (rush ? 1.25 : 0.9) * (m.status === 'paralysis' ? CONFIG.battle.paralysisSpeed : 1);
    const moved = vx || vy ? moveAround(this.ground, m, vx * speed * dt, vy * speed * dt, 0.3, dt) : 0;
    const walking = moved > 1e-4;
    if (walking !== m.moving) {
      m.moving = walking;
      m.anim.play(walking ? 'Walk' : 'Idle');
    }
    m.dir = dirFromVector(dx, dy, m.dir);
    if (m.busy <= 0) {
      const [lo, hi] = ([[1.1, 1.6], [0.8, 1.3], [0.5, 1.0]] as const)[phase] as readonly [number, number];
      m.busy = this.rng.range(lo, hi);
      const slot = this.battle.chooseMove(m, foe);
      if (slot >= 0 && this.battle.castAt(m, slot, this.mons(), 7)) {
        // Pressed, it often follows up at once.
        if (phase >= 1 && this.rng.chance(phase === 2 ? 0.5 : 0.3)) m.busy = 0.25;
      }
    }
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
    this.battle.interrupt(m);
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
      else if (s.trainer.legendBout) this.stepLegendMon(m, foe, dt);
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
    if (m.casting || incapable(m)) {
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
    if (m.casting || incapable(m)) return;
    // Standing in the player's telegraph: sometimes dash out of it sideways.
    if (foe && !m.dodge && (m.dodgeCd ?? 0) <= 0 && this.inHostileTelegraph(m)) {
      if (this.rng.chance(CONFIG.dodge.aiChance)) {
        const side = this.rng.chance(0.5) ? 1 : -1;
        this.startDodge(m, -(foe.y - m.y) * side, (foe.x - m.x) * side);
        return;
      }
      m.dodgeCd = 1;
    }
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
    const moved = vx || vy ? moveAround(this.ground, m, vx * speed * dt, vy * speed * dt, 0.22, dt) : 0;
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
  /** The final showdown: seconds until the last two are called to the crystal's arena (null until there are two). */
  private finalCountdown: number | null = null;
  finalStarted = false;

  /**
   * When only two trainers are left in the match, both are called to the battlefield round the
   * Shadow Crystal: after a short warning they are brought there, their teams restored, and they
   * battle one-on-one. The winner takes the match.
   */
  private stepFinalShowdown(dt: number): void {
    const arena = this.ground.features?.finalArena;
    if (!arena || this.finalStarted || this.outcome) return;
    const left = this.allTrainers.filter((t) => t.alive && !t.challenger && !t.visitor);
    if (left.length !== 2) return;
    const [a, b] = left as [Trainer, Trainer];
    if (this.finalCountdown === null) {
      this.finalCountdown = 5;
      this.battle.events.push({ type: 'notice', text: 'Final two! The Shadow Crystal calls you both to its arena', seconds: 4 });
      return;
    }
    // Let a battle between the two (or anything else) finish first.
    if (a.duelId || b.duelId) return;
    this.finalCountdown -= dt;
    if (this.finalCountdown > 0) return;
    this.finalStarted = true;
    if (this.controlled) this.releaseControl();
    const cy = (arena.y0 + arena.y1) / 2;
    const spots = [{ x: arena.x0 + 1, y: cy }, { x: arena.x1 - 1, y: cy }];
    // The crystal lifts a rival team that fell far behind to a few levels under the strongest
    // finalist's, so the last battle is worth fighting.
    const best = Math.max(...[a, b].flatMap((t) => t.party.filter((m) => !m.captured).map((m) => m.level)));
    for (const t of [a, b]) {
      if (t.isPlayer) continue;
      for (const m of t.party) {
        if (m.captured || m.level >= best - 3) continue;
        const before = m.level;
        // Fainted Pokémon gain no XP (gainXp ignores them), so stand it back up first: the whole
        // team is restored for the final anyway. (Before this, a fainted member below the bar
        // looped forever and froze the game as the final two were called.)
        m.fainted = false;
        for (let guard = 0; guard < 120 && m.level < best - 3; guard++) gainXp(m, Math.max(1, xpToNext(m.level) - m.xp));
        this.learnOnLevelUp(m, before);
        // Evolve straight away (no animation): it walks into the arena in its new form.
        for (let k = 0; k < 3; k++) {
          const to = pickEvolution(m.species, m.level, this.rng);
          if (!to) break;
          applyEvolution(m, species(to), this.sprites.get(to, !!m.shiny));
        }
      }
    }
    for (const [i, t] of [a, b].entries()) {
      const s = spots[i] as { x: number; y: number };
      t.x = t.px = s.x;
      t.y = t.py = s.y;
      t.aiTarget = null;
      for (const m of t.party) {
        if (m.captured) continue;
        if (isRoaming(m)) m.behavior = 'guard';
        m.recall = false;
        m.fainted = false;
        m.hp = m.maxHp;
        this.battle.cureStatus(m);
        m.drowsy = 0;
        m.x = m.px = s.x;
        m.y = m.py = s.y;
      }
    }
    // No wild Pokémon in the way.
    for (const w of this.wilds) if (!w.npc && inArena(arena, w.x, w.y, 2)) {
      w.x = w.homeX = w.targetX = arena.x0 - 4;
      w.y = w.homeY = w.targetY = arena.y0 - 4;
    }
    this.startDuel(a, b, spots[0], spots[1]);
    this.battle.events.push({ type: 'notice', text: `Final showdown: ${a.name} vs ${b.name}! Both teams are restored`, seconds: 4 });
  }

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
    // Beat a trainer while carrying a Snag Machine: pick one of their Pokémon to take.
    const loser = d.a.trainer === winner ? d.b.trainer : d.a.trainer;
    if (winner === this.player && !loser.legendBout && !loser.visitor && this.snagSlot(winner) >= 0 && loser.party.some((m) => !m.captured)) {
      this.snagOffer = { from: loser };
      this.battle.events.push({ type: 'notice', text: `Snag Machine ready: take one of ${loser.name}'s Pokémon (1-6), Esc to keep it`, seconds: 3 });
    }
    if (winner.legendBout) {
      // Lost a legend bout: it is friendly. The legend leaves and the team is patched up.
      const p = this.player;
      const shadow = winner.party.some((x) => x.shadow);
      for (const m of winner.party) m.captured = true;
      this.endLegendBout(winner);
      for (const m of p.party) {
        if (m.captured) continue;
        m.fainted = false;
        m.hp = Math.max(m.hp, Math.round(m.maxHp * 0.25));
        m.status = null;
        m.anim.play('Idle', { restart: true });
      }
      this.placeParty(p);
      this.battle.events.push({ type: 'notice', text: shadow ? `${winner.name} sinks back into the storm. It won't surface again this match` : `${winner.name} was too strong and vanished. Your Pokémon were patched up`, seconds: 3.5 });
    }
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
      // The mount stays out of the fight while it carries its trainer.
      if (t.mount?.mon === m) {
        m.stowed = true;
        continue;
      }
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
          this.battle.interrupt(m);
          m.visual.scale = 0.15;
          m.visual.flash = 1;
        }
      } else if (!m.stowed) {
        m.stowed = true;
        m.stages = { atk: 0, def: 0, spe: 0 };
        this.battle.interrupt(m);
        m.target = null;
        m.moving = false;
      }
    }
  }

  /** Seconds a wild wipe-out keeps a trainer down at the current point of the match. */
  respawnSeconds(): number {
    const c = CONFIG.respawn;
    return Math.round(Math.min(c.maxSeconds, c.baseSeconds + c.perMinute * (this.time / 60)));
  }

  /**
   * Wiped out by wild Pokémon: the trainer drops everything they carry (one Premier Ball where
   * they fell) and sits out a cooldown, then comes back at an outpost (see respawn).
   */
  down(t: Trainer): void {
    const secs = this.respawnSeconds();
    if (t.mount) {
      t.mount = null;
      if (!canStand(this.ground, t.x, t.y, CONFIG.player.radius)) {
        const spot = this.nearestStand(t.x, t.y);
        t.x = t.px = spot.x;
        t.y = t.py = spot.y;
      }
    }
    t.downUntil = this.time + secs;
    const bag = [...t.items, ...t.held].filter((e): e is InventorySlot => !!e).map((e) => ({ id: e.id, count: e.count }));
    if (bag.length) this.placeBall('premier', bag, t.x + 0.8, t.y + 0.4);
    t.items.fill(null);
    t.held.fill(null);
    t.aiTarget = null;
    t.healing = 0;
    t.moving = false;
    if (t.isPlayer) {
      if (this.controlled) this.releaseControl();
      this.lockTarget = null;
    }
    this.battle.events.push({ type: 'downed', trainer: t, seconds: secs });
  }

  /** Back from a wild wipe-out: at the nearest outpost out of the dark, party fully healed. */
  private respawn(t: Trainer): void {
    t.downUntil = undefined;
    t.lastKo = undefined;
    const spots = this.outposts.map((o) => ({ x: o.x + 1.2, y: o.y + 1.2 })).filter((s) => !this.isDark(s.x, s.y) && canStand(this.ground, s.x, s.y, CONFIG.player.radius));
    spots.sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y));
    const at = spots[0] ?? { x: t.x, y: t.y };
    t.x = t.px = at.x;
    t.y = t.py = at.y;
    for (const m of t.party) {
      if (m.captured) continue;
      m.fainted = false;
      m.hp = m.maxHp;
      this.battle.cureStatus(m);
      m.drowsy = 0;
      this.battle.interrupt(m);
      m.target = null;
      m.anim.play('Idle', { restart: true });
      m.x = m.px = t.x;
      m.y = m.py = t.y + 0.6;
      m.stowed = true;
    }
    this.fieldParty(t);
    this.battle.events.push({ type: 'respawned', trainer: t });
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
