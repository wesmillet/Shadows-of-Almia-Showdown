/** Floating damage numbers and short labels, drawn on the HUD canvas in screen space. */
import type { View } from '../render/view';
import { text, uiFont } from '../ui/screens';

interface Floater {
  x: number;
  y: number;
  t: number;
  life: number;
  label: string;
  color: string;
  size: number;
  vy: number;
}

export class Floaters {
  private list: Floater[] = [];

  add(x: number, y: number, label: string, color: string, size = 22): void {
    this.list.push({ x, y, t: 0, life: 1.0, label, color, size, vy: -1.3 });
  }

  update(dt: number): void {
    for (const f of this.list) {
      f.t += dt;
      f.y += f.vy * dt;
      f.vy *= 0.94;
    }
    this.list = this.list.filter((f) => f.t < f.life);
  }

  draw(view: View, hud: CanvasRenderingContext2D): void {
    for (const f of this.list) {
      const p = f.t / f.life;
      const pop = p < 0.15 ? 1 + (0.15 - p) * 3 : 1;
      const sx = view.toScreenX(f.x);
      const sy = view.toScreenY(f.y) - 0.9 * view.pxPerTile;
      hud.save();
      hud.globalAlpha = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1;
      // text() draws on the scene ctx; swap in the hud ctx by writing directly
      hud.font = uiFont(f.size * view.baseScale * pop);
      hud.textAlign = 'center';
      hud.lineWidth = 4 * view.baseScale;
      hud.strokeStyle = 'rgba(0,0,0,0.7)';
      hud.strokeText(f.label, sx, sy);
      hud.fillStyle = f.color;
      hud.fillText(f.label, sx, sy);
      hud.restore();
    }
  }
}

export { text };
