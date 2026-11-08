import { describe, expect, it } from 'vitest';
import { catchChance } from './catching';
import type { Mon } from './entities';

const mon = (dex: string, hpFrac: number, status: string | null = null) => ({ dex, maxHp: 100, hp: 100 * hpFrac, status } as unknown as Mon);

describe('Lugia is much harder to catch', () => {
  it('never better than 8% a ball, even at 1 HP, asleep, in an Ultra Ball', () => {
    expect(catchChance(mon('0249', 0.01, 'sleep'), 2)).toBeLessThanOrEqual(0.08);
    // Quick Ball on a fresh Lugia: was 60%.
    expect(catchChance(mon('0249', 1), 5)).toBeLessThan(0.07);
    expect(catchChance(mon('0249', 1), 1)).toBe(0.012);
    // A Master Ball still works; other Pokemon are unchanged.
    expect(catchChance(mon('0249', 1), Infinity)).toBe(1);
    expect(catchChance(mon('0399', 0.01, 'sleep'), 2)).toBe(0.98);
  });
});
