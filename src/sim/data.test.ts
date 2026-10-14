import { describe, expect, it } from 'vitest';
import { effectiveness, SPECIES, statsAtLevel, TYPE_CHART } from './data';
import spawns from '../../data/spawns.json';

describe('type chart', () => {
  it('has all 18 types with symmetric coverage', () => {
    expect(TYPE_CHART.types).toHaveLength(18);
    for (const t of TYPE_CHART.types) expect(TYPE_CHART.colors[t]).toBeDefined();
    expect(effectiveness('water', ['fire'])).toBe(2);
    expect(effectiveness('electric', ['ground'])).toBe(0);
    expect(effectiveness('fire', ['water', 'grass'])).toBe(1);
    expect(effectiveness('dragon', ['fairy'])).toBe(0);
  });
});

describe('species data', () => {
  it('only uses known types and spawn tables reference known species', () => {
    for (const s of SPECIES.values()) {
      for (const t of s.types) expect(TYPE_CHART.types).toContain(t);
      expect(s.moves.length).toBe(4);
    }
    for (const biome of Object.values(spawns.biomes)) {
      for (const row of biome.table) expect(SPECIES.has(row.dex)).toBe(true);
    }
    for (const dex of spawns.starterPool) expect(SPECIES.has(dex)).toBe(true);
  });

  it('computes level stats', () => {
    const s = statsAtLevel({ hp: 35, atk: 55, def: 40, spa: 50, spd: 50, spe: 90 }, 15);
    expect(s.hp).toBe(35);
    expect(s.atk).toBe(21);
  });
});
