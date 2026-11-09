/**
 * The last two trainers' battle moves to the Shadow Crystal, the darkness stops where it is, and
 * if the crystal had not shattered yet it never does (no Darkrai).
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';

describe('final battle at the crystal', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  it('moves the last two to the crystal and holds the darkness', () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(9), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 1 });
    const p = m.seats[0]!.trainer;
    const r = m.trainers.find((t) => !t.visitor && !t.challenger)!;
    p.party = [m.makeMon('0006', 40, p, p.x, p.y)];
    r.party = [m.makeMon('0009', 40, r, r.x, r.y)];
    // Battling far from the crystal.
    r.x = p.x + 3; r.y = p.y;
    m.startDuel(p, r);
    m.step(1 / 60);
    expect(m.finalStarted).toBe(true);
    expect(m.darknessHeld).toBe(true);
    expect(Math.hypot(p.x - m.centerX, p.y - m.centerY)).toBeLessThan(8);
    expect(Math.hypot(r.x - m.centerX, r.y - m.centerY)).toBeLessThan(8);
    expect(m.battle.events.some((e) => e.type === 'final-battle')).toBe(true);
    // Time passes well past every pulse: no shatter, no Darkrai.
    m.darkness.nextPulseIn = 0.01;
    for (let i = 0; i < 120; i++) m.step(1 / 60);
    expect(m.darkness.phase).toBe(0);
    expect((m as unknown as { darkrai: unknown }).darkrai ?? null).toBeNull();
    expect(m.isDark(p.x, p.y)).toBe(false);
  });
});
