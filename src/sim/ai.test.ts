import { describe, expect, it } from 'vitest';
import { decide, partyHpFraction } from './ai';
import type { Trainer } from './entities';
import { Rng } from '../core/rng';

function trainer(x: number, y: number, hp: number): Trainer {
  const m = { hp, maxHp: 100, fainted: hp <= 0 } as Trainer['party'][number];
  return { x, y, alive: true, party: [m], items: [null, null], stats: { catches: 0, knockouts: 0, damage: 0, timeSurvived: 0 } } as unknown as Trainer;
}

const world = (rivals: Trainer[], items: Array<{ x: number; y: number }> = []) => ({
  ground: { reachable: () => true } as never,
  rng: new Rng(3),
  items: items.map((p, i) => ({ id: i, itemId: 'potion', x: p.x, y: p.y, bob: 0 })),
  outposts: [{ x: 0, y: 0 }],
  rivals,
  darkRadius: Infinity,
  centerX: 24,
  centerY: 24,
});

describe('trainer AI', () => {
  it('engages a rival in range, seeks items otherwise, flees under 30% HP', () => {
    const me = trainer(10, 10, 100);
    const foe = trainer(13, 10, 100);
    expect(decide(me, world([foe])).ai).toBe('engage');
    expect(decide(me, world([trainer(30, 30, 100)], [{ x: 12, y: 12 }])).ai).toBe('seekItem');
    expect(decide(me, world([trainer(30, 30, 100)])).ai).toBe('roam');
    const hurt = trainer(10, 10, 20);
    expect(partyHpFraction(hurt)).toBeCloseTo(0.2);
    expect(decide(hurt, world([foe])).ai).toBe('flee');
    expect(decide(hurt, world([])).ai).toBe('heal');
  });
});
