/** Milliseconds a simulation step takes with ten computer trainers (the server steps 60 times a second). */
import { join } from 'node:path';
import { loadWorld } from '../../server/world';
import { Match } from '../../src/sim/match';
import { Rng } from '../../src/core/rng';
const world = await loadWorld(join(import.meta.dirname, '..', '..', 'assets'));
let tot = 0, n = 0, worst = 0;
const ai: number[] = [];
for (const seed of [11, 12]) {
  const m = new Match({ ground: world.ground(), rng: new Rng(seed), sprites: world.sprites }, [], { humans: [{ name: 'O', starters: ['0004'] }], rivals: 10 });
  const o = m.seats[0]!.trainer; o.party = []; o.alive = false; m.seats[0]!.outcome = 'loss';
  for (let i = 0; i < 60 * 240; i++) { m.over = false; const t0 = performance.now(); m.step(1 / 60); const d = performance.now() - t0; m.battle.events.length = 0; tot += d; n++; ai.push(d); if (i > 60) worst = Math.max(worst, d); }
}
ai.sort((a, b) => a - b);
console.log(`10 bots: mean ${(tot / n).toFixed(3)} ms/step, p99 ${ai[Math.floor(ai.length * 0.99)]!.toFixed(2)} ms, worst ${worst.toFixed(1)} ms`);
