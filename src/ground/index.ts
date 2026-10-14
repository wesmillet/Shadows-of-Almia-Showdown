import type { Assets } from '../sprites/assets';
import { StaticGround } from './staticGround';
import { SunnysideGround } from './sunnysideGround';
import type { GroundRenderer } from './types';

export type { GroundRenderer, Biome, DecorItem } from './types';

/**
 * The ground for a match: the authored map in assets/maps/<name>.json when it
 * exists (built by scripts/mapgen/build.py), otherwise an island generated for
 * the Sunnyside World tileset at the configured size.
 */
export async function createGround(assets: Assets, cols: number, rows: number, seed: number, onProgress?: (p: number) => void, mapName = 'almia'): Promise<GroundRenderer> {
  const authored = await StaticGround.load(assets, mapName, onProgress);
  if (authored) return authored;
  return SunnysideGround.create(assets, cols, rows, seed, onProgress);
}
