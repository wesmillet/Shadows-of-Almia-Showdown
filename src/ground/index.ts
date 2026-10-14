import type { Assets } from '../sprites/assets';
import { ASSET_ROOT, warnOnce } from '../sprites/assets';
import { ProceduralGround } from './procedural';
import { TiledGround } from './tiled';
import type { GroundRenderer } from './types';

export type { GroundRenderer, Biome, DecorItem } from './types';

/** The ground for a match: a painted Tiled map when /assets/tiles/map.json exists, else the procedural painter. */
export async function createGround(assets: Assets, cols: number, rows: number, tileSize: number, seed: number, onProgress?: (p: number) => void): Promise<GroundRenderer> {
  const probe = await fetch(`${ASSET_ROOT}tiles/map.json`, { method: 'HEAD', cache: 'no-cache' }).catch(() => null);
  if (probe?.ok) {
    const tiled = await TiledGround.load(assets, 'map.json');
    if (tiled) return tiled;
  } else {
    warnOnce('tiles/map.json', 'no painted tileset at assets/tiles/map.json: using the procedural stand-in ground');
  }
  return ProceduralGround.create(cols, rows, tileSize, seed, onProgress);
}
