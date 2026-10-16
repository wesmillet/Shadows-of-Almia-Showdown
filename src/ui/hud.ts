/**
 * In-match HUD on the overlay canvas: trainers-remaining counter (top left),
 * minimap with the darkness (top right), party strip with portraits and HP
 * (bottom), move wheel (bottom right) and the item bar (bottom centre).
 */
import { canMega } from '../sim/mega';
import { DIR_VECTORS, clamp } from '../core/math';
import type { View } from '../render/view';
import { incapable, lead } from '../sim/entities';
import { BEHAVIOR_LABEL, isRoaming, xpToNext } from '../sim/party';
import { CONFIG, MOVE_SLOTS, SPECIES, move, typeColor, type MoveDef } from '../sim/data';
import type { Match } from '../sim/match';
import { ITEMS, type BallKind } from '../sim/items';
import type { InventorySlot } from '../sim/entities';
import { darken, fitSize, hit, lighten, rgba, uiFont } from './screens';
import type { ItemIcons } from '../sprites/itemIcons';
import type { PixelUi } from './pixelUi';

/** ?debug in the address shows the map and lighting stamp in the corner. */
const DEBUG_STAMP = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

export type HudHit = { kind: 'portrait'; index: number } | { kind: 'move'; index: number } | { kind: 'item'; index: number } | { kind: 'behavior'; index: number } | { kind: 'tab'; index: number } | { kind: 'discard'; index: number } | { kind: 'release'; index: number } | { kind: 'chest'; index: number };

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
  /** Messages to show, oldest first (stacked down from the top). */
  notices: string[];
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
  shop: { name: string; entries: Array<{ name: string; price: number; affordable: boolean }>; sellPrice: (id: string) => number } | null;
  /** The open storage chest: its slots (shared by every town's chest) and the town it stands in. */
  chest?: { slots: Array<InventorySlot | null>; town: string } | null;
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

/** The button that casts each move slot (Q and E work too). */
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
  private chestRects: Rect[] = [];
  /** The party slot whose release X was clicked once (it turns into a confirm). */
  releaseArmed = -1;
  private minimap: HTMLCanvasElement | null = null;

  constructor(private readonly view: View, private readonly icons: ItemIcons, private readonly ui: PixelUi) {}

  /** Integer pixel scale for ui/ art on the HUD canvas. */
  private get px(): number {
    return Math.max(2, Math.round(this.view.baseScale * 3));
  }

  /** The storage chest: two rows of slots; bag slots below deposit, chest slots withdraw. */
  private drawChestPanel(ctx: CanvasRenderingContext2D, st: HudState, chest: { slots: Array<InventorySlot | null>; town: string }): void {
    const v = this.view;
    const s = v.baseScale;
    const cols = 6;
    const rows = Math.ceil(chest.slots.length / cols);
    const slot = 44 * s;
    const gap = 6 * s;
    const gridW = cols * slot + (cols - 1) * gap;
    const w = Math.max(gridW + 48 * s, 380 * s);
    const h = (96 + 26) * s + rows * slot + (rows - 1) * gap;
    const x = v.width / 2 - w / 2;
    // Below the trainer, so the open chest stays in view.
    const y = Math.min(v.height / 2 + 56 * s, v.height - h - 12 * s);
    this.popupBox(ctx, x, y, w, h);
    this.label(ctx, `Storage Chest${chest.town ? ` · ${chest.town}` : ''}`, x + w / 2, y + 28 * s, 15, '#ffd36b', 'center', '800', w - 28 * s);
    this.label(ctx, 'Click a bag slot (or 1-6) to store it · click a chest slot (or Shift+1-9) to take it', x + w / 2, y + 46 * s, 9.5, '#cfc6ea', 'center', '600', w - 28 * s);
    this.label(ctx, "Every town's chest holds the same things, and they're safe if you're wiped out · E to close", x + w / 2, y + 62 * s, 9.5, '#9ff3c8', 'center', '600', w - 28 * s);
    const gx = x + (w - gridW) / 2;
    const gy = y + 80 * s;
    let hovered: string | null = null;
    chest.slots.forEach((entry, i) => {
      const sx = gx + (i % cols) * (slot + gap);
      const sy = gy + Math.floor(i / cols) * (slot + gap);
      const hover = hit(st.mouseX, st.mouseY, sx, sy, slot, slot);
      const kit = this.ui.slot(ctx, sx, sy, slot, Math.max(1, Math.round(this.px / 3)), false);
      if (!kit) {
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(sx, sy, slot, slot);
      }
      if (hover) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(sx + 4 * s, sy + 4 * s, slot - 8 * s, slot - 8 * s);
      }
      if (i < 9) this.label(ctx, String(i + 1), sx + 6 * s, sy + 13 * s, 9, kit ? '#9f97bb' : '#b9b4cc', 'left', '600');
      const def = entry ? ITEMS[entry.id] : undefined;
      if (entry && def) {
        this.icons.draw(ctx, def.id, sx + slot / 2, sy + slot / 2, 34 * s, def.tmType);
        if (entry.count > 1) this.countBadge(ctx, entry.count, sx, sy, slot);
        if (hover) hovered = `${def.name}${entry.count > 1 ? ` x${entry.count}` : ''}`;
      }
      this.chestRects.push({ x: sx, y: sy, w: slot, h: slot });
    });
    const used = chest.slots.filter(Boolean).length;
    this.label(ctx, hovered ?? `${used}/${chest.slots.length} slots used`, x + w / 2, y + h - 14 * s, 11, hovered ? '#f4f1ff' : '#9f97bb', 'center', '700', w - 28 * s);
  }

  /** "×3" in a slot's bottom-right corner, white on dark. */
  private countBadge(ctx: CanvasRenderingContext2D, count: number, x: number, y: number, slot: number): void {
    const s = this.view.baseScale;
    const t = `×${count}`;
    ctx.font = this.font(9, '800');
    const bw = ctx.measureText(t).width + 8 * s;
    const bh = 13 * s;
    const bx = x + slot - bw - 2 * s;
    const by = y + slot - bh - 2 * s;
    ctx.fillStyle = 'rgba(30,18,10,0.85)';
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 4 * s);
    ctx.fill();
    this.label(ctx, t, bx + bw / 2, by + bh - 3 * s, 9, '#ffffff', 'center', '800');
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
    for (let i = 0; i < this.chestRects.length; i++) {
      const r = this.chestRects[i] as Rect;
      if (hit(x, y, r.x, r.y, r.w, r.h)) return { kind: 'chest', index: i };
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
    st.notices.forEach((msg, i) => {
      // Older messages above, a touch smaller and dimmer, so the newest reads first.
      const newest = i === st.notices.length - 1;
      const size = newest ? 18 : 15;
      ctx.save();
      ctx.font = this.font(size, '700');
      const w = ctx.measureText(msg).width + 40 * s;
      const y = (86 + i * 40) * s;
      ctx.globalAlpha = newest ? 1 : 0.85;
      this.popupBox(ctx, v.width / 2 - w / 2, y, w, (newest ? 40 : 34) * s);
      this.label(ctx, msg, v.width / 2, y + (newest ? 27 : 23) * s, size, '#f4f1ff', 'center', '700');
      ctx.restore();
    });
    if (st.popup) {
      const names = st.popup.items.map((it) => `${ITEMS[it.id]?.name ?? it.id}${it.count > 1 ? ` ×${it.count}` : ''}`);
      const title = `Found ${names.join(', ')}!`;
      ctx.font = this.font(15, '800');
      let w = Math.max(300 * s, ctx.measureText(title).width + 110 * s);
      const h = 54 * s;
      let x = v.width / 2 - w / 2;
      const y = (140 + Math.max(0, st.notices.length - 1) * 40) * s;
      const first = st.popup.items[0];
      const def = first ? ITEMS[first.id] : undefined;
      // One icon per kind of item found (not the ball it came in, and no repeats).
      const ids = [...new Set(st.popup.items.map((it) => it.id))].slice(0, 4);
      const iconW = 36 * s;
      const pad = 18 * s + ids.length * iconW;
      w = Math.max(w, pad + ctx.measureText(title).width + 24 * s);
      x = v.width / 2 - w / 2;
      this.popupBox(ctx, x, y, w, h);
      ids.forEach((id, i) => this.icons.draw(ctx, id, x + 28 * s + i * iconW, y + h / 2, 32 * s, ITEMS[id]?.tmType));
      const tx = x + pad;
      this.label(ctx, title, tx, y + 24 * s, 15, '#f4f1ff', 'left', '800');
      const hint = st.popup.healed ? 'Your party is fully healed'
        : def?.kind === 'tm' ? `Teaches ${def.name.replace('TM ', '')} · Held & TMs tab`
        : def?.effect === 'mega' ? `Mega Stone · give it to ${def.megaFor ? (SPECIES.get(def.megaFor)?.name ?? 'its Pokémon') : 'its Pokémon'}, then press M`
        : def?.kind === 'hold' ? 'Held item · Held & TMs tab'
        : def?.kind === 'ball' ? (def.desc ?? 'Hold F to throw')
        : def?.kind === 'shard' ? (def.desc ?? '')
        : def?.kind === 'styler' ? `${def.desc ?? ''} · Shift+number`
        : 'Shift+number to use';
      this.label(ctx, hint, tx, y + 42 * s, 11, '#cfc6ea', 'left', '600', w - (tx - x) - 14 * s);
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
      const h = (92 + st.shop.entries.length * 20) * s;
      const x = v.width / 2 - w / 2;
      const y = v.height / 2 - h / 2;
      this.popupBox(ctx, x, y, w, h);
      this.label(ctx, st.shop.name, x + w / 2, y + 28 * s, 15, '#f4f1ff', 'center', '800', w - 28 * s);
      this.label(ctx, `You have ₽${st.money.toLocaleString()} · 1-9 to buy · E or Esc to leave`, x + w / 2, y + 46 * s, 10, '#cfc6ea', 'center', '600', w - 28 * s);
      this.label(ctx, 'Sell: click a bag slot or Shift+1-6 (half price)', x + w / 2, y + 62 * s, 10, '#9ff3c8', 'center', '600', w - 28 * s);
      st.shop.entries.forEach((e, i) => {
        const yy = y + 88 * s + i * 20 * s;
        const col = e.affordable ? '#f4f1ff' : '#6f6888';
        this.label(ctx, `${i + 1}  ${e.name}`, x + 30 * s, yy, 12, col, 'left', '700', w - 130 * s);
        this.label(ctx, `₽${e.price.toLocaleString()}`, x + w - 30 * s, yy, 12, col, 'right', '700');
      });
    }
    this.chestRects = [];
    if (st.chest) this.drawChestPanel(ctx, st, st.chest);
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

  /** The island's painted picture (maps/<name>_minimap.png), set by the match screen once loaded. */
  mapPicture: CanvasImageSource | null = null;
  /** The minimap background baked at its on-screen size: picture, coast glow and vignette. */
  private minimapBaked: { canvas: HTMLCanvasElement; w: number; h: number; pic: boolean } | null = null;

  private bakeMinimap(match: Match, w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    if (this.mapPicture) g.drawImage(this.mapPicture, 0, 0, c.width, c.height);
    else {
      if (!this.minimap) this.minimap = this.buildMinimap(match);
      g.drawImage(this.minimap, 0, 0, c.width, c.height);
    }
    // A touch more colour and a soft vignette, like an old explorer's chart.
    g.globalCompositeOperation = 'soft-light';
    g.fillStyle = 'rgba(255,236,200,0.35)';
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
    const vg = g.createRadialGradient(c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.35, c.width / 2, c.height / 2, Math.max(c.width, c.height) * 0.72);
    vg.addColorStop(0, 'rgba(10,20,50,0)');
    vg.addColorStop(1, 'rgba(10,20,50,0.45)');
    g.fillStyle = vg;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  private drawMinimap(ctx: CanvasRenderingContext2D, match: Match, st: HudState, s: number): void {
    const v = this.view;
    // The island keeps its shape: one scale for both axes, so every marker lands where it is.
    const g = match.ground;
    const size = 208 * s;
    const k = size / Math.max(g.cols, g.rows);
    const mw = Math.round(g.cols * k);
    const mh = Math.round(g.rows * k);
    // The frame snaps to whole UI pixels; the chart is centred inside it so the border is even.
    const u = this.px;
    const fw = Math.round((mw + 12 * s) / u) * u;
    const fh = Math.round((mh + 12 * s) / u) * u;
    const fx = Math.round((v.width - fw - 12 * s) / u) * u;
    const fy = Math.round((12 * s) / u) * u;
    const x = Math.round(fx + (fw - mw) / 2);
    const y = Math.round(fy + (fh - mh) / 2);
    const now = performance.now() / 1000;
    if (!this.minimapBaked || this.minimapBaked.w !== mw || this.minimapBaked.h !== mh || this.minimapBaked.pic !== !!this.mapPicture) {
      this.minimapBaked = { canvas: this.bakeMinimap(match, mw, mh), w: mw, h: mh, pic: !!this.mapPicture };
    }
    this.panel(ctx, fx, fy, fw, fh, 12, 'rgba(12,12,22,0.55)');
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, mw, mh, 6 * s);
    ctx.clip();
    ctx.drawImage(this.minimapBaked.canvas, x, y, mw, mh);
    const X = (wx: number) => x + wx * k;
    const Y = (wy: number) => y + wy * k;
    const cx = X(match.centerX);
    const cy = Y(match.centerY);
    // The darkness: violet night outside the safe circle, a soft edge, and a glowing rim.
    if (Number.isFinite(st.darkRadius)) {
      const r = st.darkRadius * k;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, mw, mh);
      ctx.arc(cx, cy, Math.max(0, r), 0, Math.PI * 2, true);
      ctx.fillStyle = 'rgba(22,6,40,0.72)';
      ctx.fill('evenodd');
      const edge = ctx.createRadialGradient(cx, cy, Math.max(0, r - 7 * s), cx, cy, r);
      edge.addColorStop(0, 'rgba(60,20,100,0)');
      edge.addColorStop(1, 'rgba(60,20,100,0.35)');
      ctx.fillStyle = edge;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0, r), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = 'rgba(200,140,255,0.9)';
      ctx.shadowBlur = 6 * s;
      ctx.strokeStyle = `rgba(214,170,255,${0.75 + 0.2 * Math.sin(now * 2.4)})`;
      ctx.lineWidth = 1.6 * s;
      ctx.setLineDash([5 * s, 3 * s]);
      ctx.lineDashOffset = -now * 6 * s;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0, r), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // The Shadow Crystal: a little glowing gem.
    {
      const hgt = 7 * s;
      const wid = 4.5 * s;
      ctx.save();
      ctx.shadowColor = 'rgba(190,120,255,0.95)';
      ctx.shadowBlur = (6 + 3 * Math.sin(now * 2)) * s;
      const gr = ctx.createLinearGradient(cx - wid, cy - hgt, cx + wid, cy + hgt);
      gr.addColorStop(0, '#f2dcff');
      gr.addColorStop(0.5, '#b072ff');
      gr.addColorStop(1, '#5a2aa8');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(cx, cy - hgt);
      ctx.lineTo(cx + wid, cy - hgt * 0.15);
      ctx.lineTo(cx, cy + hgt);
      ctx.lineTo(cx - wid, cy - hgt * 0.15);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(40,10,70,0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    // Healers: a white badge with a green cross.
    for (const o of match.outposts) {
      const ox = X(o.x);
      const oy = Y(o.y);
      const r = 4 * s;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.arc(ox, oy + 1 * s, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2fbf86';
      ctx.fillRect(ox - 0.9 * s, oy - 2.6 * s, 1.8 * s, 5.2 * s);
      ctx.fillRect(ox - 2.6 * s, oy - 0.9 * s, 5.2 * s, 1.8 * s);
    }
    /** A round marker with a dark rim and a light highlight. */
    const pin = (wx: number, wy: number, color: string, r = 3) => {
      const px = X(wx);
      const py = Y(wy);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.arc(px, py + 1 * s, (r + 1.2) * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(20,14,30,0.95)';
      ctx.beginPath();
      ctx.arc(px, py, (r + 1) * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, r * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(px - r * 0.35 * s, py - r * 0.35 * s, r * 0.4 * s, 0, Math.PI * 2);
      ctx.fill();
    };
    // Roaming party members and the ping.
    for (const m of match.player.party) {
      if (m.fainted || !isRoaming(m)) continue;
      pin(m.x, m.y, '#ffd36b', 2.6);
    }
    if (this.ping && this.ping.t > 0) {
      const pm = this.ping.mon;
      const ph = (this.ping.t * 3) % 1;
      ctx.strokeStyle = `rgba(255,220,120,${0.9 - ph * 0.8})`;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.arc(X(pm.x), Y(pm.y), (4 + ph * 10) * s, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Visitors: the merchant (gold), Celeste (pink), Hoopa (violet), and any legendary loose (gold ring).
    for (const n of match.npcs) {
      if (n.role === 'merchant') pin(n.x, n.y, '#ffe27a', 2.6);
      else if (n.role === 'ace') pin(n.x, n.y, '#ff9ad5', 2.6);
    }
    for (const w of match.wilds) {
      if (w.npc === 'hoopa') pin(w.x, w.y, '#c78bff', 3);
      else if (w.legend) {
        ctx.save();
        ctx.shadowColor = 'rgba(255,210,80,0.9)';
        ctx.shadowBlur = 6 * s;
        ctx.strokeStyle = '#ffcf4a';
        ctx.lineWidth = 2 * s;
        ctx.beginPath();
        ctx.arc(X(w.x), Y(w.y), (4 + Math.sin(now * 4)) * s, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    for (const t of match.trainers) {
      if (!t.alive || t.visitor) continue;
      pin(t.x, t.y, '#ff5c5c', 3);
    }
    if (match.darkrai && !match.darkrai.fainted) pin(match.darkrai.x, match.darkrai.y, '#2a1838', 3.4);
    // You: a white arrow the way you face, with a soft pulse round it.
    {
      const p = match.player;
      const px = X(p.x);
      const py = Y(p.y);
      const ph = (now * 0.8) % 1;
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - ph)})`;
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath();
      ctx.arc(px, py, (4 + ph * 9) * s, 0, Math.PI * 2);
      ctx.stroke();
      const f = DIR_VECTORS[p.dir] ?? { x: 0, y: 1 };
      const a = Math.atan2(f.y, f.x);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(6 * s, 0);
      ctx.lineTo(-4 * s, 4.2 * s);
      ctx.lineTo(-1.8 * s, 0);
      ctx.lineTo(-4 * s, -4.2 * s);
      ctx.closePath();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 3 * s;
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#1a1424';
      ctx.lineWidth = 1.2 * s;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    }
    // Inner shadow round the edge, so the chart sits inside its frame.
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.roundRect(x, y, mw, mh, 6 * s);
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
      ctx.fillStyle = roaming ? (chipHover ? 'rgba(255,170,90,0.9)' : 'rgba(230,140,60,0.8)')
        : m.behavior === 'catch' ? (chipHover ? 'rgba(245,100,100,0.95)' : 'rgba(205,55,65,0.85)')
        : chipHover ? 'rgba(170,150,255,0.9)' : 'rgba(110,90,200,0.75)';
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
    const autoText = match.playerDuel ? 'AUTO OFF IN BATTLES' : match.auto ? 'AUTO ON · R' : 'AUTO OFF · R';
    ctx.font = this.font(10, '800');
    const aw = ctx.measureText(autoText).width + 16 * s;
    const ay = cy - r - 34 * s;
    ctx.fillStyle = match.auto && !match.playerDuel ? 'rgba(70,160,110,0.9)' : 'rgba(60,50,90,0.85)';
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
    // Mega Evolution ready: a glowing pill above the others.
    if (canMega(match.player, m)) {
      const megaText = 'MEGA EVOLVE · M';
      ctx.font = this.font(10, '800');
      const gw = ctx.measureText(megaText).width + 18 * s;
      const gy = dy - (match.playerDuel ? 22 : 44) * s;
      const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 220);
      ctx.save();
      ctx.shadowColor = 'rgba(255,140,255,0.9)';
      ctx.shadowBlur = 10 * s * pulse;
      const g = ctx.createLinearGradient(cx - gw / 2, 0, cx + gw / 2, 0);
      g.addColorStop(0, '#ff6fd8');
      g.addColorStop(0.5, '#9b6bff');
      g.addColorStop(1, '#4fc3ff');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(Math.min(cx - gw / 2, v.width - gw - 8 * s), gy, gw, 18 * s, 9 * s);
      ctx.fill();
      ctx.restore();
      this.label(ctx, megaText, Math.min(cx, v.width - gw / 2 - 8 * s), gy + 13 * s, 10, '#ffffff', 'center', '800');
    }
    let hoveredMove: MoveDef | null = null;
    m.moves.forEach((id, i) => {
      const def = move(id);
      const [ox, oy] = offsets[i] as [number, number];
      const x = cx + ox;
      const y = cy + oy;
      const cd = m.cooldowns[i] ?? 0;
      const ready = cd <= 0 && !incapable(m);
      const hover = Math.hypot(st.mouseX - x, st.mouseY - y) < r;
      if (hover) hoveredMove = def;
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
    if (hoveredMove) this.drawMoveTip(ctx, hoveredMove, cx + R + r + 8 * s, cy - r - 8 * s);
    // Slots not learned yet: faint and empty until a level-up fills them.
    for (let i = m.moves.length; i < MOVE_SLOTS; i++) {
      const [ox, oy] = offsets[i] as [number, number];
      if (this.ui.circle(ctx, cx + ox, cy + oy, r + 3 * s, 'slate')) {
        this.label(ctx, '-', cx + ox, cy + oy + 5 * s, 14, 'rgba(255,255,255,0.45)', 'center', '600');
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
          this.icons.draw(ctx, def.id, x + slot / 2, y0 + slot / 2, 34 * s, def.tmType);
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
      const name = st.shop ? `${h.def.name} · sells for ₽${st.shop.sellPrice(h.def.id).toLocaleString()}` : h.def.name;
      ctx.font = this.font(11, '700');
      const tw = ctx.measureText(name).width + 18 * s;
      const tx = Math.max(8 * s, h.x - tw / 2);
      const ty = y0 - 8 * s - 18 * s - 30 * s;
      this.panel(ctx, tx, ty, tw, 24 * s, 10, 'rgba(12,12,22,0.55)');
      this.label(ctx, name, tx + tw / 2, ty + 16 * s, 11, '#ffffff', 'center', '700');
    }
  }

  /** A move's tooltip, right-aligned to `right` and sitting on `bottom`: what it is and what it does. */
  private drawMoveTip(ctx: CanvasRenderingContext2D, def: MoveDef, right: number, bottom: number): void {
    const s = this.view.baseScale;
    const lines = describeMove(def);
    const head = def.name;
    const sub = `${def.type[0]?.toUpperCase()}${def.type.slice(1)} · ${def.category === 'status' ? 'Status' : def.category === 'physical' ? 'Physical' : 'Special'}`;
    ctx.font = this.font(14, '800');
    let w = ctx.measureText(head).width;
    ctx.font = this.font(10, '700');
    w = Math.max(w, ctx.measureText(sub).width);
    ctx.font = this.font(10, '600');
    for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
    w += 28 * s;
    const h = (44 + lines.length * 15 + 8) * s;
    const x = Math.max(8 * s, right - w);
    const y = bottom - h;
    this.popupBox(ctx, x, y, w, h);
    const col = typeColor(def.type);
    ctx.fillStyle = col;
    ctx.fillRect(x + 8 * s, y + 10 * s, 4 * s, 30 * s);
    this.label(ctx, head, x + 18 * s, y + 24 * s, 14, '#f4f1ff', 'left', '800');
    this.label(ctx, sub, x + 18 * s, y + 38 * s, 10, lighten(col, 0.35), 'left', '700');
    lines.forEach((l, i) => this.label(ctx, l, x + 14 * s, y + (58 + i * 15) * s, 10, '#cfc6ea', 'left', '600'));
  }
}

const STAT_NAME = { atk: 'Attack', def: 'Defense', spe: 'Speed' } as const;
const STATUS_VERB: Record<string, string> = {
  sleep: 'put the target to sleep', burn: 'burn', paralysis: 'paralyze', poison: 'poison', freeze: 'freeze', confusion: 'confuse',
};

/** Plain lines describing a move from its data: numbers, reach, and side effects. */
export function describeMove(def: MoveDef): string[] {
  const out: string[] = [];
  const nums = [def.power > 0 ? `Power ${def.power}` : '', `Cooldown ${def.cooldown}s`, def.cast ? `Charge ${def.cast}s` : ''].filter(Boolean);
  out.push(nums.join(' · '));
  const reach: Record<string, string> = {
    single: 'Hits one target where you aim',
    line: 'Hits everything along a line',
    cone: 'Hits everything in a cone in front',
    ring: 'Hits everything in a ring around the user',
    self: 'Affects the user',
  };
  out.push(reach[def.shape] ?? '');
  if (def.status) out.push(`${Math.round(def.status.chance * 100)}% chance to ${STATUS_VERB[def.status.kind] ?? def.status.kind}`);
  if (def.stages) {
    const parts: string[] = [];
    for (const [who, block] of [['its own', def.stages.self], ["the target's", def.stages.target]] as const) {
      for (const [k, n] of Object.entries(block ?? {}) as Array<[keyof typeof STAT_NAME, number]>) {
        if (!n) continue;
        parts.push(`${n > 0 ? 'Raises' : 'Lowers'} ${who} ${STAT_NAME[k]}${Math.abs(n) > 1 ? ' sharply' : ''}`);
      }
    }
    if (parts.length) out.push(`${parts.join(', ')}${def.stages.chance < 1 ? ` (${Math.round(def.stages.chance * 100)}%)` : ''}`);
  }
  if (def.leap) out.push('The user leaps and slams down on the target');
  if (def.signature) out.push('Signature move');
  return out.filter(Boolean);
}
