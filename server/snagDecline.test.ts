/** Turning the Snag Machine down (Esc) reaches the server, so the offer does not come back. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Room } from './room';

describe('declining the Snag Machine online', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));

  it('clears the offer on the server', () => {
    const key = 'g1';
    const room = new Room(world, [{ name: 'Snagger', starter: '0004', peer: { key, name: 'Snagger', send: () => {} } }], 4, 99, { rareChest: false } as never, () => {}, { mode: 'casual' });
    const m = room.match;
    const seat = m.seats[0]!;
    const foe = m.allTrainers.find((t) => t !== seat.trainer)!;
    seat.snagOffer = { from: foe };
    room.receive(key, { t: 'cmd', c: 'snagNo', a: [] });
    expect(seat.snagOffer).toBeNull();
  });
});
