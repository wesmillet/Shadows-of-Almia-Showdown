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

/**
 * A distance field over a window of the map (the whole map for far goals): `dist` is indexed
 * from the window's corner.
 */
interface Field {
  x0: number;
  y0: number;
  w: number;
  h: number;
  dist: Int32Array;
  made: number;
}

/** Goals at most this many tiles away use a windowed field this many tiles round the goal. */
const NEAR = 28;
const WINDOW = 44;

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

  /**
   * The field toward a goal tile: over a window `r` tiles round it (Infinity: the whole map). A
   * party catching up with its trainer only needs the ground nearby, which is a small fraction of
   * the work of a whole-map field; dir() falls back to the whole map when the way round leaves the window.
   */
  private field(gx: number, gy: number, r = Infinity): Field {
    const cols = this.ground.cols;
    const rows = this.ground.rows;
    const whole = !Number.isFinite(r);
    const key = (gy * cols + gx) * 2 + (whole ? 1 : 0);
    const hit = this.cache.get(key);
    if (hit && this.clock - hit.made < this.ttl) return hit;
    const x0 = whole ? 0 : Math.max(0, gx - r);
    const y0 = whole ? 0 : Math.max(0, gy - r);
    const w = (whole ? cols - 1 : Math.min(cols - 1, gx + r)) - x0 + 1;
    const h = (whole ? rows - 1 : Math.min(rows - 1, gy + r)) - y0 + 1;
    const dist = hit && hit.dist.length === w * h ? hit.dist : new Int32Array(w * h);
    dist.fill(UNSEEN);
    const q = this.queue;
    let head = 0;
    let tail = 0;
    const start = (gy - y0) * w + (gx - x0);
    dist[start] = 0;
    q[tail++] = start;
    while (head < tail) {
      const i = q[head++] as number;
      const lx = i % w;
      const ly = (i - lx) / w;
      const x = lx + x0;
      const y = ly + y0;
      const d = (dist[i] as number) + 1;
      for (const [dx, dy] of DIRS) {
        const nlx = lx + dx;
        const nly = ly + dy;
        if (nlx < 0 || nly < 0 || nlx >= w || nly >= h) continue;
        if (!this.open(x + dx, y + dy)) continue;
        if (dx && dy && (!this.open(x + dx, y) || !this.open(x, y + dy))) continue;
        const j = nly * w + nlx;
        if (dist[j] !== UNSEEN) continue;
        dist[j] = d;
        q[tail++] = j;
      }
    }
    const f = { x0, y0, w, h, dist, made: this.clock };
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
    const near = Math.max(Math.abs(cx - goal[0]), Math.abs(cy - goal[1])) <= NEAR;
    let f = this.field(goal[0], goal[1], near ? WINDOW : Infinity);
    // The way round leaves the window (a long detour to a bridge): the whole map, then.
    if (near && this.open(cx, cy) && at(f, cx, cy) === UNSEEN) f = this.field(goal[0], goal[1]);
    const here = this.open(cx, cy) ? at(f, cx, cy) : UNSEEN;
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
      const d = at(f, nx, ny);
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

/** A field's distance at a map tile (UNSEEN outside its window). */
function at(f: Field, x: number, y: number): number {
  const lx = x - f.x0;
  const ly = y - f.y0;
  if (lx < 0 || ly < 0 || lx >= f.w || ly >= f.h) return UNSEEN;
  return f.dist[ly * f.w + lx] as number;
}
