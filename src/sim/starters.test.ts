import { describe, expect, it } from 'vitest';
import { BASE_TIERS, lineBase, poolSize, poolTiers, starterChoices, STARTER_TIERS, tierOf, unlockedFromPc } from './starters';

describe('starter pool', () => {
  const basePool = STARTER_TIERS.filter((t) => BASE_TIERS.includes(t.id)).flatMap((t) => t.dex);

  it('a new player rolls only from the base tiers', () => {
    expect(poolSize()).toBe(basePool.length);
    for (let seed = 1; seed < 200; seed++) {
      const c = starterChoices(seed);
      expect(new Set(c).size).toBe(3);
      for (const d of c) expect(basePool).toContain(d);
    }
  });

  it('a kept Pokémon unlocks the first form of its line, in its tier', () => {
    expect(lineBase('0445')).toBe('0443'); // Garchomp -> Gible
    expect(lineBase('0448-mega')).toBe('0447'); // Mega Lucario -> Riolu
    expect(unlockedFromPc(['0445', '0006', '0025'])).toEqual(['0004', '0443']); // Pikachu is already in the base pool
    expect(tierOf('0443')).toBe('epic');
    expect(tierOf('0004')).toBe('rare');
    const tiers = poolTiers(['0443']);
    expect(tiers.find((t) => t.id === 'epic')?.dex).toEqual(['0443']);
  });

  it('legendaries join as Mythic starters', () => {
    expect(tierOf(lineBase('0888') as string)).toBe('mythic');
  });

  it('the same seed and pool roll the same three (server and browser agree)', () => {
    const pool = unlockedFromPc(['0445', '0006', '0888', '0094']);
    for (let seed = 1; seed < 50; seed++) expect(starterChoices(seed, pool)).toEqual(starterChoices(seed, [...pool]));
  });
});
