/** Check: squads. Teammates never fight or battle each other, and the last team standing wins. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FanGround, type FanMapFile } from '../../src/ground/fanGround';
import { CONFIG, SPECIES } from '../../src/sim/data';
import { Match } from '../../src/sim/match';
import { Rng } from '../../src/core/rng';
import { SpriteRegistry } from '../../src/sprites/pokemonSprite';
import { NodeAssets } from '../nodeAssets';

const ROOT = join(import.meta.dirname, '..', '..', 'assets');
const map = JSON.parse(readFileSync(join(ROOT, 'maps', `${CONFIG.map.name}.json`), 'utf8')) as FanMapFile;
const sprites = new SpriteRegistry(new NodeAssets(ROOT));
await sprites.preload([...SPECIES.keys()]);
const fail = (why: string): never => {
  console.error(`FAIL: ${why}`);
  process.exit(1);
};
const m = new Match({ ground: FanGround.headless(map), rng: new Rng(11), sprites }, [], {
  humans: [
    { name: 'A1', starters: ['0006'], team: 1 },
    { name: 'A2', starters: ['0009'], team: 1 },
    { name: 'B1', starters: ['0003'], team: 2 },
    { name: 'B2', starters: ['0025'], team: 2 },
  ],
  rivals: 2,
});
m.online = true;
const [a1, a2, b1, b2] = m.seats.map((s) => s.trainer);
if (!a1 || !a2 || !b1 || !b2) fail('seats missing');
const lead = (t: typeof a1) => t!.party[0]!;
if (m.battle.isEnemy(lead(a1), lead(a2))) fail('teammates are enemies');
if (!m.battle.isEnemy(lead(a1), lead(b1))) fail('opponents are not enemies');
// Teammates side by side never start a battle; an opponent next to them does.
a2!.x = a1!.x + 1.5;
a2!.y = a1!.y;
for (let i = 0; i < 30; i++) m.step(1 / 60);
if (a1!.duelId && a1!.duelId === a2!.duelId) fail('teammates started a battle');
// Team 2 and the computer trainers are knocked out: team 1 wins, even with A2 down too.
m.eliminate(a2!);
for (const t of [b1, b2, ...m.trainers.filter((t) => !t.isPlayer && !t.visitor && !t.challenger)]) if (t!.alive) m.eliminate(t!);
for (let i = 0; i < 10; i++) m.step(1 / 60);
const out = Object.fromEntries(m.seats.map((s) => [s.trainer.name, s.outcome]));
if (out.A1 !== 'win' || out.B1 !== 'loss' || out.B2 !== 'loss' || out.A2 !== 'loss') fail(`outcomes ${JSON.stringify(out)}`);
if (!m.over) fail('match not over');
console.log('teams ok', JSON.stringify(out));
