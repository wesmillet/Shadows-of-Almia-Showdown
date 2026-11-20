/**
 * The stadium: a battle arena of its own, off the island (past the map's east edge, where nobody can
 * walk to it). Steven is battled here. Its layout (data/stadium.json: the field, the walls, where the
 * trainers stand) and its pictures (assets/maps/stadium_<look>.png) are made by scripts/stadium/build.py
 * from the Fan-tasy tileset packs.
 *
 * withStadium(ground) wraps the island's ground so the pocket is part of the world: walkable inside the
 * stadium's floor, drawn after the island, never reachable (no spawns), never dark. Everything else is
 * the island's ground unchanged.
 */
import layout from '../../data/stadium.json';
import type { GroundRenderer } from '../ground/types';
import type { View } from '../render/view';

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Tiles between the island's east edge and the stadium. */
const GAP = 24;

export type StadiumLook = 'colosseum' | 'cavern' | 'league';

export class Stadium {
  /** World position of the stadium's top-left tile. */
  readonly ox: number;
  readonly oy: number;
  readonly cols = layout.cols;
  readonly rows = layout.rows;
  /** The battle area in world tiles (end exclusive). */
  readonly field: Rect;
  readonly stevenSpot: { x: number; y: number };
  readonly playerSpot: { x: number; y: number };
  /** Where the challenger appears, at the mouth of the south tunnel. */
  readonly gateSpot: { x: number; y: number };
  look: StadiumLook = 'colosseum';
  private readonly walk: Uint8Array;
  private image: HTMLImageElement | null = null;
  private imageLook: string | null = null;

  constructor(islandCols: number, islandRows: number) {
    this.ox = islandCols + GAP;
    this.oy = Math.max(0, Math.floor((islandRows - layout.rows) / 2));
    const f = layout.field;
    this.field = { x0: this.ox + f.x0, y0: this.oy + f.y0, x1: this.ox + f.x1, y1: this.oy + f.y1 };
    this.stevenSpot = { x: this.ox + layout.steven.x + 0.5, y: this.oy + layout.steven.y };
    this.playerSpot = { x: this.ox + layout.player.x + 0.5, y: this.oy + layout.player.y };
    this.gateSpot = { x: this.ox + layout.gate.x, y: this.oy + layout.gate.y };
    this.walk = new Uint8Array(this.cols * this.rows);
    layout.walkable.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) this.walk[y * this.cols + x] = row[x] === '1' ? 1 : 0;
    });
  }

  /** The world extent the stadium reaches to (movement may go this far). */
  get extentCols(): number {
    return this.ox + this.cols;
  }

  get extentRows(): number {
    return this.oy + this.rows;
  }

  /** A tile inside the stadium's rectangle. */
  hasTile(tx: number, ty: number): boolean {
    return tx >= this.ox && ty >= this.oy && tx < this.ox + this.cols && ty < this.oy + this.rows;
  }

  contains(x: number, y: number): boolean {
    return this.hasTile(Math.floor(x), Math.floor(y));
  }

  walkable(tx: number, ty: number): boolean {
    return this.walk[(ty - this.oy) * this.cols + (tx - this.ox)] === 1;
  }

  /** The whole stadium in world tiles (camera bounds). */
  get bounds(): Rect {
    return { x0: this.ox, y0: this.oy, x1: this.ox + this.cols, y1: this.oy + this.rows };
  }

  /** Draws the stadium's picture where it lies (browser only; the server never draws). */
  draw(view: View): void {
    const vis = view.visibleTiles();
    if (vis.x1 < this.ox || vis.x0 > this.ox + this.cols || vis.y1 < this.oy || vis.y0 > this.oy + this.rows) return;
    if (typeof Image === 'undefined') return;
    if (!this.image || this.imageLook !== this.look) {
      const img = new Image();
      img.src = `${import.meta.env?.BASE_URL ?? '/'}assets/maps/stadium_${this.look}.png`;
      this.image = img;
      this.imageLook = this.look;
    }
    if (!this.image.complete || !this.image.naturalWidth) return;
    const ctx = view.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.image, Math.round(view.toScreenX(this.ox)), Math.round(view.toScreenY(this.oy)), this.cols * view.pxPerTile, this.rows * view.pxPerTile);
  }
}

/** The island's ground with the stadium added past its east edge (see the file comment). */
export type StadiumGround = GroundRenderer & { stadium: Stadium };

export function withStadium(inner: GroundRenderer): StadiumGround {
  if ((inner as Partial<StadiumGround>).stadium) return inner as StadiumGround;
  const st = new Stadium(inner.cols, inner.rows);
  // Everything not overridden here (sizes, decor, features, the map's centre) is the island's own.
  const w = Object.create(inner) as StadiumGround & { extentCols: number; extentRows: number };
  const own = <K extends keyof GroundRenderer>(k: K, v: GroundRenderer[K]) => Object.defineProperty(w, k, { value: v, enumerable: true });
  Object.defineProperty(w, 'stadium', { value: st });
  Object.defineProperty(w, 'extentCols', { value: st.extentCols });
  Object.defineProperty(w, 'extentRows', { value: Math.max(inner.rows, st.extentRows) });
  own('walkable', (tx, ty) => (st.hasTile(tx, ty) ? st.walkable(tx, ty) : inner.walkable(tx, ty)));
  own('inWater', (tx, ty) => (st.hasTile(tx, ty) ? false : inner.inWater(tx, ty)));
  own('reachable', (tx, ty) => (st.hasTile(tx, ty) ? false : inner.reachable(tx, ty)));
  own('biomeAt', (tx, ty) => (st.hasTile(tx, ty) ? 'castle' : inner.biomeAt(tx, ty)));
  own('underCanopy', (x, y) => (st.contains(x, y) ? false : inner.underCanopy(x, y)));
  own('minimapColor', (tx, ty) => inner.minimapColor(tx, ty));
  if (inner.onLadder) own('onLadder', (tx, ty) => !st.hasTile(tx, ty) && !!inner.onLadder?.(tx, ty));
  if (inner.onStairs) own('onStairs', (tx, ty) => !st.hasTile(tx, ty) && !!inner.onStairs?.(tx, ty));
  if (inner.walkCells) own('walkCells', () => (inner.walkCells as () => Uint8Array)());
  if (inner.block) own('block', (tx, ty) => inner.block?.(tx, ty));
  own('update', (dt) => inner.update(dt));
  own('drawGround', (view) => {
    inner.drawGround(view);
    st.draw(view);
  });
  own('drawCanopy', (view) => inner.drawCanopy(view));
  return w;
}
