/**
 * Town services: Poké Dollars, the vendors at the market stalls, and the
 * challenger in the castle courtyard (data/shops.json).
 */
import shopsJson from '../../data/shops.json';
import type { Mon, Trainer } from './entities';
import { ITEMS } from './items';

export interface ShopEntry {
  id: string;
  price: number;
  /** How many the stall has this match (unset: as many as anyone buys). */
  left?: number;
}

export interface Shop {
  npc: Trainer;
  town: string;
  name: string;
  stock: ShopEntry[];
}

export interface Arena {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Challenge {
  npc: Trainer;
  arena: Arena;
  state: 'idle' | 'battle' | 'won';
  foe: Trainer | null;
  /** The player battling him (online, whoever took the challenge). */
  human?: Trainer | null;
  /** Match time from which the challenger accepts again (after a lost bout). */
  readyAt: number;
}

/** A person standing somewhere on the map file (healer, vendor, challenger). */
export interface MapNpc {
  role: 'healer' | 'vendor' | 'challenger';
  x: number;
  y: number;
  town: string;
  stand?: number;
  /** The vendor's stand base point (tiles), to find its picture in the map's objects. */
  standX?: number;
  standY?: number;
}

interface ShopsData {
  startMoney: number;
  koMoney: { wildBase: number; perLevel: number; trainerMult: number };
  stalls: Array<{ name: string; stock: Array<[string, number]> }>;
  townItems: Record<string, string>;
  townItemPrice: number;
  /** Each town's medicine stall sells its stones (one id or several). */
  townStones?: Record<string, string | string[]>;
  townStonePrice?: number;
  challenger: {
    name: string;
    party: string[];
    ranged?: string[];
    melee?: string[];
    teamSize?: number;
    rewardTms?: [number, number];
    levelOver: number;
    minLevel: number;
    retrySeconds: number;
    reward: { money: number; items: Array<[string, number]> };
  };
}

export const SHOPS = shopsJson as unknown as ShopsData;

/** The stock of a town's stall (stand 0 balls, 1 medicine, 2 gear plus the town's own item). */
export function stallStock(town: string, stand: number): { name: string; stock: ShopEntry[] } {
  const s = SHOPS.stalls[stand % SHOPS.stalls.length] ?? { name: 'Stall', stock: [] };
  const stock = s.stock.filter(([id]) => ITEMS[id]).map(([id, price]) => ({ id, price }));
  const own = SHOPS.townItems[town];
  if (stand % SHOPS.stalls.length === 2 && own && ITEMS[own]) stock.push({ id: own, price: SHOPS.townItemPrice });
  // The medicine stall also sells the town's evolution stones (between them the towns carry all ten).
  const stones = SHOPS.townStones?.[town];
  if (stand % SHOPS.stalls.length === 1 && stones) {
    for (const stone of Array.isArray(stones) ? stones : [stones]) if (ITEMS[stone]) stock.push({ id: stone, price: SHOPS.townStonePrice ?? 1800 });
  }
  return { name: s.name, stock };
}

/** Poké Dollars for knocking out `target`. */
export function koMoney(target: Mon): number {
  const k = SHOPS.koMoney;
  const base = k.wildBase + k.perLevel * target.level;
  return Math.round(target.owner ? base * k.trainerMult : base);
}

/** The challenger's level: a few above the player's strongest Pokémon, never below the floor. */
export function challengerLevel(player: Trainer): number {
  const top = Math.max(1, ...player.party.map((m) => m.level));
  return Math.min(100, Math.max(SHOPS.challenger.minLevel, top + SHOPS.challenger.levelOver));
}

export function inArena(a: Arena, x: number, y: number, pad = 0): boolean {
  return x >= a.x0 - pad && x <= a.x1 + pad && y >= a.y0 - pad && y <= a.y1 + pad;
}

/**
 * A team of `size` drawn from a ranged and a melee pool, half from each (any odd one from ranged),
 * in a random order. Species missing from the game are skipped.
 */
export function drawTeam(rng: { int(a: number, b: number): number }, ranged: string[], melee: string[], size: number, has: (dex: string) => boolean): string[] {
  const pick = (pool: string[], n: number): string[] => {
    const left = pool.filter(has);
    const out: string[] = [];
    while (out.length < n && left.length) out.push(left.splice(rng.int(0, left.length - 1), 1)[0] as string);
    return out;
  };
  const team = [...pick(ranged, Math.ceil(size / 2)), ...pick(melee, Math.floor(size / 2))];
  for (let i = team.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [team[i], team[j]] = [team[j] as string, team[i] as string];
  }
  return team;
}

/** `[min, max]` random TMs (different ones) for a fight's reward. */
export function rewardTms(rng: { int(a: number, b: number): number }, range: [number, number] | undefined, tms: string[]): string[] {
  if (!range || !tms.length) return [];
  const n = rng.int(range[0], range[1]);
  const left = [...tms];
  const out: string[] = [];
  while (out.length < n && left.length) out.push(left.splice(rng.int(0, left.length - 1), 1)[0] as string);
  return out;
}
