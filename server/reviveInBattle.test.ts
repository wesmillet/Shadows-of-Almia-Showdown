/** A Pokémon revived during a trainer battle waits in its ball; outside one it comes out beside the trainer. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';

describe('revive in a trainer battle', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  const setup = () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(3), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004', '0007'] }], rivals: 0, keepsResults: true } as never);
    const p = m.seats[0]!.trainer;
    p.items = p.items.map(() => null);
    p.items[0] = { id: 'revive', count: 3 };
    const down = p.party[1]!;
    down.fainted = true;
    down.hp = 0;
    return { m, p, down };
  };
  it('stays in its ball during a battle, out of reach of wild Pokémon and the darkness', () => {
    const { m, p, down } = setup();
    p.duelId = 7;
    expect(m.useItem(p, 0, 1)).toMatch('revived');
    expect(down.fainted).toBe(false);
    expect(down.stowed).toBe(true);
    expect([...m.mons()]).not.toContain(down);
  });
  it('comes out beside the trainer outside a battle', () => {
    const { m, p, down } = setup();
    expect(m.useItem(p, 0, 1)).toMatch('revived');
    expect(down.fainted).toBe(false);
    expect(!!down.stowed).toBe(false);
  });
});
