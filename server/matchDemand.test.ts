/** Busier server, fuller lobbies: the minimum and the wait follow how many players are around. */
import { describe, expect, it } from 'vitest';
import { Matchmaker, type Lineup } from './matchmaker';
import type { Peer } from './room';

const peer = (name: string): Peer => ({ key: name, name, send: () => {} });

function setup(demand: { online: number; playing: number }) {
  const started: Lineup[][] = [];
  const mm = new Matchmaker({ size: 10, wait: { casual: 60 }, fullSeconds: 3, minPlayers: 5, lonelySeconds: 150, lonelyMaxSeconds: 300, demand: () => demand, start: (p) => started.push(p) });
  const join = (names: string[], at: number) => { for (const n of names) mm.join({ tickets: [{ peer: peer(n), starter: '0001' }], party: false }, 'casual', at); };
  return { mm, started, join, demand };
}

describe('lobby size that follows demand', () => {
  it('needs only the base five on a quiet server', () => {
    const { mm, started, join } = setup({ online: 6, playing: 0 });
    expect(mm.minPlayers).toBe(5);
    join(['a', 'b', 'c', 'd', 'e'], 0);
    mm.tick(60_000);
    expect(started[0]?.length).toBe(5);
  });

  it('asks for half of those online (at most a full lobby)', () => {
    expect(setup({ online: 14, playing: 6 }).mm.minPlayers).toBe(7);
    expect(setup({ online: 40, playing: 30 }).mm.minPlayers).toBe(10);
  });

  it('holds five players while more are finishing their matches, then starts when enough arrive', () => {
    const { mm, started, join, demand } = setup({ online: 16, playing: 10 });
    join(['a', 'b', 'c', 'd', 'e'], 0);
    mm.tick(60_000);
    mm.tick(200_000);
    expect(started.length).toBe(0); // eight needed, and ten still in matches: worth waiting past 150 s
    join(['f', 'g', 'h'], 210_000);
    demand.playing = 7;
    mm.tick(261_000); // the lobby's next check (each minute): eight are here
    expect(started[0]?.length).toBe(8);
  });

  it('stops waiting for players who are not coming: bots after the base wait when too few are in matches', () => {
    const { mm, started, join } = setup({ online: 16, playing: 1 });
    join(['a', 'b'], 0);
    mm.tick(150_000); // eight needed, six missing, one in a match: the countdown starts at 150 s
    mm.tick(180_100);
    expect(started[0]?.length).toBe(2);
  });

  it('never waits past the longest wait (plus the countdown)', () => {
    const { mm, started, join } = setup({ online: 20, playing: 15 });
    join(['a', 'b', 'c'], 0);
    mm.tick(299_000);
    mm.tick(300_000);
    mm.tick(330_100);
    expect(started[0]?.length).toBe(3);
  });
});
