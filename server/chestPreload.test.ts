/** A player's saved chest is loaded when the match starts, so it shows the first time they open it. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Room } from './room';

describe('storage chest at the start of a match', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));

  it('is loaded before the player touches it', () => {
    const key = 'u5';
    const hooks = { rareChest: false, chestLoad: () => [{ id: 'potion', count: 3 }], chestSave: () => {} };
    const room = new Room(world, [{ name: 'Keeper', starter: '0004', peer: { key, name: 'Keeper', send: () => {} } }], 4, 7, hooks as never, () => {}, { mode: 'casual' });
    const t = room.match.seats[0]!.trainer;
    expect(t.storage?.[0]).toEqual({ id: 'potion', count: 3 });
  });
});
