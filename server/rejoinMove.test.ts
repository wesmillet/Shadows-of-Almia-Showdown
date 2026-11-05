/** Reloading the page mid-match: the new page numbers its input frames from 1 again and still moves. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Room } from './room';

describe('moving after a reload', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));

  it('takes the new page input frames', () => {
    const key = 'g-rejoin-player-1';
    const peer = { key, name: 'Mover', send: () => {} };
    const room = new Room(world, [{ name: 'Mover', starter: '0004', peer }], 4, 7, { rareChest: false } as never, () => {}, { mode: 'casual' });
    const seat = room.match.seats[0]!;
    // The first page sent a few hundred frames.
    room.receive(key, { t: 'in', f: [[500, 0, 0]] } as never);
    room.step();
    expect(seat.ack).toBe(500);
    room.disconnect(key);
    room.rejoin({ ...peer });
    const t = seat.trainer;
    const x0 = t.x;
    for (let n = 1; n <= 40; n++) {
      room.receive(key, { t: 'in', f: [[n, 1, 0]] } as never);
      room.step();
    }
    expect(seat.ack).toBe(40);
    expect(Math.abs(t.x - x0)).toBeGreaterThan(0.5);
  });
});
