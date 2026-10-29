/**
 * A computer trainer's Pokémon against one wild Pokémon, alone on open ground: how often it wins,
 * against the margin fightMargin predicts. Mirror matches (the same species and level on both
 * sides) should come out about even if the trainer's side fights as well as a wild one.
 *   npx tsx tools/bots/duel1v1.ts [rounds=20] [dex=0025] [level=5] [foeDex=same] [foeLevel=same]
 */
import { join } from 'node:path';
import { loadWorld } from '../../server/world';
import { Match } from '../../src/sim/match';
import { Rng } from '../../src/core/rng';
import { fightMargin } from '../../src/sim/ai';

const [rounds = '20', dex = '0025', lv = '5', fdex, flv] = process.argv.slice(2);
const world = await loadWorld(join(import.meta.dirname, '..', '..', 'assets'));
let wins = 0, total = 0, secs = 0, margin = 0, caught = 0;
for (let r = 0; r < Number(rounds); r++) {
  const m = new Match({ ground: world.ground(), rng: new Rng(100 + r), sprites: world.sprites }, [], { humans: [{ name: 'O', starters: ['0025'] }], rivals: 1 });
  const obs = m.seats[0]!.trainer; obs.party = []; obs.alive = false; m.seats[0]!.outcome = 'loss';
  const b = m.trainers[0]!;
  b.party = [m.makeMon(dex, Number(lv), b, b.x, b.y)];
  // an open spot far from everything: the bot's start, all other wilds removed
  const foe = m.makeMon(fdex ?? dex, Number(flv ?? lv), null, b.x + 4, b.y);
  foe.homeX = foe.x; foe.homeY = foe.y;
  m.wilds = [foe];
  m.items = [];
  m.placeParty(b);
  margin += fightMargin(b, foe);
  let t = 0;
  while (t < 300 && !foe.fainted && foe.owner !== b && b.party.some((p) => !p.fainted)) { m.over = false; m.step(1 / 60); m.battle.events.length = 0; t += 1 / 60; }
  total++;
  if (foe.fainted || foe.owner === b) wins++;
  if (foe.owner === b) caught++;
  secs += t;
}
console.log(`${dex} L${lv} vs ${fdex ?? dex} L${flv ?? lv}: won ${wins}/${total} (caught ${caught}), avg ${(secs / total).toFixed(1)} s, predicted margin ${(margin / total).toFixed(2)}`);
