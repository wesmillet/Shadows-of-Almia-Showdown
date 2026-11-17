/** A wild Pokémon that faints from your Pokémon's burn or poison pays out like any knockout (XP and money). */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';

describe('status knockouts pay out', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  for (const kind of ['burn', 'poison'] as const) {
    it(`${kind}: XP and money for the trainer whose Pokémon inflicted it, even once it is back in its ball`, () => {
      const m = new Match({ ground: world.ground(), rng: new Rng(3), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004', '0007'] }], rivals: 0, keepsResults: true } as never);
      const p = m.seats[0]!.trainer;
      const lead = p.party[0]!;
      const wild = m.makeMon('0399', 5, null, p.x + 25, p.y + 25);
      wild.wild = true;
      m.wilds.push(wild);
      m.battle.applyStatus(wild, kind, lead);
      wild.hp = 1;
      lead.stowed = true;
      const money = p.money;
      const xp: number[] = [];
      for (let i = 0; i < 60 * 4 && !wild.fainted; i++) {
        m.step(1 / 60);
        for (const e of m.battle.events) if (e.type === 'xp' && e.mon.owner === p) xp.push(e.xp);
        m.battle.events.length = 0;
      }
      expect(wild.fainted).toBe(true);
      expect(p.stats.knockouts).toBeGreaterThan(0);
      expect(p.money).toBeGreaterThan(money);
      expect(xp.length).toBeGreaterThan(0);
    });
  }
});
