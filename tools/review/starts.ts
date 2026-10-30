/**
 * Review harness: weak starts. For every new-player starter at every start spot, are there wild
 * Pokémon nearby it can actually beat (a route to a first knockout and catch), and does the bot's
 * own judgement (fightMargin) see them?
 *
 * 1. Opportunities: SEEDS matches; for each start spot, the wild Pokémon within 16 tiles (a
 *    screen) during the first 90 s, with species, level and the start's region.
 * 2. Reality: each (starter, wild species, wild level) met is fought for real, RUNS times: a lone
 *    computer trainer with the level-5 starter against that wild in the open (fieldLimit rules),
 *    held to the fight, and the win rate recorded.
 * 3. Judgement: fightMargin for the same pair (the number the bots hunt by: 1.6 to hunt, 1.35 if
 *    nothing better, 1.0 after 45 s without a hunt).
 *   SEEDS=1-12 RUNS=4 npx tsx tools/review/starts.ts > starts.json
 */
import { join } from 'node:path';
import { loadWorld } from '../../server/world';
import { Match } from '../../src/sim/match';
import { Rng } from '../../src/core/rng';
import { fightMargin } from '../../src/sim/ai';
import { STARTER_TIERS, BASE_TIERS } from '../../src/sim/starters';
import { CONFIG } from '../../src/sim/data';
import type { Mon, Trainer } from '../../src/sim/entities';

import { applyUnwarn } from './unwarn';
applyUnwarn();
const world = await loadWorld(join(import.meta.dirname, '..', '..', 'assets'));
const [s0, s1] = (process.env.SEEDS ?? '1-12').split('-').map(Number);
const RUNS = Number(process.env.RUNS ?? 4);
const starters = STARTER_TIERS.filter((t) => BASE_TIERS.includes(t.id)).flatMap((t) => t.dex);
const level = CONFIG.player.level;

// 1. what is near each start
type Near = { dex: string; level: number; name: string };
const starts: Array<{ seed: number; spot: number; region: string; near: Near[] }> = [];
for (let seed = s0!; seed <= s1!; seed++) {
  const m = new Match({ ground: world.ground(), rng: new Rng(seed), sprites: world.sprites }, [], { humans: [{ name: 'O', starters: ['0025'] }], rivals: 9 });
  const spots = m.allTrainers.map((t) => ({ x: t.x, y: t.y, region: m.ground.biomeAt(Math.floor(t.x), Math.floor(t.y)) }));
  // Nobody moves: the trainers stand at their start, so the scan sees what is around each spot.
  for (const t of m.allTrainers) { t.party = []; t.alive = false; }
  const seen = spots.map(() => new Map<number, Near>());
  for (let i = 0; i <= 90 * 60; i++) {
    if (i % 600 === 0) spots.forEach((s, k) => { for (const w of m.wilds) if (!w.fainted && Math.hypot(w.x - s.x, w.y - s.y) <= 16) seen[k]!.set(w.id, { dex: w.dex, level: w.level, name: w.name }); });
    m.over = false; m.step(1 / 60); m.battle.events.length = 0;
  }
  spots.forEach((s, k) => starts.push({ seed, spot: k, region: s.region, near: [...seen[k]!.values()] }));
}

// 2 and 3. each starter against each wild met, for real and as the bot judges it
const pairs = new Map<string, { win: number; n: number; margin: number; secs: number }>();
const fight = (starter: string, wdex: string, wlv: number): { win: number; n: number; margin: number; secs: number } => {
  const key = `${starter}|${wdex}|${wlv}`;
  const hit = pairs.get(key);
  if (hit) return hit;
  let win = 0, n = 0, margin = 0, secs = 0;
  for (let r = 0; r < RUNS; r++) {
    const m = new Match({ ground: world.ground(), rng: new Rng(4000 + r), sprites: world.sprites }, [], { humans: [{ name: 'O', starters: ['0025'] }], rivals: 1 });
    const obs = m.seats[0]!.trainer; obs.party = []; obs.alive = false; m.seats[0]!.outcome = 'loss';
    m.items = []; m.darkness.radius = m.darkness.targetRadius = 999; m.darkness.nextPulseIn = 1e9;
    const t = m.trainers[0]! as Trainer;
    t.items = t.items.map(() => null);
    // an open spot well away from the crystal
    let sx = t.x, sy = t.y;
    for (let k = 0; k < 400; k++) {
      const x = Math.floor(m.centerX + Math.cos(k) * (60 + (k % 40))), y = Math.floor(m.centerY + Math.sin(k) * (60 + (k % 40)));
      let ok = true;
      for (let dy = -5; dy <= 5 && ok; dy++) for (let dx = -5; dx <= 5 && ok; dx++) if (!(m.ground.walkable(x + dx, y + dy) && m.ground.reachable(x + dx, y + dy))) ok = false;
      if (ok) { sx = x + 0.5; sy = y + 0.5; break; }
    }
    t.x = t.px = sx - 2; t.y = t.py = sy;
    t.party = [m.makeMon(starter, level, t, t.x, t.y)];
    m.placeParty(t);
    const w = m.makeMon(wdex, wlv, null, sx + 2, sy) as Mon;
    w.homeX = w.x; w.homeY = w.y;
    m.wilds = [w];
    if (r === 0) margin = fightMargin(t, w, (CONFIG.party as { fieldLimit?: number }).fieldLimit ?? 2);
    let done = false, time = 0;
    for (let i = 0; i < 60 * 60 && !done; i++) {
      t.ai = 'hunt'; t.aiTimer = 5; t.aiTarget = { x: w.x, y: w.y }; t.aiKey = `m${w.id}`;
      m.darkness.radius = m.darkness.targetRadius = 999;
      m.over = false; m.step(1 / 60); m.battle.events.length = 0; time += 1 / 60;
      if (w.fainted) { win++; done = true; }
      else if (t.party.every((p) => p.fainted)) done = true;
    }
    if (done) { n++; secs += time; }
  }
  const res = { win, n, margin, secs: n ? secs / n : 0 };
  pairs.set(key, res);
  return res;
};

const rows: unknown[] = [];
for (const st of starts) for (const s of starters) {
  let viable = 0, accepted = 0, missed = 0, risky = 0, total = 0;
  for (const w of st.near) {
    const f = fight(s, w.dex, w.level);
    total++;
    const rate = f.n ? f.win / f.n : 0;
    const ok = rate >= 0.75;
    if (ok) viable++;
    if (f.margin >= 1.35) accepted++;
    if (ok && f.margin < 1.0) missed++;
    if (f.margin >= 1.35 && rate < 0.5) risky++;
  }
  rows.push({ seed: st.seed, spot: st.spot, region: st.region, starter: s, near: total, viable, botWouldHunt: accepted, viableButNeverHunted: missed, huntedButLosing: risky });
}
console.log(JSON.stringify({ starts: rows, pairs: Object.fromEntries(pairs) }));
