import { describe, expect, it } from 'vitest';
import { starterReels, starterChoices, tierOf } from './starters';

describe('slots 1 and 2 roll from the whole PC', () => {
  const pc = ['0001', '0004', '0007', '0025', '0133', '0147'];
  it('picks two different PC Pokémon for the first two slots, every card from the PC', () => {
    for (let seed = 1; seed < 200; seed++) {
      const reels = starterReels(seed, [], pc);
      const [a, b] = [reels[0]!.pick.dex, reels[1]!.pick.dex];
      expect(pc).toContain(a);
      expect(pc).toContain(b);
      expect(a).not.toBe(b);
      for (const r of reels.slice(0, 2)) for (const c of r.cards) expect(pc).toContain(c.dex);
    }
  });
  it('falls back to Commons with no PC, and fills from Commons when the PC has one species', () => {
    const none = starterChoices(42, [], []);
    expect(tierOf(none[0]!)).toBe(tierOf(starterChoices(42)[0]!));
    expect(none).toEqual(starterChoices(42));
    for (let seed = 1; seed < 50; seed++) {
      const one = starterChoices(seed, [], ['0147']);
      expect(new Set(one.slice(0, 2)).size).toBe(2);
    }
  });
  it('is the same for the same seed (server and browser agree)', () => {
    expect(starterChoices(7, ['0133'], pc)).toEqual(starterChoices(7, ['0133'], pc));
  });
});
