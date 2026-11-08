/** Healing items have a cooldown in a battle, and none outside one. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';

describe('healing item cooldown', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  it('10 s between Potions in a battle; any time outside one', () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(3), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 0, keepsResults: true } as never);
    const p = m.seats[0]!.trainer;
    const mon = p.party[0]!;
    p.items = p.items.map(() => null);
    p.items[0] = { id: 'potion', count: 9 };
    mon.hp = 1;
    expect(m.useItem(p, 0, 0)).toMatch('recovered');
    mon.hp = 1;
    expect(m.useItem(p, 0, 0)).toMatch('recovered');
    p.duelId = 7;
    mon.hp = 1;
    expect(m.useItem(p, 0, 0)).toMatch('recovered');
    mon.hp = 1;
    expect(m.useItem(p, 0, 0)).toMatch(/Wait 10 s/);
    expect(p.items[0]?.count).toBe(6);
    m.time += 10.1;
    expect(m.useItem(p, 0, 0)).toMatch('recovered');
  });
});
