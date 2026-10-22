/**
 * SpriteCollab `<Action>-Offsets.png` sheets mark body points per frame with
 * single coloured pixels: black = head, red = left hand, green = right hand,
 * blue = centre. Where two points coincide their channels add (both hands on
 * one pixel are yellow), so each channel is decoded independently.
 */
import type { Dir8 } from '../core/math';

export interface FramePoints {
  /** Offsets in sheet pixels from the frame's top-left; undefined when not marked. */
  head: [number, number] | undefined;
  leftHand: [number, number] | undefined;
  rightHand: [number, number] | undefined;
  center: [number, number] | undefined;
}

export type OffsetTable = FramePoints[][]; // [dir][frame]

export function decodeOffsets(rgba: Uint8ClampedArray, sheetWidth: number, sheetHeight: number, frameWidth: number, frameHeight: number): OffsetTable {
  const cols = Math.max(1, Math.floor(sheetWidth / frameWidth));
  const rows = Math.max(1, Math.min(8, Math.floor(sheetHeight / frameHeight)));
  const table: OffsetTable = [];
  for (let r = 0; r < rows; r++) {
    const row: FramePoints[] = [];
    for (let c = 0; c < cols; c++) {
      row.push({ head: undefined, leftHand: undefined, rightHand: undefined, center: undefined });
    }
    table.push(row);
  }
  for (let y = 0; y < rows * frameHeight; y++) {
    for (let x = 0; x < cols * frameWidth; x++) {
      const i = (y * sheetWidth + x) * 4;
      const a = rgba[i + 3] ?? 0;
      if (a < 128) continue;
      const r = rgba[i] ?? 0;
      const g = rgba[i + 1] ?? 0;
      const b = rgba[i + 2] ?? 0;
      const fp = table[Math.floor(y / frameHeight)]?.[Math.floor(x / frameWidth)];
      if (!fp) continue;
      const lx = x % frameWidth;
      const ly = y % frameHeight;
      if (r > 128) fp.leftHand = [lx, ly];
      if (g > 128) fp.rightHand = [lx, ly];
      if (b > 128) fp.center = [lx, ly];
      if (r < 64 && g < 64 && b < 64) fp.head = [lx, ly];
    }
  }
  return table;
}

/** Point an attack effect should anchor to for a frame: centre, else the hands' midpoint, else the frame middle. */
export function effectAnchor(table: OffsetTable | undefined, dir: Dir8, frame: number, frameWidth: number, frameHeight: number): [number, number] {
  const fp = table?.[dir]?.[frame];
  if (fp?.center) return fp.center;
  if (fp?.leftHand && fp.rightHand) {
    return [(fp.leftHand[0] + fp.rightHand[0]) / 2, (fp.leftHand[1] + fp.rightHand[1]) / 2];
  }
  if (fp?.leftHand) return fp.leftHand;
  if (fp?.rightHand) return fp.rightHand;
  return [frameWidth / 2, frameHeight / 2];
}

/** A body point for a frame (in sheet pixels from the frame's top-left): the head, or the hands' midpoint (else either hand). */
export function bodyPoint(table: OffsetTable | undefined, dir: Dir8, frame: number, kind: 'head' | 'hands'): [number, number] | null {
  const fp = table?.[dir]?.[frame];
  if (!fp) return null;
  if (kind === 'head') return fp.head ?? null;
  if (fp.leftHand && fp.rightHand) return [(fp.leftHand[0] + fp.rightHand[0]) / 2, (fp.leftHand[1] + fp.rightHand[1]) / 2];
  return fp.leftHand ?? fp.rightHand ?? null;
}
