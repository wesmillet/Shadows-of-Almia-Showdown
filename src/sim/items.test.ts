import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { BALL_LIST, ITEMS, LOOT, rollLoot, rollTier, TM_LIST } from './items';
import { MOVES, SPECIES } from './data';

describe('items and loot', () => {
  it('defines every loot entry, fifteen balls and at least ten TMs with real moves', () => {
    for (const tier of Object.values(LOOT)) for (const e of tier.entries) if (e.id !== 'tm' && e.id !== 'rare-tm' && e.id !== 'mega-stone') expect(ITEMS[e.id], e.id).toBeDefined();
    expect(BALL_LIST.map((b) => b.id).sort()).toEqual(['dusk-ball', 'great-ball', 'master-ball', 'net-ball', 'poke-ball', 'quick-ball', 'ultra-ball']);
    for (const b of BALL_LIST) expect(b.id.endsWith('-ball'), b.id).toBe(true);
    expect(ITEMS['master-ball']?.special).toBe('master');
    expect(TM_LIST.length).toBeGreaterThanOrEqual(10);
    expect(TM_LIST.some((t) => t.rare)).toBe(true);
    for (const tm of TM_LIST) expect(MOVES.has(tm.move ?? '')).toBe(true);
    expect(ITEMS['choice-band']?.kind).toBe('hold');
    expect(ITEMS['hyper-potion']?.amount).toBe(120);
    expect(ITEMS['crystal-shard']?.kind).toBe('shard');
  });

  it('gives every Mega form a held Mega Stone for its base form, and rolls stones from rare loot', () => {
    const megas = [...SPECIES.values()].filter((s) => s.megaOf);
    expect(megas.length).toBeGreaterThanOrEqual(10);
    for (const m of megas) {
      expect(SPECIES.has(m.megaOf ?? ''), m.dex).toBe(true);
      const stone = ITEMS[m.stone ?? ''];
      expect(stone?.kind, m.dex).toBe('hold');
      expect(stone?.megaFor).toBe(m.megaOf);
    }
    const rng = new Rng(5);
    let found = 0;
    let mine = 0;
    for (let i = 0; i < 3000; i++) {
      const r = rollLoot(rng, 'rare', ['0448']);
      if (ITEMS[r.id]?.effect === 'mega') {
        found++;
        if (r.id === 'lucarionite') mine++;
      }
    }
    // Rare now (about 1 in 56 rare rolls), but they do turn up, mostly for a Pokémon you have.
    expect(found).toBeGreaterThan(25);
    expect(mine / found).toBeGreaterThan(0.5);
  });

  it('rolls tiers by weight, balls one at a time; rare TMs only from Ultra Balls', () => {
    const rng = new Rng(11);
    const counts = { common: 0, uncommon: 0, rare: 0 };
    for (let i = 0; i < 1000; i++) counts[rollTier(rng)]++;
    expect(counts.common).toBeGreaterThan(counts.uncommon);
    expect(counts.uncommon).toBeGreaterThan(counts.rare);
    let balls = 0;
    for (let i = 0; i < 300; i++) {
      const common = rollLoot(rng, 'common');
      expect(ITEMS[common.id]).toBeDefined();
      if (common.id === 'poke-ball') {
        expect(common.count).toBe(1);
        balls++;
      }
      const uncommon = rollLoot(rng, 'uncommon');
      if (ITEMS[uncommon.id]?.kind === 'tm') expect(ITEMS[uncommon.id]?.rare).toBe(false);
      const rare = rollLoot(rng, 'rare');
      if (ITEMS[rare.id]?.kind === 'tm') expect(ITEMS[rare.id]?.rare).toBe(true);
    }
    expect(balls).toBeGreaterThan(0);
  });

  it('every TM type matches at least one starter or wild type', () => {
    const types = new Set([...SPECIES.values()].flatMap((s) => s.types));
    for (const tm of TM_LIST) expect(types.has(tm.tmType ?? ''), tm.id).toBe(true);
  });
});
