import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { ballKind, ballModifier, ballWobble, catchChance, newThrow, rollCatch, stepThrow, targetVisual, WOBBLE_RADIANS, type CatchContext, type Throw, type ThrowPhase } from './catching';
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

  it('applies each ball\'s rule where it lands', () => {
    const target = { hp: 50, maxHp: 100, status: null, level: 15, dex: '0403', types: ['electric'] } as unknown as Mon;
    const ctx = (over: Partial<CatchContext> = {}): CatchContext => ({
      target, thrower: { party: [] } as unknown as Trainer, matchTime: 200, inWater: false, inDark: false, ...over,
    });
    expect(ballModifier('poke-ball', ctx())).toBe(1);
    expect(ballModifier('great-ball', ctx())).toBe(1.5);
    expect(ballModifier('ultra-ball', ctx())).toBe(2);
    expect(ballModifier('master-ball', ctx())).toBe(Infinity);
    expect(catchChance(target, Infinity)).toBe(1);
    expect(rollCatch(new Rng(1), target, Infinity)).toMatchObject({ caught: true, wobbles: 3 });
    expect(ballModifier('net-ball', ctx())).toBe(1);
    expect(ballModifier('net-ball', ctx({ target: { ...target, types: ['water'] } as Mon }))).toBe(3);
    expect(ballModifier('dusk-ball', ctx({ inDark: true }))).toBe(3);
    expect(ballModifier('quick-ball', ctx({ matchTime: 30 }))).toBe(5);
    expect(ballModifier('quick-ball', ctx({ matchTime: 200 }))).toBe(1);
    expect(ballKind('quick-ball')).toBe('quick');
  });

  it('wobbles by at most 20 degrees', () => {
    const th = newThrow({} as Trainer, { x: 0, y: 0 }, { x: 1, y: 0 }, 'poke-ball');
    th.phase = 'wobble';
    let peak = 0;
    for (let k = 0; k < 1; k += 0.01) {
      th.phaseT = k * 0.55;
      peak = Math.max(peak, Math.abs(ballWobble(th)));
    }
    expect(peak).toBeLessThanOrEqual(WOBBLE_RADIANS + 1e-9);
    expect(peak).toBeGreaterThan(WOBBLE_RADIANS * 0.8);
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
    const th = newThrow({} as Trainer, { x: 0, y: 0 }, { x: 2, y: 0 }, 'great-ball');
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
    const th: Throw = newThrow({} as Trainer, { x: 0, y: 0 }, { x: 1, y: 0 }, 'poke-ball');
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
