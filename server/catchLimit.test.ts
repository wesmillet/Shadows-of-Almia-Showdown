/** Two balls thrown at once with room for one more Pokémon can never make a party of seven. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { partySize } from '../src/sim/entities';

describe('party limit while balls are in the air', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));

  it('the second quick throw waits, and a catch never overfills the party', () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(3), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 0 });
    const p = m.seats[0]!.trainer;
    m.items = [];
    m.darkness.radius = m.darkness.targetRadius = 999; m.darkness.nextPulseIn = 1e9;
    p.party = ['0004', '0007', '0001', '0025', '0133'].map((d) => m.makeMon(d, 10, p, p.x, p.y));
    for (const x of p.party) x.stowed = true;
    const wild = (dx: number) => { const w = m.makeMon('0399', 3, null, p.x + dx, p.y + 1.5); w.wild = true; m.wilds = [...m.wilds, w]; return w; };
    m.wilds = [];
    const a = wild(-1), b = wild(1);
    p.items = p.items.map(() => null);
    p.items[0] = { id: 'master-ball', count: 2 };
    expect(m.throwBall(p, 0, { x: a.x, y: a.y }, a)).toBe(true);
    // A second ball before the first has landed: refused, the party has room for only one.
    expect(m.throwBall(p, 0, { x: b.x, y: b.y }, b)).toBe(false);
    expect(p.items[0]?.count).toBe(1);
    for (let i = 0; i < 60 * 8; i++) m.step(1 / 60);
    expect(partySize(p)).toBe(6);
    // Now full: no more throws.
    expect(m.throwBall(p, 0, { x: b.x, y: b.y }, b)).toBe(false);
    expect(partySize(p)).toBeLessThanOrEqual(m.partyCap);
  });
});
