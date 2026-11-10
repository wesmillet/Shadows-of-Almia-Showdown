/**
 * Two reported exploits/glitches: a flyer sat out the endgame (no one could challenge it) while the
 * darkness and Darkrai finished everyone else; and a ball that hit a wild just before a teammate
 * knocked it out still "caught" it, putting a fainted 0 HP Pokémon on the team.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';

describe('endgame flying and fainted catches', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  const make = (rivals: number) => {
    const m = new Match({ ground: world.ground(), rng: new Rng(5), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals });
    m.darkness.radius = m.darkness.targetRadius = 999; m.darkness.nextPulseIn = 1e9;
    return m;
  };

  it('a flyer lands when its fly bar runs out and takes off again only after a rest', () => {
    const m = make(11);
    const p = m.seats[0]!.trainer;
    p.party = [m.makeMon('0330', 45, p, p.x, p.y)];
    for (const x of p.party) x.stowed = true;
    const fc = Match.flyConfig();
    m.toggleRide();
    expect(p.mount?.fly).toBe(true);
    m.step(1 / 60);
    expect(p.flyLeft!).toBeLessThan(fc.seconds);
    p.flyLeft = 0.05;
    for (let i = 0; i < 10; i++) m.step(1 / 60);
    expect(p.mount).toBeNull();
    expect(m.toggleRide()).toMatch(/tired/);
    p.flyLeft = fc.seconds * fc.takeOffAt - 0.05;
    for (let i = 0; i < 10; i++) m.step(1 / 60);
    m.toggleRide();
    expect(p.mount?.fly).toBe(true);
  });

  it('a 1 HP wild struck by a ball cannot be knocked out before it closes (and is caught healthy)', () => {
    const m = make(0);
    const p = m.seats[0]!.trainer;
    p.party = [m.makeMon('0004', 30, p, p.x, p.y)];
    const w = m.makeMon('0208', 48, null, p.x + 1, p.y + 1.5);
    w.wild = true; w.landBoss = true; w.hp = 1; w.everHit = true;
    m.wilds = [w];
    p.items = p.items.map(() => null);
    p.items[0] = { id: 'master-ball', count: 1 };
    expect(m.throwBall(p, 0, { x: w.x, y: w.y }, w)).toBe(true);
    for (let i = 0; i < 60 * 8; i++) m.step(1 / 60);
    const caught = p.party.find((x) => x.dex === '0208');
    expect(caught).toBeTruthy();
    expect(caught!.fainted).toBe(false);
    expect(caught!.hp).toBeGreaterThan(0);
  });
});
