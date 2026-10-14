import { describe, expect, it } from 'vitest';
import { decodeOffsets, effectAnchor } from './offsets';

function sheet(w: number, h: number, dots: Array<[number, number, number, number, number]>): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (const [x, y, r, g, b] of dots) {
    const i = (y * w + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  }
  return px;
}

describe('decodeOffsets', () => {
  it('reads head, hands and centre per frame and direction', () => {
    const px = sheet(8, 16, [
      [1, 1, 0, 0, 0], // head, dir 0 frame 0
      [2, 2, 255, 0, 0], // left hand
      [3, 3, 0, 255, 0], // right hand
      [2, 3, 0, 0, 255], // centre
      [5, 9, 255, 255, 0], // both hands on one pixel, dir 1 frame 1
    ]);
    const t = decodeOffsets(px, 8, 16, 4, 8);
    expect(t[0]?.[0]).toEqual({ head: [1, 1], leftHand: [2, 2], rightHand: [3, 3], center: [2, 3] });
    expect(t[1]?.[1]?.leftHand).toEqual([1, 1]);
    expect(t[1]?.[1]?.rightHand).toEqual([1, 1]);
    expect(effectAnchor(t, 0, 0, 4, 8)).toEqual([2, 3]);
    expect(effectAnchor(t, 1, 1, 4, 8)).toEqual([1, 1]);
    expect(effectAnchor(t, 1, 0, 4, 8)).toEqual([2, 4]);
  });
});
