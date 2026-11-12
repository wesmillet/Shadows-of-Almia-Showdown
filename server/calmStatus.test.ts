/** The invincible-Pokémon glitch (a calmed Pokémon caught stayed calm for good) and status knockouts. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';

describe('calm and status knockouts', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  const setup = () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(7), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 0 });
    const p = m.seats[0]!.trainer;
    m.items = [];
    m.wilds = [];
    m.darkness.radius = m.darkness.targetRadius = 999;
    m.darkness.nextPulseIn = 1e9;
    return { m, p };
  };

  it('a released Pokémon caught straight back can fight and be hit', () => {
    const { m, p } = setup();
    p.party = ['0004', '0025'].map((d) => m.makeMon(d, 10, p, p.x, p.y));
    const pika = p.party[1]!;
    m.release(1);
    expect(pika.calm).toBeGreaterThan(0);
    p.items = p.items.map(() => null);
    p.items[0] = { id: 'master-ball', count: 1 };
    expect(m.throwBall(p, 0, { x: pika.x, y: pika.y }, pika)).toBe(true);
    for (let i = 0; i < 60 * 8 && !p.party.includes(pika); i++) m.step(1 / 60);
    expect(p.party).toContain(pika);
    expect(pika.calm ?? 0).toBe(0);
    const foe = m.makeMon('0399', 5, null, p.x + 2, p.y);
    foe.wild = true;
    expect(m.battle.isEnemy(pika, foe)).toBe(true);
    expect(m.battle.isEnemy(foe, pika)).toBe(true);
  });

  it('a team member with calm left over is still everyone else\'s enemy', () => {
    const { m, p } = setup();
    const mine = p.party[0]!;
    mine.calm = 1e6;
    const foe = m.makeMon('0399', 5, null, p.x + 2, p.y);
    foe.wild = true;
    expect(m.battle.isEnemy(mine, foe)).toBe(true);
    // A calmed wild one is still nobody's enemy.
    foe.calm = 5;
    expect(m.battle.isEnemy(mine, foe)).toBe(false);
  });

  it("a team worn out by a wild Pokémon's poison goes down and comes back, not out", () => {
    const { m, p } = setup();
    const lead = p.party[0]!;
    const wild = m.makeMon('0399', 5, null, p.x + 30, p.y + 30);
    wild.wild = true;
    m.battle.applyStatus(lead, 'poison', wild);
    lead.hp = 1;
    for (let i = 0; i < 60 * 4 && !lead.fainted; i++) m.step(1 / 60);
    expect(lead.fainted).toBe(true);
    for (let i = 0; i < 60 * 3; i++) m.step(1 / 60);
    expect(p.alive).toBe(true);
    expect(p.downUntil).not.toBeNull();
  });
});
