import { describe, expect, it } from 'vitest';
import { levelFactor } from './catching';

describe('balls against higher levels', () => {
  it('go by the Pokémon\'s own level: full strength to 20, 2% less a level, at least 25%', () => {
    expect(levelFactor(15)).toBe(1);
    expect(levelFactor(20)).toBe(1);
    expect(levelFactor(40)).toBeCloseTo(0.6);
    expect(levelFactor(60)).toBe(0.25);
  });
});
