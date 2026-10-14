import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { ITEMS, LOOT, rollLoot, rollTier, TM_LIST, tierOf } from './items';
import { MOVES, SPECIES } from './data';

describe('items and loot', () => {
  it('defines every loot entry and at least ten TMs with real moves', () => {
    for (const tier of Object.values(LOOT)) for (const e of tier.entries) if (e.id !== 'tm') expect(ITEMS[e.id], e.id).toBeDefined();
    expect(TM_LIST.length).toBeGreaterThanOrEqual(10);
    for (const tm of TM_LIST) expect(MOVES.has(tm.move ?? '')).toBe(true);
    expect(ITEMS['choice-band']?.kind).toBe('hold');
    expect(ITEMS['hyper-potion']?.amount).toBe(120);
  });

  it('rolls tiers by weight and contents from the tier', () => {
    const rng = new Rng(11);
    const counts = { common: 0, uncommon: 0, rare: 0 };
    for (let i = 0; i < 1000; i++) counts[rollTier(rng)]++;
    expect(counts.common).toBeGreaterThan(counts.uncommon);
    expect(counts.uncommon).toBeGreaterThan(counts.rare);
    for (let i = 0; i < 50; i++) {
      const id = rollLoot(rng, 'rare');
      expect(ITEMS[id]).toBeDefined();
      expect(['rare', 'uncommon']).toContain(tierOf(id));
    }
  });

  it('every TM type matches at least one starter or wild type', () => {
    const types = new Set([...SPECIES.values()].flatMap((s) => s.types));
    for (const tm of TM_LIST) expect(types.has(tm.tmType ?? ''), tm.id).toBe(true);
  });
});
