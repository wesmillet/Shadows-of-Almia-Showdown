/** Title: the Ranger Union host paces a painted strip of ground under the logo; "Roll Starter" begins. */
import type { Input } from '../core/input';
import type { GroundRenderer } from '../ground/types';
import { Lighting } from '../render/lighting';
import { drawSheetFrame, drawSoftShadow } from '../render/world';
import type { RangerSprites } from '../sprites/rangerSprite';
import { button, hit, text, type GameContext, type Screen } from './screens';

export class TitleScreen implements Screen {
  private t = 0;
  private hostX = 0;
  private hostDir: 'left' | 'right' = 'right';
  private hostPhase = 0;
  private readonly lighting: Lighting;

  constructor(
    private readonly ctx: GameContext,
    private readonly ground: GroundRenderer,
    private readonly rangers: RangerSprites,
    private readonly onStart: () => void,
    private readonly onDemo: () => void,
  ) {
    this.lighting = new Lighting(ctx.view);
    const v = ctx.view;
    v.zoom = v.targetZoom = 1;
    v.snapTo(ground.cols / 2, ground.rows / 2 + 3.2);
  }

  private buttonRect(): { x: number; y: number; w: number; h: number } {
    const v = this.ctx.view;
    const s = v.baseScale;
    return { x: v.width / 2 - 120 * s, y: v.height * 0.64, w: 240 * s, h: 56 * s };
  }

  /** Demo mode: skip the roll and start with a max-level showcase team. */
  private demoRect(): { x: number; y: number; w: number; h: number } {
    const v = this.ctx.view;
    const s = v.baseScale;
    return { x: v.width / 2 - 120 * s, y: v.height * 0.64 + 68 * s, w: 240 * s, h: 44 * s };
  }

  step(dt: number, input: Input): void {
    this.t += dt;
    const v = this.ctx.view;
    // The host paces back and forth in front of the camera.
    this.hostX += (this.hostDir === 'right' ? 1 : -1) * 1.2 * dt;
    if (this.hostX > 2.2) this.hostDir = 'left';
    if (this.hostX < -2.2) this.hostDir = 'right';
    this.hostPhase = (this.hostPhase + dt * 1.4) % 1;
    v.camX = this.ground.cols / 2 + Math.sin(this.t * 0.1) * 1.5;
    const b = this.buttonRect();
    const d = this.demoRect();
    for (const c of input.takeClicks()) {
      if (hit(c.x, c.y, b.x, b.y, b.w, b.h)) this.onStart();
      else if (hit(c.x, c.y, d.x, d.y, d.w, d.h)) this.onDemo();
    }
    if (input.pressed('Enter') || input.pressed('Space')) this.onStart();
    if (input.pressed('KeyD')) this.onDemo();
  }

  /** The row the host paces on: just below the centre, but never on a cliff face or in water. */
  private hostRow(): number {
    if (this.row !== null) return this.row;
    const cx = Math.floor(this.ground.cols / 2);
    const base = Math.floor(this.ground.rows / 2 + 4);
    const clear = (r: number) => [-3, -2, -1, 0, 1, 2].every((dx) => this.ground.walkable(cx + dx, r));
    this.row = base;
    for (let k = 0; k <= 6; k++) {
      if (clear(base - k)) { this.row = base - k; break; }
      if (clear(base + k)) { this.row = base + k; break; }
    }
    return this.row;
  }

  private row: number | null = null;

  render(): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    v.ctx.fillStyle = '#0b0a12';
    v.ctx.fillRect(0, 0, v.width, v.height);
    this.ground.drawGround(v);
    // Host on the ground.
    const hx = v.toScreenX(this.ground.cols / 2 + this.hostX);
    const hy = v.toScreenY(this.hostRow() + 0.2);
    drawSoftShadow(v, hx, hy, 0.3);
    const sheet = this.rangers.get('host');
    const f = sheet.frame(this.hostDir, this.hostPhase, true);
    drawSheetFrame(v.ctx, f, Math.round(hx), Math.round(hy), v.rangerScale);
    v.beginLights();
    v.lightCtx.fillStyle = 'rgba(255,220,170,0.08)';
    v.lightCtx.fillRect(0, 0, v.width, v.height);
    this.lighting.render({ cold: 0.45, darkCx: v.width / 2, darkCy: v.height / 2, darkRadius: v.width * 0.7, darkFeather: v.width * 0.5, darkAmount: 0.4, clearCx: 0, clearCy: 0, clearRadius: 0, time: this.t });
    // Overlay
    const h = v.hud;
    h.clearRect(0, 0, v.width, v.height);
    const grad = h.createLinearGradient(0, 0, 0, v.height * 0.55);
    grad.addColorStop(0, 'rgba(8,4,20,0.85)');
    grad.addColorStop(1, 'rgba(8,4,20,0)');
    h.fillStyle = grad;
    h.fillRect(0, 0, v.width, v.height * 0.55);
    text(v, 'SHADOWS OF ALMIA', v.width / 2, v.height * 0.3, 72, { align: 'center', weight: '900', color: '#e9ddff' });
    text(v, 'SHOWDOWN', v.width / 2, v.height * 0.3 + 70 * s, 64, { align: 'center', weight: '900', color: '#b48cff' });
    text(v, 'A Pokémon battle royale on the Ranger Union training grounds', v.width / 2, v.height * 0.3 + 104 * s, 15, { align: 'center', weight: '500', color: '#cfc6ea' });
    const b = this.buttonRect();
    const hover = hit(this.ctx.input.mouseX, this.ctx.input.mouseY, b.x, b.y, b.w, b.h);
    button(v, 'Roll Starter', b.x, b.y, b.w, b.h, hover);
    const d = this.demoRect();
    button(v, 'Demo Team (D)', d.x, d.y, d.w, d.h, hit(this.ctx.input.mouseX, this.ctx.input.mouseY, d.x, d.y, d.w, d.h));
    text(v, 'Lv 100 Infernape · Shiny Rayquaza · Latios · Shiny Jirachi · Tinkaton', v.width / 2, d.y + d.h + 16 * s, 11, { align: 'center', weight: '500', color: '#9f97bb' });
    text(v, `Host: ${sheet.name} (${sheet.character})`, v.width / 2, v.height - 38 * s, 12, { align: 'center', weight: '500', color: '#9f97bb' });
    text(v, 'WASD move · 1-4 moves · 1-6 items · hold Space to throw · click portraits to swap', v.width / 2, v.height - 18 * s, 12, { align: 'center', weight: '500', color: '#9f97bb' });
    // Build stamp, top right on a dark pill: which deploy this browser has loaded.
    const stamp = `Version ${__BUILD__}`;
    h.save();
    h.font = `600 ${Math.round(14 * s)}px "Segoe UI", Inter, system-ui, sans-serif`;
    const sw = h.measureText(stamp).width + 20 * s;
    h.fillStyle = 'rgba(8,4,20,0.75)';
    h.beginPath();
    h.roundRect(v.width - sw - 12 * s, 12 * s, sw, 28 * s, 14 * s);
    h.fill();
    h.restore();
    text(v, stamp, v.width - 22 * s, 31 * s, 14, { align: 'right', weight: '600', color: '#ffe27a', shadow: false });
  }
}
