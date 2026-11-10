/**
 * The secret crystal: only from the second-to-last pulse can it be struck; when its hidden
 * strength runs out it cracks and Darkrai comes out (no Master Ball). Darkrai can be caught only
 * below 5% of its HP.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { CONFIG } from '../src/sim/data';

describe('the Shadow Crystal', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  const setup = (phase: number) => {
    const m = new Match({ ground: world.ground(), rng: new Rng(2), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 5 });
    const p = m.seats[0]!.trainer;
    p.x = p.px = m.centerX - 2.5; p.y = p.py = m.centerY;
    const mon = m.makeMon('0006', 50, p, p.x + 0.5, p.y);
    mon.moves = ['ember'];
    mon.cooldowns = [0];
    p.party = [mon];
    m.darkness.phase = phase;
    m.darkness.nextPulseIn = 1e9;
    m.darkness.radius = m.darkness.targetRadius = 999;
    return { m, p, mon };
  };
  const hammer = (m: Match, mon: ReturnType<typeof setup>['mon'], seconds: number) => {
    for (let i = 0; i < seconds * 60; i++) {
      mon.cooldowns = [0];
      if (!mon.casting) m.battle.castToward(mon, 0, m.centerX, m.centerY);
      m.step(1 / 60);
    }
  };
  it('cannot be harmed before the second-to-last pulse', () => {
    const { m, mon } = setup(CONFIG.darkness.radiiTiles.length - 2);
    const hp = m.crystalHp;
    hammer(m, mon, 4);
    expect(m.crystalHp).toBe(hp);
  });
  it('wears down in the last storms and cracks to let Darkrai out', () => {
    const { m, mon } = setup(CONFIG.darkness.radiiTiles.length - 1);
    const hp = m.crystalHp;
    hammer(m, mon, 3);
    expect(m.crystalHp).toBeLessThan(hp);
    m.crystalHp = 1;
    hammer(m, mon, 2);
    expect(m.crystalCracked).toBe(true);
    expect(m.darkrai).toBeTruthy();
    expect(m.items.some((it) => it.contents?.some((c) => c.id === 'master-ball'))).toBe(false);
    const d = m.darkrai!;
    expect(m.darkraiCatchable(d)).toBe(false);
    d.hp = Math.floor(d.maxHp * 0.04);
    expect(m.darkraiCatchable(d)).toBe(true);
  });
});
