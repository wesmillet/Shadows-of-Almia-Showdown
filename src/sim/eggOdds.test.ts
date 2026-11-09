import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { rollEgg, lineBase, nominationBase } from './starters';

describe('daily Egg odds and first stages', () => {
  it('hatches a Mythic about 2% of the time, never a Common', () => {
    const rng = new Rng(11);
    const n = 40000;
    const count: Record<string, number> = {};
    for (let i = 0; i < n; i++) { const t = rollEgg(rng).tier.id; count[t] = (count[t] ?? 0) + 1; }
    expect(count.common ?? 0).toBe(0);
    expect((count.mythic ?? 0) / n).toBeGreaterThan(0.015);
    expect((count.mythic ?? 0) / n).toBeLessThan(0.025);
  });
  it('starts Slaking, Tinkaton, Scizor, Kleavor, Musharna and Cofagrigus lines at their first stage', () => {
    expect(lineBase('0289')).toBe('0287');
    expect(lineBase('0959')).toBe('0957');
    expect(lineBase('0212')).toBe('0123');
    expect(lineBase('0900')).toBe('0123');
    expect(nominationBase('0518')).toBe('0517');
    expect(nominationBase('0563')).toBe('0562');
  });
});
