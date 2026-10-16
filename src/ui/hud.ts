/**
 * In-match HUD on the overlay canvas: trainers-remaining counter (top left),
 * minimap with the darkness (top right), party strip with portraits and HP
 * (bottom), move wheel (bottom right) and the item bar (bottom centre).
 */
import { clamp } from '../core/math';
import type { View } from '../render/view';
import { incapable, lead } from '../sim/entities';
import { BEHAVIOR_LABEL, isRoaming, xpToNext } from '../sim/party';
import { CONFIG, MOVE_SLOTS, move, typeColor } from '../sim/data';
import type { Match } from '../sim/match';
import { ITEMS, type BallKind } from '../sim/items';
import type { InventorySlot } from '../sim/entities';
import { darken, fitSize, hit, lighten, rgba, uiFont } from './screens';
import type { ItemIcons } from '../sprites/itemIcons';
import type { PixelUi } from './pixelUi';

/** ?debug in the address shows the map and lighting stamp in the corner. */
const DEBUG_STAMP = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

export type HudHit = { kind: 'portrait'; index: number } | { kind: 'move'; index: number } | { kind: 'item'; index: number } | { kind: 'behavior'; index: number } | { kind: 'tab'; index: number } | { kind: 'discard'; index: number } | { kind: 'release'; index: number };

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
  popup: { items: InventorySlot[]; ball: BallKind; healed: boolean; t: number } | null;
  /** Name of the ball F will throw, if one is armed. */
  armedBall: string | null;
  /** TM teach prompt: the TM's move name and the lead's current moves. */
  teach: { moveName: string; moves: string[]; mon: string; title?: string } | null;
  /** The Extraction Voucher's prompt: the party, to pick who goes to the PC. */
  extract: { names: string[] } | null;
  /** Poké Dollars. */
  money: number;
  /** What E would do here (shop, challenge), or a hint. */
  prompt: string | null;
  /** An open stall: its lines with prices. */
  shop: { name: string; entries: Array<{ name: string; price: number; affordable: boolean }> } | null;
  aiming: number; // 0..1 catch aim power, 0 = not aiming
  lightingMode: string;
}

/** Name, level and HP above a wild or enemy Pokémon (drawn on the HUD canvas so it stays crisp). */
export function drawInfoBar(ui: PixelUi, ctx: CanvasRenderingContext2D, px: number, sx: number, top: number, name: string, level: number, frac: number, baseScale: number, color = '#fff', badge: CanvasImageSource | null = null): void {
  const w = 20 * px;
  const x = Math.round(sx - w / 2);
  const y = Math.round(top - 7 * px - 4 * px);
  ui.bar(ctx, x, y, w, px, frac);
  ctx.font = uiFont(10 * baseScale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  const label = `${name}  Lv ${level}`;
  ctx.strokeText(label, sx, y - 3 * baseScale);
  ctx.fillStyle = color;
  ctx.fillText(label, sx, y - 3 * baseScale);
  // A badge (the Alpha mark) to the left of the name.
  if (badge) {
    const bh = 16 * baseScale;
    const bw = bh * (57 / 64);
    const tw = ctx.measureText(label).width;
    ctx.drawImage(badge, sx - tw / 2 - bw - 4 * baseScale, y - 3 * baseScale - bh + 3 * baseScale, bw, bh);
  }
}

/** The button that casts each move slot (1-2 and Q/E work too). */
const MOVE_KEYS = ['LMB', 'RMB'];

const STATUS_COLORS: Record<string, string> = { sleep: '#8f7cff', burn: '#ff7a3d', paralysis: '#f4d03f', poison: '#b06cff', freeze: '#8fe0ff', confusion: '#ff8fd0' };

export class Hud {
  private portraitRects: Rect[] = [];
  private behaviorRects: Rect[] = [];
  /** Minimap ping for a roaming member (set by the screen). */
  ping: { mon: import('../sim/entities').Mon; t: number } | null = null;
  private moveRects: Rect[] = [];
  private itemRects: Rect[] = [];
  private tabRects: Rect[] = [];
  /** The X on a hovered bag slot that throws its item away. */
  private discardRects: Array<Rect & { index: number }> = [];
  private releaseRects: Array<Rect & { index: number }> = [];
  /** The party slot whose release X was clicked once (it turns into a confirm). */
  releaseArmed = -1;
  private minimap: HTMLCanvasElement | null = null;

  constructor(private readonly view: View, private readonly icons: ItemIcons, private readonly ui: PixelUi) {}

  /** Integer pixel scale for ui/ art on the HUD canvas. */
  private get px(): number {
    return Math.max(2, Math.round(this.view.baseScale * 3));
  }

  hitTest(x: number, y: number): HudHit | null {
    for (const d of this.discardRects) if (hit(x, y, d.x, d.y, d.w, d.h)) return { kind: 'discard', index: d.index };
    for (const d of this.releaseRects) if (hit(x, y, d.x, d.y, d.w, d.h)) return { kind: 'release', index: d.index };
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
    void weight;
    return uiFont(size * this.view.baseScale);
  }

  /** Shadowed text; with `maxWidth` it shrinks (to 8 px at most) to stay inside its box. */
  private label(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color = '#f4f1ff', align: CanvasTextAlign = 'left', weight = '600', maxWidth?: number): void {
    if (maxWidth !== undefined) size = fitSize(this.view, s, size, maxWidth, ctx);
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
      this.label(ctx, st.notice, v.width / 2, 113 * s, 18, '#f4f1ff', 'center', '700');
      ctx.restore();
    }
    if (st.popup) {
      const names = st.popup.items.map((it) => `${ITEMS[it.id]?.name ?? it.id}${it.count > 1 ? ` ×${it.count}` : ''}`);
      const title = `Found ${names.join(', ')}!`;
      ctx.font = this.font(15, '800');
      const w = Math.max(300 * s, ctx.measureText(title).width + 110 * s);
      const h = 54 * s;
      const x = v.width / 2 - w / 2;
      const y = 140 * s;
      const first = st.popup.items[0];
      const def = first ? ITEMS[first.id] : undefined;
      this.popupBox(ctx, x, y, w, h);
      // The ball it came in, then what was inside.
      this.icons.draw(ctx, `${st.popup.ball}-ball`, x + 22 * s, y + h / 2, 36 * s);
      if (first) this.icons.draw(ctx, first.id, x + 58 * s, y + h / 2, 32 * s, def?.tmType);
      this.label(ctx, title, x + 86 * s, y + 24 * s, 15, '#f4f1ff', 'left', '800');
      const hint = st.popup.healed ? 'Your party is fully healed'
        : def?.kind === 'tm' ? `Teaches ${def.name.replace('TM ', '')} · Held & TMs tab`
        : def?.kind === 'hold' ? 'Held item · Held & TMs tab'
        : def?.kind === 'ball' ? (def.desc ?? 'Hold F to throw')
        : def?.kind === 'shard' ? (def.desc ?? '') : 'Shift+number to use';
      this.label(ctx, hint, x + 86 * s, y + 42 * s, 11, '#cfc6ea', 'left', '600', w - 100 * s);
    }
    if (st.teach) {
      const w = 340 * s;
      const h = 150 * s;
      const x = v.width / 2 - w / 2;
      const y = v.height / 2 - h / 2;
      this.popupBox(ctx, x, y, w, h);
      this.label(ctx, st.teach.title ?? `Teach ${st.teach.moveName} to ${st.teach.mon}?`, x + w / 2, y + 28 * s, 15, '#f4f1ff', 'center', '800', w - 28 * s);
      this.label(ctx, 'Press 1 or 2 to replace a move, Esc to keep them', x + w / 2, y + 46 * s, 10, '#cfc6ea', 'center', '600', w - 28 * s);
      st.teach.moves.forEach((mv, i) => {
        this.label(ctx, `${i + 1}  ${mv}`, x + 30 * s, y + 72 * s + i * 18 * s, 12, '#f4f1ff', 'left', '700', w - 60 * s);
      });
    }
    if (st.extract) {
      const w = 360 * s;
      const h = (84 + st.extract.names.length * 18) * s;
      const x = v.width / 2 - w / 2;
      const y = v.height / 2 - h / 2;
      this.popupBox(ctx, x, y, w, h);
      this.label(ctx, 'Extraction Voucher', x + w / 2, y + 28 * s, 15, '#ffd36b', 'center', '800', w - 28 * s);
      this.label(ctx, 'Press 1-6 (or click a card) to send that Pokémon to your PC, Esc to cancel', x + w / 2, y + 46 * s, 9.5, '#cfc6ea', 'center', '600', w - 28 * s);
      st.extract.names.forEach((n, i) => {
        this.label(ctx, `${i + 1}  ${n}`, x + 30 * s, y + 72 * s + i * 18 * s, 12, '#f4f1ff', 'left', '700', w - 60 * s);
      });
    }
    if (st.shop) {
      const w = 360 * s;
      const h = (74 + st.shop.entries.length * 20) * s;
      const x = v.width / 2 - w / 2;
      const y = v.height / 2 - h / 2;
      this.popupBox(ctx, x, y, w, h);
      this.label(ctx, st.shop.name, x + w / 2, y + 28 * s, 15, '#f4f1ff', 'center', '800', w - 28 * s);
      this.label(ctx, `You have ₽${st.money.toLocaleString()} · 1-9 to buy · E or Esc to leave`, x + w / 2, y + 46 * s, 10, '#cfc6ea', 'center', '600', w - 28 * s);
      st.shop.entries.forEach((e, i) => {
        const yy = y + 70 * s + i * 20 * s;
        const col = e.affordable ? '#f4f1ff' : '#6f6888';
        this.label(ctx, `${i + 1}  ${e.name}`, x + 30 * s, yy, 12, col, 'left', '700', w - 130 * s);
        this.label(ctx, `₽${e.price.toLocaleString()}`, x + w - 30 * s, yy, 12, col, 'right', '700');
      });
    }
    if (st.prompt && !st.shop && !st.teach) {
      const y = v.height - 170 * s;
      ctx.save();
      ctx.font = this.font(13, '700');
      const tw = ctx.measureText(st.prompt).width + 28 * s;
      ctx.restore();
      this.panel(ctx, v.width / 2 - tw / 2, y - 18 * s, tw, 28 * s, 12, 'rgba(12,12,22,0.55)');
      this.label(ctx, st.prompt, v.width / 2, y + 1 * s, 13, '#ffe9a8', 'center', '700');
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
      this.label(ctx, st.armedBall ? `${st.armedBall}: release to throw` : 'release to throw', v.width / 2, y - 6 * s, 12, '#ffe9a8', 'center');
    }
    // The map and lighting stamp, only with ?debug in the address.
    if (DEBUG_STAMP) this.label(ctx, `${match.ground.label} · lighting: ${st.lightingMode}`, v.width - 16 * s, v.height - 8 * s, 10, 'rgba(255,220,250,0.75)', 'right', '500');
  }

  /**
   * Top left: trainers left, the match clock and phase, and the storm: five pips for the
   * darkness pulses (lit as they pass) over a bar that fills toward the next one. Money sits
   * in the same panel, bottom right.
   */
  private drawCounter(ctx: CanvasRenderingContext2D, match: Match, st: HudState, s: number): void {
    const remaining = [match.player, ...match.trainers].filter((t) => t.alive && !t.challenger && !t.visitor).length;
    const x = 16 * s;
    const y = 16 * s;
    const w = 268 * s;
    const h = 104 * s;
    this.panel(ctx, x, y, w, h, 14, 'rgba(12,12,22,0.45)');
    this.label(ctx, String(remaining), x + 18 * s, y + 52 * s, 44, '#ffffff', 'left', '800');
    this.label(ctx, remaining === 1 ? 'TRAINER LEFT' : 'TRAINERS LEFT', x + 76 * s, y + 28 * s, 13, '#cdbfff', 'left', '800', w - 90 * s);
    const t = Math.floor(match.time);
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    this.label(ctx, `${mm}:${ss}  ·  ${st.darkPhaseLabel}`, x + 76 * s, y + 48 * s, 12, '#e8e4f8', 'left', '600', w - 90 * s);
    // The storm: pips for the pulses, a bar to the next one.
    const d = match.darkness;
    const pulses = CONFIG.darkness.radiiTiles.length;
    const px0 = x + 16 * s;
    const py = y + 68 * s;
    for (let i = 0; i < pulses; i++) {
      const lit = i < d.phase;
      ctx.fillStyle = lit ? '#b36bff' : 'rgba(205,191,255,0.25)';
      ctx.beginPath();
      ctx.arc(px0 + i * 14 * s + 5 * s, py, 4.5 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    const bx = px0 + pulses * 14 * s + 6 * s;
    const bw = x + w - 16 * s - bx;
    const frac = st.nextPulseIn >= 0 ? 1 - Math.min(1, st.nextPulseIn / CONFIG.darkness.pulseSeconds) : 1;
    ctx.fillStyle = 'rgba(205,191,255,0.18)';
    ctx.beginPath();
    ctx.roundRect(bx, py - 4 * s, bw, 8 * s, 4 * s);
    ctx.fill();
    ctx.fillStyle = st.nextPulseIn >= 0 && st.nextPulseIn < 15 ? '#ff6b9a' : '#8a5cff';
    ctx.beginPath();
    ctx.roundRect(bx, py - 4 * s, Math.max(4 * s, bw * frac), 8 * s, 4 * s);
    ctx.fill();
    const pulseText = st.nextPulseIn >= 0 ? `darkness pulse in ${Math.ceil(st.nextPulseIn)}s` : 'the darkness has closed in';
    this.label(ctx, pulseText, px0, y + 92 * s, 10.5, st.nextPulseIn >= 0 && st.nextPulseIn < 15 ? '#ff9ab8' : '#b9b4cc', 'left', '600', w - 110 * s);
    this.label(ctx, `₽ ${st.money.toLocaleString()}`, x + w - 16 * s, y + 92 * s, 13, '#ffe27a', 'right', '800', 90 * s);
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
    // Visitors: the merchant (gold), Celeste (pink), Hoopa (violet), and any legendary loose (white ring).
    const dot = (wx: number, wy: number, color: string, r = 2.5) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + wx * k, y + wy * k, r * s, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const n of match.npcs) {
      if (n.role === 'merchant') dot(n.x, n.y, '#ffe27a');
      else if (n.role === 'ace') dot(n.x, n.y, '#ff9ad5');
    }
    for (const w of match.wilds) {
      if (w.npc === 'hoopa') dot(w.x, w.y, '#c78bff', 3);
      else if (w.legend) {
        ctx.strokeStyle = '#ffcf4a';
        ctx.lineWidth = 2 * s;
        ctx.beginPath();
        ctx.arc(x + w.x * k, y + w.y * k, 4 * s, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    for (const t of match.trainers) {
      if (!t.alive || t.visitor) continue;
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
    // Cards shrink to fit a full party of six between the left edge and the move buttons.
    const gap = 8 * s;
    const n = Math.max(1, p.party.length);
    const room = v.width - 16 * s - 300 * s;
    const cardW = Math.min(176 * s, (room - gap * (n - 1)) / n);
    const cardH = 74 * s;
    this.behaviorRects = [];
    const x0 = 16 * s;
    const y0 = v.height - cardH - 16 * s;
    this.portraitRects = [];
    this.releaseRects = [];
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
      this.ui.slot(ctx, px - 3 * s, py - 3 * s, ps + 6 * s, Math.max(1, Math.round(this.px / 3)));
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(px, py, ps, ps, 4);
      ctx.clip();
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
      // Waiting in its ball (only two are out at a time): a small ball on the portrait.
      if (m.stowed && !m.fainted) this.icons.draw(ctx, 'poke-ball', px + 8 * s, py + ps - 8 * s, 16 * s);
      // name + level: the level keeps its size, the name shrinks into what is left.
      const lvText = `Lv ${m.level}`;
      ctx.font = this.font(11, '600');
      const lvW = ctx.measureText(lvText).width;
      const nameX = px + ps + 10 * s;
      this.label(ctx, lvText, x + cardW - 10 * s, y0 + 22 * s, 11, '#cdbfff', 'right', '600');
      this.label(ctx, m.shiny ? `${m.name} ★` : m.name, nameX, y0 + 22 * s, 13, m.fainted ? '#9b8fa8' : m.shiny ? '#9ff3ff' : '#ffffff', 'left', '700', x + cardW - 10 * s - lvW - 6 * s - nameX);
      // HP bar
      const bx = px + ps + 10 * s;
      const by = y0 + 30 * s;
      const bw = cardW - ps - 28 * s;
      const frac = clamp(m.hp / m.maxHp, 0, 1);
      this.ui.bar(ctx, Math.round(bx), Math.round(by), Math.round(bw / this.px) * this.px, this.px, frac);
      const chipW = 54 * s;
      const chipX = x + cardW - chipW - 8 * s;
      this.label(ctx, `${m.hp}/${m.maxHp}`, bx, by + 7 * this.px + 12 * s, 11, '#e8e4f8', 'left', '500', chipX - bx - 4 * s);
      // XP bar
      const xf = clamp(m.xp / xpToNext(m.level), 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(bx, by + 7 * this.px + 16 * s, bw, this.px);
      ctx.fillStyle = '#7fb3ff';
      ctx.fillRect(bx, by + 7 * this.px + 16 * s, Math.round(bw * xf / this.px) * this.px, this.px);
      // behaviour chip
      const roaming = isRoaming(m);
      const chipY = y0 + cardH - 18 * s;
      const chipHover = hit(st.mouseX, st.mouseY, chipX, chipY, chipW, 14 * s);
      ctx.fillStyle = roaming ? (chipHover ? 'rgba(255,170,90,0.9)' : 'rgba(230,140,60,0.8)') : chipHover ? 'rgba(170,150,255,0.9)' : 'rgba(110,90,200,0.75)';
      ctx.beginPath();
      ctx.roundRect(chipX, chipY, chipW, 14 * s, 7);
      ctx.fill();
      this.label(ctx, BEHAVIOR_LABEL[m.behavior], chipX + chipW / 2, chipY + 10.5 * s, 8.5, '#ffffff', 'center', '800', chipW - 6 * s);
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
        this.label(ctx, `${dist.toFixed(0)} tiles away · R to recall`, x + 8 * s, y0 + cardH - 7 * s, 8.5, '#ffd3a8', 'left', '600', chipX - x - 12 * s);
      }
      if (m.status) {
        const color = STATUS_COLORS[m.status] ?? '#fff';
        const tag = ({ paralysis: 'PAR', burn: 'BRN', sleep: 'SLP', poison: 'PSN', freeze: 'FRZ', confusion: 'CNF' } as Record<string, string>)[m.status] ?? '';
        ctx.fillStyle = color;
        ctx.beginPath();
        // On the portrait's top-left corner, clear of the HP bar.
        ctx.roundRect(px - 2 * s, py - 2 * s, 30 * s, 14 * s, 5);
        ctx.fill();
        this.label(ctx, tag, px + 13 * s, py + 9 * s, 9, '#1a1028', 'center', '800', 26 * s);
      }
      if (m.heldItem) {
        // The held item as a small icon on the portrait's corner.
        this.icons.draw(ctx, m.heldItem, px + ps - 7 * s, py + ps - 7 * s, 18 * s);
      }
      this.portraitRects.push({ x, y: y0, w: cardW, h: cardH });
      // Hovering a card (with more than one in the party): a red X in its corner releases it,
      // after a second click on the "Release?" it turns into.
      const armed = this.releaseArmed === i;
      if ((hover || armed) && p.party.length > 1 && !p.duelId) {
        const xs = 14 * s;
        const label = armed ? 'Release?' : '';
        ctx.font = this.font(9, '800');
        const bw = armed ? ctx.measureText(label).width + 12 * s : xs;
        const xx = x + cardW - bw + 3 * s;
        const xy = y0 - 3 * s;
        const over = hit(st.mouseX, st.mouseY, xx, xy, bw, xs);
        ctx.fillStyle = over || armed ? '#ff5a6e' : 'rgba(150,40,60,0.95)';
        ctx.fillRect(Math.round(xx), Math.round(xy), Math.round(bw), Math.round(xs));
        if (armed) this.label(ctx, label, xx + bw / 2, xy + xs - 4 * s, 9, '#ffffff', 'center', '800');
        else {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = Math.max(1.5, 2 * s);
          ctx.beginPath();
          ctx.moveTo(xx + 4 * s, xy + 4 * s);
          ctx.lineTo(xx + xs - 4 * s, xy + xs - 4 * s);
          ctx.moveTo(xx + xs - 4 * s, xy + 4 * s);
          ctx.lineTo(xx + 4 * s, xy + xs - 4 * s);
          ctx.stroke();
        }
        this.releaseRects.push({ x: xx, y: xy, w: bw, h: xs, index: i });
      }
    });
  }

  private drawMoves(ctx: CanvasRenderingContext2D, match: Match, st: HudState, s: number): void {
    const v = this.view;
    const m = match.actingMon;
    this.moveRects = [];
    if (!m) return;
    const cx = v.width - 128 * s;
    const cy = v.height - 118 * s;
    // Two move buttons side by side (left and right mouse button), on a dark pill.
    const R = 40 * s;
    const r = 34 * s;
    const offsets = [
      [-R, 0],
      [R, 0],
    ];
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(cx - R - r - 8 * s, cy - r - 8 * s, 2 * (R + r + 8 * s), 2 * (r + 8 * s), r + 8 * s);
    ctx.fillStyle = 'rgba(12,12,22,0.55)';
    ctx.fill();
    ctx.restore();
    // Auto-battle state above the wheel.
    const autoText = match.auto ? 'AUTO ON · R' : 'AUTO OFF · R';
    ctx.font = this.font(10, '800');
    const aw = ctx.measureText(autoText).width + 16 * s;
    const ay = cy - r - 34 * s;
    ctx.fillStyle = match.auto ? 'rgba(70,160,110,0.9)' : 'rgba(60,50,90,0.85)';
    ctx.beginPath();
    ctx.roundRect(cx - aw / 2, ay, aw, 18 * s, 9 * s);
    ctx.fill();
    this.label(ctx, autoText, cx, ay + 13 * s, 10, '#ffffff', 'center', '800');
    // Dodge readiness: the pill fills back up over the cooldown.
    const dcd = m.dodgeCd ?? 0;
    const dText = dcd > 0 ? `DODGE ${dcd.toFixed(1)}` : 'DODGE · SPACE';
    ctx.font = this.font(10, '800');
    const dw = Math.max(aw, ctx.measureText(dText).width + 16 * s);
    const dy = ay - 22 * s;
    ctx.fillStyle = 'rgba(30,24,52,0.85)';
    ctx.beginPath();
    ctx.roundRect(cx - dw / 2, dy, dw, 18 * s, 9 * s);
    ctx.fill();
    const fill = 1 - Math.min(1, dcd / 3);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(cx - dw / 2, dy, dw, 18 * s, 9 * s);
    ctx.clip();
    ctx.fillStyle = dcd > 0 ? 'rgba(120,100,200,0.7)' : 'rgba(110,90,220,0.95)';
    ctx.fillRect(cx - dw / 2, dy, dw * fill, 18 * s);
    ctx.restore();
    this.label(ctx, dText, cx, dy + 13 * s, 10, '#ffffff', 'center', '800');
    // Which mode: steering a Pokémon, or the trainer (click a Pokémon to steer it).
    if (!match.playerDuel) {
      const modeText = match.controlled ? `STEERING ${m.name.toUpperCase()} · ESC` : 'TRAINER · CLICK A POKÉMON';
      ctx.font = this.font(10, '800');
      const mw = ctx.measureText(modeText).width + 16 * s;
      const my = dy - 22 * s;
      ctx.fillStyle = match.controlled ? 'rgba(40,130,170,0.92)' : 'rgba(30,24,52,0.85)';
      ctx.beginPath();
      ctx.roundRect(Math.min(cx - mw / 2, v.width - mw - 8 * s), my, mw, 18 * s, 9 * s);
      ctx.fill();
      this.label(ctx, modeText, Math.min(cx, v.width - mw / 2 - 8 * s), my + 13 * s, 10, '#ffffff', 'center', '800');
    }
    m.moves.forEach((id, i) => {
      const def = move(id);
      const [ox, oy] = offsets[i] as [number, number];
      const x = cx + ox;
      const y = cy + oy;
      const cd = m.cooldowns[i] ?? 0;
      const ready = cd <= 0 && !incapable(m);
      const hover = Math.hypot(st.mouseX - x, st.mouseY - y) < r;
      const color = typeColor(def.type);
      // A wood ring frame (Kenney pixel kit) round a type-coloured face.
      if (this.ui.circle(ctx, x, y, r + 3 * s, ready && hover ? 'parchment' : 'wood')) {
        const ri = r * 0.78;
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, ri, 0, Math.PI * 2);
        const gi = ctx.createRadialGradient(x - ri * 0.3, y - ri * 0.4, ri * 0.1, x, y, ri);
        gi.addColorStop(0, ready ? lighten(color, 0.3) : darken(color, 0.5));
        gi.addColorStop(1, ready ? darken(color, 0.12) : darken(color, 0.7));
        ctx.fillStyle = gi;
        ctx.fill();
        if (!ready && cd > 0) {
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.arc(x, y, ri, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (cd / def.cooldown));
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        this.label(ctx, MOVE_KEYS[i] ?? String(i + 1), x, y - 4 * s, 12, '#ffffff', 'center', '800', r * 1.4);
        this.label(ctx, def.name, x, y + 11 * s, 8.5, ready ? '#ffffff' : '#bbb', 'center', '600', ri * 2 - 6 * s);
        if (!ready && cd > 0) this.label(ctx, cd.toFixed(1), x, y + 22 * s, 8, '#ffe9a8', 'center', '600');
        this.moveRects.push({ x: x - r, y: y - r, w: r * 2, h: r * 2 });
        return;
      }
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
      this.label(ctx, MOVE_KEYS[i] ?? String(i + 1), x, y - 4 * s, 12, '#ffffff', 'center', '800', r * 1.4);
      this.label(ctx, def.name, x, y + 11 * s, 8.5, ready ? '#ffffff' : '#bbb', 'center', '600', r * 2 - 8 * s);
      if (!ready && cd > 0) this.label(ctx, cd.toFixed(1), x, y + 22 * s, 8, '#ffe9a8', 'center', '600');
      this.moveRects.push({ x: x - r, y: y - r, w: r * 2, h: r * 2 });
    });
    // Slots not learned yet: faint and empty until a level-up fills them.
    for (let i = m.moves.length; i < MOVE_SLOTS; i++) {
      const [ox, oy] = offsets[i] as [number, number];
      if (this.ui.circle(ctx, cx + ox, cy + oy, r + 3 * s, 'slate')) {
        this.label(ctx, '—', cx + ox, cy + oy + 5 * s, 14, 'rgba(255,255,255,0.45)', 'center', '600');
        continue;
      }
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(30,26,44,0.6)';
      ctx.fill();
      ctx.setLineDash([4 * s, 4 * s]);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1.5 * s;
      ctx.stroke();
      ctx.restore();
      this.label(ctx, '—', cx + ox, cy + oy + 5 * s, 14, 'rgba(255,255,255,0.35)', 'center', '600');
    }
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
    this.discardRects = [];
    let hovered: { def: (typeof ITEMS)[string]; x: number } | null = null;
    this.panel(ctx, x0 - 8 * s, y0 - 8 * s, w + 16 * s, slot + 16 * s, 12, 'rgba(12,12,22,0.25)');
    // Tabs above the slots.
    const tabW = 64 * s;
    ['Bag', 'Held & TMs'].forEach((name, i) => {
      const tx = x0 - 8 * s + i * (tabW + 4 * s);
      const ty = y0 - 8 * s - 18 * s;
      const active = (i === 1) === st.gearTab;
      if (!this.ui.tab(ctx, tx, ty - 3 * s, tabW, 20 * s, Math.max(1, Math.round(this.px / 3)), active)) {
        ctx.fillStyle = active ? 'rgba(120,90,220,0.9)' : 'rgba(30,24,50,0.8)';
        ctx.fillRect(Math.round(tx), Math.round(ty), tabW, 16 * s);
      }
      this.label(ctx, name, tx + tabW / 2, ty + 11 * s, 9, active ? '#1a1030' : '#e8eef6', 'center', '800', tabW - 10 * s);
      this.tabRects.push({ x: tx, y: ty, w: tabW, h: 16 * s });
    });
    this.label(ctx, 'G', x0 + w + 8 * s - 4 * s, y0 - 8 * s - 6 * s, 8, '#9f97bb', 'right', '600');
    items.forEach((entry, i) => {
      const id = entry?.id ?? null;
      const x = x0 + i * (slot + gap);
      const hover = hit(st.mouseX, st.mouseY, x, y0, slot, slot);
      const selected = st.selectedItem === i;
      // Parchment slots in wood frames (Kenney pixel kit); rivets mark the armed item.
      const kit = this.ui.slot(ctx, x, y0, slot, Math.max(1, Math.round(this.px / 3)), selected);
      if (!kit) {
        ctx.beginPath();
        ctx.roundRect(x, y0, slot, slot, 8);
        ctx.fillStyle = selected ? 'rgba(120,90,220,0.6)' : 'rgba(255,255,255,0.06)';
        ctx.fill();
      }
      if (hover) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x + 4 * s, y0 + 4 * s, slot - 8 * s, slot - 8 * s);
      }
      this.label(ctx, String(i + 1), x + 6 * s, y0 + 13 * s, 9, kit ? '#9f97bb' : '#b9b4cc', 'left', '600');
      if (id) {
        const def = ITEMS[id];
        if (def) {
          // The icon sits in the middle of the slot with room round it; balls (18 px art) and bag icons (32 px) both fit 24 px.
          this.icons.draw(ctx, def.id, x + slot / 2, y0 + slot / 2 + 1 * s, 26 * s, def.tmType);
          const count = entry?.count ?? 1;
          if (count > 1) {
            // Quantity badge in the bottom-right corner: white on dark, always readable.
            const t = `×${count}`;
            ctx.font = this.font(9, '800');
            const bw = ctx.measureText(t).width + 8 * s;
            const bh = 13 * s;
            const bx = x + slot - bw - 2 * s;
            const by = y0 + slot - bh - 2 * s;
            ctx.fillStyle = 'rgba(30,18,10,0.85)';
            ctx.beginPath();
            ctx.roundRect(bx, by, bw, bh, 4 * s);
            ctx.fill();
            this.label(ctx, t, bx + bw / 2, by + bh - 3 * s, 9, '#ffffff', 'center', '800');
          }
          if (hover) {
            hovered = { def, x: x + slot / 2 };
            // A small X in the top-right corner throws the item away.
            const xs = 14 * s;
            const xx = x + slot - xs + 3 * s;
            const xy = y0 - 3 * s;
            const over = hit(st.mouseX, st.mouseY, xx, xy, xs, xs);
            ctx.fillStyle = over ? '#ff5a6e' : 'rgba(150,40,60,0.95)';
            ctx.fillRect(Math.round(xx), Math.round(xy), Math.round(xs), Math.round(xs));
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(1.5, 2 * s);
            ctx.beginPath();
            ctx.moveTo(xx + 4 * s, xy + 4 * s);
            ctx.lineTo(xx + xs - 4 * s, xy + xs - 4 * s);
            ctx.moveTo(xx + xs - 4 * s, xy + 4 * s);
            ctx.lineTo(xx + 4 * s, xy + xs - 4 * s);
            ctx.stroke();
            this.discardRects.push({ x: xx, y: xy, w: xs, h: xs, index: i });
          }
        }
      }
      this.itemRects.push({ x, y: y0, w: slot, h: slot });
    });
    // The hovered item's name above the bag.
    if (hovered) {
      const h = hovered as { def: (typeof ITEMS)[string]; x: number };
      const name = h.def.kind === 'tm' ? h.def.name : h.def.name;
      ctx.font = this.font(11, '700');
      const tw = ctx.measureText(name).width + 18 * s;
      const tx = Math.max(8 * s, h.x - tw / 2);
      const ty = y0 - 8 * s - 18 * s - 30 * s;
      this.panel(ctx, tx, ty, tw, 24 * s, 10, 'rgba(12,12,22,0.55)');
      this.label(ctx, name, tx + tw / 2, ty + 16 * s, 11, '#ffffff', 'center', '700');
    }
  }
}
