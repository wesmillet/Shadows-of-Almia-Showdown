/** The fast path search (reading the ground's cells directly) finds exactly the same ways. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FanGround, type FanMapFile } from '../src/ground/fanGround';
import { CONFIG } from '../src/sim/data';
import { Nav } from '../src/sim/nav';
import { Rng } from '../src/core/rng';

describe('navigation fast path', () => {
  it('gives the same next tile as the tile-by-tile search on the real map', () => {
    const map = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'assets', 'maps', `${CONFIG.map.name}.json`), 'utf8')) as FanMapFile;
    const ground = FanGround.headless(map);
    const fast = new Nav(ground);
    const slow = new Nav({ ...Object.create(Object.getPrototypeOf(ground)), cols: ground.cols, rows: ground.rows, walkable: (x: number, y: number) => ground.walkable(x, y) } as never);
    const rng = new Rng(5);
    let compared = 0;
    for (let i = 0; i < 400; i++) {
      const ax = rng.int(0, ground.cols - 1), ay = rng.int(0, ground.rows - 1);
      if (!ground.walkable(ax, ay)) continue;
      const far = i % 3 === 0;
      const bx = far ? rng.int(0, ground.cols - 1) : ax + rng.int(-20, 20), by = far ? rng.int(0, ground.rows - 1) : ay + rng.int(-20, 20);
      expect(fast.nextTile(ax + 0.5, ay + 0.5, bx + 0.5, by + 0.5)).toEqual(slow.nextTile(ax + 0.5, ay + 0.5, bx + 0.5, by + 0.5));
      compared++;
    }
    expect(compared).toBeGreaterThan(100);
  });
});
