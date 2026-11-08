/** Rare items are capped in the storage chest: what does not fit stays in the bag. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match, chestCap } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import type { InventorySlot } from '../src/sim/entities';

describe('storage chest caps', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));

  it('Rare Candy stops at 10, vouchers at 3, a Mega Stone at 1; big old stacks stay but take no more', () => {
    expect(chestCap('rare-candy')).toBe(10);
    expect(chestCap('extraction-voucher')).toBe(3);
    expect(chestCap('charizardite-x')).toBe(1);
    expect(chestCap('poke-ball')).toBe(9999);
    const m = new Match({ ground: world.ground(), rng: new Rng(5), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 0, keepsResults: true } as never);
    const p = m.seats[0]!.trainer;
    let saved: Array<InventorySlot | null> = [];
    m.chestStore = { load: () => [{ id: 'extraction-voucher', count: 9 }], save: (_t, box) => { saved = box.map((e) => (e ? { ...e } : null)); } };
    p.items = p.items.map(() => null);
    p.items[0] = { id: 'rare-candy', count: 14 };
    p.items[1] = { id: 'extraction-voucher', count: 1 };
    expect(m.deposit(p, 'items', 0)).toMatch('at most 10');
    expect(p.items[0]?.count).toBe(4);
    expect(saved.find((e) => e?.id === 'rare-candy')?.count).toBe(10);
    expect(m.deposit(p, 'items', 0)).toMatch('at most 10');
    expect(p.items[0]?.count).toBe(4);
    // Already 9 vouchers stored before the cap: kept, but no more go in.
    expect(m.deposit(p, 'items', 1)).toMatch('at most 3');
    expect(p.items[1]?.count).toBe(1);
    expect(m.storageOf(p).find((e) => e?.id === 'extraction-voucher')?.count).toBe(9);
  });
});
