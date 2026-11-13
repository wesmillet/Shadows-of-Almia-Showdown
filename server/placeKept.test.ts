/**
 * A player's place is where they went out. The room's results used to work it out again when the
 * room closed (once the last player was out), so everyone out earlier got the last player's place:
 * mostly 2nd, which also counted as a top-3 finish for the starter unlocks.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Room } from './room';

describe('places', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));

  it('keeps the place each player went out in', () => {
    const sent: Record<string, Array<{ t: string; place?: number }>> = { a: [], b: [] };
    const peer = (k: 'a' | 'b', name: string) => ({ key: `g-place-${k}`, name, send: (m: { t: string; place?: number }) => sent[k]!.push(m) });
    let report: { results: Array<{ name: string; place: number }>; trainers: Array<{ name: string; place: number }> } | null = null;
    const room = new Room(world, [{ name: 'Early', starter: '0004', peer: peer('a', 'Early') }, { name: 'Late', starter: '0007', peer: peer('b', 'Late') }], 6, 7, { rareChest: false } as never, (_r: unknown, rep: typeof report) => {
      report = rep;
    }, { mode: 'casual' });
    const m = room.match;
    const [early, late] = [m.seats[0]!.trainer, m.seats[1]!.trainer];
    // Out first, of six: 6th.
    m.eliminate(early);
    room.step();
    expect(sent.a!.find((x) => x.t === 'end')?.place).toBe(6);
    // Bots go until one is left with the other player, who then goes out 2nd.
    const bots = m.trainers.filter((t) => t.alive && t !== early && t !== late && !t.visitor && !t.challenger);
    for (const t of bots.slice(1)) {
      m.eliminate(t);
      room.step();
    }
    m.eliminate(late);
    for (let i = 0; i < 50 && !report; i++) room.step();
    expect(sent.b!.find((x) => x.t === 'end')?.place).toBe(2);
    expect(report).not.toBeNull();
    const r = report!;
    expect(r.results.find((x) => x.name === 'Early')?.place).toBe(6);
    expect(r.results.find((x) => x.name === 'Late')?.place).toBe(2);
    expect(r.trainers.find((x) => x.name === 'Early')?.place).toBe(6);
  });
});

describe('the winner of a room that closes early', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));

  it('is nobody when several computer trainers are still standing', () => {
    let report: { winner: string | null } | null = null;
    const peer = { key: 'g-early-close', name: 'Solo', send: () => {} };
    const room = new Room(world, [{ name: 'Solo', starter: '0004', peer }], 6, 7, { rareChest: false } as never, (_r: unknown, rep: typeof report) => {
      report = rep;
    }, { mode: 'casual' });
    room.match.eliminate(room.match.seats[0]!.trainer);
    for (let i = 0; i < 50 && !report; i++) room.step();
    expect(report).not.toBeNull();
    expect(report!.winner).toBe('Nobody');
  });
});
