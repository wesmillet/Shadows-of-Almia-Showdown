/**
 * Review harness: looks for computer trainers stuck on errands. For each seed, the first `minutes` of
 * a match, in 60 s windows: a trainer that stayed within 6 tiles of where the window began, spent
 * at least 80% of it on errands (hunt, shop, item, heal; not roaming or backing off), and was never
 * in a trainer battle, downed or grabbed in it. That catches a trainer standing still on one errand
 * and one pacing between two (the round 2 shop and item loop).
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
  const win = new Map<string, { x: number; y: number; t: number; samples: number; errand: number; far: number; busy: boolean; states: Record<string, number> }>();
  for (let i = 1; i <= minutes * 3600; i++) {
    m.over = false; m.step(1 / 60); m.battle.events.length = 0;
    if (i % 30) continue;
    for (const t of m.trainers) {
      if (!t.alive) continue;
      let w = win.get(t.name);
      if (!w || m.time - w.t >= 60) {
        if (w && !w.busy && w.far <= 6 && w.errand >= 0.8 * w.samples) found.push({ seed, name: t.name, from: Math.round(w.t), to: Math.round(m.time), moved: +w.far.toFixed(1), states: w.states });
        w = { x: t.x, y: t.y, t: m.time, samples: 0, errand: 0, far: 0, busy: false, states: {} };
        win.set(t.name, w);
      }
      const busy = !!t.duelId || t.downUntil != null || t.grabbed != null;
      w.busy ||= busy;
      w.samples++;
      if (['hunt', 'shop', 'seekItem', 'heal'].includes(t.ai)) w.errand++;
      w.states[t.ai] = (w.states[t.ai] ?? 0) + 1;
      w.far = Math.max(w.far, Math.hypot(t.x - w.x, t.y - w.y));
    }
  }
}
console.log(JSON.stringify(found));
