/**
 * Win / loss with the match stats. A win lets the player extract one Pokémon
 * from the party to their PC (src/pc.ts) before playing again, plus one more
 * for every Extraction Voucher still in the bag.
 */
import type { Input } from '../core/input';
import type { Match } from '../sim/match';
import type { Mon } from '../sim/entities';
import { extractToPc, loadPc } from '../pc';
import { button, hit, INK, panel, skinPiece, skinPx, text, wrapText, type GameContext, type Screen } from './screens';
import type { MatchScreen } from './matchScreen';

type Rect = { x: number; y: number; w: number; h: number };

export class EndScreen implements Screen {
  private t = 0;
  /** After a win: the Pokémon sent to the PC so far. */
  private sent: Mon[] = [];
  /** The player pressed Skip / Done. */
  private finished = false;
  private saveFailed = false;
  /** Extractions a win allows: one free, plus one per Extraction Voucher carried to the end. */
  private readonly picks: number;

  constructor(
    private readonly ctx: GameContext,
    private readonly match: Match,
    private readonly behind: MatchScreen,
    private readonly onRestart: () => void,
  ) {
    const vouchers = match.player.items.reduce((n, e) => n + (e?.id === 'extraction-voucher' ? e.count : 0), 0);
    this.picks = 1 + vouchers;
  }


  private get win(): boolean {
    return this.match.outcome === 'win';
  }

  /** Still choosing who to extract (wins only). */
  private get choosing(): boolean {
    return this.win && !this.finished && this.sent.length < this.picks && this.match.player.party.some((m) => !this.sent.includes(m));
  }

  private buttonRect(): Rect {
    const v = this.ctx.view;
    const s = v.baseScale;
    return { x: v.width / 2 - 110 * s, y: v.height / 2 + 196 * s, w: 220 * s, h: 52 * s };
  }

  /** One button per party member for the extraction pick, in two columns. */
  private pickRects(): Rect[] {
    const v = this.ctx.view;
    const s = v.baseScale;
    const pw = 520 * s;
    const px = v.width / 2 - pw / 2;
    const y0 = v.height / 2 + 46 * s;
    const bw = (pw - 80 * s - 12 * s) / 2;
    return this.match.player.party.map((_, i) => ({ x: px + 40 * s + (i % 2) * (bw + 12 * s), y: y0 + Math.floor(i / 2) * 44 * s, w: bw, h: 38 * s }));
  }

  private extract(i: number): void {
    const m = this.match.player.party[i];
    if (!m || this.sent.includes(m)) return;
    if (!extractToPc(m, this.sent.length === 0 ? 'win' : 'voucher')) this.saveFailed = true;
    // Every pick after the free one spends a voucher from the bag.
    if (this.sent.length > 0) {
      const slot = this.match.player.items.findIndex((e) => e?.id === 'extraction-voucher');
      if (slot >= 0) this.match.takeItem(this.match.player, slot);
    }
    this.sent.push(m);
  }

  step(dt: number, input: Input): void {
    this.t += dt;
    if (this.choosing) {
      if (this.t < 0.6) {
        input.takeClicks();
        return;
      }
      const rects = this.pickRects();
      for (const c of input.takeClicks()) {
        rects.forEach((r, i) => {
          if (this.choosing && hit(c.x, c.y, r.x, r.y, r.w, r.h)) this.extract(i);
        });
        const b = this.buttonRect();
        if (this.choosing && hit(c.x, c.y, b.x, b.y, b.w, b.h)) this.finished = true;
      }
      for (let i = 0; i < 6; i++) if (this.choosing && input.pressed(`Digit${i + 1}`)) this.extract(i);
      return;
    }
    const b = this.buttonRect();
    for (const c of input.takeClicks()) if (hit(c.x, c.y, b.x, b.y, b.w, b.h)) this.onRestart();
    if (this.t > 0.8 && (input.pressed('Enter') || input.pressed('Space'))) this.onRestart();
  }

  render(alpha: number, frameDt: number): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    this.behind.render(alpha, frameDt);
    const h = v.hud;
    const fade = Math.min(1, this.t / 0.8);
    h.fillStyle = `rgba(6,3,14,${0.72 * fade})`;
    h.fillRect(0, 0, v.width, v.height);
    const win = this.win;
    const pw = 520 * s;
    const ph = 400 * s;
    const px = v.width / 2 - pw / 2;
    const py = v.height / 2 - ph / 2 - 20 * s;
    panel(v, px, py, pw, ph, 22, 'rgba(18,14,34,0.92)');
    const inner = pw - 80 * s;
    // The result on a ribbon across the card's top edge.
    const k = skinPx(v);
    const rw = Math.round(340 * s);
    const rh = 22 * k;
    skinPiece(v, 'banner', v.width / 2 - rw / 2, py - rh / 2 + 6 * s, rw, rh, k);
    text(v, win ? 'VICTORY' : 'ELIMINATED', v.width / 2, py + 6 * s + 2 * k + 15 * s, 36, { align: 'center', color: win ? INK.accent : INK.bad, shadow: false, maxWidth: rw - 24 * k });
    text(v, win ? 'Last trainer standing on the training grounds.' : 'Your whole party fainted in the night.', v.width / 2, py + 82 * s, 14, { align: 'center', color: INK.dim, shadow: false, maxWidth: inner });
    const st = this.match.player.stats;
    const t = Math.floor(st.timeSurvived);
    const rows: Array<[string, string]> = [
      ['Catches', String(st.catches)],
      ['Knockouts', String(st.knockouts)],
      ['Damage dealt', String(st.damage)],
      ['Time survived', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`],
    ];
    rows.forEach(([k, val], i) => {
      const y = py + 128 * s + i * 28 * s;
      text(v, k, px + 50 * s, y, 15, { color: INK.dim, shadow: false });
      text(v, val, px + pw - 50 * s, y, 15, { align: 'right', color: INK.text, shadow: false });
      if (i < rows.length - 1) {
        h.fillStyle = 'rgba(138,106,74,0.25)';
        h.fillRect(px + 50 * s, y + 9 * s, pw - 100 * s, Math.max(1, Math.round(s)));
      }
    });
    const mx = this.ctx.input.mouseX;
    const my = this.ctx.input.mouseY;
    const b = this.buttonRect();
    if (this.choosing) {
      // The winner's prize: one Pokémon from the party goes to the PC for keeps, plus one per voucher.
      const left = this.picks - this.sent.length;
      const head = this.sent.length === 0
        ? (this.picks > 1 ? `Extract up to ${this.picks} Pokémon to your PC: 1 free + ${this.picks - 1} Extraction Voucher${this.picks > 2 ? 's' : ''} (1-6 or click)` : 'Extract one Pokémon to your PC (1-6 or click)')
        : `${this.sent.map((m) => m.name).join(', ')} sent! ${left} more with your voucher${left > 1 ? 's' : ''}`;
      text(v, head, v.width / 2, py + 252 * s, 13, { align: 'center', color: INK.blue, shadow: false, maxWidth: inner });
      this.pickRects().forEach((r, i) => {
        const m = this.match.player.party[i] as Mon;
        const done = this.sent.includes(m);
        const label = `${i + 1}  ${m.shiny ? '★ ' : ''}${m.name} Lv ${m.level}${done ? '  ✓ in PC' : ''}`;
        button(v, label, r.x, r.y, r.w, r.h, !done && hit(mx, my, r.x, r.y, r.w, r.h), done ? '#44405a' : '#f4e6c8');
      });
      button(v, this.sent.length ? 'Done' : 'Skip', b.x, b.y, b.w, b.h, hit(mx, my, b.x, b.y, b.w, b.h));
      return;
    }
    const party = this.match.player.party.map((m) => `${m.name} Lv ${m.level}${m.fainted ? ' (fainted)' : ''}`).join(', ') || '-';
    text(v, 'Party', v.width / 2, py + 252 * s, 14, { align: 'center', color: INK.dim, shadow: false });
    wrapText(v, party, v.width / 2, py + 274 * s, 13, inner, 20 * s, 2, { align: 'center', color: INK.text, shadow: false });
    if (this.sent.length) {
      const names = this.sent.map((m) => `${m.shiny ? 'Shiny ' : ''}${m.name}`).join(', ');
      const msg = this.saveFailed
        ? "Couldn't save to your PC (this browser blocks saving)"
        : `${names} ${this.sent.length > 1 ? 'were' : 'was'} sent to your PC (${loadPc().length} stored)`;
      text(v, msg, v.width / 2, py + 330 * s, 14, { align: 'center', color: this.saveFailed ? INK.bad : INK.blue, shadow: false, maxWidth: inner });
    }
    button(v, 'Play again', b.x, b.y, b.w, b.h, hit(mx, my, b.x, b.y, b.w, b.h));
  }
}
