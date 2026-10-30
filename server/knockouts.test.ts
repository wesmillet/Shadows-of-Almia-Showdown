/**
 * A knockout pays once: money, XP and drops come from the step it happened in, even if whoever
 * steps the match leaves the event list un-emptied (round 3 review fix).
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';

describe('knockout rewards', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));

  it('are paid once per knockout, even when the events are never cleared', () => {
    const m = new Match({ ground: world.ground(), rng: new Rng(11), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 0 });
    const p = m.seats[0]!.trainer;
    const mine = p.party[0]!;
    const wild = m.makeMon('0129', 3, null, mine.x + 1, mine.y);
    m.wilds.push(wild);
    m.battle.events.length = 0;
    const money0 = p.money;
    const xp0 = mine.xp + mine.level * 1e6;
    m.battle.applyDamage(wild, wild.hp, mine);
    expect(wild.fainted).toBe(true);
    m.step(1 / 60);
    const money1 = p.money;
    const xp1 = mine.xp + mine.level * 1e6;
    expect(money1).toBeGreaterThan(money0);
    expect(xp1).toBeGreaterThan(xp0);
    // Step on without emptying the list: the same faint event is still there, and pays nothing more.
    for (let i = 0; i < 30; i++) m.step(1 / 60);
    expect(m.battle.events.filter((e) => e.type === 'faint' && e.mon === wild)).toHaveLength(1);
    expect(p.money).toBe(money1);
    expect(mine.xp + mine.level * 1e6).toBe(xp1);
    expect(m.battle.events.filter((e) => e.type === 'money')).toHaveLength(1);
  });
});
