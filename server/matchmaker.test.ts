import { describe, expect, it } from 'vitest';
import { Matchmaker, type Lineup, type QueueMode } from './matchmaker';
import type { Peer } from './room';

function peer(name: string): Peer & { got: unknown[] } {
  const got: unknown[] = [];
  return { key: name, name, got, send: (m) => got.push(m) };
}

function setup(size = 4) {
  const started: Array<{ players: Lineup[]; mode: QueueMode }> = [];
  const mm = new Matchmaker({ size, wait: { casual: 10, ranked: 30 }, fullSeconds: 2, start: (players, mode) => started.push({ players, mode }) });
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

  it('matches ranked players by rating, widening with time', () => {
    const { mm, started } = setup(2);
    mm.join({ tickets: [{ peer: peer('low'), starter: '0001', rating: 1200 }], party: false }, 'ranked', 0);
    mm.join({ tickets: [{ peer: peer('high'), starter: '0001', rating: 1800 }], party: false }, 'ranked', 0);
    expect(mm.waiting.ranked).toBe(2);
    mm.tick(3000);
    expect(started.length).toBe(0);
    // A 1300 joins the low lobby at once; a 1650 is too far from the high one until it has waited.
    mm.join({ tickets: [{ peer: peer('near'), starter: '0001', rating: 1300 }], party: false }, 'ranked', 3000);
    mm.tick(5100);
    expect(started[0]?.players.map((p) => p.peer.name).sort()).toEqual(['low', 'near']);
    expect(started[0]?.mode).toBe('ranked');
  });

  it('keeps casual and ranked apart', () => {
    const { mm, started } = setup(2);
    mm.join({ tickets: [{ peer: peer('a'), starter: '0001' }], party: false }, 'casual', 0);
    mm.join({ tickets: [{ peer: peer('b'), starter: '0001', rating: 1500 }], party: false }, 'ranked', 0);
    mm.tick(3000);
    expect(started.length).toBe(0);
    expect(mm.waiting).toEqual({ casual: 1, ranked: 1 });
  });
});
