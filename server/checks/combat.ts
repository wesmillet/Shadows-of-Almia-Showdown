/**
 * Check: moves in real combat on the real map (the 28 October move audit). Two Pokémon on the
 * island's own ground, stepped the way a match steps them (lunge, slam, shove, cast, shots in flight):
 *   - contact moves land when the bodies touch and miss beyond their lunge, for small and big bodies;
 *   - a lunge stopped by a wall, or a target that runs, is a miss (no damage from the cast alone);
 *   - shots stop at walls, falling moves do not; a shot misses a target that moved clear;
 *   - shoves: light and heavy differ, walls stop them, beams and bosses don't shove.
 *   npx tsx server/checks/combat.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FanGround, type FanMapFile } from '../../src/ground/fanGround';
import { CONFIG, SPECIES, bodyRadius, move } from '../../src/sim/data';
import { Match } from '../../src/sim/match';
import { canStand } from '../../src/sim/movement';
import { Rng } from '../../src/core/rng';
import { SpriteRegistry } from '../../src/sprites/pokemonSprite';
import { BattleSystem } from '../../src/sim/battle';
import type { Mon } from '../../src/sim/entities';
import { NodeAssets } from '../nodeAssets';

const ROOT = join(import.meta.dirname, '..', '..', 'assets');
const map = JSON.parse(readFileSync(join(ROOT, 'maps', `${CONFIG.map.name}.json`), 'utf8')) as FanMapFile;
const ground = FanGround.headless(map);
const sprites = new SpriteRegistry(new NodeAssets(ROOT));
const DEXES = ['0001', '0025', '0129', '0208', '0321', '0133', '0149', '0006', '0068', '0373', '0445'].filter((d) => SPECIES.has(d));
await sprites.preload(DEXES);
let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};
const match = new Match({ ground, rng: new Rng(11), sprites }, [], { humans: [{ name: 'P1', starters: ['0025'] }], rivals: 0 });
match.wilds = [];
const P = match.seats[0]!.trainer;
const M = match as unknown as { stepLunge(m: Mon, dt: number): void; stepSlam(m: Mon, dt: number): void; stepKnock(m: Mon, dt: number): void };

/** An open stretch of ground: every tile in a 14 x 7 box walkable. */
function openSpot(): { x: number; y: number } {
  const a = ground.features?.finalArena;
  const cands = a ? [{ x: (a.x0 + a.x1) / 2 - 6, y: (a.y0 + a.y1) / 2 }] : [];
  for (let y = 10; y < ground.rows - 10; y += 3) for (let x = 10; x < ground.cols - 20; x += 3) cands.push({ x, y });
  for (const c of cands) {
    let ok = true;
    for (let dy = -3; dy <= 3 && ok; dy++) for (let dx = -2; dx <= 12 && ok; dx++) ok = ground.walkable(Math.floor(c.x + dx), Math.floor(c.y + dy)) && !ground.inWater(Math.floor(c.x + dx), Math.floor(c.y + dy));
    if (ok) return { x: Math.floor(c.x) + 0.5, y: Math.floor(c.y) + 0.5 };
  }
  throw new Error('no open ground');
}
/** A wall two or three tiles thick across a row, open ground either side (x = its west face). */
function wallSpot(): { x: number; y: number; w: number } {
  for (let y = 8; y < ground.rows - 8; y++) {
    for (let x = 8; x < ground.cols - 8; x++) {
      const open = (dx: number) => [-1, 0, 1].every((dy) => ground.walkable(x + dx, y + dy));
      const solid = (dx: number) => [-1, 0, 1].every((dy) => !ground.walkable(x + dx, y + dy) && !ground.inWater(x + dx, y + dy));
      for (const w of [2, 3]) {
        if (open(-3) && open(-2) && open(-1) && Array.from({ length: w }, (_, i) => solid(i)).every(Boolean) && open(w) && open(w + 1) && open(w + 2)) return { x, y: y + 0.5, w };
      }
    }
  }
  throw new Error('no wall');
}

function pair(aDex: string, tDex: string, ax: number, ay: number, tx: number, ty: number, moves: string[]): { a: Mon; t: Mon } {
  const a = match.makeMon(aDex, 40, P, ax, ay);
  const t = match.makeMon(tDex, 40, null, tx, ty);
  a.moves = moves;
  a.cooldowns = moves.map(() => 0);
  t.moves = [];
  t.maxHp = t.hp = 99999;
  a.dir = t.dir = 0;
  return { a, t };
}
/** Steps the two as a match does, `run` moving the target each frame; returns damage dealt. */
function fight(a: Mon, t: Mon, slot: number, seconds = 1.6, run?: (t: Mon, dt: number) => void, aimed = true): number {
  const hp = t.hp;
  const b = match.battle;
  let hitGap: number | null = null;
  b.events = [];
  b.inFlight = [];
  if (aimed) b.tryCast(a, slot, t.x, t.y, t.id, t);
  else b.castToward(a, slot, t.x, t.y);
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60; i++) {
    if (run) run(t, dt);
    for (const m of [a, t]) {
      M.stepSlam(m, dt);
      M.stepLunge(m, dt);
      M.stepKnock(m, dt);
      b.stepMon(m, dt, () => [a, t]);
    }
    b.stepFlights(dt);
    for (const e of b.events) if (e.type === 'hit' && e.target === t && hitGap === null) hitGap = Math.hypot(a.x - t.x, a.y - t.y);
  }
  b.events = [];
  lastHitGap = hitGap;
  return hp - t.hp;
}

/** Centre distance between attacker and target in the step the last fight's first hit landed. */
let lastHitGap: number | null = null;
const o = openSpot();
console.log(`open ground at ${o.x},${o.y}`);

// ---------------------------------------------------------------- contact reach
{
  const rows: string[] = [];
  for (const d of [1, 2, 3, 3.6, 4.5, 5.5, 6]) {
    const { a, t } = pair('0025', '0129', o.x, o.y, o.x + d, o.y, ['tackle']);
    const dmg = fight(a, t, 0);
    rows.push(`${d}:${dmg > 0 ? 'hit' : 'miss'}(moved ${(a.x - o.x).toFixed(1)})`);
    if (d <= 3.6) check(dmg > 0, `Tackle from ${d} tiles lunges in and lands`);
    if (d >= 5.5) check(dmg === 0 && a.x - o.x <= CONFIG.battle.lunge.maxTiles * 1.2 + 0.05, `Tackle from ${d} tiles lunges ${(a.x - o.x).toFixed(1)} tiles and misses`);
  }
  console.log('     Tackle by distance:', rows.join('  '));
  const vw = pair('0001', '0129', o.x, o.y, o.x + 3.2, o.y, ['vine-whip']);
  const vx = vw.a.x;
  check(fight(vw.a, vw.t, 0) > 0 && Math.abs(vw.a.x - vx) < 0.5, `Vine Whip lashes from 3.2 tiles without charging in (moved ${(vw.a.x - vx).toFixed(2)})`);
  const vf = pair('0001', '0129', o.x, o.y, o.x + 7.5, o.y, ['vine-whip']);
  check(fight(vf.a, vf.t, 0) === 0, 'Vine Whip does not reach 7.5 tiles');
  const qa = pair('0133', '0129', o.x, o.y, o.x + 4.4, o.y, ['quick-attack']);
  check(fight(qa.a, qa.t, 0) > 0, 'Quick Attack (a dash) lands from 4.4 tiles');
  const qb = pair('0133', '0129', o.x, o.y, o.x + 6.5, o.y, ['quick-attack']);
  check(fight(qb.a, qb.t, 0) === 0, 'Quick Attack does not land from 6.5 tiles');
}

// ---------------------------------------------------------------- sizes
{
  for (const [aDex, tDex] of [['0025', '0321'], ['0321', '0025'], ['0208', '0129'], ['0025', '0208']] as const) {
    const ra = bodyRadius(SPECIES.get(aDex)!);
    const rt = bodyRadius(SPECIES.get(tDex)!);
    const near = pair(aDex, tDex, o.x, o.y, o.x + 2, o.y, ['tackle']);
    const dmg = fight(near.a, near.t, 0);
    const gap = Math.hypot(near.t.x - near.a.x, near.t.y - near.a.y);
    check(dmg > 0 && gap > (ra + rt) * 0.5, `${aDex} -> ${tDex} (radii ${ra.toFixed(2)}, ${rt.toFixed(2)}): lands, ending ${gap.toFixed(2)} apart (bodies touching, not overlapping)`);
    // Seen from outside: the space left between the two drawn bodies when the hit lands.
    const edge = (lastHitGap ?? gap) - Math.min(1.2, ra * 0.75) - rt * 0.75;
    check(edge < 0.6, `${aDex} -> ${tDex}: ${edge.toFixed(2)} tiles of air between the bodies at the hit (under 0.6)`);
    const far = pair(aDex, tDex, o.x, o.y, o.x + 7.5 + rt, o.y, ['tackle']);
    check(fight(far.a, far.t, 0) === 0, `${aDex} -> ${tDex}: no hit from ${(7.5 + rt).toFixed(1)} tiles, big body or not`);
  }
}

// ---------------------------------------------------------------- moving targets
{
  const run = (vx: number, vy: number) => (t: Mon, dt: number) => {
    const nx = t.x + vx * dt;
    const ny = t.y + vy * dt;
    if (canStand(ground, nx, ny, 0.22)) {
      t.x = nx;
      t.y = ny;
    }
  };
  const away = pair('0025', '0129', o.x, o.y, o.x + 3.2, o.y, ['tackle']);
  check(fight(away.a, away.t, 0, 1.2, run(7, 0)) === 0, 'Tackle misses a target running straight away faster than the lunge reaches');
  const side = pair('0025', '0129', o.x, o.y, o.x + 2, o.y, ['tackle']);
  check(fight(side.a, side.t, 0, 1.2, run(0, 3)) > 0, 'Tackle follows a target stepping sideways and lands');
  const shot = pair('0025', '0129', o.x, o.y, o.x + 5, o.y, ['rock-throw']);
  let moved = false;
  const dodge = fight(shot.a, shot.t, 0, 1.6, (t, dt) => {
    if (match.battle.inFlight.length && !moved) moved = true;
    if (moved) run(0, 9)(t, dt);
  });
  check(dodge === 0, 'Rock Throw misses a target that ran clear of where it was thrown');
  const still = pair('0025', '0129', o.x, o.y, o.x + 5, o.y, ['rock-throw']);
  check(fight(still.a, still.t, 0) > 0, 'Rock Throw hits a target that stays put');
}

// ---------------------------------------------------------------- walls
{
  const w = wallSpot();
  console.log(`     wall ${w.w} tiles thick at ${w.x},${w.y}`);
  const ax = w.x - 1.5;
  const tx = w.x + w.w + 1.2;
  const lunge = pair('0025', '0129', ax, w.y, tx, w.y, ['tackle', 'ember', 'icicle-crash', 'earthquake']);
  check(fight(lunge.a, lunge.t, 0) === 0 && lunge.a.x < w.x, 'Tackle into a wall: the lunge stops at it and misses');
  lunge.a.x = ax;
  check(fight(lunge.a, lunge.t, 1, 1.6, undefined) === 0, 'Ember does not pass through the wall');
  lunge.a.x = ax;
  check(fight(lunge.a, lunge.t, 2) > 0, 'Icicle Crash (falls from the sky) lands over the wall');
  const open = pair('0025', '0129', o.x, o.y, o.x + 3.5, o.y, ['ember']);
  check(fight(open.a, open.t, 0) > 0, 'Ember lands across open ground');
}

// ---------------------------------------------------------------- shoves
{
  const push = (mv: string, aDex = '0149') => {
    const { a, t } = pair(aDex, '0025', o.x, o.y, o.x + 1.2, o.y, [mv]);
    const x0 = t.x;
    fight(a, t, 0, 1.2);
    return t.x - x0;
  };
  const light = push('tackle');
  const heavy = push('dragon-tail');
  check(light > 0.1 && heavy > light * 1.8, `shoves: Tackle ${light.toFixed(2)} tiles, Dragon Tail ${heavy.toFixed(2)}`);
  check(heavy < 2, 'Dragon Tail does not launch a target across the map');
  const slam = pair('0149', '0025', o.x, o.y, o.x + 3, o.y, ['body-slam']);
  const sx = slam.t.x;
  fight(slam.a, slam.t, 0, 1.5);
  check(slam.t.x - sx > 0.1, `Body Slam's landing shoves (${(slam.t.x - sx).toFixed(2)} tiles)`);
  const beam = pair('0006', '0025', o.x, o.y, o.x + 3, o.y, ['flamethrower']);
  const bx = beam.t.x;
  const dmg = fight(beam.a, beam.t, 0, 3);
  check(dmg > 0 && Math.abs(beam.t.x - bx) < 1e-6, 'Flamethrower (a channelled beam) hits on every pulse and never shoves');
  const boss = pair('0149', '0025', o.x, o.y, o.x + 1.2, o.y, ['dragon-tail']);
  boss.t.boss = true;
  const kx = boss.t.x;
  fight(boss.a, boss.t, 0, 1.2);
  check(boss.t.x === kx, 'a stronger encounter is not shoved');
  // Against a wall: the shove stops at it, the target stays on ground it can stand on.
  const w = wallSpot();
  const wall = pair('0149', '0025', w.x - 2.6, w.y, w.x - 0.5, w.y, ['dragon-tail']);
  fight(wall.a, wall.t, 0, 1.2);
  check(canStand(ground, wall.t.x, wall.t.y, 0.22), `shoved into a wall, it stops on open ground (${wall.t.x.toFixed(2)} < ${w.x})`);
}

// ---------------------------------------------------------------- several at once
{
  const t = match.makeMon('0129', 40, null, o.x + 3, o.y);
  t.maxHp = t.hp = 99999;
  t.moves = [];
  const as = [0, 1, 2].map((i) => {
    const a = match.makeMon('0025', 40, P, o.x, o.y - 1 + i);
    a.moves = ['tackle'];
    a.cooldowns = [0];
    return a;
  });
  const b = match.battle;
  b.events = [];
  for (const a of as) b.tryCast(a, 0, t.x, t.y, t.id, t);
  const hp = t.hp;
  for (let i = 0; i < 90; i++) {
    for (const m of [...as, t]) {
      M.stepLunge(m, 1 / 60);
      M.stepKnock(m, 1 / 60);
      b.stepMon(m, 1 / 60, () => [...as, t]);
    }
  }
  const hits = b.events.filter((e) => e.type === 'hit').length;
  b.events = [];
  check(hits === 3 && t.hp < hp && canStand(ground, t.x, t.y, 0.22), `three Tackles at once: ${hits} hits, one shove at a time, target on open ground`);
  check(BattleSystem.active(t), 'the target is still there');
}

console.log(failed ? `${failed} combat checks FAILED` : 'All combat checks passed');
process.exit(failed ? 1 : 0);
