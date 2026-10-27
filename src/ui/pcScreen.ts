/**
 * The PC, laid out like a Gen 5 PC box: every Pokémon extracted so far (src/pc.ts) sits in a 6x5
 * box of slots, drawn with its own in-game sprite (standing, facing you), 30 to a box: one art
 * style for every species, form, shiny and Shadow Pokémon. The hovered one plays its idle animation.
 * The box name has arrows to page through boxes (or A/D, arrow keys); hovering a slot hops its
 * icon and shows the Pokémon on the side panel. Esc or Back returns.
 */
import type { Input } from '../core/input';
import { loadPc, type PcEntry } from '../pc';
import type { Assets } from '../sprites/assets';
import { AnimPlayer, SpriteRegistry, type FrameRect } from '../sprites/pokemonSprite';
import { backdrop, button, heading, hit, INK, panel, skinPiece, skinPx, skinPx2, text, type GameContext, type Screen } from './screens';

const COLS = 6;
const ROWS = 5;
const PER_BOX = COLS * ROWS;

type Rect = { x: number; y: number; w: number; h: number };

export class PcScreen implements Screen {
  private readonly list: PcEntry[];
  private box = 0;
  private t = 0;
  private hover = -1;

  constructor(
    private readonly ctx: GameContext,
    private readonly sprites: SpriteRegistry,
    private readonly assets: Assets,
    private readonly onBack: () => void,
    /** Online: the PC on the server (signed in); offline, this browser's. */
    list?: PcEntry[],
    private readonly where = 'kept in this browser',
  ) {
    // Oldest first, like filling a box.
    this.list = list ?? loadPc();
    // Shiny ones load their recoloured set (key `dex*`), so they are ready when the box opens too.
    void this.sprites.preload(this.list.map((e) => (e.shiny && SpriteRegistry.hasShiny(e.dex) ? `${e.dex}*` : e.dex)), undefined, true);
  }

  private get boxes(): number {
    return Math.max(1, Math.ceil(this.list.length / PER_BOX));
  }

  /** Each Pokémon's idle animation (by PC entry), made on first draw. */
  private anims = new Map<string, AnimPlayer>();

  private anim(e: PcEntry): AnimPlayer {
    let a = this.anims.get(e.uid);
    if (!a) {
      a = new AnimPlayer(this.sprites.get(e.dex, !!e.shiny));
      a.dir = 0;
      this.anims.set(e.uid, a);
    }
    return a;
  }

  private layout(): { box: Rect; slot: number; gx: number; gy: number; side: Rect; title: Rect; left: Rect; right: Rect } {
    const v = this.ctx.view;
    const s = v.baseScale;
    const slot = Math.round(74 * s);
    const bw = COLS * slot + 40 * s;
    const bh = ROWS * slot + 96 * s;
    const sideW = 280 * s;
    const total = bw + 24 * s + sideW;
    const bx = v.width / 2 - total / 2;
    const by = 100 * s;
    const box = { x: bx, y: by, w: bw, h: bh };
    const title = { x: bx + 60 * s, y: by + 14 * s, w: bw - 120 * s, h: 42 * s };
    return {
      box, slot, gx: bx + 20 * s, gy: by + 72 * s,
      side: { x: bx + bw + 24 * s, y: by, w: sideW, h: bh },
      title,
      left: { x: bx + 14 * s, y: title.y, w: 40 * s, h: 42 * s },
      right: { x: bx + bw - 54 * s, y: title.y, w: 40 * s, h: 42 * s },
    };
  }

  private backRect(): Rect {
    const v = this.ctx.view;
    const s = v.baseScale;
    return { x: v.width / 2 - 100 * s, y: v.height - 70 * s, w: 200 * s, h: 46 * s };
  }

  step(dt: number, input: Input): void {
    this.t += dt;
    // Only the one pointed at moves; the rest stand still, like a box.
    const hov = this.list[this.hover];
    if (hov) this.anim(hov).update(dt);
    const L = this.layout();
    const b = this.backRect();
    for (const c of input.takeClicks()) {
      if (hit(c.x, c.y, b.x, b.y, b.w, b.h)) this.onBack();
      else if (hit(c.x, c.y, L.left.x, L.left.y, L.left.w, L.left.h)) this.turn(-1);
      else if (hit(c.x, c.y, L.right.x, L.right.y, L.right.w, L.right.h)) this.turn(1);
    }
    if (input.pressed('Escape') || input.pressed('KeyP')) this.onBack();
    if (input.pressed('ArrowLeft') || input.pressed('KeyA') || input.pressed('KeyQ')) this.turn(-1);
    if (input.pressed('ArrowRight') || input.pressed('KeyD') || input.pressed('KeyE')) this.turn(1);
    // The slot under the mouse.
    const mx = this.ctx.input.mouseX;
    const my = this.ctx.input.mouseY;
    const col = Math.floor((mx - L.gx) / L.slot);
    const row = Math.floor((my - L.gy) / L.slot);
    this.hover = col >= 0 && col < COLS && row >= 0 && row < ROWS ? this.box * PER_BOX + row * COLS + col : -1;
  }

  private turn(d: number): void {
    this.box = (this.box + d + this.boxes) % this.boxes;
  }

  render(): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    const h = v.hud;
    h.clearRect(0, 0, v.width, v.height);
    backdrop(v);
    heading(v, 'MY PC', this.list.length
      ? `${this.list.length} Pokémon extracted · ${this.where} · A/D or the arrows change box · Esc back`
      : 'Nothing here yet. Win a match (you pick one Pokémon to extract) or use an Extraction Voucher.', 56 * s);
    const L = this.layout();
    this.drawWallpaper(L.box);
    // Box name with its arrows.
    const mx = this.ctx.input.mouseX;
    const my = this.ctx.input.mouseY;
    // The box's name on a cream ribbon; the arrows are small cream buttons that rise when pointed at.
    const k = skinPx(v);
    if (!skinPiece(v, 'cream', L.title.x, L.title.y, L.title.w, L.title.h, k)) panel(v, L.title.x, L.title.y, L.title.w, L.title.h);
    text(v, `BOX ${this.box + 1}`, L.title.x + L.title.w / 2, L.title.y + L.title.h / 2 + 5 * s, 20, { align: 'center', color: INK.text, shadow: false });
    for (const [r, dir] of [[L.left, -1], [L.right, 1]] as Array<[Rect, number]>) {
      const over = hit(mx, my, r.x, r.y, r.w, r.h);
      const lift = over ? k : 0;
      button(v, '', r.x, r.y, r.w, r.h, over, '#f4e6c8');
      h.fillStyle = over ? INK.accent : INK.text;
      h.beginPath();
      const cx = r.x + r.w / 2;
      const cy = r.y + (r.h - 3 * k) / 2 - lift;
      h.moveTo(cx + dir * 8 * s, cy);
      h.lineTo(cx - dir * 6 * s, cy - 9 * s);
      h.lineTo(cx - dir * 6 * s, cy + 9 * s);
      h.closePath();
      h.fill();
    }
    // The slots.
    for (let i = 0; i < PER_BOX; i++) {
      const idx = this.box * PER_BOX + i;
      const e = this.list[idx];
      const x = L.gx + (i % COLS) * L.slot;
      const y = L.gy + Math.floor(i / COLS) * L.slot;
      const over = idx === this.hover;
      // Each slot a small cream well; the one pointed at rises.
      const k2 = skinPx2(v);
      const up = over && e ? k2 : 0;
      if (!skinPiece(v, e ? 'slotGrey' : 'slotGhost', x + 3 * s, y + 3 * s - up, L.slot - 6 * s, L.slot - 6 * s, k2)) {
        h.fillStyle = over ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.1)';
        h.fillRect(x + 3 * s, y + 3 * s, L.slot - 6 * s, L.slot - 6 * s);
      }
      if (!e) continue;
      // Hovered (and every icon now and then) hops like a box icon.
      const hop = over ? Math.abs(Math.sin(this.t * 9)) * 3 * s : 0;
      // Centred in the well (which itself rises by `up` when pointed at), with room left for the hop.
      this.drawIcon(e, x + L.slot / 2, y + L.slot / 2 + 1.5 * s - up - hop, L.slot - 22 * s);
      if (e.shiny) text(v, '★', x + L.slot - 12 * s, y + 18 * s, 12, { align: 'center', weight: '900', color: '#ffd36b' });
      if (e.shadow) text(v, '◆', x + 14 * s, y + 18 * s, 11, { align: 'center', weight: '900', color: '#c48bff' });
    }
    this.drawSide(L.side);
    const b = this.backRect();
    button(v, 'Back', b.x, b.y, b.w, b.h, hit(mx, my, b.x, b.y, b.w, b.h), '#f4e6c8');
  }

  /**
   * The Pokémon's own sprite, standing and facing out of the box. Every frame of its idle loop is
   * measured (the union of their opaque pixels), and that whole area is what gets fitted and
   * centred: so the still icon sits in the middle of its slot, and the idle animation that plays on
   * hover stays inside the slot and never jumps when it starts. Frames are drawn at one fixed
   * origin, so the animation moves exactly as the sheet does.
   */
  private drawIcon(e: PcEntry, cx: number, cy: number, room: number): void {
    const h = this.ctx.view.hud;
    const a = this.anim(e);
    const f = a.current();
    if (f.placeholder) return;
    const box = this.idleBounds(e, f);
    if (!box) return;
    const bw = box.x1 - box.x0;
    const bh = box.y1 - box.y0;
    const want = room / Math.max(bw, bh, 1);
    // A whole-number scale keeps pixels square, but only when it still fills most of the slot;
    // otherwise small Pokémon would look much smaller than their neighbours, so the scale is exact.
    const k = want >= 2 && Math.floor(want) >= want * 0.8 ? Math.floor(want) : want;
    const dx = Math.round(cx - ((box.x0 + box.x1) / 2) * k);
    const dy = Math.round(cy - ((box.y0 + box.y1) / 2) * k);
    h.save();
    h.imageSmoothingEnabled = false;
    if (e.shadow) {
      h.shadowColor = 'rgba(150,60,255,0.9)';
      h.shadowBlur = 8 * this.ctx.view.baseScale;
    }
    h.drawImage(f.image, f.sx, f.sy, f.w, f.h, dx, dy, f.w * k, f.h * k);
    h.restore();
  }

  /** Per species: the opaque area of all its front-facing idle frames, in frame pixels. */
  private static bounds = new Map<string, { x0: number; y0: number; x1: number; y1: number } | null>();

  private idleBounds(e: PcEntry, f: FrameRect): { x0: number; y0: number; x1: number; y1: number } | null {
    const key = `${e.dex}:${f.w}x${f.h}`;
    const known = PcScreen.bounds.get(key);
    if (known !== undefined) return known;
    const img = f.image as HTMLImageElement | HTMLCanvasElement;
    const sheetW = 'naturalWidth' in img ? img.naturalWidth : img.width;
    const frames = Math.max(1, Math.floor(sheetW / f.w));
    const c = document.createElement('canvas');
    c.width = frames * f.w;
    c.height = f.h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    // Row 0 of the sheet is the facing-down (towards you) direction, the one the box shows.
    g.drawImage(img, 0, f.sy, frames * f.w, f.h, 0, 0, frames * f.w, f.h);
    let px: Uint8ClampedArray;
    try {
      px = g.getImageData(0, 0, c.width, c.height).data;
    } catch {
      return null;
    }
    let x0 = f.w, y0 = f.h, x1 = 0, y1 = 0;
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < c.width; x++) {
        if ((px[(y * c.width + x) * 4 + 3] ?? 0) < 24) continue;
        const fx = x % f.w;
        if (fx < x0) x0 = fx;
        if (fx + 1 > x1) x1 = fx + 1;
        if (y < y0) y0 = y;
        if (y + 1 > y1) y1 = y + 1;
      }
    }
    const r = x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
    if (r) PcScreen.bounds.set(key, r);
    return r;
  }

  /** The side panel: the hovered Pokémon (its portrait, level, tags and how it got here). */
  private drawSide(r: Rect): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    const h = v.hud;
    panel(v, r.x, r.y, r.w, r.h, 16, 'rgba(22,30,52,0.94)');
    const e = this.list[this.hover];
    if (!e) {
      text(v, this.list.length ? 'Point at a Pokémon' : 'Your box is empty', r.x + r.w / 2, r.y + r.h / 2, 14, { align: 'center', color: INK.dim, shadow: false, maxWidth: r.w - 30 * s });
      return;
    }
    const f = this.sprites.get(e.dex, !!e.shiny).portraitSource();
    const ps = 120 * s;
    h.save();
    // The portrait in an orange frame (violet for Shadow Pokémon, blue for shiny ones).
    const pk = skinPx(v);
    if (!skinPiece(v, e.shadow ? 'grey' : e.shiny ? 'blue' : 'orange', r.x + r.w / 2 - ps / 2 - 8 * s, r.y + 22 * s, ps + 16 * s, ps + 16 * s, pk)) {
      h.fillStyle = 'rgba(255,255,255,0.08)';
      h.fillRect(r.x + r.w / 2 - ps / 2 - 8 * s, r.y + 22 * s, ps + 16 * s, ps + 16 * s);
    }
    if (e.shadow) {
      h.fillStyle = 'rgba(70,20,110,0.55)';
      h.fillRect(r.x + r.w / 2 - ps / 2 - 8 * s + 2 * pk, r.y + 22 * s + 2 * pk, ps + 16 * s - 4 * pk, ps + 16 * s - 4 * pk);
    }
    h.imageSmoothingEnabled = false;
    h.drawImage(f.image, f.sx, f.sy, f.w, f.h, r.x + r.w / 2 - ps / 2, r.y + 30 * s, ps, ps);
    h.restore();
    const y = r.y + 30 * s + ps + 40 * s;
    text(v, `${e.shiny ? '★ ' : ''}${e.name}`, r.x + r.w / 2, y, 20, { align: 'center', color: e.shiny ? INK.blue : INK.text, shadow: false, maxWidth: r.w - 24 * s });
    text(v, `Lv ${e.level}`, r.x + r.w / 2, y + 26 * s, 15, { align: 'center', color: INK.accent, shadow: false });
    const tags = [(e as PcEntry & { wonder?: boolean }).wonder ? 'On Wonder Trade' : '', e.shadow ? 'Shadow' : '', e.shiny ? 'Shiny' : '', e.alpha ? 'Alpha' : '', e.legend ? 'Legend' : ''].filter(Boolean).join(' · ');
    if (tags) text(v, tags, r.x + r.w / 2, y + 48 * s, 12, { align: 'center', color: e.shadow ? INK.storm : INK.gold, shadow: false });
    text(v, e.via === 'win' ? 'Victory prize' : 'Extraction Voucher', r.x + r.w / 2, y + 70 * s, 12, { align: 'center', color: e.via === 'win' ? INK.gold : INK.blue, shadow: false });
    if (e.moves?.length) text(v, e.moves.map((m) => m.replace(/-/g, ' ')).join(' · '), r.x + r.w / 2, y + 94 * s, 11, { align: 'center', color: INK.dim, shadow: false, maxWidth: r.w - 24 * s });
  }

  /** The box: the skin's blue frame, with Gen 5's soft diagonal bands across its field. */
  private drawWallpaper(r: Rect): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    const h = v.hud;
    const k = skinPx(v);
    if (!skinPiece(v, 'blue', r.x, r.y, r.w, r.h, k)) {
      h.fillStyle = '#3a8aa6';
      h.fillRect(r.x, r.y, r.w, r.h);
    }
    h.save();
    h.beginPath();
    h.rect(r.x + 3 * k, r.y + 3 * k, r.w - 6 * k, r.h - 6 * k);
    h.clip();
    h.strokeStyle = 'rgba(255,255,255,0.08)';
    h.lineWidth = 14 * s;
    for (let i = -r.h; i < r.w + r.h; i += 46 * s) {
      h.beginPath();
      h.moveTo(r.x + i, r.y);
      h.lineTo(r.x + i - r.h, r.y + r.h);
      h.stroke();
    }
    h.restore();
  }
}
