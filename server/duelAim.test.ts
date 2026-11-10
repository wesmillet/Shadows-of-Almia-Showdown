/** Trainer battles: a move cast at the foe follows it, so a side-step does not make it miss. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { move } from '../src/sim/data';

describe('trainer battle aim', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));
  for (const id of ['ember', 'flamethrower', 'dragon-breath']) {
    it(`${id} (${move(id).shape}) lands on a foe that side-stepped during the wind-up`, () => {
      const m = new Match({ ground: world.ground(), rng: new Rng(4), sprites: world.sprites }, [], { humans: [{ name: 'P', starters: ['0004'] }], rivals: 3 });
      m.finalStarted = true; // keep the battle where it is
      const p = m.seats[0]!.trainer;
      const r = m.trainers.find((t) => !t.visitor && !t.challenger)!;
      p.party = [m.makeMon('0006', 40, p, p.x, p.y)];
      r.party = [m.makeMon('0009', 40, r, r.x, r.y)];
      r.x = p.x + 4; r.y = p.y;
      m.startDuel(p, r);
      const d = m.duels.find((x) => x.id === p.duelId)!;
      for (let i = 0; i < 600 && !(d.a.mon && d.b.mon); i++) m.step(1 / 60);
      const mine = (d.a.trainer === p ? d.a : d.b).mon!;
      const foe = (d.a.trainer === p ? d.b : d.a).mon!;
      mine.moves = [id];
      mine.cooldowns = [0];
      foe.x = mine.x + 3; foe.y = mine.y;
      m.aim = { x: foe.x, y: foe.y };
      const hp = foe.hp;
      expect(m.playerCast(0)).toBe('cast');
      // The foe steps well clear of where it was aimed and stays there (the cursor roughly follows it).
      for (let i = 0; i < 150 && foe.hp === hp; i++) { foe.moving = false; foe.casting = null; foe.x = mine.x + 2.6; foe.y = mine.y + 2.2; m.aim = { x: foe.x + 1, y: foe.y }; m.step(1 / 60); }
      expect(foe.hp).toBeLessThan(hp);
    });
  }
});
