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
  townStones?: Record<string, string>;
  townStonePrice?: number;
  challenger: {
    name: string;
    party: string[];
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
  // The medicine stall also sells the town's evolution stone.
  const stone = SHOPS.townStones?.[town];
  if (stand % SHOPS.stalls.length === 1 && stone && ITEMS[stone]) stock.push({ id: stone, price: SHOPS.townStonePrice ?? 1800 });
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
