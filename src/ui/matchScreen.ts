import type { Input } from '../core/input';
import type { View } from '../render/view';
import { renderWorld } from '../render/world';
import type { Match } from '../sim/match';
import type { RangerSprites } from '../sprites/rangerSprite';
import { panel, text, type GameContext, type Screen } from './screens';

export class MatchScreen implements Screen {
  constructor(private readonly ctx: GameContext, readonly match: Match, private readonly rangers: RangerSprites) {
    const v = ctx.view;
    v.snapTo(match.player.x, match.player.y);
  }

  step(dt: number, input: Input): void {
    this.match.step(dt, input);
  }

  render(alpha: number, frameDt: number): void {
    const v: View = this.ctx.view;
    const p = this.match.player;
    v.follow(p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha, frameDt, this.match.ground.cols, this.match.ground.rows);
    v.ctx.fillStyle = '#0b0a12';
    v.ctx.fillRect(0, 0, v.width, v.height);
    renderWorld(v, this.match, { alpha, rangers: this.rangers });
    this.drawHud(v);
  }

  private drawHud(v: View): void {
    const s = v.baseScale;
    panel(v, 16 * s, 16 * s, 300 * s, 54 * s);
    text(v, 'NIGHTFALL ROYALE', 30 * s, 40 * s, 16, { weight: '800', color: '#cdbfff' });
    text(v, `milestone 1 · ${Math.floor(this.match.time)}s`, 30 * s, 60 * s, 12, { color: '#b9b4cc' });
    const label = this.match.ground.label;
    panel(v, 16 * s, v.height - 46 * s, Math.min(v.width - 32 * s, (label.length * 7 + 30) * s), 30 * s, 10, 'rgba(60,20,70,0.7)');
    text(v, label, 30 * s, v.height - 26 * s, 12, { color: '#ffd3f6' });
    text(v, 'WASD / arrows to move', v.width - 20 * s, v.height - 26 * s, 12, { align: 'right', color: '#b9b4cc' });
  }
}
