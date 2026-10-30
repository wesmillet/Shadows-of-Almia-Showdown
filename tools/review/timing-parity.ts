/**
 * Review harness: the same seeded match run twice, once with every species' AnimData loaded (the
 * server and the node harness) and once with none loaded (the offline browser before a species'
 * sprites arrive). Prints how many hits and casts differ. With the strike table both agree exactly.
 *   npx tsx tools/review/timing-parity.ts [seed] [minutes]
 */
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { FanGround, type FanMapFile } from '../../src/ground/fanGround';
import { readFileSync } from 'node:fs';
import { CONFIG, SPECIES } from '../../src/sim/data';
import { Match } from '../../src/sim/match';
import { Rng } from '../../src/core/rng';
import { SpriteRegistry } from '../../src/sprites/pokemonSprite';
import { NodeAssets } from '../../server/nodeAssets';

class NoSprites extends NodeAssets {
  override async text(path: string): Promise<string | null> {
    return path.endsWith('AnimData.xml') ? null : super.text(path);
  }
}
const dir = join(import.meta.dirname, '..', '..', 'assets');
const map = JSON.parse(readFileSync(join(dir, 'maps', `${CONFIG.map.name}.json`), 'utf8')) as FanMapFile;
const seed = Number(process.argv[2] ?? 4242);
const minutes = Number(process.argv[3] ?? 3);

async function run(assets: NodeAssets): Promise<{ trace: string[]; hash: string }> {
  const sprites = new SpriteRegistry(assets);
  await sprites.preload([...SPECIES.keys()]);
  const m = new Match({ ground: FanGround.headless(map), rng: new Rng(seed), sprites }, [], { humans: [{ name: 'Observer', starters: ['0025'] }], rivals: 9 });
  const trace: string[] = [];
  // Pokémon ids count up across the process: name each by the order it first appears in this run.
  const ids = new Map<number, number>();
  const id = (x: number | undefined) => (x === undefined ? -1 : ids.get(x) ?? (ids.set(x, ids.size), ids.size - 1));
  for (let i = 0; i < minutes * 3600; i++) {
    m.step(1 / 60);
    for (const e of m.battle.events as Array<Record<string, any>>) {
      if (e.type === 'hit') trace.push(`${i} hit ${id(e.attacker?.id)} ${id(e.target?.id)} ${e.damage}`);
      if (e.type === 'cast') trace.push(`${i} cast ${id(e.attacker?.id)} ${e.move?.id}`);
    }
    m.battle.events.length = 0;
  }
  return { trace, hash: createHash('sha1').update(trace.join('\n')).digest('hex').slice(0, 12) };
}
const loaded = await run(new NodeAssets(dir));
const blank = await run(new NoSprites(dir));
let first = -1;
for (let i = 0; i < Math.max(loaded.trace.length, blank.trace.length); i++) if (loaded.trace[i] !== blank.trace[i]) { first = i; break; }
console.log(JSON.stringify({ seed, minutes, loaded: { events: loaded.trace.length, hash: loaded.hash }, noSprites: { events: blank.trace.length, hash: blank.hash }, identical: first < 0, firstDifference: first < 0 ? null : { loaded: loaded.trace[first], noSprites: blank.trace[first] } }));
