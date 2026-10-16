/**
 * Pick your trainer: every Ranger Union and townsfolk sheet in assets/rangers, walking in place.
 * Click one (or arrows + Enter) to wear it; Esc or Back returns. All looks are free for now; online
 * they will be unlockables.
 */
import type { Input } from '../core/input';
import { saveLook } from '../look';
import type { RangerSprites } from '../sprites/rangerSprite';
import { button, hit, panel, text, type GameContext, type Screen } from './screens';

type Rect = { x: number; y: number; w: number; h: number };

export class CharacterScreen implements Screen {
  private readonly list: string[];
  private current: string;
  private cursor: number;
  private t = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly rangers: RangerSprites,
    private readonly onBack: () => void,
  ) {
    this.list = rangers.characters();
    this.current = rangers.characterOf('player');
    this.cursor = Math.max(0, this.list.indexOf(this.current));
    for (const c of this.list) rangers.preview(c);
  }

  /** Named originals, then "Ranger 3" for the Union sheets and "Local 7" for the townsfolk. */
  static readonly NAMES: Record<string, string> = { orig_00: 'Wren' };

  static label(character: string): string {
    const named = CharacterScreen.NAMES[character];
    if (named) return named;
    const [kind, n] = character.split('_');
    return `${kind === 'union' ? 'Ranger' : 'Local'} ${Number(n) + 1}`;
  }

  private layout(): { cols: number; cw: number; ch: number; x0: number; y0: number; gap: number } {
    const v = this.ctx.view;
    const s = v.baseScale;
    const gap = 10 * s;
    const cw = 104 * s;
    const ch = 156 * s;
    const cols = Math.max(1, Math.min(8, Math.floor((v.width - 60 * s + gap) / (cw + gap))));
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
    this.cursor = i;
    this.current = c;
    saveLook(c);
    void this.rangers.setRole('player', c);
  }

  step(dt: number, input: Input): void {
    this.t += dt;
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
    h.fillStyle = '#100c1e';
    h.fillRect(0, 0, v.width, v.height);
    text(v, 'CHOOSE YOUR TRAINER', v.width / 2, 56 * s, 30, { align: 'center', color: '#e9ddff' });
    text(v, 'Every look is free for now. When the game goes online these become unlockables.', v.width / 2, 84 * s, 13, { align: 'center', color: '#b9b4cc', maxWidth: v.width - 60 * s });
    const mx = this.ctx.input.mouseX;
    const my = this.ctx.input.mouseY;
    this.list.forEach((c, i) => {
      const r = this.rect(i);
      const chosen = c === this.current;
      const hover = hit(mx, my, r.x, r.y, r.w, r.h) || i === this.cursor;
      panel(v, r.x, r.y, r.w, r.h, 12, chosen ? 'rgba(60,110,90,0.95)' : hover ? 'rgba(52,40,92,0.95)' : 'rgba(30,22,58,0.92)');
      const sheet = this.rangers.preview(c);
      // Walking toward you when picked or pointed at, standing otherwise.
      const f = sheet.frame('down', this.t * 1.6 + i * 0.13, chosen || hover);
      const k = Math.max(1, Math.floor((r.h * 0.7) / f.h));
      h.save();
      h.imageSmoothingEnabled = false;
      const dw = f.w * k;
      const dh = f.h * k;
      const dx = r.x + r.w / 2 - dw / 2;
      const dy = r.y + 12 * s + (r.h * 0.7 - dh);
      if (f.flip) {
        h.translate(dx + dw, dy);
        h.scale(-1, 1);
        h.drawImage(f.image, f.sx, f.sy, f.w, f.h, 0, 0, dw, dh);
      } else h.drawImage(f.image, f.sx, f.sy, f.w, f.h, dx, dy, dw, dh);
      h.restore();
      if (chosen || hover) {
        h.save();
        h.strokeStyle = chosen ? '#7dffb0' : 'rgba(233,221,255,0.7)';
        h.lineWidth = Math.max(2, 3 * s);
        h.strokeRect(r.x + 4 * s, r.y + 4 * s, r.w - 8 * s, r.h - 8 * s);
        h.restore();
      }
      text(v, CharacterScreen.label(c), r.x + r.w / 2, r.y + r.h - 26 * s, 13, { align: 'center', weight: '800', color: '#ffffff', maxWidth: r.w - 10 * s });
      text(v, chosen ? 'Wearing' : 'Free', r.x + r.w / 2, r.y + r.h - 10 * s, 10, { align: 'center', color: chosen ? '#9ff3c8' : '#b9b4cc' });
    });
    const b = this.backRect();
    button(v, 'Back', b.x, b.y, b.w, b.h, hit(mx, my, b.x, b.y, b.w, b.h), '#4f7ad6');
  }
}
