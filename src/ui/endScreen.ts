/** Win / loss with the match stats. */
import type { Input } from '../core/input';
import type { Match } from '../sim/match';
import { button, hit, panel, text, type GameContext, type Screen } from './screens';
import type { MatchScreen } from './matchScreen';

export class EndScreen implements Screen {
  private t = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly match: Match,
    private readonly behind: MatchScreen,
    private readonly onRestart: () => void,
  ) {}

  private buttonRect(): { x: number; y: number; w: number; h: number } {
    const v = this.ctx.view;
    const s = v.baseScale;
    return { x: v.width / 2 - 110 * s, y: v.height / 2 + 150 * s, w: 220 * s, h: 52 * s };
  }

  step(dt: number, input: Input): void {
    this.t += dt;
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
    const win = this.match.outcome === 'win';
    const pw = 520 * s;
    const ph = 360 * s;
    const px = v.width / 2 - pw / 2;
    const py = v.height / 2 - ph / 2 - 20 * s;
    panel(v, px, py, pw, ph, 22, 'rgba(18,14,34,0.92)');
    text(v, win ? 'VICTORY' : 'ELIMINATED', v.width / 2, py + 62 * s, 44, { align: 'center', weight: '900', color: win ? '#ffd36b' : '#ff8fa3' });
    text(v, win ? 'Last trainer standing on the training grounds.' : 'Your whole party fainted in the night.', v.width / 2, py + 92 * s, 14, { align: 'center', weight: '500', color: '#cfc6ea' });
    const st = this.match.player.stats;
    const t = Math.floor(st.timeSurvived);
    const rows: Array<[string, string]> = [
      ['Catches', String(st.catches)],
      ['Knockouts', String(st.knockouts)],
      ['Damage dealt', String(st.damage)],
      ['Time survived', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`],
      ['Party', this.match.player.party.map((m) => `${m.name}${m.fainted ? ' (fainted)' : ''}`).join(', ') || '-'],
    ];
    rows.forEach(([k, val], i) => {
      const y = py + 140 * s + i * 34 * s;
      text(v, k, px + 50 * s, y, 16, { weight: '600', color: '#b9b4cc' });
      text(v, val, px + pw - 50 * s, y, 16, { align: 'right', weight: '800', color: '#ffffff' });
    });
    const b = this.buttonRect();
    button(v, 'Play again', b.x, b.y, b.w, b.h, hit(this.ctx.input.mouseX, this.ctx.input.mouseY, b.x, b.y, b.w, b.h));
  }
}
