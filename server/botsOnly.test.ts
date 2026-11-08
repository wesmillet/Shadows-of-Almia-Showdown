/** A match with only computer trainers left in it closes: nobody is there to play or watch it. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Room } from './room';

describe('a match left to the bots', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  const hooks = { rareChest: false, chestLoad: () => null, chestSave: () => {}, extracted: () => {} };
  const make = () => {
    const peer = (key: string) => ({ key, name: key, send: () => {} });
    return new Room(world, [{ name: 'A', starter: '0004', peer: peer('u1') }, { name: 'B', starter: '0007', peer: peer('u2') }], 6, 11, hooks as never, () => {}, { mode: 'casual' });
  };
  const run = (room: Room, seconds: number) => {
    for (let i = 0; i < seconds * 60 && !room.closed; i++) room.step();
  };

  it('closes when every human has left', () => {
    const room = make();
    run(room, 1);
    room.receive('u1', { t: 'leave' } as never);
    run(room, 1);
    expect(room.closed).toBe(false);
    room.receive('u2', { t: 'leave' } as never);
    run(room, 1);
    expect(room.closed).toBe(true);
  });

  it('closes when every human is knocked out', () => {
    const room = make();
    run(room, 1);
    for (const s of room.match.seats) room.match.eliminate(s.trainer);
    run(room, 1);
    expect(room.closed).toBe(true);
  });

  it('closes soon after every human has disconnected, without waiting out the reconnect window', () => {
    const room = make();
    run(room, 1);
    room.disconnect('u1');
    room.disconnect('u2');
    run(room, 20);
    expect(room.closed).toBe(true);
  });

  it('keeps going while one human is still connected', () => {
    const room = make();
    run(room, 1);
    room.disconnect('u1');
    run(room, 20);
    expect(room.closed).toBe(false);
  });
});
