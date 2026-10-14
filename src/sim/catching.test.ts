import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { catchChance, rollCatch } from './catching';
import type { Mon } from './entities';

const mon = (hp: number, maxHp: number, status: Mon['status'] = null): Mon => ({ hp, maxHp, status }) as Mon;

describe('catchChance', () => {
  it('rises as HP drops, with status and ball tier', () => {
    expect(catchChance(mon(100, 100), 1)).toBeCloseTo(0.12);
    expect(catchChance(mon(10, 100), 1)).toBeGreaterThan(0.7);
    expect(catchChance(mon(50, 100), 2)).toBeGreaterThan(catchChance(mon(50, 100), 1));
    expect(catchChance(mon(80, 100, 'sleep'), 1)).toBeCloseTo(catchChance(mon(80, 100), 1) * 2);
    expect(catchChance(mon(1, 100, 'sleep'), 2)).toBeLessThanOrEqual(0.98);
  });

  it('wobbles one to three times and always three on a catch', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 200; i++) {
      const r = rollCatch(rng, mon(30, 100), 1.5);
      expect(r.wobbles).toBeGreaterThanOrEqual(1);
      expect(r.wobbles).toBeLessThanOrEqual(3);
      if (r.caught) expect(r.wobbles).toBe(3);
    }
  });
});
