import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { pickStrong, weightedPicks, type StrongPool } from './spawning';
import { SPAWNS, SPECIES } from './data';

describe('rotation picks', () => {
  it('never repeats a species and favours the heavier entries', () => {
    const rng = new Rng(3);
    const pool = [{ dex: 'a', weight: 4 }, { dex: 'b', weight: 4 }, { dex: 'c', weight: 1.2 }, { dex: 'd', weight: 1.2 }];
    let rare = 0;
    for (let i = 0; i < 4000; i++) {
      const picks = weightedPicks(rng, pool, 2);
      expect(new Set(picks.map((p) => p.dex)).size).toBe(2);
      rare += picks.filter((p) => p.weight < 2).length;
    }
    // Two picks from 4+4+1.2+1.2: well under half of them rare.
    expect(rare / 8000).toBeLessThan(0.3);
    expect(weightedPicks(rng, pool, 9).length).toBe(4);
  });
});

describe('stronger encounters', () => {
  const strong = (SPAWNS as unknown as { strong: { pools: Record<string, StrongPool>; pseudoChance: number; count: Record<string, number> } }).strong;

  it('picks the pseudo-legendary category 10% of the time, split evenly in the desert', () => {
    const rng = new Rng(11);
    const counts = new Map<string, number>();
    const N = 40_000;
    for (let i = 0; i < N; i++) {
      const [r] = pickStrong(rng, strong.pools.desert as StrongPool, 1, strong.pseudoChance);
      counts.set(r?.dex ?? '', (counts.get(r?.dex ?? '') ?? 0) + 1);
    }
    const share = (d: string) => (counts.get(d) ?? 0) / N;
    expect(share('0248') + share('0445')).toBeCloseTo(0.1, 1);
    expect(share('0248')).toBeCloseTo(0.05, 1);
    expect(share('0445')).toBeCloseTo(0.05, 1);
    // Iron Treads is the rarer of the ordinary desert candidates.
    expect(share('0990')).toBeLessThan(share('0208'));
  });

  it('has no forest pseudo-legendary yet, and never repeats a species in one land', () => {
    expect(strong.pools.forest?.pseudo.length).toBe(0);
    const rng = new Rng(5);
    for (let i = 0; i < 500; i++) {
      const picks = pickStrong(rng, strong.pools.snow as StrongPool, 3, strong.pseudoChance);
      expect(new Set(picks.map((p) => p.dex)).size).toBe(3);
    }
  });

  it('uses only known species, at least one per land, with count odds that add up', () => {
    for (const pool of Object.values(strong.pools)) for (const r of [...pool.candidates, ...pool.pseudo]) expect(SPECIES.has(r.dex), r.dex).toBe(true);
    const total = Object.values(strong.count).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(Math.min(...Object.keys(strong.count).map(Number))).toBe(1);
  });
});
