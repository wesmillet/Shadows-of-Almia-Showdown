/**
 * Review harness: the timeline of one channelled beam (cast, channel start, every pulse's resolve and
 * damage, channel end) against a stationary target. Prints seconds from the cast.
 *   npx tsx tools/review/beamtime.ts [move] [interruptAt]
 */
import { join } from 'node:path';
import { loadWorld } from '../../server/world';
import { Match } from '../../src/sim/match';
import { Rng } from '../../src/core/rng';

const world = await loadWorld(join(import.meta.dirname, '..', '..', 'assets'));
const mv = process.argv[2] ?? 'flamethrower';
const cut = Number(process.argv[3] ?? -1);
const m = new Match({ ground: world.ground(), rng: new Rng(5), sprites: world.sprites }, [], { humans: [{ name: 'O', starters: ['0025'] }], rivals: 0 });
const p = m.seats[0]!.trainer; p.party = [];
const hold = () => { m.darkness.radius = m.darkness.targetRadius = 999; m.darkness.nextPulseIn = 1e9; };
hold();
const a = m.makeMon('0006', 40, null, p.x, p.y + 3); const b = m.makeMon('0143', 40, null, p.x + 3, p.y + 3);
a.wild = true; b.wild = true; (b as { boss?: boolean }).boss = true; b.maxHp = b.hp = 999999; a.moves = [mv]; a.cooldowns = [0]; b.moves = []; b.cooldowns = [];
m.wilds = [a, b];
m.battle.castToward(a, 0, b.x, b.y, 5.6, b);
const t0 = m.time;
const log: string[] = [];
for (let s = 0; s < 60 * 3; s++) {
  hold(); a.target = null; b.target = null; b.x = b.px = p.x + 3; b.y = b.py = p.y + 3;
  if (cut > 0 && Math.abs(m.time - t0 - cut) < 1 / 120) m.battle.interrupt(a);
  m.step(1 / 60);
  const t = (m.time - t0).toFixed(3);
  for (const e of m.battle.events as any[]) {
    if (e.type === 'channel-start' || e.type === 'channel-end') log.push(`${t} ${e.type}`);
    if (e.type === 'resolve' && e.attacker === a) log.push(`${t} resolve hits=${e.hits.length} power=${e.move.power}`);
    if (e.type === 'hit' && e.target === b) log.push(`${t} hit ${e.damage}`);
  }
  m.battle.events.length = 0;
}
console.log(log.join('\n'));
