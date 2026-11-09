/** Two equal ways round: the choice does not flip as the walker inches across its tile (no jitter). */
import { describe, expect, it } from 'vitest';
import { Nav } from './nav';

describe('path ties', () => {
  it('keeps the same side across a tile when the goal is straight behind a wall', () => {
    // 7x5: a wall row above the walker, open round both ends.
    const rows = ['.......', '..###..', '.......', '.......', '.......'];
    const ground = { cols: 7, rows: 5, walkable: (x: number, y: number) => x >= 0 && y >= 0 && x < 7 && y < 5 && rows[y]![x] === '.' } as never;
    const nav = new Nav(ground);
    const picks = new Set<string>();
    for (let fx = 0.05; fx < 1; fx += 0.1) {
      const n = nav.nextTile(3 + fx, 2.5, 3.5, 0.5);
      picks.add(JSON.stringify(n));
    }
    expect(picks.size).toBe(1);
  });
});
