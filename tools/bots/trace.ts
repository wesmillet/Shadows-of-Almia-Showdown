/**
 * Follows one computer trainer through a full 10-trainer match and prints what it is doing, where,
 * and whether the way to its target is open, between two match times (for looking into a stuck bot).
 *   SEED=501 npx tsx tools/bots/trace.ts <name> <fromSeconds> <toSeconds> [everySeconds=1]
 */
import { join } from 'node:path';
import { loadWorld } from '../../server/world';
import { Match } from '../../src/sim/match';
import { Rng } from '../../src/core/rng';

const [who = 'Rook', from = '0', to = '60', every = '1'] = process.argv.slice(2);
const world = await loadWorld(join(import.meta.dirname, '..', '..', 'assets'));
const m = new Match({ ground: world.ground(), rng: new Rng(Number(process.env.SEED ?? 500)), sprites: world.sprites }, [], { humans: [{ name: 'Observer', starters: ['0025'] }], rivals: Number(process.env.BOTS ?? 10) });
const o = m.seats[0]!.trainer;
o.party = [];
o.alive = false;
m.seats[0]!.outcome = 'loss';
const t = m.trainers.find((x) => x.name === who)!;
const g = m.ground;
let next = Number(from);
while (m.time < Number(to) && t.alive) {
  m.over = false;
  m.step(1 / 60);
  m.battle.events.length = 0;
  if (m.time < next) continue;
  next += Number(every);
  const tg = t.aiTarget;
  const tile = `${Math.floor(t.x)},${Math.floor(t.y)}`;
  const dir = tg ? m.nav.dir(t.x, t.y, tg.x, tg.y) : null;
  console.log(`${m.time.toFixed(1)} ${t.ai}/${t.aiKey ?? '-'}${t.bot?.why ? `(${t.bot.why})` : ''} at ${t.x.toFixed(2)},${t.y.toFixed(2)} [${tile} walk=${g.walkable(Math.floor(t.x), Math.floor(t.y))} reach=${g.reachable(Math.floor(t.x), Math.floor(t.y))}] -> ${tg ? `${tg.x.toFixed(1)},${tg.y.toFixed(1)} d=${Math.hypot(tg.x - t.x, tg.y - t.y).toFixed(1)} clear=${m.nav.clearLine(t.x, t.y, tg.x, tg.y)} nav=${dir ? `${dir.x.toFixed(2)},${dir.y.toFixed(2)}` : 'none'}` : '-'} hp=${t.party.map((p) => `${p.hp}/${p.maxHp}`).join(' ')} storm=${(t.stormT ?? 0).toFixed(1)} dark=${m.isDark(t.x, t.y)} near=${m.wilds.filter((w) => Math.hypot(w.x - t.x, w.y - t.y) < 3).map((w) => `${w.name}L${w.level}@${w.x.toFixed(1)},${w.y.toFixed(1)}${w.target ? '!' : ''}`).join(' ')} party=${t.party.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}${p.target ? '>' + p.target.name : ''}`).join(' ')}`);
}
