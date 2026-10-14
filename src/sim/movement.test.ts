import { describe, expect, it } from 'vitest';
import { pointBehind } from './movement';

describe('pointBehind', () => {
  it('walks back along the path by distance', () => {
    const h = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }];
    expect(pointBehind(h, 0.5)).toEqual({ x: 2, y: 0.5 });
    expect(pointBehind(h, 1.5)).toEqual({ x: 1.5, y: 0 });
    expect(pointBehind(h, 10)).toEqual({ x: 0, y: 0 });
    expect(pointBehind([], 1)).toBeNull();
  });
});
