/**
 * What every match on the server shares, loaded once at start: the map (walkability, biomes, spawn
 * points; no pictures) and each species' animation timings (moves land on the attack animation's
 * hit frame, so the server needs those, but never an image).
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
}

/** A match for these players, with computer trainers filling the rest up to `size`. */
export function createMatch(world: World, humans: Human[], size: number, seed: number): Match {
  return new Match({ ground: world.ground(), rng: new Rng(seed), sprites: world.sprites }, [], {
    humans: humans.map((h) => ({ name: h.name, starters: [h.starter] })),
    rivals: Math.max(0, size - humans.length),
  });
}
