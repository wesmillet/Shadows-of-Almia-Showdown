export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(bx - ax, by - ay);
export const angleTo = (ax: number, ay: number, bx: number, by: number): number => Math.atan2(by - ay, bx - ax);

export interface Vec2 {
  x: number;
  y: number;
}

/** 8 facing directions in SpriteCollab sheet row order (row 0 = down). */
export const DIR_NAMES = ['down', 'downRight', 'right', 'upRight', 'up', 'upLeft', 'left', 'downLeft'] as const;
export type Dir8 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Unit-ish step vectors for the 8 directions (screen space, y down). */
export const DIR_VECTORS: ReadonlyArray<Vec2> = [
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: 0 },
  { x: 1, y: -1 },
  { x: 0, y: -1 },
  { x: -1, y: -1 },
  { x: -1, y: 0 },
  { x: -1, y: 1 },
];

/** Nearest of the 8 directions for a movement vector (y down). Zero keeps `fallback`. */
export function dirFromVector(dx: number, dy: number, fallback: Dir8 = 0): Dir8 {
  if (dx === 0 && dy === 0) return fallback;
  // Row i points at screen angle 90° - 45°·i (down = 90°, right = 0°, up = -90°).
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const i = Math.round((90 - deg) / 45);
  return (((i % 8) + 8) % 8) as Dir8;
}

/** Opposite direction (face the thing behind you). */
export const oppositeDir = (d: Dir8): Dir8 => (((d + 4) % 8) as Dir8);

/** Collapses 8 directions to the 4 an overworld sheet has. Diagonals prefer the horizontal row. */
export function dir8To4(d: Dir8): 'up' | 'down' | 'left' | 'right' {
  switch (d) {
    case 0:
      return 'down';
    case 4:
      return 'up';
    case 1:
    case 2:
    case 3:
      return 'right';
    default:
      return 'left';
  }
}

export function easeOutCubic(t: number): number {
  const u = 1 - clamp(t, 0, 1);
  return 1 - u * u * u;
}
