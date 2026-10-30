/**
 * Review harness: one computer trainer's AI state, target, position and party every second for the
 * first `minutes` of a seeded match (the stall study's setup: 9 rivals, observer out).
 *   npx tsx tools/review/bottrace.ts <seed> <name> [minutes]
 */
import { join } from 'node:path';
import { loadWorld } from '../../server/world';
import { Match } from '../../src/sim/match';
import { Rng } from '../../src/core/rng';

const world = await loadWorld(join(import.meta.dirname, '..', '..', 'assets'));
const [seedS, name, minS] = process.argv.slice(2);
const m = new Match({ ground: world.ground(), rng: new Rng(Number(seedS)), sprites: world.sprites }, [], { humans: [{ name: 'Observer', starters: ['0025'] }], rivals: Number(process.env.BOTS ?? 9) });
const obs = m.seats[0]!.trainer; obs.party = []; obs.alive = false; m.seats[0]!.outcome = 'loss';
const t = m.trainers.find((x) => x.name === name)!;
if (!t) { console.log('no trainer', name, m.trainers.map((x) => x.name)); process.exit(1); }
for (let i = 1; i <= Number(minS ?? 4) * 3600; i++) {
  m.over = false; m.step(1 / 60);
  m.battle.events.length = 0;
  if (i % 60 === 0) {
    const tgt = t.aiTarget ? `${t.aiTarget.x.toFixed(1)},${t.aiTarget.y.toFixed(1)}` : '-';
    console.log(`${(i / 60).toFixed(0)}s ${t.ai} key=${t.aiKey ?? ''} timer=${(t.aiTimer ?? 0).toFixed(1)} at=${t.x.toFixed(1)},${t.y.toFixed(1)} tgt=${tgt} money=${t.money} items=${t.items.filter(Boolean).map((s) => `${s!.id}x${s!.count}`).join('/')} party=${t.party.map((p) => `${p.name}${p.level}:${p.hp}/${p.maxHp}${p.fainted ? 'KO' : ''}`).join(' ')}`);
  }
}
