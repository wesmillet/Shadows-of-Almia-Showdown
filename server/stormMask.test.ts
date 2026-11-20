/** The Storm Mask: one to a trainer (and one in the chest), one sold a match, never handed on. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match, carryCap } from '../src/sim/match';
import { Rng } from '../src/core/rng';

describe('storm mask', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  const mk = () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(3), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }, { name: 'Q', starters: ['0007'] }], rivals: 0, keepsResults: true } as never);
    const p = m.seats[0]!.trainer;
    const q = m.seats[1]!.trainer;
    for (const t of [p, q]) t.items = t.items.map(() => null);
    return { m, p, q };
  };
  it('carries one at most, and the merchant sells one a match', () => {
    const { m, p, q } = mk();
    expect(carryCap('storm-mask')).toBe(1);
    p.money = q.money = 99999;
    const shop = { stock: [{ id: 'storm-mask', price: 5000, left: 1 }] } as never;
    expect(m.buy(shop, 0, p)).toMatch('Bought');
    expect(m.buy(shop, 0, p)).toMatch('sold out');
    expect(m.buy(shop, 0, q)).toMatch('sold out');
    expect(q.money).toBe(99999);
    expect(m.giveItem(p, 'storm-mask', 1)).toBe(false);
  });
  it('can be kept between games, one at most', () => {
    const { m, p } = mk();
    m.giveItem(p, 'storm-mask', 1);
    const slot = p.items.findIndex((e) => e?.id === 'storm-mask');
    expect(m.deposit(p, 'items', slot)).toMatch('Stored Storm Mask');
    m.giveItem(p, 'storm-mask', 1);
    const again = p.items.findIndex((e) => e?.id === 'storm-mask');
    expect(m.deposit(p, 'items', again)).toMatch('at most 1');
  });
});
