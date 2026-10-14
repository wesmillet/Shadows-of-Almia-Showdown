import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { ballKind, catchChance, newThrow, rollCatch, stepThrow, targetVisual, type Throw, type ThrowPhase } from './catching';
import type { Mon, Trainer } from './entities';

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

describe('throw sequence', () => {
  it('flies, hits, absorbs, drops, wobbles and clicks', () => {
    const th = newThrow({} as Trainer, { x: 0, y: 0 }, { x: 2, y: 0 }, 'great-ball', 1.5);
    expect(ballKind(th.ballId)).toBe('great');
    const seen: string[] = [];
    let landed = false;
    for (let i = 0; i < 60 * 8 && th.phase !== 'done'; i++) {
      const ev = stepThrow(th, 1 / 60);
      if (ev === 'landed') {
        landed = true;
        th.target = mon(10, 50);
        th.roll = { chance: 0.9, caught: true, wobbles: 3 };
        th.phase = 'hit';
        th.phaseT = 0;
      } else if (ev) seen.push(ev);
      if (th.phase === 'absorb' && th.phaseT > 0.15) {
        const v = targetVisual(th);
        expect(v.scale).toBeLessThan(0.6);
        expect(v.alpha).toBeLessThan(0.6);
      }
    }
    expect(landed).toBe(true);
    expect(seen).toEqual(['absorb', 'drop', 'wobble', 'click', 'done']);
    expect(th.wobblesDone).toBe(3);
  });

  it('bursts open after a failed roll', () => {
    const th: Throw = newThrow({} as Trainer, { x: 0, y: 0 }, { x: 1, y: 0 }, 'poke-ball', 1);
    th.target = mon(50, 50);
    th.roll = { chance: 0.2, caught: false, wobbles: 1 };
    th.phase = 'hit' as ThrowPhase;
    const seen: string[] = [];
    for (let i = 0; i < 60 * 5 && (th.phase as ThrowPhase) !== 'done'; i++) {
      const ev = stepThrow(th, 1 / 60);
      if (ev) seen.push(ev);
    }
    expect(seen).toEqual(['absorb', 'drop', 'wobble', 'burst', 'done']);
  });
});
