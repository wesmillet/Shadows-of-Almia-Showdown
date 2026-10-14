/**
 * Grid navigation over the ground's walkable tiles. The authored map is
 * terraced: cliff bands can only be crossed at ladders, rivers at bridges, so
 * anything that walks somewhere on purpose (AI trainers, a party catching up
 * with its trainer) follows a distance field instead of a straight line.
 *
 * A field is a breadth-first search outward from the goal tile over eight
 * neighbours (no squeezing diagonally past a blocked corner). Fields are
 * cached per goal tile for a short while; goals that sit still (outposts, the
 * crystal) are reused across many steps.
 */
import type { GroundRenderer } from '../ground/types';

const UNSEEN = -1;
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

interface Field {
  dist: Int32Array;
  made: number;
}

export class Nav {
  private cache = new Map<number, Field>();
  private queue: Int32Array;
  private clock = 0;

  constructor(private readonly ground: GroundRenderer, private readonly ttl = 1.5, private readonly maxFields = 24) {
    this.queue = new Int32Array(ground.cols * ground.rows);
  }

  /** Advance the cache clock (seconds). */
  tick(dt: number): void {
    this.clock += dt;
  }

  private open(x: number, y: number): boolean {
    return this.ground.walkable(x, y);
  }

  /** The walkable tile nearest to (tx, ty), searching a few rings out. */
  private settle(tx: number, ty: number): [number, number] | null {
    if (this.open(tx, ty)) return [tx, ty];
    for (let r = 1; r <= 4; r++) {
      let best: [number, number] | null = null;
      let bd = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !this.open(tx + dx, ty + dy)) continue;
          const d = dx * dx + dy * dy;
          if (d < bd) {
            bd = d;
            best = [tx + dx, ty + dy];
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  private field(gx: number, gy: number): Field {
    const cols = this.ground.cols;
    const key = gy * cols + gx;
    const hit = this.cache.get(key);
    if (hit && this.clock - hit.made < this.ttl) return hit;
    const n = cols * this.ground.rows;
    const dist = hit?.dist ?? new Int32Array(n);
    dist.fill(UNSEEN);
    const q = this.queue;
    let head = 0;
    let tail = 0;
    dist[key] = 0;
    q[tail++] = key;
    while (head < tail) {
      const i = q[head++] as number;
      const x = i % cols;
      const y = (i - x) / cols;
      const d = (dist[i] as number) + 1;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!this.open(nx, ny)) continue;
        if (dx && dy && (!this.open(x + dx, y) || !this.open(x, y + dy))) continue;
        const j = ny * cols + nx;
        if (dist[j] !== UNSEEN) continue;
        dist[j] = d;
        q[tail++] = j;
      }
    }
    const f = { dist, made: this.clock };
    this.cache.delete(key);
    this.cache.set(key, f);
    if (this.cache.size > this.maxFields) {
      const oldest = this.cache.keys().next().value as number;
      this.cache.delete(oldest);
    }
    return f;
  }

  /**
   * Unit direction to walk from (x, y) toward (tx, ty) along the field, or
   * null when the goal cannot be reached on foot (or is already this tile).
   */
  dir(x: number, y: number, tx: number, ty: number): { x: number; y: number } | null {
    const goal = this.settle(Math.floor(tx), Math.floor(ty));
    if (!goal) return null;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (cx === goal[0] && cy === goal[1]) return null;
    const cols = this.ground.cols;
    const f = this.field(goal[0], goal[1]);
    const here = this.open(cx, cy) ? (f.dist[cy * cols + cx] ?? UNSEEN) : UNSEEN;
    let best = -1;
    let bx = 0;
    let by = 0;
    let bestAlign = -Infinity;
    const gx = tx - x;
    const gy = ty - y;
    const gl = Math.hypot(gx, gy) || 1;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!this.open(nx, ny)) continue;
      if (dx && dy && (!this.open(cx + dx, cy) || !this.open(cx, cy + dy))) continue;
      const d = f.dist[ny * cols + nx] as number;
      if (d === UNSEEN) continue;
      const align = (dx * gx + dy * gy) / (Math.hypot(dx, dy) * gl);
      if (best === -1 || d < best || (d === best && align > bestAlign)) {
        best = d;
        bx = nx;
        by = ny;
        bestAlign = align;
      }
    }
    if (best === -1 || (here !== UNSEEN && best >= here)) return null;
    // aim at the next tile's centre so 1-wide ladders and bridges are taken squarely
    const vx = bx + 0.5 - x;
    const vy = by + 0.5 - y;
    const vl = Math.hypot(vx, vy) || 1;
    return { x: vx / vl, y: vy / vl };
  }

  /** True when a straight walk from a to b stays on walkable tiles. */
  clearLine(ax: number, ay: number, bx: number, by: number): boolean {
    const d = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(d / 0.4));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!this.open(Math.floor(ax + (bx - ax) * t), Math.floor(ay + (by - ay) * t))) return false;
    }
    return true;
  }
}
