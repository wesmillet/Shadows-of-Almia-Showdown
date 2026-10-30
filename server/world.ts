/**
 * What every match on the server shares, loaded once at start: the map (walkability, biomes, spawn
 * points; no pictures) and each species' AnimData (no images). Moves strike on the attack
 * animation's hit frame, read from data/strike-times.json (src/sim/strikeTimes.ts), the same
 * table the browser uses.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FanGround, type FanMapFile } from '../src/ground/fanGround';
import type { GroundRenderer } from '../src/ground/types';
import { CONFIG, SPECIES } from '../src/sim/data';
import { Match } from '../src/sim/match';
import { Rng } from '../src/core/rng';
import { SpriteRegistry } from '../src/sprites/pokemonSprite';
import { NodeAssets } from './nodeAssets';

export interface World {
  map: FanMapFile;
  sprites: SpriteRegistry;
  /** A fresh copy of the map's collision for each match (props placed in a match block tiles). */
  ground(): GroundRenderer;
}

export async function loadWorld(assetsDir: string): Promise<World> {
  const assets = new NodeAssets(assetsDir);
  const map = JSON.parse(readFileSync(join(assetsDir, 'maps', `${CONFIG.map.name}.json`), 'utf8')) as FanMapFile;
  const sprites = new SpriteRegistry(assets);
  await sprites.preload([...SPECIES.keys()]);
  return { map, sprites, ground: () => FanGround.headless(map) };
}

export interface Human {
  name: string;
  starter: string;
  /** Squad number (parties and team rules); none plays alone. */
  team?: number;
}

export interface MatchRules {
  /** Fill empty spots with computer trainers (default yes). */
  bots?: boolean;
  /** Starters' level (default the game's). */
  level?: number;
  /** How fast the storm closes in (1 normal). */
  storm?: number;
  /** Shiny odds multiplier (events). */
  shinyBoost?: number;
}

/** A match for these players, with computer trainers filling the rest up to `size`. */
export function createMatch(world: World, humans: Human[], size: number, seed: number, rules: MatchRules = {}): Match {
  const m = newMatch(world, humans, size, seed, rules);
  // Testing only (never on the live server): DEV_GATHER=1 starts every human player a few steps
  // from the first, so a playtest with two browsers can fight at once instead of walking the island.
  // Testing only: DEV_START=x,y puts the first player there (to look at one place online).
  const devStart = process.env.SERVER_KIND === 'dev' ? /^(\d+),(\d+)$/.exec(process.env.DEV_START ?? '') : null;
  if (devStart && m.seats[0]) {
    const t = m.seats[0].trainer;
    const dx = Number(devStart[1]) + 0.5 - t.x;
    const dy = Number(devStart[2]) + 0.5 - t.y;
    t.x = t.px = t.x + dx;
    t.y = t.py = t.y + dy;
    for (const mon of t.party) if (mon) { mon.x = mon.px = mon.x + dx; mon.y = mon.py = mon.y + dy; }
  }
  if (process.env.DEV_GATHER === '1' && process.env.SERVER_KIND === 'dev') {
    const first = m.seats[0]?.trainer;
    const g = m.ground;
    for (const [i, seat] of m.seats.entries()) {
      if (i === 0 || !first) continue;
      const t = seat.trainer;
      // the nearest open, reachable ground about 6 tiles from the first player
      let spot: { x: number; y: number } | null = null;
      for (let r = 6; r < 14 && !spot; r++) {
        for (let k = 0; k < 16 && !spot; k++) {
          const a = (k / 16) * Math.PI * 2;
          const x = Math.floor(first.x + Math.cos(a) * r) + 0.5;
          const y = Math.floor(first.y + Math.sin(a) * r) + 0.5;
          if (g.walkable(Math.floor(x), Math.floor(y)) && g.reachable(Math.floor(x), Math.floor(y))) spot = { x, y };
        }
      }
      if (!spot) continue;
      const dx = spot.x - t.x;
      const dy = spot.y - t.y;
      t.x = t.px = t.x + dx;
      t.y = t.py = t.y + dy;
      for (const mon of t.party) if (mon) { mon.x = mon.px = mon.x + dx; mon.y = mon.py = mon.y + dy; }
    }
  }
  return m;
}

function newMatch(world: World, humans: Human[], size: number, seed: number, rules: MatchRules): Match {
  return new Match({ ground: world.ground(), rng: new Rng(seed), sprites: world.sprites }, [], {
    humans: humans.map((h) => ({ name: h.name, starters: [h.starter], team: h.team })),
    rivals: rules.bots === false ? 0 : Math.max(0, size - humans.length),
    level: rules.level,
    stormSpeed: rules.storm,
    shinyBoost: rules.shinyBoost,
  });
}
