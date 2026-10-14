/** Circle-vs-tile movement shared by trainers, party members and wild Pokémon. */
import type { GroundRenderer } from '../ground/types';

export interface Mover {
  x: number;
  y: number;
}

export function canStand(ground: GroundRenderer, x: number, y: number, r: number): boolean {
  const x0 = Math.floor(x - r);
  const x1 = Math.floor(x + r);
  const y0 = Math.floor(y - r);
  const y1 = Math.floor(y + r);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!ground.walkable(tx, ty)) return false;
    }
  }
  return true;
}

/** Moves along each axis separately so sliding along walls works. Returns the distance actually moved. */
export function tryMove(ground: GroundRenderer, m: Mover, dx: number, dy: number, r: number): number {
  const sx = m.x;
  const sy = m.y;
  if (dx !== 0) {
    const nx = Math.min(ground.cols - r, Math.max(r, m.x + dx));
    if (canStand(ground, nx, m.y, r)) m.x = nx;
  }
  if (dy !== 0) {
    const ny = Math.min(ground.rows - r, Math.max(r, m.y + dy));
    if (canStand(ground, m.x, ny, r)) m.y = ny;
  }
  return Math.hypot(m.x - sx, m.y - sy);
}

/** A point `distance` tiles back along a position history (newest last). */
export function pointBehind(history: ReadonlyArray<{ x: number; y: number }>, distance: number): { x: number; y: number } | null {
  if (history.length === 0) return null;
  let remaining = distance;
  for (let i = history.length - 1; i > 0; i--) {
    const a = history[i] as { x: number; y: number };
    const b = history[i - 1] as { x: number; y: number };
    const seg = Math.hypot(a.x - b.x, a.y - b.y);
    if (seg >= remaining) {
      const t = seg === 0 ? 0 : remaining / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= seg;
  }
  return history[0] ?? null;
}
