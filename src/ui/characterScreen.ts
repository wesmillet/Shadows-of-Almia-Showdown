/**
 * Pick your trainer: every Ranger Union and townsfolk sheet in assets/rangers, walking in place.
 * Click one (or arrows + Enter) to wear it; Esc or Back returns. With a game server, the townsfolk
 * The first Ranger is free; the other Rangers are earned online by trainer level (src/net/progression.ts)
 * and the townsfolk are locked for now. Without a server only the first Ranger can be worn.
 */
import type { Input } from '../core/input';
import { saveLook } from '../look';
import type { RangerSprites } from '../sprites/rangerSprite';
import { backdrop, button, heading, hit, INK, panel, skinPiece, skinPx, skinPx2, text, type GameContext, type Screen } from './screens';

type Rect = { x: number; y: number; w: number; h: number };

export class CharacterScreen implements Screen {
  private readonly list: string[];
  private current: string;
  private cursor: number;
  private t = 0;
  private note = '';
  private noteT = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly rangers: RangerSprites,
    private readonly onBack: () => void,
    /** Why a look can not be worn yet ("Level 10"), or null when it can. */
    private readonly lock: (look: string) => string | null = () => null,
  ) {
    this.list = rangers.characters();
    this.current = rangers.characterOf('player');
    this.cursor = Math.max(0, this.list.indexOf(this.current));
    for (const c of this.list) rangers.preview(c);
  }

  /** "Ranger 3" for the Union sheets and "Local 7" for the townsfolk. */
  static label(character: string): string {
    const [kind, n] = character.split('_');
    return `${kind === 'union' ? 'Ranger' : 'Local'} ${Number(n) + 1}`;
  }

  private layout(): { cols: number; cw: number; ch: number; x0: number; y0: number; gap: number } {
    const v = this.ctx.view;
    const s = v.baseScale;
    const gap = 10 * s;
    // Every look fits between the heading and the Back button: the column count (and, if it must,
    // the card size) is picked so the whole grid shows.
    const n = Math.max(1, this.list.length);
    const roomW = v.width - 60 * s;
    const roomH = v.height - 116 * s - 80 * s;
    let best = { cols: 1, f: 0 };
    for (let cols = 4; cols <= 14; cols++) {
      const rows = Math.ceil(n / cols);
      const f = Math.min(1, (roomH - (rows - 1) * gap) / (rows * 156 * s), (roomW - (cols - 1) * gap) / (cols * 104 * s));
      if (f > best.f + 0.001) best = { cols, f };
    }
    const cw = Math.floor(104 * s * best.f);
    const ch = Math.floor(156 * s * best.f);
    const cols = best.cols;
    const x0 = v.width / 2 - (cols * cw + (cols - 1) * gap) / 2;
    return { cols, cw, ch, x0, y0: 116 * s, gap };
  }

  private rect(i: number): Rect {
    const { cols, cw, ch, x0, y0, gap } = this.layout();
    return { x: x0 + (i % cols) * (cw + gap), y: y0 + Math.floor(i / cols) * (ch + gap), w: cw, h: ch };
  }

  private backRect(): Rect {
    const v = this.ctx.view;
    const s = v.baseScale;
    return { x: v.width / 2 - 100 * s, y: v.height - 64 * s, w: 200 * s, h: 44 * s };
  }

  private pick(i: number): void {
    const c = this.list[i];
    if (!c) return;
    const why = this.lock(c);
    if (why) {
      this.cursor = i;
      this.note = `${CharacterScreen.label(c)} unlocks with: ${why}`;
      this.noteT = 2.5;
      return;
    }
    this.cursor = i;
    this.current = c;
    saveLook(c);
    void this.rangers.setRole('player', c);
  }

  step(dt: number, input: Input): void {
    this.t += dt;
    this.noteT = Math.max(0, this.noteT - dt);
    const b = this.backRect();
    for (const c of input.takeClicks()) {
      if (hit(c.x, c.y, b.x, b.y, b.w, b.h)) return this.onBack();
      this.list.forEach((_, i) => {
        const r = this.rect(i);
        if (hit(c.x, c.y, r.x, r.y, r.w, r.h)) this.pick(i);
      });
    }
    const { cols } = this.layout();
    const n = this.list.length;
    if (input.pressed('ArrowRight') || input.pressed('KeyD')) this.cursor = (this.cursor + 1) % n;
    if (input.pressed('ArrowLeft') || input.pressed('KeyA')) this.cursor = (this.cursor - 1 + n) % n;
    if (input.pressed('ArrowDown') || input.pressed('KeyS')) this.cursor = Math.min(n - 1, this.cursor + cols);
    if (input.pressed('ArrowUp') || input.pressed('KeyW')) this.cursor = Math.max(0, this.cursor - cols);
    if (input.pressed('Enter') || input.pressed('Space')) this.pick(this.cursor);
    if (input.pressed('Escape') || input.pressed('KeyC')) this.onBack();
  }

  render(): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    const h = v.hud;
    h.clearRect(0, 0, v.width, v.height);
    backdrop(v);
    const anyLocked = this.list.some((c) => this.lock(c));
    heading(v, 'CHOOSE YOUR TRAINER', anyLocked ? 'The first Ranger is free; more Rangers unlock with your trainer level online, and more trainers are coming soon' : 'Pick the trainer you play as', 56 * s);
    const mx = this.ctx.input.mouseX;
    const my = this.ctx.input.mouseY;
    const k = skinPx(v);
    const k2 = skinPx2(v);
    this.list.forEach((c, i) => {
      const r0 = this.rect(i);
      const chosen = c === this.current;
      const hover = hit(mx, my, r0.x, r0.y, r0.w, r0.h) || i === this.cursor;
      // A cream card that rises a pixel under the pointer; the one you wear is framed in orange.
      const r = { ...r0, y: r0.y - (hover ? k : 0) };
      if (!skinPiece(v, chosen ? 'orange' : 'cream', r.x, r.y, r.w, r.h, k)) panel(v, r.x, r.y, r.w, r.h, 12);
      if (chosen) skinPiece(v, 'cream', r.x + 3 * k, r.y + 3 * k, r.w - 6 * k, r.h - 6 * k, k2);
      const locked = this.lock(c);
      const sheet = this.rangers.preview(c);
      // Walking toward you when picked or pointed at, standing otherwise.
      const f = sheet.frame('down', this.t * 1.6 + i * 0.13, chosen || hover);
      const kk = Math.max(1, Math.floor((r.h * 0.66) / f.h));
      h.save();
      h.imageSmoothingEnabled = false;
      // Locked: a dark silhouette.
      if (locked) h.filter = 'brightness(0.15) opacity(0.7)';
      const dw = f.w * kk;
      const dh = f.h * kk;
      const dx = Math.round(r.x + r.w / 2 - dw / 2);
      const dy = Math.round(r.y + 12 * s + (r.h * 0.66 - dh));
      if (f.flip) {
        h.translate(dx + dw, dy);
        h.scale(-1, 1);
        h.drawImage(f.image, f.sx, f.sy, f.w, f.h, 0, 0, dw, dh);
      } else h.drawImage(f.image, f.sx, f.sy, f.w, f.h, dx, dy, dw, dh);
      h.restore();
      text(v, CharacterScreen.label(c), r.x + r.w / 2, r.y + r.h - 30 * s, 13, { align: 'center', color: INK.text, shadow: false, maxWidth: r.w - 16 * s });
      text(v, chosen ? 'Wearing' : locked ? `🔒 ${locked}` : 'Unlocked', r.x + r.w / 2, r.y + r.h - 14 * s, 10, { align: 'center', color: chosen ? INK.good : locked ? INK.bad : INK.dim, shadow: false, maxWidth: r.w - 8 * s });
    });
    const b = this.backRect();
    button(v, 'Back', b.x, b.y, b.w, b.h, hit(mx, my, b.x, b.y, b.w, b.h), '#4f7ad6');
    if (this.noteT > 0) text(v, this.note, v.width / 2, b.y - 14 * s, 13, { align: 'center', color: '#f4ecdc', maxWidth: v.width - 40 * s });
  }
}
