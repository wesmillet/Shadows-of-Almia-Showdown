/** The PC: every Pokémon extracted so far (src/pc.ts), as a grid of cards. Esc or Back returns. */
import type { Input } from '../core/input';
import { loadPc, type PcEntry } from '../pc';
import type { SpriteRegistry } from '../sprites/pokemonSprite';
import { button, hit, panel, text, type GameContext, type Screen } from './screens';

export class PcScreen implements Screen {
  private readonly list: PcEntry[];
  private scroll = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly sprites: SpriteRegistry,
    private readonly onBack: () => void,
  ) {
    // Newest first.
    this.list = loadPc().slice().reverse();
  }

  private backRect(): { x: number; y: number; w: number; h: number } {
    const v = this.ctx.view;
    const s = v.baseScale;
    return { x: v.width / 2 - 100 * s, y: v.height - 70 * s, w: 200 * s, h: 46 * s };
  }

  private layout(): { cols: number; cw: number; ch: number; x0: number; y0: number; gap: number } {
    const v = this.ctx.view;
    const s = v.baseScale;
    const gap = 12 * s;
    const cw = 150 * s;
    const ch = 150 * s;
    const cols = Math.max(1, Math.floor((v.width - 80 * s + gap) / (cw + gap)));
    const x0 = v.width / 2 - (cols * cw + (cols - 1) * gap) / 2;
    return { cols, cw, ch, x0, y0: 120 * s, gap };
  }

  step(_dt: number, input: Input): void {
    const b = this.backRect();
    for (const c of input.takeClicks()) if (hit(c.x, c.y, b.x, b.y, b.w, b.h)) this.onBack();
    if (input.pressed('Escape') || input.pressed('KeyP')) this.onBack();
    const { cols, ch, gap } = this.layout();
    const rows = Math.ceil(this.list.length / cols);
    const visible = Math.max(1, Math.floor((this.ctx.view.height - 220 * this.ctx.view.baseScale) / (ch + gap)));
    const maxScroll = Math.max(0, rows - visible);
    if (input.pressed('ArrowDown') || input.pressed('KeyS')) this.scroll = Math.min(maxScroll, this.scroll + 1);
    if (input.pressed('ArrowUp') || input.pressed('KeyW')) this.scroll = Math.max(0, this.scroll - 1);
  }

  render(): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    const h = v.hud;
    h.clearRect(0, 0, v.width, v.height);
    h.fillStyle = '#100c1e';
    h.fillRect(0, 0, v.width, v.height);
    text(v, 'MY PC', v.width / 2, 56 * s, 32, { align: 'center', color: '#e9ddff' });
    text(v, this.list.length
      ? `${this.list.length} Pokémon extracted · kept in this browser · W/S scroll · Esc back`
      : 'Nothing here yet. Win a match (you pick one Pokémon to extract) or use an Extraction Voucher.',
    v.width / 2, 86 * s, 13, { align: 'center', color: '#b9b4cc', maxWidth: v.width - 60 * s });
    const { cols, cw, ch, x0, y0, gap } = this.layout();
    const bottom = v.height - 90 * s;
    this.list.forEach((e, i) => {
      const row = Math.floor(i / cols) - this.scroll;
      if (row < 0) return;
      const x = x0 + (i % cols) * (cw + gap);
      const y = y0 + row * (ch + gap);
      if (y + ch > bottom) return;
      panel(v, x, y, cw, ch, 14, e.shiny ? 'rgba(40,70,90,0.9)' : 'rgba(30,22,58,0.92)');
      const f = this.sprites.get(e.dex, !!e.shiny).portraitSource();
      const ps = 64 * s;
      h.save();
      h.imageSmoothingEnabled = false;
      h.drawImage(f.image, f.sx, f.sy, f.w, f.h, x + cw / 2 - ps / 2, y + 14 * s, ps, ps);
      h.restore();
      const tags = [e.shiny ? 'Shiny' : '', e.alpha ? 'Alpha' : '', e.legend ? 'Legend' : ''].filter(Boolean).join(' · ');
      text(v, e.name, x + cw / 2, y + 98 * s, 15, { align: 'center', weight: '800', color: e.shiny ? '#9ff3ff' : '#ffffff', maxWidth: cw - 16 * s });
      text(v, `Lv ${e.level}${tags ? ` · ${tags}` : ''}`, x + cw / 2, y + 116 * s, 11, { align: 'center', color: '#cfc6ea', maxWidth: cw - 16 * s });
      text(v, e.via === 'win' ? 'Victory prize' : 'Voucher', x + cw / 2, y + 134 * s, 10, { align: 'center', color: e.via === 'win' ? '#ffd36b' : '#9be7ff', maxWidth: cw - 16 * s });
    });
    const b = this.backRect();
    button(v, 'Back', b.x, b.y, b.w, b.h, hit(this.ctx.input.mouseX, this.ctx.input.mouseY, b.x, b.y, b.w, b.h), '#4f7ad6');
  }
}
