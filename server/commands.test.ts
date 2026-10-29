/**
 * Party commands as the server runs them for an online player: a behaviour change reaches the
 * server's Pokémon (it used to change only on the player's screen, so a "Passive" Pokémon kept
 * attacking), and an item dragged onto a party card is used on that Pokémon.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { runCommand } from './commands';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';

describe('party commands', () => {
  it('behaviour and items on a chosen Pokémon', async () => {
    const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
    const m = new Match({ ground: world.ground(), rng: new Rng(3), sprites: world.sprites }, [], { humans: [{ name: 'A', starters: ['0004'] }, { name: 'B', starters: ['0007'] }], rivals: 0 });
    const seat = m.seats[0]!;
    const p = seat.trainer;
    p.party.push(m.makeMon('0025', 10, p, p.x + 1, p.y));
    const [lead, second] = p.party as [NonNullable<(typeof p.party)[0]>, NonNullable<(typeof p.party)[0]>];

    // Attack -> Catch -> Passive on the server's own copy
    expect(lead.behavior).toBe('aggressive');
    runCommand(m, seat, 'behavior', [0]);
    expect(lead.behavior).toBe('catch');
    runCommand(m, seat, 'behavior', [0]);
    expect(lead.behavior).toBe('passive');
    expect(second.behavior).toBe('aggressive');

    // A potion dropped on the second Pokémon heals it, not the lead
    lead.hp = 5;
    second.hp = 5;
    p.items[0] = { id: 'potion', count: 1 };
    expect(runCommand(m, seat, 'useItem', [0, 1])).toContain(second.name);
    expect(second.hp).toBeGreaterThan(5);
    expect(lead.hp).toBe(5);
    // No target: the lead, as before
    p.items[0] = { id: 'potion', count: 1 };
    runCommand(m, seat, 'useItem', [0]);
    expect(lead.hp).toBeGreaterThan(5);
    // A potion on a fainted Pokémon does nothing and is kept
    second.fainted = true;
    second.hp = 0;
    p.items[0] = { id: 'potion', count: 1 };
    expect(runCommand(m, seat, 'useItem', [0, 1])).toBe(`${second.name} has fainted`);
    expect(p.items[0]?.count).toBe(1);
  }, 60_000);
});
