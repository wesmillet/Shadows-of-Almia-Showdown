/** Check: a cast that names a nearby opponent aims at where it really is. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FanGround, type FanMapFile } from '../../src/ground/fanGround';
import { CONFIG, SPECIES } from '../../src/sim/data';
import { Match } from '../../src/sim/match';
import { Rng } from '../../src/core/rng';
import { SpriteRegistry } from '../../src/sprites/pokemonSprite';
import { NodeAssets } from '../nodeAssets';
import { runCommand } from '../commands';

const ROOT = join(import.meta.dirname, '..', '..', 'assets');
const map = JSON.parse(readFileSync(join(ROOT, 'maps', `${CONFIG.map.name}.json`), 'utf8')) as FanMapFile;
const sprites = new SpriteRegistry(new NodeAssets(ROOT));
await sprites.preload([...SPECIES.keys()]);
const m = new Match({ ground: FanGround.headless(map), rng: new Rng(5), sprites }, [], { humans: [{ name: 'A', starters: ['0006'] }], rivals: 1 });
m.online = true;
const seat = m.seats[0]!;
for (let i = 0; i < 60; i++) m.step(1 / 60);
const me = m.withSeat(seat, () => m.actingMon)!;
const foe = [...m.mons()].find((c) => c !== me && m.battle.isEnemy(me, c) && !c.fainted)!;
const results: Record<string, unknown> = {};
for (const [name, withId] of [['without id', false], ['with id', true]] as const) {
  me.cooldowns.fill(0);
  me.casting = null as never;
  // The foe sits 2 tiles to the right of my lead; my aim is where it was drawn, 1.5 tiles off.
  foe.x = me.x + 2; foe.y = me.y;
  seat.aim = { x: me.x + 2, y: me.y + 2.5 };
  runCommand(m, seat, 'cast', withId ? [0, foe.id] : [0]);
  const c = me.casting as unknown as { tx?: number; ty?: number; x?: number; y?: number } | null;
  results[name] = { dir: me.dir, casting: c ? Object.fromEntries(Object.entries(c).filter(([, v]) => typeof v === 'number')) : null };
}
// Too far from the aim to be the one aimed at: ignored.
me.cooldowns.fill(0); me.casting = null as never;
foe.x = me.x + 2; foe.y = me.y; seat.aim = { x: me.x - 3, y: me.y + 3 };
runCommand(m, seat, 'cast', [0, foe.id]);
results['far id ignored'] = { dir: me.dir };
console.log(JSON.stringify({ me: [me.x, me.y], foe: [foe.x, foe.y], ...results }, null, 1));
const withId = (results['with id'] as { casting: { targetX: number; targetY: number } | null }).casting;
if (!withId || Math.hypot(withId.targetX - foe.x, withId.targetY - foe.y) > 0.01) {
  console.error('FAIL: a cast naming the opponent did not aim at it');
  process.exit(1);
}
