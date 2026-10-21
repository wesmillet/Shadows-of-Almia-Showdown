/** Smoke test: a full match on Node with several human seats driven by scripted input. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FanGround, type FanMapFile } from '../src/ground/fanGround';
import { CONFIG, SPECIES } from '../src/sim/data';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { SpriteRegistry } from '../src/sprites/pokemonSprite';
import { NodeAssets } from './nodeAssets';

const ROOT = join(import.meta.dirname, '..', 'assets');
const assets = new NodeAssets(ROOT);
const map = JSON.parse(readFileSync(join(ROOT, 'maps', `${CONFIG.map.name}.json`), 'utf8')) as FanMapFile;
const ground = FanGround.headless(map);
const sprites = new SpriteRegistry(assets);
const t0 = performance.now();
await sprites.preload([...SPECIES.keys()]);
const humans = Number(process.argv[3] ?? 3);
const match = new Match({ ground, rng: new Rng(99), sprites }, [], {
  humans: Array.from({ length: humans }, (_, i) => ({ name: `Player${i + 1}`, starters: [['0448', '0445', '0006', '0392'][i % 4] as string] })),
  rivals: 8 - humans,
});
const rng = new Rng(7);
const simSeconds = Number(process.argv[2] ?? 120);
let steps = 0;
const notices = new Map<string, number>();
const t1 = performance.now();
for (; steps < simSeconds * 60 && !match.over; steps++) {
  // Each human wanders, changing direction every couple of seconds, and casts now and then.
  for (const seat of match.seats) {
    if (steps % 120 === 0) {
      const a = rng.range(0, Math.PI * 2);
      seat.moveX = Math.cos(a);
      seat.moveY = Math.sin(a);
    }
    if (steps % 45 === 0) match.withSeat(seat, () => match.playerCast(rng.int(0, 1)));
  }
  match.step(1 / 60);
  for (const e of match.battle.events) if (e.type === 'notice') notices.set(`${e.to ?? 'all'}`, (notices.get(`${e.to ?? 'all'}`) ?? 0) + 1);
  match.battle.events.length = 0;
}
const t2 = performance.now();
console.log(JSON.stringify({
  loadMs: Math.round(t1 - t0), simSeconds: steps / 60, msPerStep: +((t2 - t1) / steps).toFixed(3),
  seats: match.seats.map((s) => ({ name: s.trainer.name, alive: s.trainer.alive, outcome: s.outcome, x: Math.round(s.trainer.x), y: Math.round(s.trainer.y), party: s.trainer.party.map((m) => `${m.name}${m.fainted ? '(KO)' : ''}`).join('/') })),
  rivalsAlive: match.trainers.filter((t) => t.alive && !t.visitor && !t.challenger).length, over: match.over, notices: Object.fromEntries(notices),
}, null, 1));
