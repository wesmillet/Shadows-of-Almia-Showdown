/**
 * Full matches of computer trainers only (10 by default), run headless, with a report on how the
 * bots played: how they went out, how their teams grew, and signs of camping, getting stuck or
 * repeating themselves.
 *
 *   npx tsx tools/bots/sim.ts [matches=4] [bots=10] [maxMinutes=30] [--json]
 *
 * Per bot, sampled every second:
 *   camping   longest stretch (s) spent within 6 tiles of one spot while not fighting a wild or a trainer
 *   outpost   share of its time within 4 tiles of a healer
 *   stuck     longest stretch (s) with a walk target more than 2 tiles off and under 0.5 tiles moved (not while its team fights)
 *   flips     decisions that went straight back to the target it had two decisions ago (A, B, A)
 *   bans      targets it gave up on as unreachable
 * Team growth: party size, best and average level, evolutions, catches, items used, at 5/10/15 min
 * and at the end.
 */
import { join } from 'node:path';
import { loadWorld } from '../../server/world';
import { CONFIG } from '../../src/sim/data';
import { Match } from '../../src/sim/match';
import { Rng } from '../../src/core/rng';
import type { Mon, Trainer } from '../../src/sim/entities';
import { fightMargin, partyHpFraction } from '../../src/sim/ai';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const asJson = process.argv.includes('--json');
const matches = Number(args[0] ?? 4);
const bots = Number(args[1] ?? 10);
const maxMinutes = Number(args[2] ?? 30);
const seed0 = Number(process.env.SEED ?? 500);
const world = await loadWorld(join(import.meta.dirname, '..', '..', 'assets'));

interface Track {
  t: Trainer;
  camp: { x: number; y: number; since: number; best: number };
  stuck: { x: number; y: number; since: number; best: number; at?: string };
  outpostS: number;
  aliveS: number;
  keys: string[];
  flips: number;
  bans: number;
  evolutions: number;
  itemsUsed: number;
  catches: number;
  throws: number;
  states: Record<string, number>;
  out?: { at: number; how: string };
  downs: number;
  snaps: Record<string, { size: number; best: number; avg: number }>;
  /** Seconds spent in the storm, chasing a rival without a battle, and keeping away from rivals. */
  stormS: number;
  chaseS: number;
  avoidS: number;
  duels: number;
  hunts: number;
  starter: string;
}

const results: unknown[] = [];
/** Fights with wilds by predicted margin (at the first blow): how many, how many the team won (knocked out or caught), HP lost. */
const flipKinds = new Map<string, number>();
const fights: Array<{ margin: number; won: boolean; hpLost: number; big: boolean }> = [];
const open = new Map<string, { t: Trainer; w: Mon; margin: number; hp0: number; big: boolean; at: number }>();
const agg = { matches: 0, minutes: 0, out: {} as Record<string, number>, winnerParty: 0, winnerBest: 0 };
/** Every stretch a bot spent stuck (wanting to walk somewhere, not fighting, getting nowhere) of 5 s or more. */
const stuckEpisodes: Array<{ secs: number; where: string }> = [];
/** The final two: their levels when two were left, and at the end. */
const finals: string[] = [];
let duelsAll = 0;

for (let k = 0; k < matches; k++) {
  const seed = seed0 + k;
  const m = new Match({ ground: world.ground(), rng: new Rng(seed), sprites: world.sprites }, [], { humans: [{ name: 'Observer', starters: ['0025'] }], rivals: bots });
  // The observer seat sits the match out: no party, out of the match from the start.
  const obs = m.seats[0]!.trainer;
  obs.party = [];
  obs.alive = false;
  m.seats[0]!.outcome = 'loss';
  const tracks = new Map<Trainer, Track>();
  for (const t of m.trainers) {
    tracks.set(t, {
      t, camp: { x: t.x, y: t.y, since: 0, best: 0 }, stuck: { x: t.x, y: t.y, since: 0, best: 0 }, outpostS: 0, aliveS: 0,
      keys: [], flips: 0, bans: 0, evolutions: 0, itemsUsed: 0, catches: 0, throws: 0, states: {}, downs: 0, snaps: {},
      stormS: 0, chaseS: 0, avoidS: 0, duels: 0, hunts: 0, starter: `${t.party[0]?.name} ${t.party[0]?.level}`,
    });
  }
  const dt = 1 / 60;
  let steps = 0;
  const left = () => m.trainers.filter((t) => t.alive && !t.visitor && !t.challenger);
  while (steps < maxMinutes * 3600 && left().length > 1) {
    m.over = false;
    m.step(dt);
    steps++;
    for (const e of m.battle.events) {
      // Fights with wilds: the margin when the first blow lands, and how it ended.
      if (e.type === 'hit') {
        const [w, mine] = e.attacker.wild ? [e.attacker, e.target] : [e.target, e.attacker];
        const t = mine.owner;
        if (w.wild && !w.boss && t && tracks.has(t) && !open.has(`${t.id}:${w.id}`)) {
          open.set(`${t.id}:${w.id}`, { t, w, margin: fightMargin(t, w), hp0: partyHpFraction(t), big: !!(w.alpha || w.landBoss), at: m.time });
        }
      }
      const close = (key: string, won: boolean) => {
        const o = open.get(key);
        if (!o) return;
        fights.push({ margin: o.margin, won, hpLost: Math.max(0, o.hp0 - partyHpFraction(o.t)), big: o.big });
        open.delete(key);
      };
      if (e.type === 'faint' && e.mon.wild && e.by?.owner) close(`${e.by.owner.id}:${e.mon.id}`, true);
      if (e.type === 'caught' && e.by) close(`${e.by.id}:${e.mon.id}`, true);
      if (e.type === 'faint' && e.mon.owner && e.by?.wild) {
        const t = e.mon.owner;
        if (!t.party.some((p) => !p.fainted && !p.captured)) close(`${t.id}:${e.by.id}`, false);
      }
      const tr = (e as { trainer?: Trainer }).trainer;
      if (e.type === 'evolved' && e.mon.owner) { const x = tracks.get(e.mon.owner); if (x) x.evolutions++; }
      if (e.type === 'caught' && e.by) { const x = tracks.get(e.by); if (x) x.catches++; }
      if (e.type === 'eliminated' && tr) { const x = tracks.get(tr); if (x && !x.out) x.out = { at: m.time, how: tr.grabbed != null ? 'storm' : tr.lastKo === 'trainer' ? 'trainer' : tr.lastKo ?? 'other' }; }
      if (e.type === 'downed' && tr) { const x = tracks.get(tr); if (x) x.downs++; }
      if (e.type === 'duel-start') {
        duelsAll++;
        for (const s of [e.duel.a, e.duel.b]) { const x = tracks.get(s.trainer); if (x) x.duels++; }
      }
    }
    m.battle.events.length = 0;
    if (steps % 60 !== 0) continue;
    // A fight left for a minute without a knockout either way: it was walked away from.
    for (const [key, o] of open) if (m.time - o.at > 60) {
      fights.push({ margin: o.margin, won: false, hpLost: Math.max(0, o.hp0 - partyHpFraction(o.t)), big: o.big });
      open.delete(key);
    }
    const now = m.time;
    if (left().length === 2 && !finals.some((f) => f.startsWith(`${seed}:`))) {
      finals.push(`${seed}: two left at ${(now / 60).toFixed(1)} min: ` + left().map((t) => `${t.name} [${t.party.filter((p) => !p.captured).map((p) => p.level).join(',')}]`).join(' vs '));
    }
    for (const x of tracks.values()) {
      const t = x.t;
      if (!t.alive) continue;
      x.aliveS++;
      x.states[t.ai] = (x.states[t.ai] ?? 0) + 1;
      if (t.downUntil != null) {
        x.stuck = { x: t.x, y: t.y, since: now, best: x.stuck.best, at: undefined };
        continue;
      }
      x.throws = (t.bot as { thrown?: number } | undefined)?.thrown ?? 0;
      const fighting = !!t.duelId || t.party.some((p) => p.target && !p.fainted && Math.hypot(p.target.x - p.x, p.target.y - p.y) < 8);
      if (m.isDark(t.x, t.y)) x.stormS++;
      if (t.ai === 'engage' && t.aiKey !== 'last' && !t.duelId) x.chaseS++;
      if (t.ai === 'flee' && t.bot?.why === 'rival') x.avoidS++;
      if (t.ai === 'hunt' && t.aiKey && t.aiKey !== x.keys.at(-1)) x.hunts++;
      // camping: stays within 6 tiles of where it settled
      if (Math.hypot(t.x - x.camp.x, t.y - x.camp.y) > 6 || fighting) x.camp = { x: t.x, y: t.y, since: now, best: x.camp.best };
      x.camp.best = Math.max(x.camp.best, now - x.camp.since);
      // stuck: wants to go somewhere 2+ tiles off and isn't moving
      const far = t.aiTarget && Math.hypot(t.aiTarget.x - t.x, t.aiTarget.y - t.y) > 2 && !t.duelId && !fighting;
      if (!far || Math.hypot(t.x - x.stuck.x, t.y - x.stuck.y) > 1) {
        const secs = now - x.stuck.since;
        if (secs >= 5) stuckEpisodes.push({ secs, where: `${t.name} ${x.stuck.at ?? ''}` });
        x.stuck = { x: t.x, y: t.y, since: now, best: x.stuck.best, at: undefined };
      }
      if (far && !x.stuck.at) x.stuck.at = `${t.ai}/${t.aiKey ?? '-'} at ${t.x.toFixed(1)},${t.y.toFixed(1)} -> ${t.aiTarget!.x.toFixed(1)},${t.aiTarget!.y.toFixed(1)} t=${Math.round(now)}`;
      if (now - x.stuck.since > x.stuck.best) x.stuck.best = now - x.stuck.since;
      if (m.outposts.some((o) => Math.hypot(o.x - t.x, o.y - t.y) < 4)) x.outpostS++;
      const key = t.aiKey ?? (t.ai === 'flee' ? `flee-${t.bot?.why ?? ''}` : `${t.ai}`);
      if (key !== x.keys.at(-1)) {
        x.keys.push(key);
        if (x.keys.length >= 3 && key.length > 1 && key === x.keys.at(-3) && key !== 'roam') {
          x.flips++;
          const pat = `${t.ai}:${x.keys.at(-2)?.replace(/\d+/g, '#')}>${key.replace(/\d+/g, '#')}`;
          flipKinds.set(pat, (flipKinds.get(pat) ?? 0) + 1);
        }
      }
      x.bans = Object.keys(t.aiBans ?? {}).length;
      for (const mark of [300, 600, 900]) {
        if (Math.abs(now - mark) < 0.6) {
          const team = t.party.filter((p) => !p.captured);
          x.snaps[`${mark / 60}m`] = { size: team.length, best: Math.max(...team.map((p) => p.level)), avg: +(team.reduce((a, p) => a + p.level, 0) / Math.max(1, team.length)).toFixed(1) };
        }
      }
    }
  }
  const winner = left().length === 1 ? left()[0] : null;
  const rows = [...tracks.values()].map((x) => {
    const team = x.t.party.filter((p) => !p.captured);
    x.snaps.end = { size: team.length, best: Math.max(...team.map((p) => p.level)), avg: +(team.reduce((a, p) => a + p.level, 0) / Math.max(1, team.length)).toFixed(1) };
    const how = x.out?.how ?? (x.t === winner ? 'WON' : 'alive');
    agg.out[how] = (agg.out[how] ?? 0) + 1;
    return {
      name: x.t.name, result: how, outAt: x.out ? +(x.out.at / 60).toFixed(1) : null,
      team: team.map((p) => `${p.name} ${p.level}`).join(', '),
      catches: x.catches, throws: x.throws, items: x.t.bot?.used ?? 0, money: x.t.money, evolutions: x.evolutions, downs: x.downs,
      stormS: x.stormS, chaseS: x.chaseS, avoidS: x.avoidS, duels: x.duels, hunts: x.hunts, starter: x.starter,
      campMax: Math.round(x.camp.best), stuckMax: Math.round(x.stuck.best), stuckAt: x.stuck.best > 20 ? x.stuck.at : undefined, outpostPct: Math.round((100 * x.outpostS) / Math.max(1, x.aliveS)),
      flips: x.flips, bans: x.bans, snaps: x.snaps,
      states: Object.fromEntries(Object.entries(x.states).map(([s, n]) => [s, Math.round((100 * n) / Math.max(1, x.aliveS))])),
    };
  });
  agg.matches++;
  agg.minutes += m.time / 60;
  if (winner) {
    agg.winnerParty += winner.party.filter((p) => !p.captured).length;
    agg.winnerBest += Math.max(...winner.party.map((p) => p.level));
  }
  results.push({ seed, minutes: +(m.time / 60).toFixed(1), winner: winner?.name ?? null, rows });
  if (!asJson) {
    console.log(`\n=== match seed ${seed}: ${(m.time / 60).toFixed(1)} min, winner ${winner?.name ?? 'none'} ===`);
    for (const r of rows) {
      console.log(`${r.name.padEnd(8)} ${String(r.result).padEnd(8)} out@${String(r.outAt ?? '-').padEnd(5)} start ${r.starter} catch ${r.catches}/${r.throws} hunts ${r.hunts} items ${r.items} ₽${r.money} evo ${r.evolutions} downs ${r.downs} duels ${r.duels} chase ${r.chaseS}s avoid ${r.avoidS}s storm ${r.stormS}s camp ${r.campMax}s stuck ${r.stuckMax}s outpost ${r.outpostPct}% flips ${r.flips} | 5m ${fmt(r.snaps['5m'])} 10m ${fmt(r.snaps['10m'])} end ${fmt(r.snaps.end)} | ${r.team}`);
      console.log(`         states ${JSON.stringify(r.states)}`);
    }
  }
}
function fmt(s?: { size: number; best: number; avg: number }): string {
  return s ? `${s.size}x L${s.best}/${s.avg}` : '-';
}
const summary = { matches: agg.matches, avgMinutes: +(agg.minutes / agg.matches).toFixed(1), outcomes: agg.out, winnerParty: +(agg.winnerParty / agg.matches).toFixed(1), winnerBestLevel: +(agg.winnerBest / agg.matches).toFixed(1), storm: CONFIG.darkness ? 'on' : 'off' };
const bins = [[0, 1], [1, 1.25], [1.25, 1.5], [1.5, 2], [2, 3], [3, 99]] as const;
const calib = bins.map(([a, b]) => {
  const f = fights.filter((x) => x.margin >= a && x.margin < b);
  return { margin: `${a}-${b}`, n: f.length, won: f.length ? Math.round((100 * f.filter((x) => x.won).length) / f.length) : null, hpLost: f.length ? Math.round((100 * f.reduce((q, x) => q + x.hpLost, 0)) / f.length) : null, big: f.filter((x) => x.big).length };
});
if (!asJson) console.log('FIGHTS by margin', JSON.stringify(calib));
if (!asJson) {
  stuckEpisodes.sort((a, b) => b.secs - a.secs);
  const over = (n: number) => stuckEpisodes.filter((e) => e.secs >= n).length;
  console.log(`STUCK episodes: ${stuckEpisodes.length} of 5 s+, ${over(10)} of 10 s+, ${over(20)} of 20 s+; longest:`);
  for (const e of stuckEpisodes.slice(0, 6)) console.log(`  ${e.secs.toFixed(0)} s  ${e.where}`);
  console.log(`DUELS ${duelsAll} in ${agg.matches} matches`);
  for (const f of finals) console.log(`FINAL ${f}`);
}
if (!asJson) console.log('FLIPS', JSON.stringify([...flipKinds].sort((a, b) => b[1] - a[1]).slice(0, 12)));
if (asJson) console.log(JSON.stringify({ summary, calib, results }, null, 1));
else console.log('\nSUMMARY', JSON.stringify(summary));
