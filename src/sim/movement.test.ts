import { describe, expect, it } from 'vitest';
import type { GroundRenderer } from '../ground/types';
import { moveAround, tryMove } from './movement';

/** An open 20x20 field with one blocked tile (a tree) at (10, 10). */
const ground = { cols: 20, rows: 20, walkable: (x: number, y: number) => x >= 0 && y >= 0 && x < 20 && y < 20 && !(x === 10 && y === 10) } as unknown as GroundRenderer;

describe('moveAround', () => {
  it('steps round a tree that tryMove would stay stuck on', () => {
    const plain = { x: 8.5, y: 10.5 };
    for (let i = 0; i < 120; i++) tryMove(ground, plain, 0.05, 0, 0.3);
    expect(plain.x).toBeLessThan(10);
    const smart = { x: 8.5, y: 10.5 };
    for (let i = 0; i < 120; i++) moveAround(ground, smart, 0.05, 0, 0.3, 1 / 60);
    expect(smart.x).toBeGreaterThan(11);
  });
});
