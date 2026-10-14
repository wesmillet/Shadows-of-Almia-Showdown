import type { Assets } from '../sprites/assets';
import { SunnysideGround } from './sunnysideGround';
import type { GroundRenderer } from './types';

export type { GroundRenderer, Biome, DecorItem } from './types';

/** The ground for a match: an island generated for the Sunnyside World tileset. */
export async function createGround(assets: Assets, cols: number, rows: number, seed: number, onProgress?: (p: number) => void): Promise<GroundRenderer> {
  return SunnysideGround.create(assets, cols, rows, seed, onProgress);
}
