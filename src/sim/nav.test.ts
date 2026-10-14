import { describe, expect, it } from 'vitest';
import type { GroundRenderer } from '../ground/types';
import { Nav } from './nav';

/** A 12x9 field with a cliff across row 4 and a one-tile ladder at x = 9. */
function terraced(): GroundRenderer {
  const cols = 12;
  const rows = 9;
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && (y !== 4 || x === 9);
  return { cols, rows, walkable: open } as unknown as GroundRenderer;
}

describe('Nav', () => {
  it('routes to the ladder instead of walking into the cliff', () => {
    const nav = new Nav(terraced());
    // from (2.5, 1.5) to (2.5, 7.5): straight down is blocked, the way is through x = 9
    expect(nav.clearLine(2.5, 1.5, 2.5, 7.5)).toBe(false);
    let x = 2.5;
    let y = 1.5;
    for (let i = 0; i < 200 && Math.hypot(x - 2.5, y - 7.5) > 0.6; i++) {
      const d = nav.dir(x, y, 2.5, 7.5);
      if (!d) break;
      x += d.x * 0.25;
      y += d.y * 0.25;
      expect(terraced().walkable(Math.floor(x), Math.floor(y))).toBe(true);
    }
    expect(Math.hypot(x - 2.5, y - 7.5)).toBeLessThan(1);
  });

  it('gives no direction when the goal cannot be reached', () => {
    const g = { cols: 6, rows: 6, walkable: (x: number, y: number) => x >= 0 && y >= 0 && x < 6 && y < 6 && x !== 3 } as unknown as GroundRenderer;
    expect(new Nav(g).dir(1.5, 1.5, 5.5, 1.5)).toBeNull();
  });
});
