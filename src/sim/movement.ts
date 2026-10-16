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

/** A mover that remembers which way it is stepping round an obstacle (see moveAround). */
export interface Detouring extends Mover {
  /** +1 or -1: the side it is going round on, while `detourT` lasts. */
  detourSide?: number;
  /** Seconds left to keep stepping round on that side. */
  detourT?: number;
}

/**
 * Like tryMove, but a Pokémon that bumps into something (a tree, a rock, a building corner) steps
 * round it instead of pushing into it: when the straight step mostly fails it tries the way turned
 * 45, 90 and 135 degrees, keeping to one side for a moment so it walks along the obstacle rather
 * than jittering. Returns the distance moved.
 */
export function moveAround(ground: GroundRenderer, m: Detouring, dx: number, dy: number, r: number, dt: number): number {
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return 0;
  if (m.detourT !== undefined && m.detourT > 0) m.detourT -= dt;
  const keepSide = (m.detourT ?? 0) > 0 ? (m.detourSide ?? 1) : 0;
  // While a detour is on, keep leaning the chosen way so it clears the corner.
  if (!keepSide) {
    const moved = tryMove(ground, m, dx, dy, r);
    if (moved >= len * 0.6) return moved;
  }
  const ux = dx / len;
  const uy = dy / len;
  const sides = keepSide ? [keepSide] : [1, -1];
  let best = 0;
  let bestSide = 0;
  let bestPos = { x: m.x, y: m.y };
  const start = { x: m.x, y: m.y };
  for (const side of sides) {
    for (const deg of [45, 90, 135]) {
      const a = (deg * Math.PI) / 180 * side;
      const vx = ux * Math.cos(a) - uy * Math.sin(a);
      const vy = ux * Math.sin(a) + uy * Math.cos(a);
      m.x = start.x;
      m.y = start.y;
      const moved = tryMove(ground, m, vx * len, vy * len, r);
      // Prefer the gentlest turn that gets a real step in (progress along the wanted way counts).
      const progress = (m.x - start.x) * ux + (m.y - start.y) * uy;
      const score = moved * 0.6 + progress;
      if (moved >= len * 0.6 && score > best) {
        best = score;
        bestSide = side;
        bestPos = { x: m.x, y: m.y };
        break;
      }
    }
  }
  if (bestSide) {
    m.x = bestPos.x;
    m.y = bestPos.y;
    m.detourSide = bestSide;
    m.detourT = 0.6;
    // Back on the straight way as soon as it is open again.
    const probe = { x: m.x, y: m.y };
    if (canStand(ground, probe.x + ux * r * 2, probe.y + uy * r * 2, r)) m.detourT = Math.min(m.detourT, 0.15);
    return Math.hypot(m.x - start.x, m.y - start.y);
  }
  // Nothing worked: fall back to sliding along the wall and switch sides next time.
  m.x = start.x;
  m.y = start.y;
  m.detourSide = -(m.detourSide ?? 1);
  m.detourT = 0;
  return tryMove(ground, m, dx, dy, r);
}
