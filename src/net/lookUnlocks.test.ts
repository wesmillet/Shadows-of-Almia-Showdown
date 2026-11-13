/** The three earned looks: lab coat at 25 wins, old man at 50 wins, orange Ranger at 50 Pokémon in the PC. */
import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, canWear, isShownLook, lookRequirement } from './progression';

const earnedFor = (life: { wins: number }, pc: number) =>
  ACHIEVEMENTS.filter((a) => a.check({ match: null, life: { matches: 0, catches: 0, knockouts: 0, damage: 0, ...life }, level: 1, pc })).map((a) => a.id);

describe('earned looks', () => {
  it('are on offer and each needs its achievement', () => {
    for (const look of ['union_05', 'civ_09', 'union_06']) {
      expect(isShownLook(look)).toBe(true);
      expect(lookRequirement(look)?.achievement).toBeTruthy();
      expect(canWear(look, 1, [])).toBe(false);
    }
  });
  it('lab coat at 25 wins, old man at 50 wins', () => {
    expect(canWear('union_05', 1, earnedFor({ wins: 24 }, 0))).toBe(false);
    expect(canWear('union_05', 1, earnedFor({ wins: 25 }, 0))).toBe(true);
    expect(canWear('civ_09', 1, earnedFor({ wins: 49 }, 0))).toBe(false);
    expect(canWear('civ_09', 1, earnedFor({ wins: 50 }, 0))).toBe(true);
  });
  it('orange Ranger at 50 Pokémon in the PC', () => {
    expect(canWear('union_06', 1, earnedFor({ wins: 0 }, 49))).toBe(false);
    expect(canWear('union_06', 1, earnedFor({ wins: 0 }, 50))).toBe(true);
  });
});
