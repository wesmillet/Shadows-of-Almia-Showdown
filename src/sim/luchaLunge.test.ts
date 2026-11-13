/** Pikachu Libre's own move: a high, slamming leap it learns at Lv 30. */
import { describe, expect, it } from 'vitest';
import { move, species } from './data';

describe('Lucha Lunge', () => {
  it('is a 90-power Fighting leap that goes higher than a normal slam', () => {
    const m = move('lucha-lunge');
    expect(m.type).toBe('fighting');
    expect(m.power).toBe(90);
    expect(m.category).toBe('physical');
    expect(m.leap).toBe(true);
    expect(m.leapHeight ?? 1).toBeGreaterThan(1);
  });
  it('only Pikachu Libre learns it, at level 30', () => {
    expect(species('0025-libre').learnset).toContainEqual([30, 'lucha-lunge']);
    expect(species('0025').learnset?.some(([, id]) => id === 'lucha-lunge')).toBe(false);
  });
});
