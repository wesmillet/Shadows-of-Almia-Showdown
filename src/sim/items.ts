/** Item definitions, TMs and the loot tiers from data/items/. */
import itemsJson from '../../data/items/items.json';
import tmsJson from '../../data/items/tms.json';
import lootJson from '../../data/items/loot.json';
import type { Rng } from '../core/rng';
import { MOVES } from './data';

export type HeldEffect = 'regen' | 'sash' | 'choice-band' | 'life-orb' | 'type-boost';

export interface ItemDef {
  id: string;
  name: string;
  short: string;
  kind: 'ball' | 'heal' | 'revive' | 'cure' | 'boost' | 'hold' | 'tm' | 'styler';
  tier?: number;
  amount?: number;
  fraction?: number;
  stat?: 'atk' | 'def' | 'spe';
  stages?: number;
  effect?: HeldEffect;
  boostType?: string;
  /** TMs: the move taught, and the type whose disc icon to show. */
  move?: string;
  tmType?: string;
  stack?: number;
}

export type LootTier = 'common' | 'uncommon' | 'rare';

export const ITEMS: Record<string, ItemDef> = {};
for (const it of (itemsJson as { items: ItemDef[] }).items) ITEMS[it.id] = it;
for (const tm of (tmsJson as { tms: Array<{ id: string; move: string }> }).tms) {
  const mv = MOVES.get(tm.move);
  if (!mv) continue;
  ITEMS[tm.id] = { id: tm.id, name: `TM ${mv.name}`, short: 'TM', kind: 'tm', move: tm.move, tmType: mv.type };
}
export const ITEM_LIST: ItemDef[] = Object.values(ITEMS);
export const TM_LIST: ItemDef[] = ITEM_LIST.filter((i) => i.kind === 'tm');

interface LootEntry {
  id: string;
  weight: number;
}
interface LootTierDef {
  weight: number;
  ball: 'poke' | 'great' | 'ultra';
  entries: LootEntry[];
}
export const LOOT = (lootJson as { tiers: Record<LootTier, LootTierDef> }).tiers;
export const LOOT_TIERS: LootTier[] = ['common', 'uncommon', 'rare'];

/** Goes in the second bag tab (held items and TMs). */
export function isGear(itemId: string): boolean {
  const k = ITEMS[itemId]?.kind;
  return k === 'hold' || k === 'tm';
}

export function rollTier(rng: Rng): LootTier {
  return rng.weighted(LOOT_TIERS, (t) => LOOT[t].weight);
}

/** Rolls the contents of an item ball of a tier. */
export function rollLoot(rng: Rng, tier: LootTier): string {
  const entry = rng.weighted(LOOT[tier].entries, (e) => e.weight);
  if (entry.id === 'tm') return rng.pick(TM_LIST).id;
  return entry.id;
}

/** Which tier an item would normally come from (for balls dropped with known contents). */
export function tierOf(itemId: string): LootTier {
  if (ITEMS[itemId]?.kind === 'tm') return 'uncommon';
  for (const t of LOOT_TIERS) if (LOOT[t].entries.some((e) => e.id === itemId)) return t;
  return 'common';
}

export function ballOfTier(tier: LootTier): 'poke' | 'great' | 'ultra' {
  return LOOT[tier].ball;
}
