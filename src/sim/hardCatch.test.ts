import { describe, expect, it } from 'vitest';
import { catchChance, tooStrongForBalls } from './catching';
import type { Mon } from './entities';

const mon = (dex: string, hpFrac: number, status: string | null = null) => ({ dex, maxHp: 100, hp: 100 * hpFrac, status } as unknown as Mon);

describe('Lugia is much harder to catch', () => {
  it('never better than 4% a ball, even at 1 HP, asleep, in an Ultra Ball', () => {
    expect(catchChance(mon('0249', 0.01, 'sleep'), 2)).toBeLessThanOrEqual(0.04);
    // Quick Ball on a fresh Lugia: was 60%, then 6%.
    expect(catchChance(mon('0249', 1), 5)).toBeLessThan(0.035);
    expect(catchChance(mon('0249', 1), 1)).toBe(0.01);
    // A Master Ball is sure (balls can only be thrown at Lugia below 10%: see ballBelow).
    expect(catchChance(mon('0249', 0.05), Infinity)).toBe(1);
    expect(tooStrongForBalls(mon('0249', 0.11))).toBe(true);
    expect(tooStrongForBalls(mon('0249', 0.09))).toBe(false);
    expect(tooStrongForBalls(mon('0399', 1))).toBe(false);
    // Other Pokemon are unchanged.
    expect(catchChance(mon('0399', 1), Infinity)).toBe(1);
    expect(catchChance(mon('0399', 0.01, 'sleep'), 2)).toBe(0.98);
  });
});
