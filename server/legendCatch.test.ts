/** A legendary never joins for being beaten: at its last HP it holds on for a ball, then escapes. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { CONFIG } from '../src/sim/data';
import { catchChance } from '../src/sim/catching';

describe('legendaries must be caught', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  const setup = () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(4), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 0 });
    const p = m.seats[0]!.trainer;
    m.wilds = [];
    m.darkness.radius = m.darkness.targetRadius = 999;
    m.darkness.nextPulseIn = 1e9;
    p.party = [m.makeMon('0006', 70, p, p.x, p.y)];
    m.placeParty(p);
    const L = m.makeMon('0245', 60, null, p.x + 4, p.y);
    L.legend = true;
    L.landBoss = true;
    m.wilds.push(L);
    return { m, p, L };
  };
  const run = (m: Match, secs: number) => { for (let i = 0; i < secs * 60; i++) { m.darkness.nextPulseIn = 1e9; m.step(1 / 60); } };

  it('worn down in its bout, it holds on, then escapes without joining', () => {
    const { m, p, L } = setup();
    expect(m.startLegendBout(L)).toBe(true);
    run(m, 2);
    m.battle.applyDamage(L, 1e6, p.party[0]!);
    run(m, 0.2);
    expect(L.hp).toBe(1);
    expect(L.lastStandUntil).toBeDefined();
    expect(p.party.includes(L)).toBe(false);
    run(m, CONFIG.catch.lastStandSeconds + 1);
    expect(L.captured).toBe(true);
    expect(p.party.includes(L)).toBe(false);
    expect(m.trainers.some((t) => t.legendBout)).toBe(false);
  }, 60_000);

  it('caught, it joins as an ordinary level-60 team member', () => {
    const { m, p, L } = setup();
    expect(m.startLegendBout(L)).toBe(true);
    run(m, 1);
    (m as unknown as { catchBoutLegend(L: unknown, h: unknown, by: unknown): void }).catchBoutLegend(L, L.owner, p);
    expect(p.party.includes(L)).toBe(true);
    expect(L.level).toBe(60);
    expect(L.legend).toBe(false);
    expect(L.maxHp).toBe(L.stats.hp);
  }, 60_000);

  it('is hard to catch even at its last HP', () => {
    const { L } = setup();
    L.hp = 1;
    expect(catchChance(L, 2)).toBeLessThanOrEqual(CONFIG.catch.legendCatch.max);
  }, 60_000);
});
