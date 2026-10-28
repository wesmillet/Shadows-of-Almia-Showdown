/** Item definitions, TMs and the loot tiers from data/items/. */
import itemsJson from '../../data/items/items.json';
import tmsJson from '../../data/items/tms.json';
import lootJson from '../../data/items/loot.json';
import type { Rng } from '../core/rng';
import type { InventorySlot } from './entities';
import { MOVES, SPECIES, canLearnTm } from './data';

export type HeldEffect = 'regen' | 'sash' | 'choice-band' | 'life-orb' | 'type-boost' | 'exp-share' | 'lucky-egg' | 'mega';

/** Ball rules beyond a flat modifier (see ballModifier in catching.ts). */
export type BallSpecial = 'master' | 'net' | 'dive' | 'nest' | 'repeat' | 'timer' | 'dusk' | 'heal' | 'quick';

/** Sprite names in assets/items/balls/manifest.json. */
export type BallKind =
  | 'poke' | 'great' | 'ultra' | 'master' | 'net' | 'dive' | 'nest' | 'repeat'
  | 'timer' | 'luxury' | 'premier' | 'dusk' | 'heal' | 'quick' | 'cherish';

export interface ItemDef {
  id: string;
  name: string;
  short: string;
  kind: 'ball' | 'heal' | 'revive' | 'cure' | 'boost' | 'hold' | 'tm' | 'styler' | 'candy' | 'stone' | 'voucher' | 'rod' | 'charm';
  /** Balls: base catch modifier. */
  tier?: number;
  special?: BallSpecial;
  desc?: string;
  amount?: number;
  fraction?: number;
  stat?: 'atk' | 'def' | 'spe';
  stages?: number;
  effect?: HeldEffect;
  boostType?: string;
  /** TMs: the move taught, the type whose disc icon to show, and whether only Ultra Ball loot has it. */
  move?: string;
  tmType?: string;
  rare?: boolean;
  stack?: number;
  /** Mega Stones: the base dex that Mega Evolves holding it. */
  megaFor?: string;
}

export type LootTier = 'common' | 'uncommon' | 'rare';

export const ITEMS: Record<string, ItemDef> = {};
for (const it of (itemsJson as { items: ItemDef[] }).items) ITEMS[it.id] = it;
for (const tm of (tmsJson as { tms: Array<{ id: string; move: string; rare?: boolean }> }).tms) {
  const mv = MOVES.get(tm.move);
  if (!mv) continue;
  ITEMS[tm.id] = { id: tm.id, name: `TM ${mv.name}`, short: 'TM', kind: 'tm', move: tm.move, tmType: mv.type, rare: !!tm.rare };
}
export const ITEM_LIST: ItemDef[] = Object.values(ITEMS);
export const TM_LIST: ItemDef[] = ITEM_LIST.filter((i) => i.kind === 'tm');
export const BALL_LIST: ItemDef[] = ITEM_LIST.filter((i) => i.kind === 'ball');

interface LootEntry {
  id: string;
  weight: number;
  count?: number;
}
interface LootTierDef {
  weight: number;
  ball: BallKind;
  entries: LootEntry[];
}
export const LOOT = (lootJson as { tiers: Record<LootTier, LootTierDef> }).tiers;
export const LOOT_TIERS: LootTier[] = ['common', 'uncommon', 'rare'];

/** Goes in the second bag tab (held items and TMs). */
export function isGear(itemId: string): boolean {
  const k = ITEMS[itemId]?.kind;
  return k === 'hold' || k === 'tm';
}

/** Sprite name for a ball item id (poke-ball -> poke); other items are not balls. */
export function ballKindOf(itemId: string): BallKind {
  return itemId.replace(/-ball$/, '') as BallKind;
}

export function rollTier(rng: Rng): LootTier {
  return rng.weighted(LOOT_TIERS, (t) => LOOT[t].weight);
}

/** Rolls the contents of an item ball of a tier: one stack. */
export function rollLoot(rng: Rng, tier: LootTier, party: string[] = []): InventorySlot {
  const entry = rng.weighted(LOOT[tier].entries, (e) => e.weight);
  if (entry.id === 'mega-stone') {
    // A Mega Stone: usually one for a Pokémon the finder has, when they have one that can use it.
    const stones = ITEM_LIST.filter((i) => i.effect === 'mega');
    const mine = stones.filter((i) => i.megaFor && party.includes(i.megaFor));
    const pool = mine.length && rng.chance(0.6) ? mine : stones;
    if (pool.length) return { id: rng.pick(pool).id, count: 1 };
    return { id: 'rare-candy', count: 1 };
  }
  if (entry.id === 'tm' || entry.id === 'rare-tm') {
    const pool = TM_LIST.filter((t) => !!t.rare === (entry.id === 'rare-tm'));
    // Usually one the finder's team can use (like Mega Stones): a TM nobody in the party can learn is dead weight.
    const usable = pool.filter((t) => party.some((dex) => {
      const sp = SPECIES.get(dex);
      return !!sp && !!t.move && canLearnTm(sp, t.move);
    }));
    const from = usable.length && rng.chance(0.65) ? usable : pool.length ? pool : TM_LIST;
    return { id: rng.pick(from).id, count: 1 };
  }
  return { id: entry.id, count: entry.count ?? 1 };
}

export function ballOfTier(tier: LootTier): BallKind {
  return LOOT[tier].ball;
}
