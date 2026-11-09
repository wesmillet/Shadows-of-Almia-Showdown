import { describe, expect, it } from 'vitest';
import { quickBonus } from './catching';

const ctx = (target: number, team: number[]) => ({
  target: { level: target } as never,
  thrower: { party: team.map((level) => ({ level, fainted: false })) } as never,
  matchTime: 0, inWater: false, inDark: false,
});

describe('Quick Ball against higher levels', () => {
  it('is x5 up to 10 levels above the team, then eases to x2.5 at 30 above', () => {
    expect(quickBonus(ctx(30, [20, 12]) as never)).toBe(5);
    expect(quickBonus(ctx(40, [20]) as never)).toBeCloseTo(3.75);
    expect(quickBonus(ctx(50, [20]) as never)).toBe(2.5);
    expect(quickBonus(ctx(80, [20]) as never)).toBe(2.5);
  });
});
