/** The storage chest: five slots, one kept between games, with rare items capped; old ten-slot chests can only be emptied. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match, chestCap } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import type { InventorySlot } from '../src/sim/entities';

describe('storage chest', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  const setup = (stored: InventorySlot[]) => {
    const m = new Match({ ground: world.ground(), rng: new Rng(5), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 0, keepsResults: true } as never);
    const p = m.seats[0]!.trainer;
    const out = { saved: [] as Array<InventorySlot | null> };
    m.chestStore = { load: () => stored, save: (_t, box) => { out.saved = box.map((e) => (e ? { ...e } : null)); } };
    p.items = p.items.map(() => null);
    return { m, p, out };
  };

  it('caps: Rare Candy 10, vouchers 3, a Mega Stone 1', () => {
    expect(chestCap('rare-candy')).toBe(10);
    expect(chestCap('extraction-voucher')).toBe(3);
    expect(chestCap('charizardite-x')).toBe(1);
    expect(chestCap('poke-ball')).toBe(9999);
  });

  it('five slots: the first is kept between games, the other four last this match', () => {
    const { m, p, out } = setup([]);
    expect(m.storageOf(p).length).toBe(5);
    expect(p.storageKeep).toBe(1);
    p.items[0] = { id: 'rare-candy', count: 14 };
    p.items[1] = { id: 'potion', count: 2 };
    p.items[2] = { id: 'poke-ball', count: 5 };
    expect(m.deposit(p, 'items', 0)).toMatch('at most 10');
    expect(p.items[0]?.count).toBe(4);
    expect(out.saved).toEqual([{ id: 'rare-candy', count: 10 }]);
    expect(m.deposit(p, 'items', 1)).toMatch('this match only');
    expect(m.deposit(p, 'items', 2)).toMatch('this match only');
    // Only the kept slot is saved.
    expect(out.saved).toEqual([{ id: 'rare-candy', count: 10 }]);
    expect(m.storageOf(p).filter(Boolean).length).toBe(3);
    expect(m.withdraw(p, 0)).toMatch('Took');
    expect(out.saved).toEqual([null]);
    p.items[3] = { id: 'super-potion', count: 1 };
    expect(m.deposit(p, 'items', 3)).toMatch('kept between games');
    expect(out.saved).toEqual([{ id: 'super-potion', count: 1 }]);
  });

  it('an old ten-slot chest keeps its items, shrinks as it is emptied, and new items go to the match slots', () => {
    const { m, p, out } = setup([{ id: 'extraction-voucher', count: 9 }, { id: 'potion', count: 3 }, { id: 'rare-candy', count: 40 }]);
    expect(m.storageOf(p).length).toBe(7);
    p.items[0] = { id: 'potion', count: 1 };
    expect(m.deposit(p, 'items', 0)).toMatch('this match only');
    expect(m.withdraw(p, 1)).toMatch('Took');
    expect(out.saved).toEqual([{ id: 'extraction-voucher', count: 9 }, { id: 'rare-candy', count: 40 }]);
    expect(m.withdraw(p, 0)).toMatch('Took');
    expect(out.saved).toEqual([{ id: 'rare-candy', count: 40 }]);
    expect(m.withdraw(p, 0)).toMatch('Took');
    expect(out.saved).toEqual([null]);
    p.items[1] = { id: 'poke-ball', count: 2 };
    expect(m.deposit(p, 'items', 1)).toMatch('kept between games');
  });
});
