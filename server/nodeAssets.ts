/**
 * Assets for the game server: text and JSON come from the repository's assets/ folder on disk;
 * images are never loaded (the server simulates, it does not draw), so loadImage resolves null and
 * the sprite code keeps only each species' AnimData (frame timings the battle system reads).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Assets } from '../src/sprites/assets';

export class NodeAssets extends Assets {
  constructor(private readonly root: string) {
    super();
  }

  override loadImage(): Promise<HTMLImageElement | null> {
    return Promise.resolve(null);
  }

  override async text(path: string): Promise<string | null> {
    try {
      return readFileSync(join(this.root, path), 'utf8');
    } catch {
      return null;
    }
  }

  override placeholder(): HTMLCanvasElement {
    return null as unknown as HTMLCanvasElement;
  }
}
