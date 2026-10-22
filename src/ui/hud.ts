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
import { CONFIG, MOVE_SLOTS, SPECIES, isContact, move, typeColor, type MoveDef } from '../sim/data';
import type { Match } from '../sim/match';
import { ITEMS, type BallKind } from '../sim/items';
import type { InventorySlot } from '../sim/entities';
import { darken, fitSize, hit, lighten, rgba, uiFont } from './screens';
import type { ItemIcons } from '../sprites/itemIcons';
import { FLAT_INK, type PixelUi } from './pixelUi';

/** A hex colour a little lighter (hover). */
function lightenHex(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.min(255, Math.round(v + (255 - v) * 0.25));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/** ?debug in the address shows the map and lighting stamp in the corner. */
const DEBUG_STAMP = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

export type HudHit = { kind: 'portrait'; index: number } | { kind: 'move'; index: number } | { kind: 'item'; index: number } | { kind: 'behavior'; index: number } | { kind: 'tab'; index: number } | { kind: 'discard'; index: number } | { kind: 'release'; index: number } | { kind: 'chest'; index: number } | { kind: 'snag'; index: number } | { kind: 'held'; index: number } | { kind: 'learn'; index: number };

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
  /**
   * A move one of your Pokémon could learn with both slots full (Match.learnOffer): its name, the
   * new move, its two current moves (a signature move cannot be forgotten) and how many more wait.
   */
  learn: { mon: string; level: number; moveId: string; moves: string[]; queued: number } | null;
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
  /** Party members' storm meters (0..1 toward sleep in the darkness), by party slot. */
  storm?: number[];
  /** A won battle with a Snag Machine in the bag: the beaten trainer and their Pokémon to choose from. */
  snag?: { from: string; names: string[] } | null;
  /** The open storage chest: its slots (shared by every town's chest) and the town it stands in. */
  chest?: { slots: Array<InventorySlot | null>; town: string } | null;
  aiming: number; // 0..1 catch aim power, 0 = not aiming
  lightingMode: string;
  /** Watching (a spectator or a replay): no bag and no control hints, only what is going on. */
  watching?: boolean;
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
  /** The held-item icons on the party cards (a click takes the item back). */
  private heldRects: Array<Rect & { index: number }> = [];
  /** The learn card's buttons: 0 and 1 forget that move, 2 keeps both. */
  private learnRects: Array<Rect & { index: number }> = [];
  private chestRects: Rect[] = [];
  private snagRects: Rect[] = [];
  /** The party slot whose release X was clicked once (it turns into a confirm). */
  releaseArmed = -1;
  private minimap: HTMLCanvasElement | null = null;
  /** How far each bag slot is raised (0..1 of a full lift), eased toward its target every frame. */
  private slotLift: number[] = [];
  private liftClock = 0;

  /** The HUD's panels this frame (banner, minimap, party, bag, moves): labels over Pokémon keep out of them. */
  occupied: Rect[] = [];

  /** Does a box overlap any HUD panel drawn this frame? */
  covers(x: number, y: number, w: number, h: number): boolean {
    return this.occupied.some((r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y);
  }

  constructor(private readonly view: View, private readonly icons: ItemIcons, private readonly ui: PixelUi) {}

  /** Integer pixel scale for ui/ art on the HUD canvas. */
  private get px(): number {
    return Math.max(2, Math.round(this.view.baseScale * 3));
  }

  /** The smaller whole-pixel scale for slim pieces of the flat skin (strips, tabs, small slots). */
  private get px2(): number {
    return Math.max(2, Math.round(this.view.baseScale * 2));
  }

  /** Text on the cream skin: dark ink, no drop shadow; with `maxWidth` it shrinks to fit. */
  private ink(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string = FLAT_INK.text, align: CanvasTextAlign = 'left', maxWidth?: number): void {
    if (maxWidth !== undefined) size = fitSize(this.view, s, size, maxWidth, ctx);
    ctx.font = this.font(size, '700');
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }

  /** A one-line cream strip centred on `cx` with its top at `y`: returns its height. */
  private creamStrip(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, size: number, color: string = FLAT_INK.text, accent?: { text: string; color: string }): number {
    const s = this.view.baseScale;
    const k = this.px2;
    ctx.font = this.font(size, '700');
    const tw = ctx.measureText(text).width;
    const aw = accent ? ctx.measureText(accent.text).width : 0;
    const w = tw + aw + 12 * k + 10 * s;
    const h = Math.round(8 * k + size * 1.25 * s);
    const x = Math.round(cx - w / 2);
    if (!this.ui.flat(ctx, 'cream', x, y, w, h, k)) this.popupBox(ctx, x, y, w, h);
    const base = y + 3 * k + (h - 8 * k) / 2 + size * 0.42 * s;
    this.ink(ctx, text, x + 6 * k + 5 * s, base, size, color);
    if (accent) this.ink(ctx, accent.text, x + 6 * k + 5 * s + tw, base, size, accent.color);
    return h;
  }

  /** The storage chest: two rows of slots; bag slots below deposit, chest slots withdraw. */
  private drawChestPanel(ctx: CanvasRenderingContext2D, st: HudState, chest: { slots: Array<InventorySlot | null>; town: string }): void {
    const v = this.view;
    const s = v.baseScale;
    const cols = 6;
    const rows = Math.ceil(chest.slots.length / cols);
    const gap = 6 * s;
    // Clear of the bag (its slots and tabs take the bottom 120 px) and the top strips: big chests use smaller slots.
    const room = v.height - 130 * s - 64 * s;
    const slot = Math.max(28 * s, Math.min(44 * s, (room - (96 + 26) * s - (rows - 1) * gap) / rows));
    const gridW = cols * slot + (cols - 1) * gap;
    const w = Math.max(gridW + 48 * s, 380 * s);
    const h = (96 + 26) * s + rows * slot + (rows - 1) * gap;
    const x = v.width / 2 - w / 2;
    // Below the trainer when it fits, so the open chest stays in view; never over the bag.
    const y = Math.max(64 * s, Math.min(v.height / 2 + 56 * s, v.height - 130 * s - h));
    this.popupBox(ctx, x, y, w, h);
    this.ink(ctx, `Storage Chest${chest.town ? ` · ${chest.town}` : ''}`, x + w / 2, y + 32 * s, 15, FLAT_INK.accent, 'center', w - 36 * s);
    this.ink(ctx, 'Click a bag slot (or 1-6) to store it · click a chest slot (or Shift+1-9) to take it', x + w / 2, y + 50 * s, 9.5, FLAT_INK.dim, 'center', w - 36 * s);
    this.ink(ctx, "Every town's chest holds the same things, kept between games and safe if you're wiped out · E to close", x + w / 2, y + 65 * s, 9.5, FLAT_INK.good, 'center', w - 36 * s);
    const gx = x + (w - gridW) / 2;
    const gy = y + 80 * s;
    let hovered: string | null = null;
    chest.slots.forEach((entry, i) => {
      const sx = gx + (i % cols) * (slot + gap);
      const sy = gy + Math.floor(i / cols) * (slot + gap);
      const hover = hit(st.mouseX, st.mouseY, sx, sy, slot, slot);
      // Grey wells for full slots, faint ones for empty; the one pointed at rises.
      const up = hover && entry ? this.px2 : 0;
      if (!this.ui.flat(ctx, entry ? 'slotGrey' : 'slotGhost', sx, sy - up, slot, slot, this.px2)) {
        ctx.fillStyle = 'rgba(138,106,74,0.15)';
        ctx.fillRect(sx, sy, slot, slot);
      }
      if (i < 9) this.ink(ctx, String(i + 1), sx + 5 * s, sy + 12 * s - up, 8, FLAT_INK.text);
      const def = entry ? ITEMS[entry.id] : undefined;
      if (entry && def) {
        const up2 = hover ? this.px2 : 0;
        this.icons.draw(ctx, def.id, sx + slot / 2, sy + slot / 2 - up2, (def.kind === 'ball' ? 0.8 : 1) * (slot - 10 * s), def.tmType);
        if (entry.count > 1) this.countBadge(ctx, entry.count, sx + slot, sy + slot - up2);
        if (hover) hovered = `${def.name}${entry.count > 1 ? ` x${entry.count}` : ''}`;
      }
      this.chestRects.push({ x: sx, y: sy, w: slot, h: slot });
    });
    const used = chest.slots.filter(Boolean).length;
    this.ink(ctx, hovered ?? `${used}/${chest.slots.length} slots used`, x + w / 2, y + h - 18 * s, 11, hovered ? FLAT_INK.text : FLAT_INK.dim, 'center', w - 36 * s);
  }

  /**
   * A stack's count: a small dark pixel tag with a cream rim hanging off the slot's bottom-right
   * corner, the number in white (no "×"), so it never sits on the item's art.
   */
  private countBadge(ctx: CanvasRenderingContext2D, count: number, right: number, bottom: number): void {
    const s = this.view.baseScale;
    const u = Math.max(1, Math.round(s));
    const t = String(count);
    ctx.font = this.font(9, '800');
    const tw = Math.ceil(ctx.measureText(t).width);
    const h = Math.round(13 * s);
    const w = Math.max(h, tw + Math.round(8 * s));
    const x = Math.round(right - w * 0.75);
    const y = Math.round(bottom - h * 0.7);
    // Rim, then body, with the corners notched a pixel so it reads as pixel art.
    ctx.fillStyle = '#fff3d6';
    ctx.fillRect(x + u, y, w - 2 * u, h);
    ctx.fillRect(x, y + u, w, h - 2 * u);
    ctx.fillStyle = '#4a3424';
    ctx.fillRect(x + 2 * u, y + u, w - 4 * u, h - 2 * u);
    ctx.fillRect(x + u, y + 2 * u, w - 2 * u, h - 4 * u);
    ctx.fillStyle = '#6b4c34';
    ctx.fillRect(x + 2 * u, y + u, w - 4 * u, u);
    ctx.font = this.font(9, '800');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#1e140c';
    ctx.fillText(t, x + w / 2 + u, y + h - 3 * s + u);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(t, x + w / 2, y + h - 3 * s);
  }

  hitTest(x: number, y: number): HudHit | null {
    for (const d of this.learnRects) if (hit(x, y, d.x, d.y, d.w, d.h)) return { kind: 'learn', index: d.index };
    for (const d of this.discardRects) if (hit(x, y, d.x, d.y, d.w, d.h)) return { kind: 'discard', index: d.index };
    for (const d of this.releaseRects) if (hit(x, y, d.x, d.y, d.w, d.h)) return { kind: 'release', index: d.index };
    for (const d of this.heldRects) if (hit(x, y, d.x, d.y, d.w, d.h)) return { kind: 'held', index: d.index };
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
    for (let i = 0; i < this.snagRects.length; i++) {
      const r = this.snagRects[i] as Rect;
      if (hit(x, y, r.x, r.y, r.w, r.h)) return { kind: 'snag', index: i };
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

  /**
   * Panels: dark blue glass with a soft top light, a thin cool rim and a drop shadow (one look for
   * every HUD panel). `fill` adds a tint over the glass (lead card, hover, fainted).
   */
  private panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 12, fill = ''): void {
    this.glass(ctx, x, y, w, h, Math.min(r, 12) * this.view.baseScale, { tint: fill || undefined });
  }

  /** Popups (shop, chest, prompts, move tips): the skin's cream card; text on it uses FLAT_INK. */
  popupBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    if (this.ui.flat(ctx, 'cream', x, y, w, h, this.px)) return;
    this.glass(ctx, x, y, w, h, 12 * this.view.baseScale, { top: 'rgba(42,52,88,0.96)', bottom: 'rgba(22,28,52,0.96)', rim: 'rgba(170,215,255,0.55)' });
  }

  /** A rounded glass panel. */
  glass(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
    o: { top?: string; bottom?: string; rim?: string; rimWidth?: number; tint?: string; glow?: string } = {}): void {
    const s = this.view.baseScale;
    ctx.save();
    ctx.shadowColor = o.glow ?? 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = (o.glow ? 14 : 10) * s;
    ctx.shadowOffsetY = o.glow ? 0 : 3 * s;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, o.top ?? 'rgba(30,38,66,0.9)');
    g.addColorStop(1, o.bottom ?? 'rgba(14,18,34,0.9)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.clip();
    if (o.tint) {
      ctx.fillStyle = o.tint;
      ctx.fillRect(x, y, w, h);
    }
    // the light catching the top edge
    const sh = ctx.createLinearGradient(0, y, 0, y + Math.min(h, 22 * s));
    sh.addColorStop(0, 'rgba(255,255,255,0.10)');
    sh.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(x, y, w, Math.min(h, 22 * s));
    ctx.restore();
    ctx.strokeStyle = o.rim ?? 'rgba(150,190,255,0.28)';
    ctx.lineWidth = (o.rimWidth ?? 1.5) * s;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, r);
    ctx.stroke();
  }

  /** A rounded bar: dark track, coloured fill with a light stripe along its top. */
  private pillBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, color: string | CanvasGradient): void {
    ctx.save();
    ctx.fillStyle = 'rgba(4,6,14,0.75)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.fill();
    const fw = Math.max(0, Math.min(w, w * frac));
    if (fw > 0) {
      ctx.beginPath();
      ctx.roundRect(x, y, Math.max(h, fw), h, h / 2);
      ctx.clip();
      ctx.fillStyle = color;
      ctx.fillRect(x, y, fw, h);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x, y + 1, fw, Math.max(1, h * 0.3));
    }
    ctx.restore();
  }

  draw(match: Match, st: HudState): void {
    const v = this.view;
    const ctx = v.hud;
    const s = v.baseScale;
    ctx.clearRect(0, 0, v.width, v.height);
    this.occupied = [];
    this.drawCounter(ctx, match, st, s);
    this.drawMinimap(ctx, match, st, s);
    this.drawParty(ctx, match, st, s);
    this.drawMoves(ctx, match, st, s);
    if (!st.watching) this.drawItems(ctx, match, st, s);
    this.drawLearn(ctx, st, s);
    // The darkness strip, top centre (the battle banner takes that spot in a battle), and the
    // messages stacked under it: cream strips, older ones above, smaller and dimmer.
    let ny = (match.playerDuel ? 70 : 12) * s;
    if (!match.playerDuel) ny += this.drawStormStrip(ctx, match, st, s) + 8 * s;
    st.notices.forEach((msg, i) => {
      const newest = i === st.notices.length - 1;
      ctx.save();
      ctx.globalAlpha = newest ? 1 : 0.85;
      ny += this.creamStrip(ctx, msg, v.width / 2, ny, newest ? 15 : 12) + 6 * s;
      ctx.restore();
    });
    if (st.popup) {
      const names = st.popup.items.map((it) => `${ITEMS[it.id]?.name ?? it.id}${it.count > 1 ? ` ×${it.count}` : ''}`);
      const title = `Found ${names.join(', ')}!`;
      ctx.font = this.font(14, '800');
      const ids = [...new Set(st.popup.items.map((it) => it.id))].slice(0, 4);
      const iconW = 36 * s;
      const pad = 22 * s + ids.length * iconW;
      const w = Math.max(300 * s, pad + ctx.measureText(title).width + 30 * s);
      const h = 62 * s;
      const x = v.width / 2 - w / 2;
      const y = (140 + Math.max(0, st.notices.length - 1) * 40) * s;
      const first = st.popup.items[0];
      const def = first ? ITEMS[first.id] : undefined;
      this.popupBox(ctx, x, y, w, h);
      ids.forEach((id, i) => this.icons.draw(ctx, id, x + 30 * s + i * iconW, y + h / 2 - 2 * s, 30 * s, ITEMS[id]?.tmType));
      const tx = x + pad;
      this.ink(ctx, title, tx, y + 28 * s, 14, FLAT_INK.text);
      const hint = st.popup.healed ? 'Your party is fully healed'
        : def?.kind === 'tm' ? `Teaches ${def.name.replace('TM ', '')} · Held & TMs tab`
        : def?.effect === 'mega' ? `Mega Stone · give it to ${def.megaFor ? (SPECIES.get(def.megaFor)?.name ?? 'its Pokémon') : 'its Pokémon'}, then press M`
        : def?.kind === 'hold' ? 'Held item · Held & TMs tab'
        : def?.kind === 'ball' ? (def.desc ?? 'Hold F to throw')
        : def?.kind === 'shard' ? (def.desc ?? '')
        : def?.kind === 'styler' ? `${def.desc ?? ''} · its number key`
        : 'Press its number key to use it';
      this.ink(ctx, hint, tx, y + 44 * s, 10, FLAT_INK.dim, 'left', w - (tx - x) - 16 * s);
    }
    if (st.teach) {
      const w = 360 * s;
      const h = 156 * s;
      const x = v.width / 2 - w / 2;
      const y = v.height / 2 - h / 2;
      this.popupBox(ctx, x, y, w, h);
      this.ink(ctx, st.teach.title ?? `Teach ${st.teach.moveName} to ${st.teach.mon}?`, x + w / 2, y + 32 * s, 14, FLAT_INK.text, 'center', w - 36 * s);
      this.ink(ctx, 'Press 1 or 2 to replace a move, Esc to keep them', x + w / 2, y + 50 * s, 10, FLAT_INK.dim, 'center', w - 36 * s);
      st.teach.moves.forEach((mv, i) => {
        this.ink(ctx, String(i + 1), x + 30 * s, y + 78 * s + i * 20 * s, 12, FLAT_INK.accent);
        this.ink(ctx, mv, x + 48 * s, y + 78 * s + i * 20 * s, 12, FLAT_INK.text, 'left', w - 80 * s);
      });
    }
    if (st.extract) {
      const w = 380 * s;
      const h = (90 + st.extract.names.length * 20) * s;
      const x = v.width / 2 - w / 2;
      const y = v.height / 2 - h / 2;
      this.popupBox(ctx, x, y, w, h);
      this.ink(ctx, 'Extraction Voucher', x + w / 2, y + 32 * s, 15, FLAT_INK.accent, 'center', w - 36 * s);
      this.ink(ctx, 'Press 1-6 (or click a card) to send that Pokémon to your PC, Esc to cancel', x + w / 2, y + 50 * s, 9.5, FLAT_INK.dim, 'center', w - 36 * s);
      st.extract.names.forEach((n, i) => {
        this.ink(ctx, String(i + 1), x + 30 * s, y + 78 * s + i * 20 * s, 12, FLAT_INK.accent);
        this.ink(ctx, n, x + 48 * s, y + 78 * s + i * 20 * s, 12, FLAT_INK.text, 'left', w - 80 * s);
      });
    }
    if (st.shop) {
      const w = 380 * s;
      const h = (100 + st.shop.entries.length * 21) * s;
      const x = v.width / 2 - w / 2;
      const y = v.height / 2 - h / 2;
      this.popupBox(ctx, x, y, w, h);
      this.ink(ctx, st.shop.name, x + w / 2, y + 32 * s, 15, FLAT_INK.text, 'center', w - 36 * s);
      this.ink(ctx, `You have ₽${st.money.toLocaleString()} · 1-9 to buy · E or Esc to leave`, x + w / 2, y + 50 * s, 10, FLAT_INK.dim, 'center', w - 36 * s);
      this.ink(ctx, 'Sell: click a bag slot or Shift+1-6 (half price)', x + w / 2, y + 66 * s, 10, FLAT_INK.good, 'center', w - 36 * s);
      st.shop.entries.forEach((e, i) => {
        const yy = y + 94 * s + i * 21 * s;
        const col = e.affordable ? FLAT_INK.text : '#b8a890';
        if (i % 2 === 0) {
          ctx.fillStyle = 'rgba(138,106,74,0.1)';
          ctx.fillRect(x + 20 * s, yy - 15 * s, w - 40 * s, 21 * s);
        }
        this.ink(ctx, String((i + 1) % 10), x + 30 * s, yy, 12, e.affordable ? FLAT_INK.accent : '#b8a890');
        this.ink(ctx, e.name, x + 48 * s, yy, 12, col, 'left', w - 150 * s);
        this.ink(ctx, `₽${e.price.toLocaleString()}`, x + w - 30 * s, yy, 12, e.affordable ? FLAT_INK.good : '#b8a890', 'right');
      });
    }
    this.chestRects = [];
    if (st.chest) this.drawChestPanel(ctx, st, st.chest);
    this.snagRects = [];
    if (st.snag) {
      const w = 400 * s;
      const h = (100 + st.snag.names.length * 26) * s;
      const x = v.width / 2 - w / 2;
      const y = v.height / 2 - h / 2;
      this.popupBox(ctx, x, y, w, h);
      this.ink(ctx, `Snag Machine · beat ${st.snag.from}`, x + w / 2, y + 32 * s, 15, FLAT_INK.bad, 'center', w - 36 * s);
      this.ink(ctx, 'Take one of their Pokémon: 1-6 or click · Esc keeps the machine', x + w / 2, y + 50 * s, 9.5, FLAT_INK.dim, 'center', w - 36 * s);
      st.snag.names.forEach((n, i) => {
        const ry = y + 64 * s + i * 26 * s;
        const r = { x: x + 22 * s, y: ry, w: w - 44 * s, h: 23 * s };
        const over = hit(st.mouseX, st.mouseY, r.x, r.y, r.w, r.h);
        ctx.fillStyle = over ? 'rgba(194,97,26,0.22)' : 'rgba(138,106,74,0.1)';
        ctx.fillRect(r.x, r.y - (over ? 2 * s : 0), r.w, r.h);
        this.ink(ctx, String(i + 1), r.x + 10 * s, ry + 16 * s - (over ? 2 * s : 0), 12, FLAT_INK.accent);
        this.ink(ctx, n, r.x + 28 * s, ry + 16 * s - (over ? 2 * s : 0), 12, FLAT_INK.text, 'left', r.w - 40 * s);
        this.snagRects.push(r);
      });
    }
    if (st.prompt && !st.shop && !st.teach && !st.snag) {
      this.creamStrip(ctx, st.prompt, v.width / 2, v.height - 190 * s, 12, FLAT_INK.accent);
    }
    if (st.aiming > 0) {
      // The throw's power: the gold-rimmed bar filling as F is held, a cream strip naming the ball above it.
      const w = 240 * s;
      const x = v.width / 2 - w / 2;
      const y = v.height - 236 * s;
      const strip = this.creamStrip(ctx, st.armedBall ? `${st.armedBall}: release to throw` : 'Release to throw', v.width / 2, y, 11, FLAT_INK.text);
      if (!this.ui.flatBar(ctx, x, y + strip + 4 * s, w, this.px2, st.aiming, 'gold')) this.pillBar(ctx, x, y + strip + 4 * s, w, 8 * s, st.aiming, '#ffd36b');
    }
    // The map and lighting stamp, only with ?debug in the address.
    if (DEBUG_STAMP) this.label(ctx, `${match.ground.label} · lighting: ${st.lightingMode}`, v.width - 16 * s, v.height - 8 * s, 10, 'rgba(255,220,250,0.75)', 'right', '500');
  }

  /**
   * Top left, on the cream ribbon banner: trainers left (big), and under the label the match clock,
   * the phase and your money.
   */
  private drawCounter(ctx: CanvasRenderingContext2D, match: Match, st: HudState, s: number): void {
    const remaining = match.radar.length ? match.radar.filter((d) => d.alive).length : [match.player, ...match.trainers].filter((t) => t.alive && !t.challenger && !t.visitor).length;
    const k = this.px;
    const t = Math.floor(match.time);
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    const line = `${mm}:${ss} · ${st.darkPhaseLabel} · ₽${st.money.toLocaleString()}`;
    const title = remaining === 1 ? 'Trainer left' : 'Trainers left';
    ctx.font = this.font(40, '800');
    const nw = ctx.measureText(String(remaining)).width;
    ctx.font = this.font(10, '700');
    const lw = Math.max(ctx.measureText(line).width, ctx.measureText(title).width * 1.2);
    const x = 16 * s;
    const y = 16 * s;
    const w = Math.round(9 * k + 6 * s + nw + 12 * s + lw + 9 * k + 6 * s);
    const h = 20 * k;
    if (!this.ui.flat(ctx, 'banner', x, y, w, h, k)) this.panel(ctx, x, y, w, h, 14, 'rgba(12,12,22,0.45)');
    this.occupied.push({ x, y, w, h });
    // The banner's front panel runs from 4 to 20 art pixels down; the text sits in its middle.
    const mid = y + 12 * k;
    const nx = x + 9 * k + 6 * s;
    this.ink(ctx, String(remaining), nx, mid + 13 * s, 40, FLAT_INK.accent);
    const tx = nx + nw + 12 * s;
    this.ink(ctx, title, tx, mid - 2 * s, 12, FLAT_INK.text);
    this.ink(ctx, line, tx, mid + 12 * s, 10, FLAT_INK.dim);
  }

  /** Top centre: when the darkness pulses next (purple and urgent in the last 15 s). Returns its height. */
  private drawStormStrip(ctx: CanvasRenderingContext2D, match: Match, st: HudState, s: number): number {
    const v = this.view;
    const y = 12 * s;
    if (st.nextPulseIn < 0) return this.creamStrip(ctx, 'The darkness has closed in', v.width / 2, y, 12, FLAT_INK.storm);
    const secs = `${Math.ceil(st.nextPulseIn)}s`;
    const urgent = st.nextPulseIn < 15;
    const pulses = CONFIG.darkness.radiiTiles.length;
    const head = urgent ? 'The darkness closes in · ' : `Darkness pulse ${Math.min(pulses, match.darkness.phase + 1)}/${pulses} in `;
    return this.creamStrip(ctx, head, v.width / 2, y, 12, FLAT_INK.text, { text: secs, color: urgent ? '#b0302a' : FLAT_INK.storm });
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
    // A cream frame from the flat skin: 3 art pixels round the chart, 5 under it (its shaded lip).
    const fw = mw + 6 * u;
    const fh = mh + 8 * u;
    const fx = Math.round((v.width - fw - 12 * s) / u) * u;
    const fy = Math.round((12 * s) / u) * u;
    const x = fx + 3 * u;
    const y = fy + 3 * u;
    const now = performance.now() / 1000;
    if (!this.minimapBaked || this.minimapBaked.w !== mw || this.minimapBaked.h !== mh || this.minimapBaked.pic !== !!this.mapPicture) {
      this.minimapBaked = { canvas: this.bakeMinimap(match, mw, mh), w: mw, h: mh, pic: !!this.mapPicture };
    }
    if (!this.ui.flat(ctx, 'cream', fx, fy, fw, fh, u)) this.panel(ctx, fx, fy, fw, fh, 12, 'rgba(12,12,22,0.55)');
    this.occupied.push({ x: fx, y: fy, w: fw, h: fh });
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, mw, mh);
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
    if (match.radar.length) {
      // Online: everyone still in, other players in blue.
      for (const d of match.radar) if (d.alive && d.id !== match.player.id) pin(d.x, d.y, d.human ? '#5cc8ff' : '#ff5c5c', 3);
    } else {
      for (const t of match.trainers) {
        if (!t.alive || t.visitor) continue;
        pin(t.x, t.y, '#ff5c5c', 3);
      }
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
    ctx.strokeStyle = 'rgba(40,24,12,0.55)';
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.rect(x, y, mw, mh);
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

  /**
   * The party: a compact column, bottom left. Each row is the portrait in an orange slot (the lead's
   * framed by corner brackets), a cream name tab with the level, and the gold-rimmed HP bar; a small
   * behaviour chip (click to change), the HP numbers, status, held item and release X as before.
   * The storm meters are over the Pokémon themselves (MatchScreen.drawInfoBars), not here.
   */
  private drawParty(ctx: CanvasRenderingContext2D, match: Match, st: HudState, s: number): void {
    const v = this.view;
    const p = match.player;
    const k = this.px;
    const k2 = this.px2;
    const ps = Math.round(50 * s);
    const gap = Math.round(6 * s);
    const right = Math.round(176 * s);
    const cardW = ps + 6 * s + right;
    const n = p.party.length;
    const x0 = 16 * s;
    const bottom = v.height - 16 * s;
    this.behaviorRects = [];
    this.portraitRects = [];
    this.releaseRects = [];
    this.heldRects = [];
    const first = lead(p);
    if (n) this.occupied.push({ x: x0, y: bottom - n * ps - (n - 1) * gap, w: cardW + 60 * s, h: n * ps + (n - 1) * gap });
    p.party.forEach((m, i) => {
      const x = x0;
      const y0 = Math.round(bottom - (n - i) * ps - (n - 1 - i) * gap);
      const hover = hit(st.mouseX, st.mouseY, x, y0, cardW + 24 * s, ps);
      const isLead = m === first;
      // The portrait in its slot.
      const px = x;
      const py = y0;
      if (!this.ui.flat(ctx, m.fainted ? 'slotGhost' : 'slotOrange', px, py, ps, ps, k2)) this.panel(ctx, px, py, ps, ps, 8);
      if (m.fainted) {
        ctx.fillStyle = 'rgba(16,10,30,0.6)';
        ctx.fillRect(px + 2 * k2, py + 2 * k2, ps - 4 * k2, ps - 4 * k2);
      }
      const inner = ps - 8 * k2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(px + 4 * k2 - 2 * s, py + 4 * k2 - 2 * s, inner + 4 * s, inner + 4 * s);
      ctx.clip();
      const f = m.sprites.portraitSource();
      ctx.imageSmoothingEnabled = false;
      const scale = Math.max(1, Math.floor((inner + 4 * s) / Math.max(f.w, f.h)));
      const dw = f.w * scale;
      const dh = f.h * scale;
      if (m.fainted) ctx.filter = 'grayscale(1) brightness(0.6)';
      ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, Math.round(px + (ps - dw) / 2), Math.round(py + (ps - dh) / 2), dw, dh);
      ctx.filter = 'none';
      ctx.restore();
      if (isLead) this.ui.flat(ctx, 'select', px - 4 * s, py - 4 * s, ps + 8 * s, ps + 8 * s, k2);
      else if (hover) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(px + 4 * k2, py + 4 * k2, inner, inner);
      }
      // Waiting in its ball (only two are out at a time): a small ball on the portrait.
      if (m.stowed && !m.fainted) this.icons.draw(ctx, 'poke-ball', px + 10 * s, py + ps - 10 * s, 16 * s);
      // The name tab, with the level; the behaviour chip at the row's right end.
      const rx = px + ps + 6 * s;
      const chipW = Math.round(46 * s);
      const chipH = Math.round(16 * s);
      const chipX = rx + right - chipW;
      const tabText = `${m.shiny ? '★ ' : ''}${m.name}  Lv ${m.level}`;
      ctx.font = this.font(10, '700');
      const tabH = Math.round(6 * k2 + 12 * s);
      const tabW = Math.min(right - chipW - 6 * s, Math.round(ctx.measureText(tabText).width + 6 * k2 + 10 * s));
      if (!this.ui.flat(ctx, 'tab', rx, y0, tabW, tabH, k2)) this.panel(ctx, rx, y0, tabW, tabH, 6);
      this.ink(ctx, tabText, rx + 4 * k2 + 3 * s, y0 + 2 * k2 + (tabH - 6 * k2) / 2 + 4.5 * s, 10, m.fainted ? '#8a7a6a' : m.shiny ? '#1f7a9a' : FLAT_INK.text, 'left', tabW - 6 * k2 - 6 * s);
      // HP: the gold-rimmed bar along the bottom of the row; the numbers (or where it roams) beside the tab.
      const bk = k2;
      const by = y0 + ps - 10 * bk - 2 * s;
      const frac = clamp(m.hp / m.maxHp, 0, 1);
      if (!this.ui.flatBar(ctx, rx, by, right, bk, frac, frac > 0.5 ? 'green' : frac > 0.2 ? 'gold' : 'red')) {
        this.pillBar(ctx, rx, by + 3 * bk, right, 4 * bk, frac, frac > 0.5 ? '#5ee08f' : frac > 0.2 ? '#ffcf4a' : '#ff5f6d');
      }
      // XP: a hairline under the bar.
      const xf = clamp(m.xp / xpToNext(m.level), 0, 1);
      const xh = Math.max(2, Math.round(2 * s));
      ctx.fillStyle = 'rgba(20,14,36,0.55)';
      ctx.fillRect(rx + 3 * bk, by + 10 * bk, right - 6 * bk, xh);
      ctx.fillStyle = '#7fb3ff';
      ctx.fillRect(rx + 3 * bk, by + 10 * bk, Math.round((right - 6 * bk) * xf), xh);
      // The HP numbers (or how far it roams) just right of the bar.
      const roaming = isRoaming(m);
      const info = m.fainted ? 'Fainted' : roaming ? `${Math.hypot(m.x - p.x, m.y - p.y).toFixed(0)} tiles · R` : `${m.hp}/${m.maxHp}`;
      this.label(ctx, info, rx + right + 5 * s, by + 5 * bk + 4 * s, 9, m.fainted ? '#ff8fa3' : roaming ? '#ffd3a8' : '#ffffff', 'left', '700');
      const chipY = y0 + Math.round((tabH - chipH) / 2);
      const chipHover = hit(st.mouseX, st.mouseY, chipX, chipY, chipW, chipH);
      const chipCol = roaming ? '#e88a3c' : ({ aggressive: '#e2574c', guard: '#3f86f0', catch: '#d93a4a', passive: '#7d879e', hold: '#7d879e' } as Record<string, string>)[m.behavior] ?? '#6c5ad8';
      ctx.fillStyle = chipHover ? lightenHex(chipCol) : chipCol;
      ctx.fillRect(chipX, chipY, chipW, chipH);
      ctx.strokeStyle = '#1a1028';
      ctx.lineWidth = Math.max(1, Math.round(s));
      ctx.strokeRect(chipX + 0.5, chipY + 0.5, chipW - 1, chipH - 1);
      this.label(ctx, BEHAVIOR_LABEL[m.behavior], chipX + chipW / 2, chipY + chipH - 4 * s, 8, '#ffffff', 'center', '800', chipW - 6 * s);
      this.behaviorRects.push({ x: chipX, y: chipY, w: chipW, h: chipH });
      if (roaming) {
        // A map pin on the portrait.
        const pinX = px + ps - 9 * s;
        const pinY = py + 9 * s;
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
      }
      if (m.status) {
        const color = STATUS_COLORS[m.status] ?? '#fff';
        const tag = ({ paralysis: 'PAR', burn: 'BRN', sleep: 'SLP', poison: 'PSN', freeze: 'FRZ', confusion: 'CNF' } as Record<string, string>)[m.status] ?? '';
        ctx.fillStyle = color;
        ctx.fillRect(px, py, 28 * s, 13 * s);
        ctx.strokeStyle = '#1a1028';
        ctx.strokeRect(px + 0.5, py + 0.5, 28 * s - 1, 13 * s - 1);
        this.label(ctx, tag, px + 14 * s, py + 10 * s, 8.5, '#1a1028', 'center', '800', 26 * s);
      }
      if (m.heldItem) {
        // The held item on the portrait's corner; hovered, a ring and a tooltip (a click takes it back).
        const hx = px + ps - 8 * s;
        const hy = py + ps - 8 * s;
        const overHeld = hit(st.mouseX, st.mouseY, hx - 11 * s, hy - 11 * s, 22 * s, 22 * s);
        if (overHeld) {
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.beginPath();
          ctx.arc(hx, hy, 12 * s, 0, Math.PI * 2);
          ctx.fill();
        }
        this.icons.draw(ctx, m.heldItem, hx, hy, 18 * s);
        if (overHeld) {
          const tip = `Take ${ITEMS[m.heldItem]?.name ?? 'item'}`;
          ctx.font = this.font(9, '800');
          const tw = ctx.measureText(tip).width + 12 * s;
          ctx.fillStyle = 'rgba(20,16,36,0.92)';
          ctx.beginPath();
          ctx.roundRect(hx + 13 * s, hy - 9 * s, tw, 18 * s, 6 * s);
          ctx.fill();
          this.label(ctx, tip, hx + 19 * s, hy + 4 * s, 9, '#ffe9a8', 'left', '800');
        }
        this.heldRects.push({ x: hx - 11 * s, y: hy - 11 * s, w: 22 * s, h: 22 * s, index: i });
      }
      this.portraitRects.push({ x, y: y0, w: cardW, h: ps });
      // Hovering a row (with more than one in the party): a red X at its right end releases it,
      // after a second click on the "Release?" it turns into.
      const armed = this.releaseArmed === i;
      if ((hover || armed) && p.party.length > 1 && !p.duelId) {
        const xs = 14 * s;
        const label = armed ? 'Release?' : '';
        ctx.font = this.font(9, '800');
        const bw = armed ? ctx.measureText(label).width + 12 * s : xs;
        const xx = x + cardW + 4 * s;
        const xy = y0 + (tabH - xs) / 2;
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

  /** Width of a cream strip holding `text` at `size`. */
  private creamWidth(ctx: CanvasRenderingContext2D, text: string, size: number): number {
    ctx.font = this.font(size, '700');
    return ctx.measureText(text).width + 12 * this.px2 + 10 * this.view.baseScale;
  }

  /**
   * Bottom right: the two move buttons (left and right mouse button) as cream buttons from the flat
   * skin, the cooldown a shade drawn down over the face; above them, small cream strips for the
   * auto-battle state, dodge, steering and Mega Evolution.
   */
  private drawMoves(ctx: CanvasRenderingContext2D, match: Match, st: HudState, s: number): void {
    const v = this.view;
    const m = match.actingMon;
    this.moveRects = [];
    if (!m) return;
    const k = this.px;
    const bw = Math.round(132 * s);
    const bh = Math.round(66 * s);
    const gap = Math.round(8 * s);
    const right = v.width - 16 * s;
    const top = v.height - 16 * s - bh;
    const bx = (i: number) => Math.round(right - (2 - i) * bw - (1 - i) * gap);
    this.occupied.push({ x: bx(0), y: top - 110 * s, w: right - bx(0), h: bh + 110 * s });
    // The strips above, stacked upward from the buttons, right-aligned.
    let cy = top - 8 * s;
    const chip = (text: string, color: string, glow?: string) => {
      // Watching: the hints are about controls nobody watching has.
      if (st.watching) return;
      const w = this.creamWidth(ctx, text, 10);
      const h = Math.round(8 * this.px2 + 10 * 1.25 * s);
      cy -= h;
      ctx.save();
      if (glow) {
        ctx.shadowColor = glow;
        ctx.shadowBlur = 12 * s * (0.75 + 0.25 * Math.sin(performance.now() / 220));
      }
      this.creamStrip(ctx, text, right - w / 2, cy, 10, color);
      ctx.restore();
      cy -= 4 * s;
    };
    chip(match.playerDuel ? 'Auto off in battles' : match.auto ? 'Auto on · R' : 'Auto off · R', match.auto && !match.playerDuel ? '#2e7d32' : FLAT_INK.dim);
    // Dodging is for steering a Pokémon (Pokémon mode or a battle), not walking the trainer.
    const dcd = m.dodgeCd ?? 0;
    if (match.canDodge) chip(dcd > 0 ? `Dodge ${dcd.toFixed(1)}s` : 'Dodge · Space', dcd > 0 ? FLAT_INK.dim : FLAT_INK.text);
    if (!match.playerDuel) chip(match.controlled ? `Steering ${m.name} · Esc` : 'Trainer · click a Pokémon', match.controlled ? '#1f6aa0' : FLAT_INK.text);
    if (canMega(match.player, m)) chip('Mega Evolve · M', FLAT_INK.storm, 'rgba(190,120,255,0.95)');
    // A legendary in its bout can be caught: say so, with the balls left.
    if (match.legendBoutFoe()) {
      const balls = match.player.items.reduce((n, e) => n + (e && ITEMS[e.id]?.kind === 'ball' ? e.count : 0), 0);
      chip(balls > 0 ? `Throw a ball · F (${balls})` : 'No Poké Balls left', balls > 0 ? FLAT_INK.text : FLAT_INK.dim, balls > 0 ? 'rgba(255,207,74,0.9)' : undefined);
    }
    let hoveredMove: MoveDef | null = null;
    for (let i = 0; i < 2; i++) {
      const x = bx(i);
      const y = top;
      const id = m.moves[i];
      if (!id) {
        // Not learned yet: a faint empty slot.
        if (!this.ui.flat(ctx, 'slotGhost', x, y, bw, bh, this.px2)) this.panel(ctx, x, y, bw, bh, 8);
        this.label(ctx, '-', x + bw / 2, y + bh / 2 + 5 * s, 14, 'rgba(255,255,255,0.5)', 'center', '600');
        continue;
      }
      const def = move(id);
      const cd = m.cooldowns[i] ?? 0;
      const ready = cd <= 0 && !incapable(m);
      const hover = hit(st.mouseX, st.mouseY, x, y, bw, bh);
      if (hover) hoveredMove = def;
      if (!this.ui.flat(ctx, 'button', x, y, bw, bh, k)) this.panel(ctx, x, y, bw, bh, 10);
      // The button in its move's type colour: the face (inside the outline, above the lip) and a darker lip.
      const col = typeColor(def.type);
      const fx = x + k;
      const fy = y + 5 * k;
      const fw = bw - 2 * k;
      const fh = bh - 5 * k - 4 * k;
      ctx.fillStyle = !ready ? darken(col, 0.35) : hover ? lighten(col, 0.18) : col;
      ctx.fillRect(fx, fy, fw, fh);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(fx, fy, fw, k);
      ctx.fillStyle = darken(col, ready ? 0.35 : 0.6);
      ctx.fillRect(fx, y + bh - 4 * k, fw, 3 * k);
      if (!ready && cd > 0) {
        // The cooldown: a shade over the face that draws up as it recharges.
        const frac = Math.min(1, cd / def.cooldown);
        ctx.fillStyle = 'rgba(10,6,20,0.45)';
        ctx.fillRect(fx, fy, fw, Math.round(fh * frac));
      }
      const midY = fy + fh / 2;
      this.label(ctx, MOVE_KEYS[i] ?? String(i + 1), x + bw / 2, midY - 5 * s, 9, ready ? '#ffffff' : '#c9c2d8', 'center', '800');
      this.label(ctx, def.name, x + bw / 2, midY + 10 * s, 12, ready ? '#ffffff' : '#c9c2d8', 'center', '800', bw - 4 * k);
      if (!ready && cd > 0) this.label(ctx, `${cd.toFixed(1)}s`, x + bw - 2 * k - 2 * s, fy + 11 * s, 8, '#ffe9a8', 'right', '800');
      this.moveRects.push({ x, y, w: bw, h: bh });
    }
    if (hoveredMove) this.drawMoveTip(ctx, hoveredMove, right, cy);
  }

  /**
   * The bag, bottom centre: the six slots as cream buttons from the flat skin (number top left, count
   * bottom right, the armed one framed by corner brackets), the Bag / Held & TMs tabs over its left end,
   * and, while your team is in the storm with a Storm Mask in the bag, a tab saying so.
   */
  private drawItems(ctx: CanvasRenderingContext2D, match: Match, st: HudState, s: number): void {
    const v = this.view;
    const p = match.player;
    const items = st.gearTab ? p.held : p.items;
    const n = items.length;
    const k = this.px;
    const k2 = this.px2;
    const sw = Math.round(54 * s);
    const sh = Math.round(60 * s);
    const gap = Math.round(4 * s);
    const w = n * sw + (n - 1) * gap;
    const x0 = Math.round((v.width - w) / 2);
    const y0 = Math.round(v.height - 16 * s - sh);
    this.itemRects = [];
    this.tabRects = [];
    this.discardRects = [];
    this.occupied.push({ x: x0, y: y0 - 60 * s, w, h: sh + 60 * s });
    let hovered: { def: (typeof ITEMS)[string]; x: number } | null = null;
    // Tabs over the bag's left end.
    const tabH = Math.round(6 * k2 + 12 * s);
    const tabY = y0 - tabH - 4 * s;
    let tx = x0;
    ['Bag', 'Held & TMs'].forEach((name, i) => {
      const active = (i === 1) === st.gearTab;
      ctx.font = this.font(10, '700');
      const tw = Math.round(ctx.measureText(name).width + 6 * k2 + 14 * s);
      const over = hit(st.mouseX, st.mouseY, tx, tabY, tw, tabH);
      ctx.save();
      ctx.globalAlpha = active ? 1 : over ? 0.85 : 0.6;
      if (!this.ui.flat(ctx, 'tab', tx, tabY, tw, tabH, k2)) this.panel(ctx, tx, tabY, tw, tabH, 6);
      this.ink(ctx, name, tx + 4 * k2 + 5 * s, tabY + 2 * k2 + (tabH - 6 * k2) / 2 + 4.5 * s, 10, active ? FLAT_INK.text : FLAT_INK.dim);
      ctx.restore();
      this.tabRects.push({ x: tx, y: tabY, w: tw, h: tabH });
      tx += tw + 4 * s;
    });
    this.label(ctx, 'G', tx + 2 * s, tabY + tabH / 2 + 4 * s, 9, '#ffffff', 'left', '700');
    // The Storm Mask at work: a tab over the bag's right end while anyone in the party is in the darkness.
    const masked = p.items.some((e) => e?.id === 'storm-mask') || p.held.some((e) => e?.id === 'storm-mask');
    if (masked && p.party.some((m) => m.inDark && !m.fainted && !m.stowed)) {
      const secs = (CONFIG.darkness as { stormMaskSeconds?: number }).stormMaskSeconds ?? 120;
      const text = `Storm Mask: your team lasts ${secs % 60 ? `${secs}s` : `${secs / 60} min`} in the storm`;
      ctx.font = this.font(9, '700');
      const mw = Math.round(ctx.measureText(text).width + 6 * k2 + 12 * s);
      const my = tabY - tabH - 4 * s;
      const mx = Math.round(x0 + w / 2 - mw / 2);
      if (!this.ui.flat(ctx, 'tab', mx, my, mw, tabH, k2)) this.panel(ctx, mx, my, mw, tabH, 6);
      this.ink(ctx, text, mx + 4 * k2 + 4 * s, my + 2 * k2 + (tabH - 6 * k2) / 2 + 4 * s, 9, FLAT_INK.storm);
    }
    // Each slot eases toward its lift: the armed one rises (with its number), a hovered one a little.
    const now = performance.now();
    const ldt = this.liftClock ? Math.min(0.1, (now - this.liftClock) / 1000) : 0;
    this.liftClock = now;
    const rise = Math.round(9 * s);
    items.forEach((entry, i) => {
      const id = entry?.id ?? null;
      const x = x0 + i * (sw + gap);
      const hover = hit(st.mouseX, st.mouseY, x, y0 - rise, sw, sh + rise);
      const selected = st.selectedItem === i;
      const target = selected ? 1 : hover ? 0.35 : 0;
      const cur = this.slotLift[i] ?? 0;
      const next = cur + (target - cur) * Math.min(1, ldt * 16);
      this.slotLift[i] = Math.abs(next - target) < 0.01 ? target : next;
      const lift = Math.round(this.slotLift[i] * rise);
      const y = y0 - lift;
      // A soft shadow left on the ground as the slot rises.
      if (lift > 0) {
        ctx.fillStyle = `rgba(20,12,6,${0.28 * (this.slotLift[i] ?? 0)})`;
        ctx.fillRect(x + 2 * k, y0 + sh - 3 * k, sw - 4 * k, 3 * k);
      }
      if (!this.ui.flat(ctx, 'button', x, y, sw, sh, k)) this.panel(ctx, x, y, sw, sh, 8);
      if (selected) {
        // The armed slot's face glows a little warmer.
        ctx.fillStyle = 'rgba(255,214,120,0.28)';
        ctx.fillRect(x + k, y + 5 * k, sw - 2 * k, sh - 9 * k);
      }
      // The face's middle: below the 6-pixel top, above the 5-pixel lip.
      const cx = x + sw / 2;
      const cyc = y + sh / 2 + 0.5 * k;
      this.ink(ctx, String(i + 1), x + k + 3 * s, y + 5 * k + 9 * s, 9, selected ? '#b0302a' : FLAT_INK.accent);
      if (id) {
        const def = ITEMS[id];
        if (def) {
          // Balls are drawn a touch smaller than the bag icons, so every item sits at one size.
          this.icons.draw(ctx, def.id, cx, cyc + 1 * s, (def.kind === 'ball' ? 27 : 34) * s, def.tmType);
          const count = entry?.count ?? 1;
          if (count > 1) this.countBadge(ctx, count, x + sw, y + sh - 4 * k);
          if (hover) {
            hovered = { def, x: cx };
            // A small X in the top-right corner throws the item away.
            const xs = 14 * s;
            const xx = x + sw - xs + 3 * s;
            const xy = y + 4 * k - 3 * s;
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
      this.itemRects.push({ x, y, w: sw, h: sh + lift });
    });
    // The hovered item's name above the bag.
    if (hovered) {
      const h = hovered as { def: (typeof ITEMS)[string]; x: number };
      const name = st.shop ? `${h.def.name} · sells for ₽${st.shop.sellPrice(h.def.id).toLocaleString()}` : h.def.name;
      const tw = this.creamWidth(ctx, name, 11);
      const cx = Math.max(8 * s + tw / 2, Math.min(v.width - 8 * s - tw / 2, h.x));
      this.creamStrip(ctx, name, cx, tabY - 2 * tabH - 14 * s, 11);
    }
  }

  /** A move's tooltip, right-aligned to `right` and sitting on `bottom`: what it is and what it does. */
  /**
   * The learn card, right of centre: a Pokémon wants a new move and both its slots are full. It
   * shows the new move beside the two it knows, each as a type-coloured row with its numbers;
   * click a known move to forget it for the new one, or "Keep both" to pass. The match carries on
   * meanwhile (nothing is paused or blocked), and the offer waits until it is answered.
   */
  private drawLearn(ctx: CanvasRenderingContext2D, st: HudState, s: number): void {
    this.learnRects = [];
    const L = st.learn;
    if (!L) return;
    const v = this.view;
    const w = Math.round(300 * s);
    const rowH = Math.round(40 * s);
    const gap = Math.round(6 * s);
    const h = Math.round(64 * s + rowH + 22 * s + 2 * (rowH + gap) + 42 * s);
    const x = Math.round(v.width - w - 16 * s);
    const y = Math.round(Math.max(200 * s, v.height / 2 - h / 2 - 30 * s));
    this.popupBox(ctx, x, y, w, h);
    this.occupied.push({ x, y, w, h });
    const pad = Math.round(14 * s);
    this.ink(ctx, `${L.mon} wants to learn`, x + w / 2, y + 26 * s, 12, FLAT_INK.dim, 'center', w - 2 * pad);
    const fresh = move(L.moveId);
    this.ink(ctx, fresh.name, x + w / 2, y + 46 * s, 16, FLAT_INK.accent, 'center', w - 2 * pad);
    if (L.queued > 0) this.ink(ctx, `+${L.queued} more`, x + w - pad, y + 18 * s, 9, FLAT_INK.dim, 'right');
    const row = (def: MoveDef, rx: number, ry: number, rw: number, state: 'new' | 'hover' | 'idle' | 'locked') => {
      const col = typeColor(def.type);
      ctx.fillStyle = state === 'locked' ? 'rgba(138,106,74,0.12)' : state === 'hover' ? 'rgba(194,97,26,0.16)' : state === 'new' ? 'rgba(106,63,200,0.1)' : 'rgba(138,106,74,0.08)';
      ctx.fillRect(rx, ry, rw, rowH);
      if (state === 'hover') {
        ctx.fillStyle = FLAT_INK.accent;
        ctx.fillRect(rx, ry, rw, Math.max(1, Math.round(s)));
        ctx.fillRect(rx, ry + rowH - Math.max(1, Math.round(s)), rw, Math.max(1, Math.round(s)));
      }
      // The type stripe.
      ctx.fillStyle = '#2a1a10';
      ctx.fillRect(rx, ry, Math.round(6 * s), rowH);
      ctx.fillStyle = state === 'locked' ? darken(col, 0.4) : col;
      ctx.fillRect(rx + Math.round(s), ry + Math.round(s), Math.round(4 * s), rowH - 2 * Math.round(s));
      const tx = rx + 14 * s;
      this.ink(ctx, def.name, tx, ry + 17 * s, 12, state === 'locked' ? FLAT_INK.dim : FLAT_INK.text, 'left', rw * 0.55);
      const kind = `${def.type[0]?.toUpperCase()}${def.type.slice(1)} · ${def.category === 'status' ? 'Status' : def.category === 'physical' ? (isContact(def) ? 'Physical, lunge' : 'Physical') : 'Special'}`;
      this.ink(ctx, kind, tx, ry + 32 * s, 9, darken(col, 0.3), 'left', rw * 0.6);
      const nums = `${def.power > 0 ? `Pow ${def.power}` : 'No damage'} · ${def.cooldown}s`;
      this.ink(ctx, nums, rx + rw - 8 * s, ry + 17 * s, 10, FLAT_INK.text, 'right');
      const tag = state === 'new' ? 'NEW' : state === 'locked' ? 'Signature: kept' : state === 'hover' ? 'Forget this' : 'Click to forget';
      this.ink(ctx, tag, rx + rw - 8 * s, ry + 32 * s, 9, state === 'new' ? FLAT_INK.storm : state === 'hover' ? FLAT_INK.bad : FLAT_INK.dim, 'right');
    };
    const rx = x + pad;
    const rw = w - 2 * pad;
    let ry = y + 58 * s;
    row(fresh, rx, ry, rw, 'new');
    ry += rowH + 22 * s;
    this.ink(ctx, 'Forget one of these for it:', rx, ry - 6 * s, 10, FLAT_INK.dim);
    L.moves.forEach((id, i) => {
      const def = move(id);
      const locked = !!def.signature;
      const over = !locked && hit(st.mouseX, st.mouseY, rx, ry, rw, rowH);
      row(def, rx, ry, rw, locked ? 'locked' : over ? 'hover' : 'idle');
      if (!locked) this.learnRects.push({ x: rx, y: ry, w: rw, h: rowH, index: i });
      ry += rowH + gap;
    });
    // Keep both: a cream button along the bottom (the button art has a lip above its face, so it
    // is drawn that much taller to fill its box), rising a pixel under the pointer.
    const k = this.px2;
    const bw = Math.round(rw * 0.62);
    const bh = Math.round(26 * s);
    const bx = Math.round(x + w / 2 - bw / 2);
    const by = Math.round(y + h - bh - 10 * s);
    const over = hit(st.mouseX, st.mouseY, bx, by, bw, bh);
    const lift = over ? k : 0;
    if (!this.ui.flat(ctx, 'button', bx, by - 4 * k - lift, bw, bh + 4 * k, k)) this.panel(ctx, bx, by, bw, bh, 8);
    this.ink(ctx, `Don't learn ${fresh.name}`, bx + bw / 2, by - lift + (bh - 3 * k) / 2 + 4 * s, 10, over ? FLAT_INK.accent : FLAT_INK.text, 'center', bw - 12 * s);
    this.learnRects.push({ x: bx, y: by - k, w: bw, h: bh + k, index: 2 });
  }

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
    w += 40 * s;
    const h = (52 + lines.length * 15 + 14) * s;
    const x = Math.max(8 * s, right - w);
    const y = bottom - h;
    this.popupBox(ctx, x, y, w, h);
    const col = typeColor(def.type);
    // A stripe of the move's type colour by its name.
    ctx.fillStyle = '#2a1a10';
    ctx.fillRect(Math.round(x + 12 * s), Math.round(y + 14 * s), Math.round(6 * s), Math.round(30 * s));
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(x + 13 * s), Math.round(y + 15 * s), Math.round(4 * s), Math.round(28 * s));
    this.ink(ctx, head, x + 24 * s, y + 28 * s, 14, FLAT_INK.text);
    this.ink(ctx, sub, x + 24 * s, y + 42 * s, 10, darken(col, 0.25));
    lines.forEach((l, i) => this.ink(ctx, l, x + 16 * s, y + (64 + i * 15) * s, 10, FLAT_INK.dim));
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
  else if (isContact(def)) out.push('The user lunges in and strikes, shoving the target back');
  if (def.signature) out.push('Signature move');
  return out.filter(Boolean);
}
