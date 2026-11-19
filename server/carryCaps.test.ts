/** Healing items have a most-you-can-carry (config items.carryCaps). */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match, carryCap } from '../src/sim/match';
import { Rng } from '../src/core/rng';

describe('carry caps', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  const mk = () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(3), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 0, keepsResults: true } as never);
    const p = m.seats[0]!.trainer;
    p.items = p.items.map(() => null);
    return { m, p };
  };
  it('stops at the cap, all or nothing, and giveUpTo takes what fits', () => {
    const { m, p } = mk();
    const cap = carryCap('hyper-potion');
    expect(cap).toBeLessThan(Infinity);
    expect(m.giveItem(p, 'hyper-potion', cap)).toBe(true);
    expect(m.giveItem(p, 'hyper-potion', 1)).toBe(false);
    p.items = p.items.map(() => null);
    expect(m.giveUpTo(p, 'hyper-potion', cap + 5)).toBe(cap);
    expect(m.carryRoom(p, 'hyper-potion')).toBe(0);
    expect(carryCap('poke-ball')).toBe(Infinity);
  });
  it('a shop refuses past the cap without charging', () => {
    const { m, p } = mk();
    m.giveItem(p, 'max-revive', carryCap('max-revive'));
    p.money = 99999;
    const shop = { stock: [{ id: 'max-revive', price: 100 }] } as never;
    expect(m.buy(shop, 0, p)).toMatch('at most');
    expect(p.money).toBe(99999);
  });
});
