/** Item definitions from data/items.json. */
import itemsJson from '../../data/items.json';

export interface ItemDef {
  id: string;
  name: string;
  short: string;
  kind: 'ball' | 'heal' | 'revive' | 'cure' | 'boost' | 'hold' | 'styler';
  tier?: number;
  amount?: number;
  fraction?: number;
  stat?: 'atk' | 'def';
  stages?: number;
  effect?: 'regen' | 'sash';
  weight: number;
  stack?: number;
  /** TMs: the move type whose disc icon to show. */
  tmType?: string;
  icon?: { shape: 'ball' | 'bottle' | 'badge' | 'sash' | 'styler'; color: string; accent?: string };
}

export const ITEMS: Record<string, ItemDef> = {};
for (const it of (itemsJson as { items: ItemDef[] }).items) ITEMS[it.id] = it;
export const ITEM_LIST: ItemDef[] = Object.values(ITEMS);
