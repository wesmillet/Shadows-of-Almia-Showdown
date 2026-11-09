import { describe, expect, it } from 'vitest';
import { quickBonus } from './catching';

const ctx = (target: number, team: number[]) => ({
  target: { level: target } as never,
  thrower: { party: team.map((level) => ({ level, fainted: false })) } as never,
  matchTime: 0, inWater: false, inDark: false,
});

describe('Quick Ball against higher levels', () => {
  it('is x5 up to 5 levels above the team, then falls to x1 at 20 above', () => {
    expect(quickBonus(ctx(25, [20, 12]) as never)).toBe(5);
    expect(quickBonus(ctx(32, [20]) as never)).toBeCloseTo(5 - (4 * 7) / 15);
    expect(quickBonus(ctx(40, [20]) as never)).toBe(1);
    expect(quickBonus(ctx(70, [20]) as never)).toBe(1);
  });
});
