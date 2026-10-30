/**
 * Review harness: looks for computer trainers stuck on one errand. For each seed, the first
 * `minutes` of a match: any trainer that keeps the same AI state and key for over 40 s while not
 * in a trainer battle, not downed, and moving less than 3 tiles in that time.
 *   SEEDS=601,604 npx tsx tools/review/huntscan.ts [minutes]
 */
import { join } from 'node:path';
import { loadWorld } from '../../server/world';
import { Match } from '../../src/sim/match';
import { Rng } from '../../src/core/rng';

const world = await loadWorld(join(import.meta.dirname, '..', '..', 'assets'));
const seeds = (process.env.SEEDS ?? '601,602,603,604,605,606,607,608,609,610').split(',').map(Number);
const minutes = Number(process.argv[2] ?? 8);
const found: unknown[] = [];
for (const seed of seeds) {
  const m = new Match({ ground: world.ground(), rng: new Rng(seed), sprites: world.sprites }, [], { humans: [{ name: 'Observer', starters: ['0025'] }], rivals: 9 });
  const obs = m.seats[0]!.trainer; obs.party = []; obs.alive = false; m.seats[0]!.outcome = 'loss';
  const streak = new Map<string, { key: string; since: number; x: number; y: number; far: number }>();
  for (let i = 1; i <= minutes * 3600; i++) {
    m.over = false; m.step(1 / 60); m.battle.events.length = 0;
    if (i % 30) continue;
    for (const t of m.trainers) {
      if (!t.alive) continue;
      const busy = !!t.duelId || t.downUntil != null || t.grabbed != null;
      const key = busy ? 'busy' : `${t.ai}:${t.aiKey ?? ''}`;
      const s = streak.get(t.name);
      if (!s || s.key !== key) { streak.set(t.name, { key, since: m.time, x: t.x, y: t.y, far: 0 }); continue; }
      s.far = Math.max(s.far, Math.hypot(t.x - s.x, t.y - s.y));
      if (key !== 'busy' && !key.startsWith('roam') && m.time - s.since > 40 && s.far < 3) {
        found.push({ seed, name: t.name, key, since: +s.since.toFixed(0), at: +m.time.toFixed(0), moved: +s.far.toFixed(1) });
        s.since = m.time; // report once per 40 s
      }
    }
  }
}
console.log(JSON.stringify(found));
