/**
 * Review harness. Channelled beams measured alone: pulses actually delivered, damage per
 * pulse, total against 1.3x a single hit, crits, the per-pulse floor of 1, and burn applications.
 */
import { join } from 'node:path';
import { loadWorld } from '../../server/world';
import { Match } from '../../src/sim/match';
import { Rng } from '../../src/core/rng';
import { computeDamage } from '../../src/sim/battle';
import { move } from '../../src/sim/data';

const world = await loadWorld(join(import.meta.dirname, '..', '..', 'assets'));
const N = Number(process.env.N ?? 150);
const out: unknown[] = [];
for (const [dexA, dexB, mv] of [['0006', '0143', 'flamethrower'], ['0006', '0076', 'flamethrower'], ['0130', '0143', 'hydro-pump'], ['0026', '0143', 'thunderbolt']] as const)
  for (const L of [10, 25, 40, 60]) {
    const m = new Match({ ground: world.ground(), rng: new Rng(5), sprites: world.sprites }, [], { humans: [{ name: 'O', starters: ['0025'] }], rivals: 0 });
    m.wilds = [];
    const p = m.seats[0]!.trainer; p.party = [];
    m.darkness.radius = m.darkness.targetRadius = 999; m.darkness.nextPulseIn = 1e9;
    let anyStatus = 0, zeroHits = 0;
    let total = 0, pulses = 0, crits = 0, floors = 0, burns = 0, casts = 0, firstPulse = 0, lastPulse = 0;
    const perPulse: number[] = [];
    for (let k = 0; k < N; k++) {
      const a = m.makeMon(dexA, L, null, p.x, p.y + 3); const b = m.makeMon(dexB, L, null, p.x + 3, p.y + 3);
      a.wild = true; b.wild = true; (b as { boss?: boolean }).boss = true; b.maxHp = b.hp = 999999;
      a.moves = [mv]; a.cooldowns = [0]; b.moves = []; b.cooldowns = [];
      m.wilds = [a, b];
      m.battle.castToward(a, 0, b.x, b.y, 5.6, b);
      casts++;
      let i = 0, n = 0, gotStatus = false;
      for (let s = 0; s < 60 * 3; s++) {
        m.darkness.radius = m.darkness.targetRadius = 999; m.darkness.nextPulseIn = 1e9;
        a.target = null; b.target = null; b.x = b.px = p.x + 3; b.y = b.py = p.y + 3;
        m.step(1 / 60);
        for (const e of m.battle.events as any[]) {
          if (e.type === 'hit' && e.target === b) { total += e.damage; pulses++; n++; if (e.crit) crits++; if (e.damage === 1) floors++; perPulse[i] = (perPulse[i] ?? 0) + e.damage; i++; }
          if (e.type === 'status' && e.target === b) { burns++; gotStatus = true; b.status = null; }
          if (e.type === 'hit' && e.target === b && e.damage === 0) zeroHits++;
        }
        m.battle.events.length = 0;
      }
      b.status = null;
      if (gotStatus) anyStatus++;
      if (process.env.DBG && k < 3) console.error('cast', k, 'hits', n, 'a.channel', !!a.channel, 'a.cd', a.cooldowns[0].toFixed(2));
    }
    // Expected single hit (1.3x) from the same formula and dice, boss scale off
    const a = m.makeMon(dexA, L, null, 0, 0), b = m.makeMon(dexB, L, null, 0, 0);
    const rng = new Rng(9); let single = 0; for (let k = 0; k < 4000; k++) single += computeDamage(rng, a, b, move(mv)).damage;
    single = (single / 4000) * 1.3;
    const avg = total / casts;
    out.push({ mv, a: a.name, b: b.name, L, pulsesPerCast: +(pulses / casts).toFixed(2), avgTotal: +avg.toFixed(1), intended: +single.toFixed(1), ratio: +(avg / single).toFixed(2), firstPulseAvg: +((perPulse[0] ?? 0) / casts).toFixed(2), lastPulseAvg: +((perPulse[pulses / casts - 1 | 0] ?? 0) / casts).toFixed(2), critRate: +(crits / pulses).toFixed(3), pulsesAtFloor1: +(floors / pulses).toFixed(3), statusPerCast: +(burns / casts).toFixed(3), castsWithStatus: +(anyStatus / casts).toFixed(3), zeroPulses: +(zeroHits / pulses).toFixed(3) });
  }
console.log(JSON.stringify(out));
