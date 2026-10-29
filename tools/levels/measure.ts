/**
 * Wild levels per match, in bands, over many seeds (offline-sized match: the player and 9 rivals).
 *   npx tsx tools/levels/measure.ts [seeds] ['{"wild":{"calmTiles":[25,70]}}' overrides]
 */
import { join } from 'node:path';
import { loadWorld } from '../../server/world';
import { CONFIG, SPAWNS } from '../../src/sim/data';
import { Match } from '../../src/sim/match';
import { Rng } from '../../src/core/rng';

const seeds = Number(process.argv[2] ?? 60);
const over = JSON.parse(process.argv[3] ?? '{}') as { wild?: Record<string, unknown>; countScale?: number };
Object.assign(CONFIG.wild, over.wild ?? {});
if (over.countScale) for (const t of Object.values(SPAWNS.biomes as Record<string, { count?: number }>)) if (typeof t.count === 'number') t.count = Math.round(t.count * over.countScale);
const world = await loadWorld(join(import.meta.dirname, '..', '..', 'assets'));
const bands = [[0, 9], [10, 19], [20, 34], [35, 49], [50, 100]] as const;
const sum = bands.map(() => 0);
let total = 0;
for (let s = 1; s <= seeds; s++) {
  const m = new Match({ ground: world.ground(), rng: new Rng(1000 + s), sprites: world.sprites }, ['0001'], {});
  for (const w of m.wilds) {
    total++;
    bands.forEach(([a, b], i) => { if (w.level >= a && w.level <= b) sum[i]!++; });
  }
}
console.log(`${(total / seeds).toFixed(0)} wilds per match | ` + bands.map(([a, b], i) => `${a}-${b}: ${(sum[i]! / seeds).toFixed(0)}`).join(' | '));
