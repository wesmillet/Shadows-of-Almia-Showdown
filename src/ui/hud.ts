/**
 * In-match HUD on the overlay canvas: trainers-remaining counter (top left),
 * minimap with the darkness (top right), party strip with portraits and HP
 * (bottom), move wheel (bottom right) and the item bar (bottom centre).
 */
import { clamp } from '../core/math';
import type { View } from '../render/view';
import { lead } from '../sim/entities';
import { BEHAVIOR_LABEL, isRoaming, xpToNext } from '../sim/party';
import { move, typeColor } from '../sim/data';
import type { Match } from '../sim/match';
import { ITEMS } from '../sim/items';
import { darken, hit, lighten, rgba } from './screens';
import type { ItemIcons } from '../sprites/itemIcons';
import type { PixelUi } from './pixelUi';

export type HudHit = { kind: 'portrait'; index: number } | { kind: 'move'; index: number } | { kind: 'item'; index: number } | { kind: 'behavior'; index: number } | { kind: 'tab'; index: number };

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HudState {
  mouseX: number;
  mouseY: number;
  /** Safe radius of the darkness in tiles (Infinity = none yet). */
  darkRadius: number;
  darkPhaseLabel: string;
  nextPulseIn: number;
  notice: string;
  selectedItem: number;
  /** Which bag tab is open. */
  gearTab: boolean;
  /** Pickup popup: item id and seconds left. */
  popup: { itemId: string; t: number } | null;
  /** TM teach prompt: the TM's move name and the lead's current moves. */
  teach: { moveName: string; moves: string[]; mon: string } | null;
  aiming: number; // 0..1 catch aim power, 0 = not aiming
  lightingMode: string;
}

/** Name, level and HP above a wild or enemy Pokémon (drawn on the HUD canvas so it stays crisp). */
export function drawInfoBar(ui: PixelUi, ctx: CanvasRenderingContext2D, px: number, sx: number, top: number, name: string, level: number, frac: number, baseScale: number): void {
  const w = 20 * px;
  const x = Math.round(sx - w / 2);
  const y = Math.round(top - 7 * px - 4 * px);
  ui.bar(ctx, x, y, w, px, frac);
  ctx.font = `700 ${Math.round(10 * baseScale)}px "Segoe UI", Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  const label = `${name}  Lv ${level}`;
  ctx.strokeText(label, sx, y - 3 * baseScale);
  ctx.fillStyle = '#fff';
  ctx.fillText(label, sx, y - 3 * baseScale);
}

const STATUS_COLORS: Record<string, string> = { sleep: '#8f7cff', burn: '#ff7a3d', paralysis: '#f4d03f' };

export class Hud {
  private portraitRects: Rect[] = [];
  private behaviorRects: Rect[] = [];
  /** Minimap ping for a roaming member (set by the screen). */
  ping: { mon: import('../sim/entities').Mon; t: number } | null = null;
  private moveRects: Rect[] = [];
  private itemRects: Rect[] = [];
  private tabRects: Rect[] = [];
  private minimap: HTMLCanvasElement | null = null;

  constructor(private readonly view: View, private readonly icons: ItemIcons, private readonly ui: PixelUi) {}

  /** Integer pixel scale for ui/ art on the HUD canvas. */
  private get px(): number {
    return Math.max(2, Math.round(this.view.baseScale * 3));
  }

  hitTest(x: number, y: number): HudHit | null {
    for (let i = 0; i < this.behaviorRects.length; i++) {
      const r = this.behaviorRects[i] as Rect;
      if (hit(x, y, r.x, r.y, r.w, r.h)) return { kind: 'behavior', index: i };
    }
    for (let i = 0; i < this.moveRects.length; i++) {
      const r = this.moveRects[i] as Rect;
      if (hit(x, y, r.x, r.y, r.w, r.h)) return { kind: 'move', index: i };
    }
    for (let i = 0; i < this.portraitRects.length; i++) {
      const r = this.portraitRects[i] as Rect;
      if (hit(x, y, r.x, r.y, r.w, r.h)) return { kind: 'portrait', index: i };
    }
    for (let i = 0; i < this.itemRects.length; i++) {
      const r = this.itemRects[i] as Rect;
      if (hit(x, y, r.x, r.y, r.w, r.h)) return { kind: 'item', index: i };
    }
    for (let i = 0; i < this.tabRects.length; i++) {
      const r = this.tabRects[i] as Rect;
      if (hit(x, y, r.x, r.y, r.w, r.h)) return { kind: 'tab', index: i };
    }
    return null;
  }

  private font(size: number, weight = '600'): string {
    return `${weight} ${Math.round(size * this.view.baseScale)}px "Segoe UI", Inter, system-ui, sans-serif`;
  }

  private label(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color = '#f4f1ff', align: CanvasTextAlign = 'left', weight = '600'): void {
    ctx.font = this.font(size, weight);
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(s, x + 1.2 * this.view.baseScale, y + 1.2 * this.view.baseScale);
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }

  /** Panels are the tileset's dark 9-slice box; `fill` tints it (lead card, hover). */
  private panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, _r = 14, fill = ''): void {
    const s = this.px;
    const X = Math.round(x / s) * s;
    const Y = Math.round(y / s) * s;
    const W = Math.max(3 * s * 2, Math.round(w / s) * s);
    const H = Math.max(3 * s * 2, Math.round(h / s) * s);
    this.ui.box(ctx, X, Y, W, H, s, 'dt');
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(X + s, Y + s, W - 2 * s, H - 2 * s);
    }
  }

  /** Light 9-slice box for popups and notices. */
  popupBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const s = this.px;
    this.ui.box(ctx, Math.round(x / s) * s, Math.round(y / s) * s, Math.round(w / s) * s, Math.round(h / s) * s, s, 'lt');
  }

  draw(match: Match, st: HudState): void {
    const v = this.view;
    const ctx = v.hud;
    const s = v.baseScale;
    ctx.clearRect(0, 0, v.width, v.height);
    this.drawCounter(ctx, match, st, s);
    this.drawMinimap(ctx, match, st, s);
    this.drawParty(ctx, match, st, s);
    this.drawMoves(ctx, match, st, s);
    this.drawItems(ctx, match, st, s);
    if (st.notice) {
      ctx.save();
      ctx.font = this.font(18, '700');
      const w = ctx.measureText(st.notice).width + 40 * s;
      this.popupBox(ctx, v.width / 2 - w / 2, 86 * s, w, 40 * s);
      this.label(ctx, st.notice, v.width / 2, 113 * s, 18, '#4a2d1a', 'center', '700');
      ctx.restore();
    }
    if (st.popup) {
      const w = 300 * s;
      const h = 54 * s;
      const x = v.width / 2 - w / 2;
      const y = 140 * s;
      const def = ITEMS[st.popup.itemId];
      this.popupBox(ctx, x, y, w, h);
      this.icons.draw(ctx, st.popup.itemId, x + 30 * s, y + h / 2, Math.max(1, Math.round(s)), def?.tmType);
      this.label(ctx, `Found ${def?.name ?? st.popup.itemId}!`, x + 58 * s, y + 24 * s, 15, '#4a2d1a', 'left', '800');
      const hint = def?.kind === 'tm' ? `Teaches ${def.name.replace('TM ', '')} · Held & TMs tab` : def?.kind === 'hold' ? 'Held item · Held & TMs tab' : def?.kind === 'ball' ? 'Hold Space to throw' : 'Shift+number to use';
      this.label(ctx, hint, x + 58 * s, y + 42 * s, 11, '#6b4a30', 'left', '600');
    }
    if (st.teach) {
      const w = 340 * s;
      const h = 150 * s;
      const x = v.width / 2 - w / 2;
      const y = v.height / 2 - h / 2;
      this.popupBox(ctx, x, y, w, h);
      this.label(ctx, `Teach ${st.teach.moveName} to ${st.teach.mon}?`, x + w / 2, y + 28 * s, 15, '#4a2d1a', 'center', '800');
      this.label(ctx, 'Press 1-4 to replace a move, Esc to keep them', x + w / 2, y + 46 * s, 10, '#6b4a30', 'center', '600');
      st.teach.moves.forEach((mv, i) => {
        this.label(ctx, `${i + 1}  ${mv}`, x + 30 * s, y + 72 * s + i * 18 * s, 12, '#2a1a10', 'left', '700');
      });
    }
    if (st.aiming > 0) {
      const w = 220 * s;
      const x = v.width / 2 - w / 2;
      const y = v.height - 150 * s;
      this.panel(ctx, x, y, w, 22 * s, 11);
      ctx.fillStyle = '#ffd36b';
      ctx.beginPath();
      ctx.roundRect(x + 3 * s, y + 3 * s, (w - 6 * s) * st.aiming, 16 * s, 8);
      ctx.fill();
      this.label(ctx, 'release to throw', v.width / 2, y - 6 * s, 12, '#ffe9a8', 'center');
    }
    const note = match.ground.label;
    this.label(ctx, `${note} · lighting: ${st.lightingMode}`, v.width - 16 * s, v.height - 8 * s, 10, 'rgba(255,220,250,0.75)', 'right', '500');
  }

  private drawCounter(ctx: CanvasRenderingContext2D, match: Match, st: HudState, s: number): void {
    const remaining = [match.player, ...match.trainers].filter((t) => t.alive).length;
    this.panel(ctx, 16 * s, 16 * s, 236 * s, 74 * s, 14, 'rgba(12,12,22,0.35)');
    this.label(ctx, String(remaining), 34 * s, 66 * s, 44, '#ffffff', 'left', '800');
    this.label(ctx, 'TRAINERS LEFT', 92 * s, 44 * s, 13, '#cdbfff', 'left', '800');
    const t = Math.floor(match.time);
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    this.label(ctx, `${mm}:${ss}  ·  ${st.darkPhaseLabel}`, 92 * s, 66 * s, 13, '#e8e4f8', 'left', '500');
    if (st.nextPulseIn >= 0) this.label(ctx, `pulse in ${Math.ceil(st.nextPulseIn)}s`, 92 * s, 82 * s, 11, '#b9b4cc', 'left', '500');
  }

  private buildMinimap(match: Match): HTMLCanvasElement {
    const g = match.ground;
    const c = document.createElement('canvas');
    c.width = g.cols;
    c.height = g.rows;
    const ctx = c.getContext('2d')!;
    for (let y = 0; y < g.rows; y++) {
      for (let x = 0; x < g.cols; x++) {
        ctx.fillStyle = g.minimapColor(x, y);
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  private drawMinimap(ctx: CanvasRenderingContext2D, match: Match, st: HudState, s: number): void {
    const v = this.view;
    if (!this.minimap) this.minimap = this.buildMinimap(match);
    const size = 156 * s;
    const x = v.width - size - 16 * s;
    const y = 16 * s;
    this.panel(ctx, x - 6 * s, y - 6 * s, size + 12 * s, size + 12 * s, 12, 'rgba(12,12,22,0.2)');
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 8);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.minimap, x, y, size, size);
    const k = size / match.ground.cols;
    // darkness
    if (Number.isFinite(st.darkRadius)) {
      const cx = x + match.centerX * k;
      const cy = y + match.centerY * k;
      const r = st.darkRadius * k;
      const grad = ctx.createRadialGradient(cx, cy, Math.max(0, r - 2 * s), cx, cy, r + 6 * s);
      grad.addColorStop(0, 'rgba(20,4,36,0)');
      grad.addColorStop(1, 'rgba(20,4,36,0.86)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, size, size);
      ctx.strokeStyle = 'rgba(190,120,255,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // crystal
    ctx.fillStyle = '#c38bff';
    ctx.beginPath();
    ctx.moveTo(x + match.centerX * k, y + match.centerY * k - 5 * s);
    ctx.lineTo(x + match.centerX * k + 3.5 * s, y + match.centerY * k);
    ctx.lineTo(x + match.centerX * k, y + match.centerY * k + 5 * s);
    ctx.lineTo(x + match.centerX * k - 3.5 * s, y + match.centerY * k);
    ctx.fill();
    for (const o of match.outposts) {
      ctx.fillStyle = '#5ef0a8';
      ctx.fillRect(x + o.x * k - 2 * s, y + o.y * k - 2 * s, 4 * s, 4 * s);
    }
    // Roaming party members and the ping.
    for (const m of match.player.party) {
      if (m.fainted || !isRoaming(m)) continue;
      ctx.fillStyle = '#ffd36b';
      ctx.beginPath();
      ctx.arc(x + m.x * k, y + m.y * k, 2.5 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    if (this.ping && this.ping.t > 0) {
      const pm = this.ping.mon;
      const r = (4 + ((this.ping.t * 3) % 1) * 10) * s;
      ctx.strokeStyle = `rgba(255,220,120,${0.9 - ((this.ping.t * 3) % 1) * 0.8})`;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.arc(x + pm.x * k, y + pm.y * k, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const t of match.trainers) {
      if (!t.alive) continue;
      ctx.fillStyle = '#ff5c5c';
      ctx.beginPath();
      ctx.arc(x + t.x * k, y + t.y * k, 3 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    if (match.darkrai && !match.darkrai.fainted) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x + match.darkrai.x * k, y + match.darkrai.y * k, 3 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x + match.player.x * k, y + match.player.y * k, 3.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Index of the party card under the mouse, for the R (recall) key. */
  hoveredPortrait(x: number, y: number): number {
    for (let i = 0; i < this.portraitRects.length; i++) {
      const r = this.portraitRects[i] as Rect;
      if (hit(x, y, r.x, r.y, r.w, r.h)) return i;
    }
    return -1;
  }

  private drawParty(ctx: CanvasRenderingContext2D, match: Match, st: HudState, s: number): void {
    const v = this.view;
    const p = match.player;
    const cardW = 176 * s;
    const cardH = 74 * s;
    this.behaviorRects = [];
    const gap = 8 * s;
    const x0 = 16 * s;
    const y0 = v.height - cardH - 16 * s;
    this.portraitRects = [];
    const first = lead(p);
    p.party.forEach((m, i) => {
      const x = x0 + i * (cardW + gap);
      const hover = hit(st.mouseX, st.mouseY, x, y0, cardW, cardH);
      const isLead = m === first;
      this.panel(ctx, x, y0, cardW, cardH, 12, m.fainted ? 'rgba(60,20,30,0.45)' : isLead ? 'rgba(90,60,170,0.45)' : hover ? 'rgba(255,255,255,0.08)' : '');
      if (isLead) {
        ctx.strokeStyle = '#d7c6ff';
        ctx.lineWidth = this.px;
        ctx.strokeRect(x + this.px / 2, y0 + this.px / 2, cardW - this.px, cardH - this.px);
      }
      // portrait
      const ps = 46 * s;
      const px = x + 8 * s;
      const py = y0 + 8 * s;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(px, py, ps, ps, 8);
      ctx.clip();
      ctx.fillStyle = '#1c1830';
      ctx.fillRect(px, py, ps, ps);
      const f = m.sprites.portraitSource();
      ctx.imageSmoothingEnabled = false;
      const scale = Math.max(1, Math.floor(ps / Math.max(f.w, f.h)));
      const dw = f.w * scale;
      const dh = f.h * scale;
      ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, px + (ps - dw) / 2, py + (ps - dh) / 2, dw, dh);
      if (m.fainted) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(px, py, ps, ps);
      }
      ctx.restore();
      // name + level
      this.label(ctx, m.name, px + ps + 10 * s, y0 + 22 * s, 13, m.fainted ? '#9b8fa8' : '#ffffff', 'left', '700');
      this.label(ctx, `Lv ${m.level}`, x + cardW - 10 * s, y0 + 22 * s, 11, '#cdbfff', 'right', '600');
      // HP bar
      const bx = px + ps + 10 * s;
      const by = y0 + 30 * s;
      const bw = cardW - ps - 28 * s;
      const frac = clamp(m.hp / m.maxHp, 0, 1);
      this.ui.bar(ctx, Math.round(bx), Math.round(by), Math.round(bw / this.px) * this.px, this.px, frac);
      this.label(ctx, `${m.hp}/${m.maxHp}`, bx, by + 7 * this.px + 12 * s, 11, '#e8e4f8', 'left', '500');
      // XP bar
      const xf = clamp(m.xp / xpToNext(m.level), 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(bx, by + 7 * this.px + 16 * s, bw, this.px);
      ctx.fillStyle = '#7fb3ff';
      ctx.fillRect(bx, by + 7 * this.px + 16 * s, Math.round(bw * xf / this.px) * this.px, this.px);
      // behaviour chip
      const roaming = isRoaming(m);
      const chipW = 66 * s;
      const chipX = x + cardW - chipW - 8 * s;
      const chipY = y0 + cardH - 18 * s;
      const chipHover = hit(st.mouseX, st.mouseY, chipX, chipY, chipW, 14 * s);
      ctx.fillStyle = roaming ? (chipHover ? 'rgba(255,170,90,0.9)' : 'rgba(230,140,60,0.8)') : chipHover ? 'rgba(170,150,255,0.9)' : 'rgba(110,90,200,0.75)';
      ctx.beginPath();
      ctx.roundRect(chipX, chipY, chipW, 14 * s, 7);
      ctx.fill();
      this.label(ctx, BEHAVIOR_LABEL[m.behavior], chipX + chipW / 2, chipY + 10.5 * s, 8.5, '#ffffff', 'center', '800');
      this.behaviorRects.push({ x: chipX, y: chipY, w: chipW, h: 14 * s });
      if (roaming) {
        const dist = Math.hypot(m.x - p.x, m.y - p.y);
        // map pin + distance
        const pinX = px + ps - 6 * s;
        const pinY = py + 8 * s;
        ctx.fillStyle = '#ff6b6b';
        ctx.beginPath();
        ctx.arc(pinX, pinY, 5 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(pinX - 4 * s, pinY + 3 * s);
        ctx.lineTo(pinX + 4 * s, pinY + 3 * s);
        ctx.lineTo(pinX, pinY + 10 * s);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(pinX, pinY, 2 * s, 0, Math.PI * 2);
        ctx.fill();
        this.label(ctx, `${dist.toFixed(0)} tiles away · R to recall`, x + 8 * s, y0 + cardH - 7 * s, 8.5, '#ffd3a8', 'left', '600');
      }
      if (m.status) {
        const color = STATUS_COLORS[m.status] ?? '#fff';
        const tag = m.status === 'paralysis' ? 'PAR' : m.status === 'burn' ? 'BRN' : 'SLP';
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x + cardW - 44 * s, by + 10 * s, 34 * s, 15 * s, 6);
        ctx.fill();
        this.label(ctx, tag, x + cardW - 27 * s, by + 21.5 * s, 10, '#1a1028', 'center', '800');
      }
      if (m.heldItem) {
        this.label(ctx, ITEMS[m.heldItem]?.short ?? m.heldItem, x + cardW - 10 * s, y0 + cardH - 8 * s, 9, '#ffe9a8', 'right', '600');
      }
      this.portraitRects.push({ x, y: y0, w: cardW, h: cardH });
    });
  }

  private drawMoves(ctx: CanvasRenderingContext2D, match: Match, st: HudState, s: number): void {
    const v = this.view;
    const m = lead(match.player);
    this.moveRects = [];
    if (!m) return;
    const cx = v.width - 128 * s;
    const cy = v.height - 118 * s;
    const R = 56 * s;
    const r = 30 * s;
    const offsets = [
      [0, -R],
      [R, 0],
      [0, R],
      [-R, 0],
    ];
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R + r + 8 * s, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12,12,22,0.55)';
    ctx.fill();
    ctx.restore();
    m.moves.forEach((id, i) => {
      const def = move(id);
      const [ox, oy] = offsets[i] as [number, number];
      const x = cx + ox;
      const y = cy + oy;
      const cd = m.cooldowns[i] ?? 0;
      const ready = cd <= 0 && m.status !== 'sleep';
      const hover = Math.hypot(st.mouseX - x, st.mouseY - y) < r;
      const color = typeColor(def.type);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.1, x, y, r);
      g.addColorStop(0, ready ? lighten(color, hover ? 0.45 : 0.25) : darken(color, 0.55));
      g.addColorStop(1, ready ? darken(color, 0.15) : darken(color, 0.7));
      ctx.fillStyle = g;
      ctx.fill();
      if (!ready && cd > 0) {
        const frac = cd / def.cooldown;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = ready ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = (ready && hover ? 3 : 1.5) * s;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      if (ready) {
        ctx.shadowColor = rgba(color, 0.8);
        ctx.shadowBlur = 12 * s;
        ctx.stroke();
      }
      ctx.restore();
      this.label(ctx, String(i + 1), x, y - 4 * s, 15, '#ffffff', 'center', '800');
      this.label(ctx, def.name, x, y + 11 * s, 8.5, ready ? '#ffffff' : '#bbb', 'center', '600');
      if (!ready && cd > 0) this.label(ctx, cd.toFixed(1), x, y + 22 * s, 8, '#ffe9a8', 'center', '600');
      this.moveRects.push({ x: x - r, y: y - r, w: r * 2, h: r * 2 });
    });
  }

  private drawItems(ctx: CanvasRenderingContext2D, match: Match, st: HudState, s: number): void {
    const v = this.view;
    const items = st.gearTab ? match.player.held : match.player.items;
    const n = items.length;
    const slot = 44 * s;
    const gap = 6 * s;
    const w = n * slot + (n - 1) * gap;
    const x0 = 24 * s;
    const y0 = v.height - 62 * s - 16 * s - slot - 20 * s;
    this.itemRects = [];
    this.tabRects = [];
    this.panel(ctx, x0 - 8 * s, y0 - 8 * s, w + 16 * s, slot + 16 * s, 12, 'rgba(12,12,22,0.25)');
    // Tabs above the slots.
    const tabW = 64 * s;
    ['Bag', 'Held & TMs'].forEach((name, i) => {
      const tx = x0 - 8 * s + i * (tabW + 4 * s);
      const ty = y0 - 8 * s - 18 * s;
      const active = (i === 1) === st.gearTab;
      ctx.fillStyle = active ? 'rgba(120,90,220,0.9)' : 'rgba(30,24,50,0.8)';
      ctx.fillRect(Math.round(tx), Math.round(ty), tabW, 16 * s);
      this.label(ctx, name, tx + tabW / 2, ty + 12 * s, 9, active ? '#fff' : '#b9b4cc', 'center', '800');
      this.tabRects.push({ x: tx, y: ty, w: tabW, h: 16 * s });
    });
    this.label(ctx, 'Tab', x0 + w + 8 * s - 4 * s, y0 - 8 * s - 6 * s, 8, '#9f97bb', 'right', '600');
    items.forEach((entry, i) => {
      const id = entry?.id ?? null;
      const x = x0 + i * (slot + gap);
      const hover = hit(st.mouseX, st.mouseY, x, y0, slot, slot);
      const selected = st.selectedItem === i;
      ctx.beginPath();
      ctx.roundRect(x, y0, slot, slot, 8);
      ctx.fillStyle = selected ? 'rgba(120,90,220,0.6)' : hover ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)';
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = '#ffe9a8';
        ctx.lineWidth = 2 * s;
        ctx.stroke();
      }
      this.label(ctx, String(i + 1), x + 4 * s, y0 + 11 * s, 9, '#b9b4cc', 'left', '600');
      if (id) {
        const def = ITEMS[id];
        if (def) {
          this.icons.draw(ctx, def.id, x + slot / 2, y0 + slot / 2 - 3 * s, Math.max(1, Math.round(s)), def.tmType);
          this.label(ctx, def.kind === 'tm' ? def.name.replace('TM ', '') : def.short, x + slot / 2, y0 + slot - 4 * s, 8, '#ffffff', 'center', '700');
          if ((entry?.count ?? 1) > 1) this.label(ctx, `×${entry?.count}`, x + slot - 4 * s, y0 + 11 * s, 9, '#ffe9a8', 'right', '800');
        }
      }
      this.itemRects.push({ x, y: y0, w: slot, h: slot });
    });
  }
}

/** Simple vector icons for items (balls, bottles, badges). */
export function drawItemIcon(ctx: CanvasRenderingContext2D, icon: { shape: 'ball' | 'bottle' | 'badge' | 'sash' | 'styler'; color: string; accent?: string }, x: number, y: number, r: number): void {
  ctx.save();
  if (icon.shape === 'ball') {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#f4f4f4';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI, 0);
    ctx.fillStyle = icon.color;
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.fillRect(x - r, y - r * 0.12, r * 2, r * 0.24);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = '#222';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = icon.accent ?? '#fff';
    ctx.fill();
  } else if (icon.shape === 'bottle') {
    ctx.fillStyle = icon.color;
    ctx.beginPath();
    ctx.roundRect(x - r * 0.55, y - r * 0.5, r * 1.1, r * 1.5, r * 0.3);
    ctx.fill();
    ctx.fillStyle = icon.accent ?? '#fff';
    ctx.fillRect(x - r * 0.3, y - r * 1.0, r * 0.6, r * 0.55);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(x - r * 0.35, y - r * 0.2, r * 0.25, r * 0.9);
  } else if (icon.shape === 'badge') {
    ctx.fillStyle = icon.color;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = icon.accent ?? '#fff';
    ctx.font = `800 ${Math.round(r * 1.1)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('X', x, y + 1);
  } else if (icon.shape === 'sash') {
    ctx.strokeStyle = icon.color;
    ctx.lineWidth = r * 0.45;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - r, y - r * 0.8);
    ctx.quadraticCurveTo(x, y + r * 0.2, x + r, y + r * 0.9);
    ctx.stroke();
  } else {
    ctx.fillStyle = icon.color;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.65, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = icon.accent ?? '#fff';
    ctx.beginPath();
    ctx.arc(x + r * 0.25, y - r * 0.1, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
