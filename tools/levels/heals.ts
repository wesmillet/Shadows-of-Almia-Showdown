/** How often computer trainers heal at outposts: heals per trainer per 10 minutes, over a few offline-sized matches. */
import { join } from 'node:path';
import { loadWorld } from '../../server/world';
import { Match } from '../../src/sim/match';
import { Rng } from '../../src/core/rng';
const world = await loadWorld(join(import.meta.dirname, '..', '..', 'assets'));
let heals = 0, trainerMinutes = 0, healingSec = 0, tripSec = 0, nearSec = 0;
for (const seed of [21, 22, 23, 24]) {
  const m = new Match({ ground: world.ground(), rng: new Rng(seed), sprites: world.sprites }, ['0004'], {});
  m.auto = true;
  const was = new Map<object, number>();
  for (let i = 0; i < 60 * 60 * 8 && !m.over; i++) {
    m.step(1 / 60);
    m.battle.events.length = 0;
    for (const t of m.allTrainers) {
      if (t.isPlayer || !t.alive || t.visitor || t.challenger) continue;
      if (i % 60 === 0) trainerMinutes += 1 / 60;
      if (t.healing > 0) healingSec += 1 / 60;
      if ((t as { ai?: string }).ai === 'heal') tripSec += 1 / 60;
      if (m.outposts.some((o) => Math.hypot(o.x - t.x, o.y - t.y) < 8)) nearSec += 1 / 60;
      const r = t.outpostReady ?? 0;
      if (r !== (was.get(t) ?? r)) heals++;
      was.set(t, r);
    }
  }
}
console.log(`heals per trainer per 10 min: ${(heals / trainerMinutes * 10).toFixed(2)}; share of time healing: ${(healingSec / (trainerMinutes * 60) * 100).toFixed(1)}%, walking to heal: ${(tripSec / (trainerMinutes * 60) * 100).toFixed(1)}%, within 8 tiles of an outpost: ${(nearSec / (trainerMinutes * 60) * 100).toFixed(1)}%`);
