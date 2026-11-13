/** Darkrai's base form closes in by blinking, and never strays from the crystal. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import type { Mon } from '../src/sim/entities';

describe('darkrai blink', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  it('blinks toward the nearest trainer and stays within 4 tiles of the crystal', () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(8), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 0 });
    const x = m as unknown as { spawnDarkrai(): void; stepDarkrai(d: Mon, dt: number): void; darkrai: Mon };
    const p = m.seats[0]!.trainer;
    x.spawnDarkrai();
    const d = x.darkrai;
    d.busy = 999;
    const lead = p.party[0]!;
    lead.stowed = false;
    p.x = lead.x = m.centerX - 6;
    p.y = lead.y = m.centerY + 1.6;
    let blinks = 0;
    for (let i = 0; i < 200; i++) {
      m.battle.events.length = 0;
      x.stepDarkrai(d, 0.02);
      blinks += m.battle.events.filter((e) => e.type === 'darkrai-blink').length;
      expect(Math.hypot(d.x - m.centerX, d.y - m.centerY)).toBeLessThanOrEqual(4.01);
    }
    expect(blinks).toBeGreaterThanOrEqual(1);
    expect(d.x).toBeLessThan(m.centerX);
  });
});
