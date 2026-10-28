import { describe, expect, it } from 'vitest';
import { Matchmaker, type Lineup, type QueueMode } from './matchmaker';
import type { Peer } from './room';

function peer(name: string): Peer & { got: unknown[] } {
  const got: unknown[] = [];
  return { key: name, name, got, send: (m) => got.push(m) };
}

function setup(size = 4) {
  const started: Array<{ players: Lineup[]; mode: QueueMode }> = [];
  const mm = new Matchmaker({ size, wait: { casual: 10 }, fullSeconds: 2, start: (players, mode) => started.push({ players, mode }) });
  return { mm, started };
}

describe('matchmaker', () => {
  it('starts a full lobby after a short beat, and a partial one after the wait', () => {
    const { mm, started } = setup(2);
    mm.join({ tickets: [{ peer: peer('a'), starter: '0001' }], party: false }, 'casual', 0);
    mm.tick(5000);
    expect(started.length).toBe(0);
    mm.join({ tickets: [{ peer: peer('b'), starter: '0004' }], party: false }, 'casual', 5000);
    mm.tick(6000);
    expect(started.length).toBe(0);
    mm.tick(7100);
    expect(started.length).toBe(1);
    mm.join({ tickets: [{ peer: peer('c'), starter: '0007' }], party: false }, 'casual', 8000);
    mm.tick(18_100);
    expect(started[1]?.players.map((p) => p.peer.name)).toEqual(['c']);
  });

  it('keeps a party together as one team, and never splits it', () => {
    const { mm, started } = setup(4);
    mm.join({ tickets: [{ peer: peer('solo1'), starter: '0001' }, ], party: false }, 'casual', 0);
    mm.join({ tickets: [{ peer: peer('solo2'), starter: '0001' }], party: false }, 'casual', 0);
    mm.join({ tickets: [{ peer: peer('p1'), starter: '0001' }, { peer: peer('p2'), starter: '0004' }, { peer: peer('p3'), starter: '0007' }], party: true }, 'casual', 0);
    mm.tick(10_001);
    // The party of three did not fit beside two solos: it waits for its own lobby.
    expect(started[0]?.players.map((p) => p.peer.name)).toEqual(['solo1', 'solo2']);
    mm.tick(20_001);
    const squad = started[1]?.players ?? [];
    expect(squad.map((p) => p.peer.name)).toEqual(['p1', 'p2', 'p3']);
    expect(new Set(squad.map((p) => p.team)).size).toBe(1);
    expect(squad[0]?.team).toBeDefined();
  });

  it('leaving takes the whole party out', () => {
    const { mm } = setup(4);
    mm.join({ tickets: [{ peer: peer('p1'), starter: '0001' }, { peer: peer('p2'), starter: '0004' }], party: true }, 'casual', 0);
    expect(mm.leave('p2').map((p) => p.name)).toEqual(['p1', 'p2']);
    expect(mm.has('p1')).toBe(false);
  });

  it('waits for half the lobby to be real players before starting with bots', () => {
    const started: Array<unknown> = [];
    const mm = new Matchmaker({ size: 8, wait: { casual: 10 }, fullSeconds: 2, start: (players) => started.push(players) });
    for (const k of ['a', 'b', 'c']) mm.join({ tickets: [{ peer: peer(k), starter: '0001' }], party: false }, 'casual', 0);
    mm.startNow('a', 0);
    mm.tick(60_000);
    expect(started.length).toBe(0);
    mm.join({ tickets: [{ peer: peer('d'), starter: '0001' }], party: false }, 'casual', 60_000);
    mm.tick(60_000 + 11_000);
    expect(started.length).toBe(1);
  });

  it('never lets the countdown or Start now go below four real players in an eight-player lobby', () => {
    const started: Array<Lineup[]> = [];
    const mm = new Matchmaker({ size: 8, wait: { casual: 10 }, fullSeconds: 2, start: (players) => started.push(players) });
    const peers = ['a', 'b', 'c', 'd'].map(peer);
    for (const p of peers) mm.join({ tickets: [{ peer: p, starter: '0001' }], party: false }, 'casual', 0);
    // Four are in: Start now counts down from two seconds...
    mm.startNow('a', 1000);
    // ...but one leaves before it fires: back to waiting, and the others are told how many are missing.
    mm.leave('d');
    mm.tick(3500);
    expect(started.length).toBe(0);
    const last = peers[0]?.got.at(-1) as { need: number; min: number; startsIn: number | null };
    expect(last.need).toBe(1);
    expect(last.min).toBe(4);
    expect(last.startsIn).toBeNull();
    // Start now does nothing below the minimum, and neither does the wait running out.
    mm.startNow('a', 4000);
    mm.tick(120_000);
    expect(started.length).toBe(0);
    mm.join({ tickets: [{ peer: peer('e'), starter: '0001' }], party: false }, 'casual', 120_000);
    mm.startNow('e', 120_000);
    mm.tick(122_100);
    expect(started[0]?.length).toBe(4);
  });

  it('ten-trainer lobbies need five real players; an administrator may start alone, nobody else may', () => {
    const started: Array<Lineup[]> = [];
    const admins = new Set(['wes']);
    const mm = new Matchmaker({ size: 10, wait: { casual: 10 }, fullSeconds: 2, start: (players) => started.push(players), isAdmin: (p) => admins.has(p.key) });
    expect(mm.minPlayers).toBe(5);
    // An ordinary player alone: Start now (even if the client claims to be an admin) does nothing.
    const other = peer('bob');
    mm.join({ tickets: [{ peer: other, starter: '0001' }], party: false }, 'casual', 0);
    mm.startNow('bob', 0);
    mm.tick(60_000);
    expect(started.length).toBe(0);
    expect((other.got.at(-1) as { admin?: boolean }).admin).toBeUndefined();
    mm.leave('bob');
    // The administrator alone: their lobby message offers it, and their start goes ahead.
    const wes = peer('wes');
    mm.join({ tickets: [{ peer: wes, starter: '0001' }], party: false }, 'casual', 61_000);
    expect((wes.got.at(-1) as { admin?: boolean; need: number }).admin).toBe(true);
    mm.startNow('wes', 61_000, true);
    mm.tick(63_100);
    expect(started.length).toBe(1);
    expect(started[0]?.map((x) => x.peer.name)).toEqual(['wes']);
    // With others queued too, everyone in the lobby comes along.
    const pals = ['p1', 'p2'].map(peer);
    mm.join({ tickets: [{ peer: wes, starter: '0001' }], party: false }, 'casual', 70_000);
    for (const q of pals) mm.join({ tickets: [{ peer: q, starter: '0001' }], party: false }, 'casual', 70_000);
    mm.startNow('wes', 70_000, true);
    mm.tick(72_100);
    expect(started[1]?.map((x) => x.peer.name).sort()).toEqual(['p1', 'p2', 'wes']);
  });
});
