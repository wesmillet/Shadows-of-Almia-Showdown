/** A trainer wiped out by wild Pokémon comes back at an outpost, and at the centre only as a last resort. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';

describe('respawn spot', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  const make = () => new Match({ ground: world.ground(), rng: new Rng(3), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 0, keepsResults: true } as never) as unknown as {
    seats: Array<{ trainer: { x: number; y: number } }>; outposts: Array<{ x: number; y: number; cost?: number }>; down(t: object): void; respawn(t: object): void; isDark(x: number, y: number): boolean;
  };

  it('skips the centre healer even when it is the nearest', () => {
    const m = make();
    const centre = m.outposts.find((o) => o.cost);
    expect(centre).toBeTruthy();
    const t = m.seats[0]!.trainer;
    t.x = centre!.x;
    t.y = centre!.y + 2;
    m.down(t);
    m.respawn(t);
    expect(Math.hypot(t.x - centre!.x, t.y - centre!.y)).toBeGreaterThan(20);
  });

  it('uses the centre healer when every other outpost is in the dark', () => {
    const m = make();
    const centre = m.outposts.find((o) => o.cost)!;
    m.isDark = (x: number, y: number) => Math.hypot(x - centre.x, y - centre.y) > 10;
    const t = m.seats[0]!.trainer;
    m.down(t);
    m.respawn(t);
    expect(Math.hypot(t.x - centre.x, t.y - centre.y)).toBeLessThan(6);
  });
});
