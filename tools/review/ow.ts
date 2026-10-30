/**
 * Review harness (scaling-lab): open-world fights, several Pokémon at once. A computer trainer's
 * party (two out, the rest in reserve) against wild Pokémon set beside it; the trainer is held to
 * the fight. Per row: who wins, how long, HP left, and two sets of measurements:
 *  - sleep: share of the fight the wilds spent asleep, the longest unbroken sleep, how many times
 *    they were put to sleep, and how many moves a wild got off between being put to sleep again;
 *  - teammates: how often a trainer's Pokémon stood with a move ready and a foe in reach but
 *    waited (the pause after each move), and moves per Pokémon per 10 s.
 *   LEVEL_MODEL=current|p LAB_SLEEP=old LAB_TEAMMATES=quick SCEN=file.json RUNS=30 npx tsx tools/review/ow.ts
 *   row: { label, team: [[dex, lv, moves?], ...], wilds: [...] }
 */
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadWorld } from '../../server/world';
import { Match } from '../../src/sim/match';
import { Rng } from '../../src/core/rng';
import { incapable } from '../../src/sim/entities';
import { levelModel, LAB } from '../../src/sim/levelModel';
import type { Mon } from '../../src/sim/entities';

import { applyUnwarn } from './unwarn';
applyUnwarn();
const world = await loadWorld(join(import.meta.dirname, '..', '..', 'assets'));
type Entry = [string, number, string[]?];
const ROWS: Array<{ label: string; team: Entry[]; wilds: Entry[] }> = JSON.parse(readFileSync(process.env.SCEN!, 'utf8'));
const RUNS = Number(process.env.RUNS ?? 30);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const wilson = (k: number, n: number): [number, number] => {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [+((c - h) / d).toFixed(2), +((c + h) / d).toFixed(2)];
};
function openSpot(m: Match): { x: number; y: number } {
  const g = m.ground;
  for (let r = 0; r < 160; r += 2) for (let a = 0; a < 6.28; a += 0.2) {
    const x = Math.floor(m.centerX + Math.cos(a) * (40 + r)), y = Math.floor(m.centerY + Math.sin(a) * (40 + r));
    let ok = true;
    for (let dy = -8; dy <= 8 && ok; dy++) for (let dx = -8; dx <= 8 && ok; dx++) if (dx * dx + dy * dy <= 64 && !(g.walkable(x + dx, y + dy) && g.reachable(x + dx, y + dy))) ok = false;
    if (ok) return { x: x + 0.5, y: y + 0.5 };
  }
  throw new Error('no open spot');
}
const out: unknown[] = [];
for (const row of ROWS) {
  let wins = 0, n = 0;
  const dur: number[] = [], hpLeft: number[] = [], asleepShare: number[] = [], longest: number[] = [], sleeps: number[] = [], betweenMin: number[] = [], betweenMean: number[] = [], waitShare: number[] = [], castsPer10: number[] = [], noActionGaps: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const m = new Match({ ground: world.ground(), rng: new Rng(1300 + r), sprites: world.sprites }, [], { humans: [{ name: 'O', starters: ['0025'] }], rivals: 1 });
    const obs = m.seats[0]!.trainer; obs.party = []; obs.alive = false; m.seats[0]!.outcome = 'loss';
    m.items = []; m.darkness.radius = m.darkness.targetRadius = 999; m.darkness.nextPulseIn = 9999;
    const t = m.trainers[0]!; t.items = t.items.map(() => null);
    const spot = openSpot(m);
    t.x = t.px = spot.x - 3; t.y = t.py = spot.y;
    const mk = (owner: typeof t | null, [d, l, mv]: Entry, x: number, y: number) => { const q = m.makeMon(d, l, owner, x, y); if (mv) { q.moves = mv; q.cooldowns = mv.map(() => 0); } return q; };
    t.party = row.team.map((e) => mk(t, e, t.x, t.y));
    m.placeParty(t);
    const ws = row.wilds.map((e, i) => { const w = mk(null, e, spot.x + 2 + (i % 2), spot.y - 1 + i); w.homeX = w.x; w.homeY = w.y; return w; });
    m.wilds = ws;
    const hp0 = t.party.reduce((s, p) => s + p.maxHp, 0);
    let time = 0, done = false, asleepT = 0, wait = 0, onField = 0, casts = 0;
    const run = new Map<Mon, number>(), longestRun = new Map<Mon, number>(), sleepCount = new Map<Mon, number>(), castsSince = new Map<Mon, number>(), gaps: number[] = [];
    let lastAction = 0, maxGap = 0;
    for (let i = 0; i < 60 * 120 && !done; i++) {
      { const w0 = ws.find((w) => !w.fainted && !w.captured) ?? ws[0]!; t.ai = 'hunt'; t.aiTimer = 5; t.aiTarget = { x: w0.x, y: w0.y }; t.aiKey = `m${w0.id}`; }
      m.darkness.radius = m.darkness.targetRadius = 999;
      m.over = false; m.step(1 / 60); time += 1 / 60;
      for (const e of m.battle.events as Array<Record<string, any>>) {
        if (e.type === 'status' && e.status === 'sleep' && ws.includes(e.target)) {
          sleepCount.set(e.target, (sleepCount.get(e.target) ?? 0) + 1);
          if ((sleepCount.get(e.target) ?? 0) > 1) gaps.push(castsSince.get(e.target) ?? 0);
          castsSince.set(e.target, 0);
        }
        if (e.type === 'cast' && ws.includes(e.attacker)) { castsSince.set(e.attacker, (castsSince.get(e.attacker) ?? 0) + 1); lastAction = time; }
        if (e.type === 'cast' && e.attacker?.owner === t) casts++;
      }
      m.battle.events.length = 0;
      // the wilds' longest stretch without getting a move off (asleep or otherwise kept from acting)
      maxGap = Math.max(maxGap, time - lastAction);
      for (const w of ws) {
        if (w.status === 'sleep') { asleepT += 1 / 60 / ws.length; run.set(w, (run.get(w) ?? 0) + 1 / 60); longestRun.set(w, Math.max(longestRun.get(w) ?? 0, run.get(w)!)); }
        else run.set(w, 0);
      }
      // teammates: out, able, a foe in reach, a move ready, but held by the pause after its last move
      for (const p of t.party) {
        if (p.stowed || p.fainted || p.captured) continue;
        onField++;
        const foe = p.target;
        if (!foe || foe.fainted || incapable(p) || p.casting) continue;
        const d = Math.hypot(foe.x - p.x, foe.y - p.y);
        const ready = m.battle.chooseMove(p, foe, true) >= 0;
        if (ready && d <= 6 && p.busy > 0) wait++;
      }
      const teamUp = t.party.some((p) => !p.fainted && !p.captured);
      const wildUp = ws.some((w) => !w.fainted && !w.captured);
      if (!teamUp || !wildUp) done = true;
    }
    if (!done) continue;
    n++;
    if (t.party.some((p) => !p.fainted)) wins++;
    dur.push(time);
    hpLeft.push(t.party.reduce((s, p) => s + (p.fainted ? 0 : p.hp), 0) / hp0);
    asleepShare.push(asleepT / time);
    longest.push(Math.max(0, ...longestRun.values()));
    sleeps.push([...sleepCount.values()].reduce((a, b) => a + b, 0));
    if (gaps.length) { betweenMin.push(Math.min(...gaps)); betweenMean.push(mean(gaps)); }
    waitShare.push(onField ? wait / onField : 0);
    castsPer10.push((casts / Math.max(1, onField / 60)) * 10);
    noActionGaps.push(maxGap);
  }
  out.push({
    label: row.label, model: levelModel(), sleep: LAB.sleepBreaks ? 'breaks' : 'old', teammates: LAB.teammates, n,
    teamWin: +(wins / Math.max(1, n)).toFixed(2), ci: wilson(wins, n), dur: +mean(dur).toFixed(1), teamHpLeft: +mean(hpLeft).toFixed(2),
    sleep_: { asleepShare: +mean(asleepShare).toFixed(3), longestSleep: +mean(longest).toFixed(1), longestSleepMax: +Math.max(0, ...longest).toFixed(1), applications: +mean(sleeps).toFixed(1), movesBetweenSleepsMin: +mean(betweenMin).toFixed(1), movesBetweenSleepsMean: +mean(betweenMean).toFixed(1), fightsWithResleep: betweenMin.length, longestWithoutAMove: +mean(noActionGaps).toFixed(1), longestWithoutAMoveMax: +Math.max(0, ...noActionGaps).toFixed(1) },
    teammates_: { waitingWithMoveReady: +mean(waitShare).toFixed(3), movesPer10s: +mean(castsPer10).toFixed(1) },
  });
}
console.log(JSON.stringify(out));
