/** Scheduled matches: one every few minutes on the clock, whoever is in, up to twelve players. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { Matchmaker, type Lineup } from './matchmaker';
import { loadWorld, createMatch } from './world';
import type { Peer } from './room';

const sent = new Map<string, Array<Record<string, unknown>>>();
const peer = (name: string): Peer => ({ key: name, name, send: (m) => { const a = sent.get(name) ?? []; a.push(m as Record<string, unknown>); sent.set(name, a); } });
const T0 = Date.parse('2026-11-08T23:00:00Z'); // on a slot

function setup() {
  const started: Array<{ players: Lineup[]; rules: { bots: boolean; size: number } }> = [];
  const mm = new Matchmaker({ size: 10, seats: 12, everySeconds: 360, wait: { casual: 60 }, fullSeconds: 3, minPlayers: 5, start: (players, _m, rules) => started.push({ players, rules }) });
  const add = (names: string[], at: number) => { for (const n of names) mm.join({ tickets: [{ peer: peer(n), starter: '0001' }], party: false }, 'casual', at); };
  return { mm, started, add };
}

describe('scheduled matches', () => {
  it('starts on the clock with whoever is in, even one player, bots filling to ten', () => {
    const { mm, started, add } = setup();
    add(['solo'], T0 + 60_000);
    const last = sent.get('solo')?.at(-1);
    expect(last?.at).toBe(T0 + 360_000);
    expect(last?.startsIn).toBe(300);
    mm.tick(T0 + 359_000);
    expect(started.length).toBe(0);
    mm.tick(T0 + 360_000);
    expect(started[0]?.players.length).toBe(1);
    expect(started[0]?.rules).toEqual({ bots: true, size: 10 });
  });

  it('takes up to twelve, then the next slot; twelve real players play with no bots', () => {
    const { mm, started, add } = setup();
    add(Array.from({ length: 14 }, (_, i) => `p${i}`), T0 + 10_000);
    expect(sent.get('p13')?.at(-1)?.at).toBe(T0 + 720_000);
    mm.tick(T0 + 360_000);
    expect(started[0]?.players.length).toBe(12);
    expect(started[0]?.rules).toEqual({ bots: false, size: 12 });
    mm.tick(T0 + 720_000);
    expect(started[1]?.players.map((p) => p.peer.name)).toEqual(['p12', 'p13']);
  });

  it('does not offer a slot a few seconds away', () => {
    const { add } = setup();
    add(['late'], T0 + 357_000);
    expect(sent.get('late')?.at(-1)?.at).toBe(T0 + 720_000);
  });

  it('a party stays together in one match', () => {
    const { mm, started, add } = setup();
    add(Array.from({ length: 11 }, (_, i) => `s${i}`), T0);
    mm.join({ tickets: [{ peer: peer('a'), starter: '0001' }, { peer: peer('b'), starter: '0004' }], party: true }, 'casual', T0);
    mm.tick(T0 + 360_000);
    mm.tick(T0 + 720_000);
    expect(started[0]?.players.length).toBe(11);
    expect(started[1]?.players.map((p) => p.peer.name)).toEqual(['a', 'b']);
  });

  it('players cannot start it early; leaving frees the seat', () => {
    const { mm, started, add } = setup();
    add(['x', 'y'], T0);
    mm.startNow('x', T0 + 1000);
    mm.tick(T0 + 5000);
    expect(started.length).toBe(0);
    mm.leave('y');
    mm.tick(T0 + 360_000);
    expect(started[0]?.players.map((p) => p.peer.name)).toEqual(['x']);
  });

  it('a twelve-trainer match can be made', async () => {
    const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
    const humans = Array.from({ length: 12 }, (_, i) => ({ name: `H${i}`, starter: '0001' }));
    const m = createMatch(world, humans, 12, 5, { bots: false } as never);
    expect(m.seats.length).toBe(12);
    const spots = new Set(m.seats.map((s) => `${Math.round(s.trainer.x)},${Math.round(s.trainer.y)}`));
    expect(spots.size).toBe(12);
  }, 60_000);
});

describe('a quiet server brings the next match forward', () => {
  const make = (running: { n: number }) => {
    const started: Lineup[][] = [];
    const mm = new Matchmaker({ size: 10, seats: 12, everySeconds: 360, wait: { casual: 60 }, fullSeconds: 3, running: () => running.n, start: (p) => { started.push(p); running.n++; } });
    const add = (n: string, at: number) => mm.join({ tickets: [{ peer: peer(n), starter: '0001' }], party: false }, 'casual', at);
    return { mm, started, add };
  };

  it('every 2 minutes with nothing running, every 3 with one, every 6 with two', () => {
    const r = { n: 0 };
    const { add } = make(r);
    add('q0', T0 + 10_000);
    expect(sent.get('q0')?.at(-1)?.at).toBe(T0 + 120_000);
    r.n = 1;
    const b = make(r); b.add('q1', T0 + 10_000);
    expect(sent.get('q1')?.at(-1)?.at).toBe(T0 + 180_000);
    r.n = 2;
    const c = make(r); c.add('q2', T0 + 10_000);
    expect(sent.get('q2')?.at(-1)?.at).toBe(T0 + 360_000);
  });

  it('does not move a start up with under 30 s of notice', () => {
    const r = { n: 2 };
    const { mm, add } = make(r);
    add('v', T0 + 10_000);
    r.n = 1;
    mm.tick(T0 + 160_000); // 3:00 is only 20 s away: keeps 6:00
    expect(sent.get('v')?.at(-1)?.at).toBe(T0 + 360_000);
  });

  it('moves a waiting lobby up when a match ends, with notice, never back', () => {
    const r = { n: 2 };
    const { mm, started, add } = make(r);
    add('w', T0 + 10_000);
    expect(sent.get('w')?.at(-1)?.at).toBe(T0 + 360_000);
    r.n = 1; // a match ended at 2:20: the 3:00 mark is 40 s away, enough notice
    mm.tick(T0 + 140_000);
    expect(sent.get('w')?.at(-1)?.at).toBe(T0 + 180_000);
    r.n = 2;
    mm.tick(T0 + 160_000);
    expect(sent.get('w')?.at(-1)?.at).toBe(T0 + 180_000);
    mm.tick(T0 + 180_000);
    expect(started.length).toBe(1);
  });
});
