/** Updates are spread over three steps (a third of the players on each), each player still every third step. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Room } from './room';

describe('spread updates', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));

  it('sends each player one update per three steps, a third of them on each step, with every event', () => {
    const got = new Map<string, Array<{ t: string; e?: unknown[] }>>();
    const entries = Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, starter: '0004', peer: { key: `k${i}`, name: `P${i}`, send: (m: { t: string }) => { const a = got.get(`k${i}`) ?? []; a.push(m); got.set(`k${i}`, a); } } }));
    const room = new Room(world, entries as never, 6, 3, { rareChest: false, extracted: () => {} } as never, () => {}, { mode: 'casual' });
    const updates = () => [...got.values()].map((a) => a.filter((m) => m.t === 's').length);
    for (let i = 0; i < 60; i++) room.step();
    const before = updates();
    expect(before.every((n) => n === 20)).toBe(true);
    // One step: two of the six players get theirs.
    room.step();
    const after = updates();
    expect(after.reduce((a, b) => a + b, 0) - before.reduce((a, b) => a + b, 0)).toBe(2);
    // An event raised now reaches every player within the next three steps.
    room.match.battle.events.push({ type: 'notice', text: 'hello all', seconds: 1 } as never);
    for (let i = 0; i < 3; i++) room.step();
    for (const a of got.values()) expect(a.some((m) => m.t === 's' && JSON.stringify(m.e).includes('hello all'))).toBe(true);
  }, 60_000);
});
