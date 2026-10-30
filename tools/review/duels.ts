/**
 * Review harness (scaling-lab): trainer battles between two computer trainers, with real movement,
 * aiming and dodging. Per row it reports who wins, how long it takes, what a hit is worth, and what
 * the losing side managed to do before it went down.
 *
 *   LEVEL_MODEL=current|p SCEN=file.json RUNS=40 npx tsx tools/review/duels.ts
 *   row: { label, a: [[dex, lv, moves?], ...], b: [...], skillA?, skillB? }   skill: avg | good | kite | goodkite
 */
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadWorld } from '../../server/world';
import { Match } from '../../src/sim/match';
import { Rng } from '../../src/core/rng';
import type { Mon, Trainer } from '../../src/sim/entities';
import { levelModel } from '../../src/sim/levelModel';

const world = await loadWorld(join(import.meta.dirname, '..', '..', 'assets'));
type Entry = [string, number, string[]?];
const ROWS: Array<{ label: string; a: Entry[]; b: Entry[]; skillA?: string; skillB?: string }> = JSON.parse(readFileSync(process.env.SCEN!, 'utf8'));
const RUNS = Number(process.env.RUNS ?? 40);
const SEED0 = Number(process.env.SEED0 ?? 900);
const SKILL: Record<string, { react: number; sd: number; attempt: number; wrong: number; kite?: boolean }> = {
  avg: { react: 0.32, sd: 0.07, attempt: 0.5, wrong: 0.2 },
  good: { react: 0.24, sd: 0.05, attempt: 0.8, wrong: 0.1 },
  kite: { react: 0.32, sd: 0.07, attempt: 0, wrong: 0, kite: true },
  goodkite: { react: 0.24, sd: 0.05, attempt: 0.8, wrong: 0.1, kite: true },
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
const wilson = (k: number, n: number): [number, number] => {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [+((c - h) / d).toFixed(2), +((c + h) / d).toFixed(2)];
};
const q = (xs: number[], f: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? +s[Math.min(s.length - 1, Math.floor(f * s.length))]!.toFixed(1) : 0; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

import { applyUnwarn } from './unwarn';
applyUnwarn();
const out: unknown[] = [];
for (const row of ROWS) {
  let winsA = 0, n = 0, timeouts = 0;
  const dur: number[] = [], hitA: number[] = [], hitB: number[] = [], loserCasts: number[] = [], loserHits: number[] = [], loserDmg: number[] = [], winnerLeft: number[] = [], loserFirstHitAt: number[] = [], dodged: number[] = [], hitsToKoLoser: number[] = [];
  const movePctA: number[] = [], movePctB: number[] = [];
  const bAsleep: number[] = [], bLongest: number[] = [], bSleeps: number[] = [], bBetween: number[] = [], landedA: number[] = [], castsA: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const m = new Match({ ground: world.ground(), rng: new Rng(SEED0 + r), sprites: world.sprites }, [], { humans: [{ name: 'O', starters: ['0025'] }], rivals: 2 });
    const obs = m.seats[0]!.trainer; obs.party = []; obs.alive = false; m.seats[0]!.outcome = 'loss';
    m.wilds = []; m.items = [];
    const hold = () => { m.darkness.radius = m.darkness.targetRadius = 999; m.darkness.nextPulseIn = 1e9; };
    hold();
    const [A, B] = [m.trainers[0]!, m.trainers[1]!];
    const spot = openSpot(m);
    A.x = A.px = spot.x - 2.5; A.y = A.py = spot.y;
    B.x = B.px = spot.x + 2.5; B.y = B.py = spot.y;
    const mk = (t: Trainer, [d, l, mv]: Entry) => { const x = m.makeMon(d, l, t, t.x, t.y); if (mv) { x.moves = mv; x.cooldowns = mv.map(() => 0); } return x; };
    A.party = row.a.map((e) => mk(A, e));
    B.party = row.b.map((e) => mk(B, e));
    for (const t of [A, B]) { t.items = t.items.map(() => null); t.duelReadyAt = Infinity; m.placeParty(t); }
    (A as Trainer & { labHuman?: unknown }).labHuman = SKILL[row.skillA ?? ''];
    (B as Trainer & { labHuman?: unknown }).labHuman = SKILL[row.skillB ?? ''];
    const hpA0 = A.party.reduce((s, p) => s + p.maxHp, 0), hpB0 = B.party.reduce((s, p) => s + p.maxHp, 0);
    m.startDuel(A, B);
    let tFight = -1, tEnd = -1, winner: Trainer | null = null;
    const casts = new Map<Trainer, number>(), landed = new Map<Trainer, number>(), dealt = new Map<Trainer, number>();
    const firstTaken = new Map<Trainer, number>();
    const hitsOn = new Map<Trainer, number>();
    let pctA = 0, pctB = 0;
    let dodges = 0, asleep = 0, runB = 0, longB = 0, sleepsB = 0, castsB = 0, fightT = 0;
    const between: number[] = [];
    for (let i = 0; i < 60 * 240 && tEnd < 0; i++) {
      hold();
      m.over = false; m.step(1 / 60);
      for (const e of m.battle.events as Array<Record<string, any>>) {
        const ow = e.attacker?.owner as Trainer | undefined;
        if (e.type === 'cast' && ow) { casts.set(ow, (casts.get(ow) ?? 0) + 1); if (tFight < 0) tFight = m.time; }
        if (e.type === 'hit' && ow && e.target?.owner && e.damage > 0) {
          if (tFight < 0) tFight = m.time;
          landed.set(ow, (landed.get(ow) ?? 0) + 1);
          dealt.set(ow, (dealt.get(ow) ?? 0) + e.damage);
          const victim = e.target.owner as Trainer;
          hitsOn.set(victim, (hitsOn.get(victim) ?? 0) + 1);
          if (!firstTaken.has(victim)) firstTaken.set(victim, m.time);
          (ow === A ? hitA : hitB).push((100 * e.damage) / e.target.maxHp);
          if (ow === A) pctA += (100 * e.damage) / e.target.maxHp; else pctB += (100 * e.damage) / e.target.maxHp;
        }
        if (e.type === 'dodged') dodges++;
        if (e.type === 'status' && e.status === 'sleep' && e.target?.owner === B) { sleepsB++; if (sleepsB > 1) between.push(castsB); castsB = 0; }
        if (e.type === 'cast' && ow === B) castsB++;
        if (e.type === 'duel-end') { tEnd = m.time; winner = (e.winner as Trainer) ?? null; }
      }
      m.battle.events.length = 0;
      if (tFight >= 0) {
        fightT += 1 / 60;
        const bm = B.party.find((p) => !p.stowed && !p.fainted && !p.captured);
        if (bm?.status === 'sleep') { asleep += 1 / 60; runB += 1 / 60; longB = Math.max(longB, runB); } else runB = 0;
      }
    }
    if (tEnd < 0 || !winner) { timeouts++; continue; }
    bAsleep.push(fightT ? asleep / fightT : 0); bLongest.push(longB); bSleeps.push(sleepsB); if (between.length) bBetween.push(Math.min(...between));
    landedA.push(landed.get(A) ?? 0); castsA.push(casts.get(A) ?? 0);
    if (casts.get(A)) movePctA.push(pctA / casts.get(A)!);
    if (casts.get(B)) movePctB.push(pctB / casts.get(B)!);
    n++;
    if (winner === A) winsA++;
    const loser = winner === A ? B : A;
    dur.push(tEnd - Math.max(0, tFight));
    loserCasts.push(casts.get(loser) ?? 0);
    loserHits.push(landed.get(loser) ?? 0);
    loserDmg.push((100 * (dealt.get(loser) ?? 0)) / (winner === A ? hpA0 : hpB0));
    winnerLeft.push(winner.party.reduce((s, p) => s + (p.fainted ? 0 : p.hp), 0) / (winner === A ? hpA0 : hpB0));
    loserFirstHitAt.push((firstTaken.get(winner) ?? tEnd) - Math.max(0, tFight));
    hitsToKoLoser.push(hitsOn.get(loser) ?? 0);
    dodged.push(dodges);
  }
  out.push({
    label: row.label, model: levelModel(), n, timeouts,
    winA: +(winsA / Math.max(1, n)).toFixed(2), ci: wilson(winsA, n),
    dur: { p25: q(dur, 0.25), med: q(dur, 0.5), p75: q(dur, 0.75) },
    hitPct: { a: +mean(hitA).toFixed(1), b: +mean(hitB).toFixed(1) },
    perMovePct: { a: +mean(movePctA).toFixed(1), b: +mean(movePctB).toFixed(1) },
    loser: { casts: +mean(loserCasts).toFixed(1), hits: +mean(loserHits).toFixed(1), dmgPctOfWinner: +mean(loserDmg).toFixed(0), firstHitOnWinnerAt: +mean(loserFirstHitAt).toFixed(1) },
    hitsToBeatLoser: +mean(hitsToKoLoser).toFixed(1),
    winnerHpLeft: +mean(winnerLeft).toFixed(2), dodged: +mean(dodged).toFixed(1),
    a: { casts: +mean(castsA).toFixed(1), landed: +mean(landedA).toFixed(1) },
    bSleep: { asleepShare: +mean(bAsleep).toFixed(3), longest: +mean(bLongest).toFixed(1), longestMax: +Math.max(0, ...bLongest).toFixed(1), applications: +mean(bSleeps).toFixed(1), fewestMovesBetween: bBetween.length ? +mean(bBetween).toFixed(1) : null },
  });
}
console.log(JSON.stringify(out));
