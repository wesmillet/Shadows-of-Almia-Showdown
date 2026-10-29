import { join } from 'node:path';
import { loadWorld } from '../../server/world';
import { CONFIG, SPAWNS } from '../../src/sim/data';
import { Match } from '../../src/sim/match';
import { Rng } from '../../src/core/rng';
const scale = Number(process.argv[2] ?? 1);
if (scale !== 1) { (CONFIG.wild as any).calmTiles = [20, 55]; for (const t of Object.values(SPAWNS.biomes as any) as any[]) if (typeof t.count === 'number') t.count = Math.round(t.count * scale); }
const world = await loadWorld(join(import.meta.dirname, '..', '..', 'assets'));
let tot = 0, n = 0, worst = 0;
for (const seed of [11, 12, 13]) {
  const m = new Match({ ground: world.ground(), rng: new Rng(seed), sprites: world.sprites }, [], { humans: Array.from({ length: 10 }, (_, i) => ({ name: 'P' + i, starters: ['0004'] })), rivals: 0 });
  for (let i = 0; i < 60 * 90; i++) { const t0 = performance.now(); m.step(1 / 60); const d = performance.now() - t0; m.battle.events.length = 0; tot += d; n++; if (i > 60) worst = Math.max(worst, d); }
}
console.log(`scale ${scale}: mean ${(tot / n).toFixed(3)} ms/step, worst ${worst.toFixed(1)} ms`);
