/**
 * Review harness (scaling-lab). Full matches with 10 computer trainers (and a dead observer seat):
 * progression every minute, every trainer battle (who chose it, levels and party sizes, who won,
 * how long, what the loser got off), where XP came from, danger from wilds, Alphas, bosses and
 * the centre, and per trainer its start (starter, region), first catch and first knockout, and
 * stretches stuck on errands. One JSON line per match, written as each finishes.
 *   SEED=700 N=10 LEVEL_MODEL=current|p npx tsx tools/review/progress.ts
 */
import { join } from 'node:path';
import { loadWorld } from '../../server/world';
import { Match } from '../../src/sim/match';
import { Rng } from '../../src/core/rng';
import type { Mon, Trainer } from '../../src/sim/entities';
import { levelModel } from '../../src/sim/levelModel';

import { applyUnwarn } from './unwarn';
applyUnwarn();
const world = await loadWorld(join(import.meta.dirname, '..', '..', 'assets'));
const seed0 = Number(process.env.SEED ?? 500), N = Number(process.env.N ?? 6);
for (let k = 0; k < N; k++) {
  const seed = seed0 + k;
  const m = new Match({ ground: world.ground(), rng: new Rng(seed), sprites: world.sprites }, [], { humans: [{ name: 'Observer', starters: ['0025'] }], rivals: Number(process.env.BOTS ?? 10) });
  const obs = m.seats[0]!.trainer; obs.party = []; obs.alive = false; m.seats[0]!.outcome = 'loss';
  const mins: unknown[] = [];
  const duels: unknown[] = [];
  const xp = { ko: 0, field: 0, bench: 0, catch: 0, candy: 0 };
  const party = (t: Trainer) => t.party.filter((p) => !p.captured);
  const lv = (t: Trainer) => party(t).map((p) => p.level);
  const left = () => m.trainers.filter((t) => t.alive);
  const elim: Record<string, unknown> = {};
  // Danger: knockouts of trainers' Pokémon by wilds (by kind), trainer downs, Alpha/boss fights.
  const danger = { koByWild: 0, koByAlpha: 0, koByBoss: 0, koByWildCenter: 0, downs: 0, alphaFights: 0, alphaWon: 0, bossFights: 0, bossWon: 0, catches: 0, centerSecs: 0, trainerSecs: 0 };
  const bigFights = new Map<number, { kind: string; t: Trainer }>();
  let steps = 0;
  const pendingDuels = new Map<unknown, Record<string, any>>();
  const who = new Map<Trainer, { start: string; startLv: number; region: string; firstCatch: number | null; firstKo: number | null; catches: number; kos: number; lv10: number | null; stuck: number; win?: { x: number; y: number; t: number; samples: number; errand: number; far: number; busy: boolean } }>();
  for (const t of m.trainers) if (t.alive) who.set(t, { start: t.party[0]!.name, startLv: t.party[0]!.level, region: m.ground.biomeAt(Math.floor(t.x), Math.floor(t.y)), firstCatch: null, firstKo: null, catches: 0, kos: 0, lv10: null, stuck: 0 });
  while (steps < 30 * 3600 && left().length > 1) {
    // who is deliberately going after whom, read before the step
    const intent = new Map<Trainer, string>();
    for (const t of m.trainers) intent.set(t, `${t.ai}:${t.aiKey ?? ''}`);
    m.over = false; m.step(1 / 60); steps++;
    let mode = '';
    for (const e of m.battle.events as Array<Record<string, any>>) {
      if (e.type === 'faint' && e.by?.owner) mode = 'ko';
      if (e.type === 'caught') mode = 'catch';
      if (e.type === 'xp' && e.mon?.owner && e.xp > 0) {
        const mon = e.mon as Mon;
        if (mode === 'ko') { xp.ko += e.xp; mode = 'share'; }
        else if (mode === 'catch') { xp.catch += e.xp; mode = ''; }
        else if (mode === 'share') { if (mon.stowed) xp.bench += e.xp; else xp.field += e.xp; }
      }
      if (e.type === 'faint' && e.mon?.owner && e.by?.wild) {
        danger.koByWild++;
        if (e.by.alpha) danger.koByAlpha++;
        if (e.by.landBoss || e.by.boss) danger.koByBoss++;
        if (Math.hypot(e.by.x - m.centerX, e.by.y - m.centerY) < 55) danger.koByWildCenter++;
      }
      if (e.type === 'downed') danger.downs++;
      if (e.type === 'caught') danger.catches++;
      if (e.type === 'caught' && who.has(e.by)) { const w = who.get(e.by)!; w.catches++; w.firstCatch ??= +(m.time / 60).toFixed(2); }
      if (e.type === 'faint' && e.by?.owner && who.has(e.by.owner) && e.mon?.wild) { const w = who.get(e.by.owner)!; w.kos++; w.firstKo ??= +(m.time / 60).toFixed(2); }
      if (e.type === 'cast' && e.attacker?.owner) for (const r of pendingDuels.values()) { if (r.aT === e.attacker.owner) r.aCasts++; if (r.bT === e.attacker.owner) r.bCasts++; }
      if (e.type === 'hit' && e.attacker?.owner && (e.target?.alpha || e.target?.landBoss) && !bigFights.has(e.target.id)) {
        bigFights.set(e.target.id, { kind: e.target.alpha ? 'alpha' : 'boss', t: e.attacker.owner });
        if (e.target.alpha) danger.alphaFights++; else danger.bossFights++;
      }
      if ((e.type === 'faint' || e.type === 'caught') && bigFights.has(e.mon?.id)) {
        const f = bigFights.get(e.mon.id)!;
        if (f.kind === 'alpha') danger.alphaWon++; else danger.bossWon++;
        bigFights.delete(e.mon.id);
      }
      if (e.type === 'duel-start') {
        const a = e.duel.a.trainer as Trainer, b = e.duel.b.trainer as Trainer;
        const ia = intent.get(a) ?? '', ib = intent.get(b) ?? '';
        const chose = (i: string, o: Trainer) => i.startsWith('engage:') && (i.endsWith(`r${o.id}`) || i.endsWith('last'));
        const rec: Record<string, any> = { t: +(m.time / 60).toFixed(2), start: m.time, a: a.name, b: b.name, aChose: chose(ia, b), bChose: chose(ib, a), aIntent: ia, bIntent: ib, aLv: lv(a), bLv: lv(b), winner: '', aCasts: 0, bCasts: 0 };
        Object.defineProperty(rec, 'aT', { value: a, enumerable: false });
        Object.defineProperty(rec, 'bT', { value: b, enumerable: false });
        pendingDuels.set(e.duel, rec); duels.push(rec);
      }
      if (e.type === 'duel-end') { const r = pendingDuels.get(e.duel); if (r) { r.winner = (e.winner as Trainer)?.name ?? ''; r.secs = +(m.time - r.start).toFixed(1); pendingDuels.delete(e.duel); } }
      if (e.type === 'eliminated' && e.trainer) { const t = e.trainer as Trainer; elim[t.name] = { at: +(m.time / 60).toFixed(2), how: t.grabbed != null ? 'storm' : t.lastKo ?? 'other', lv: lv(t) }; }
    }
    m.battle.events.length = 0;
    if (steps % 60 === 0) for (const t of left()) { danger.trainerSecs++; if (Math.hypot(t.x - m.centerX, t.y - m.centerY) < 55) danger.centerSecs++; }
    if (steps % 30 === 0) for (const t of left()) {
      const w = who.get(t);
      if (!w) continue;
      if (w.lv10 === null && lv(t).some((l) => l >= 10)) w.lv10 = +(m.time / 60).toFixed(2);
      // Stuck on errands: a 60 s stretch within 6 tiles, 80% of it on errands, no battle, not downed.
      let s = w.win;
      if (!s || m.time - s.t >= 60) {
        if (s && !s.busy && s.far <= 6 && s.errand >= 0.8 * s.samples) w.stuck++;
        s = w.win = { x: t.x, y: t.y, t: m.time, samples: 0, errand: 0, far: 0, busy: false };
      }
      s.busy ||= !!t.duelId || t.downUntil != null || t.grabbed != null;
      s.samples++;
      if (['hunt', 'shop', 'seekItem', 'heal'].includes(t.ai)) s.errand++;
      s.far = Math.max(s.far, Math.hypot(t.x - s.x, t.y - s.y));
    }
    if (steps % 3600 === 0) mins.push({ min: steps / 3600, alive: left().length, teams: m.trainers.filter((t) => t.alive).map((t) => ({ n: t.name, lv: lv(t), hp: party(t).map((p) => p.maxHp) })) });
  }
  const trainers = Object.fromEntries([...who].map(([t, w]) => [t.name, { start: w.start, region: w.region, firstCatch: w.firstCatch, firstKo: w.firstKo, catches: w.catches, kos: w.kos, lv10: w.lv10, stuck: w.stuck }]));
  console.log(JSON.stringify({ seed, minutes: +(m.time / 60).toFixed(2), winner: left()[0]?.name, winnerLv: left()[0] ? lv(left()[0]!) : [], mins, duels, xp, elim, danger, trainers, model: levelModel(), teammates: process.env.LAB_TEAMMATES ?? 'pause' }));
}
