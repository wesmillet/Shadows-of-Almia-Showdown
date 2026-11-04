/**
 * The PC, laid out like a Gen 5 PC box: every Pokémon kept so far (src/pc.ts, or the account's PC
 * online) sits in a 6x5 box of slots, drawn with its own in-game sprite (standing, facing you), 30
 * to a box. Above the box: sort, filters (favourites, shiny, nominated, tier) and a name search.
 * Right: the selected Pokémon (portrait, types, tier, base stats, its line, where it came from,
 * moves, a favourite star, and the third starter slot's Nominate button), or, with none selected,
 * the collection at a glance. Under the box (online): the third slot's five spots with each one's
 * odds and the points used. A/D or the arrows page through boxes; Esc or Back returns.
 */
import type { Input } from '../core/input';
import type { Connection } from '../net/connection';
import type { StartersInfo } from '../sim/starterAchievements';
import { SPECIES, typeColor } from '../sim/data';
import { nominationBase, nominationCost, NOMINATION_SLOTS, pcBase, STARTER_TIERS, tierOf } from '../sim/starters';
import { loadPc, setFavLocal, type PcEntry } from '../pc';
import type { Assets } from '../sprites/assets';
import { AnimPlayer, SpriteRegistry, type FrameRect } from '../sprites/pokemonSprite';
import { backdrop, button, heading, hit, INK, panel, skinPiece, skinPx, skinPx2, text, type GameContext, type Screen } from './screens';

/** PC icon size classes by idle sprite size in art pixels (69: the largest, Ho-Oh). */
const PC_SIZE_CLASSES = [
  { id: 'XS', upTo: 20, fill: 0.62 },
  { id: 'S', upTo: 24, fill: 0.72 },
  { id: 'M', upTo: 28, fill: 0.82 },
  { id: 'L', upTo: 34, fill: 0.93 },
  { id: 'XL', upTo: 44, fill: 1.04 },
  { id: 'XXL', upTo: Infinity, fill: 1.15 },
] as const;

const COLS = 6;
const ROWS = 5;
const PER_BOX = COLS * ROWS;
const CREAM = '#f4e6c8';

type Rect = { x: number; y: number; w: number; h: number };

const SORTS = ['Oldest', 'Newest', 'Pokédex', 'Tier', 'Level', 'Name'] as const;
type SortKey = (typeof SORTS)[number];
type Filter = 'all' | 'fav' | 'shiny' | 'nom';
const TIER_ORDER = STARTER_TIERS.map((t) => t.id);

const tierInfo = (id: string): { name: string; color: string } => {
  const t = STARTER_TIERS.find((x) => x.id === id);
  return { name: t?.name ?? id, color: t?.color ?? '#b8b8c8' };
};

const viaLabel = (via: PcEntry['via']): string =>
  via === 'win' ? 'Victory prize' : via === 'egg' ? 'Daily Egg' : via === 'gift' ? 'Mystery Gift' : via === 'reward' ? 'Starter achievement' : 'Extraction Voucher';

export class PcScreen implements Screen {
  private readonly list: PcEntry[];
  private box = 0;
  private t = 0;
  /** Hovered and selected Pokémon, as indexes into `list`. */
  private hover = -1;
  private selected = -1;
  private sort: SortKey = 'Oldest';
  private filter: Filter = 'all';
  /** A tier filter ('' for any). */
  private tier = '';
  private query = '';
  /** The box's order: indexes into `list`, sorted and filtered. */
  private view: number[] = [];
  private search: HTMLInputElement | null = null;

  constructor(
    private readonly ctx: GameContext,
    private readonly sprites: SpriteRegistry,
    private readonly assets: Assets,
    private readonly onBack: () => void,
    /** Online: the PC on the server (signed in); offline, this browser's. */
    list?: PcEntry[],
    private readonly where = 'kept in this browser',
    /** Online and signed in: the third starter slot's nominations are chosen here. */
    private readonly net: Connection | null = null,
  ) {
    this.list = list ?? loadPc();
    // Shiny ones load their recoloured set (key `dex*`), so they are ready when the box opens too.
    void this.sprites.preload(this.list.map((e) => (e.shiny && SpriteRegistry.hasShiny(e.dex) ? `${e.dex}*` : e.dex)), undefined, true);
    if (net) void this.loadStarters();
    this.refresh();
  }

  enter(): void {
    const el = document.createElement('input');
    el.type = 'search';
    el.placeholder = 'Search by name';
    el.setAttribute('aria-label', 'Search the PC by name');
    Object.assign(el.style, {
      position: 'fixed', zIndex: '20', boxSizing: 'border-box', border: '3px solid #2a1a10', borderRadius: '4px',
      background: '#fffaf0', color: '#4a3424', padding: '0 10px', fontFamily: '"BoldPixels", "Segoe UI", system-ui, sans-serif', outline: 'none',
    } as Partial<CSSStyleDeclaration>);
    el.addEventListener('input', () => {
      this.query = el.value.trim().toLowerCase();
      this.box = 0;
      this.refresh();
    });
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') el.blur();
    });
    document.body.appendChild(el);
    this.search = el;
  }

  exit(): void {
    this.search?.remove();
    this.search = null;
  }

  // ------------------------------------------------------------------ sorting and filtering

  private refresh(): void {
    const tierOfEntry = (e: PcEntry): number => TIER_ORDER.indexOf(this.tierOf(e));
    const order = this.list.map((_, i) => i).filter((i) => {
      const e = this.list[i] as PcEntry;
      if (this.filter === 'fav' && !e.fav) return false;
      if (this.filter === 'shiny' && !e.shiny) return false;
      if (this.filter === 'nom' && !this.isNominated(e)) return false;
      if (this.tier && this.tierOf(e) !== this.tier) return false;
      if (this.query && !e.name.toLowerCase().includes(this.query) && !(SPECIES.get(e.dex)?.name ?? '').toLowerCase().includes(this.query)) return false;
      return true;
    });
    const by: Record<SortKey, (a: PcEntry, b: PcEntry, ia: number, ib: number) => number> = {
      Oldest: (_a, _b, ia, ib) => ia - ib,
      Newest: (_a, _b, ia, ib) => ib - ia,
      'Pokédex': (a, b, ia, ib) => a.dex.localeCompare(b.dex) || ia - ib,
      Tier: (a, b, ia, ib) => tierOfEntry(b) - tierOfEntry(a) || a.dex.localeCompare(b.dex) || ia - ib,
      Level: (a, b, ia, ib) => b.level - a.level || ia - ib,
      Name: (a, b, ia, ib) => a.name.localeCompare(b.name) || ia - ib,
    };
    // Favourites first, then the chosen order.
    order.sort((ia, ib) => {
      const a = this.list[ia] as PcEntry;
      const b = this.list[ib] as PcEntry;
      return Number(!!b.fav) - Number(!!a.fav) || by[this.sort](a, b, ia, ib);
    });
    this.view = order;
    this.box = Math.min(this.box, this.boxes - 1);
  }

  private tierOf(e: PcEntry): string {
    return tierOf(nominationBase(e.dex) ?? pcBase(e.dex));
  }

  private get boxes(): number {
    return Math.max(1, Math.ceil(this.view.length / PER_BOX));
  }

  private toggleFav(i: number): void {
    const e = this.list[i];
    if (!e) return;
    const on = !e.fav;
    if (on) e.fav = true;
    else delete e.fav;
    if (this.net && e.pcId !== undefined) void this.net.api('/api/pc/fav', { pcId: e.pcId, on });
    else setFavLocal(e.uid, on);
    this.refresh();
  }

  // ------------------------------------------------------------------ third-slot nominations

  /** The account's nominations, budget and what it may nominate (server/starterUnlocks.ts). */
  private starters: StartersInfo | null = null;
  private note = '';
  private saving = false;

  private async loadStarters(): Promise<void> {
    if (!this.net) return;
    const r = await this.net.api<StartersInfo>('/api/starters');
    if (!r.error) this.starters = r;
  }

  /** What a PC Pokémon would nominate (its line's first form), or null. */
  private nomOf(e: PcEntry): string | null {
    const b = nominationBase(e.dex);
    return b && this.starters?.eligible.some((x) => x.dex === b) ? b : null;
  }

  private isNominated(e: PcEntry): boolean {
    const nd = this.nomOf(e);
    return !!nd && !!this.starters?.nominations.includes(nd);
  }

  private nominate(dex: string, on: boolean): void {
    const st = this.starters;
    if (!st || !this.net || this.saving) return;
    const next = on ? [...st.nominations, dex] : st.nominations.filter((d) => d !== dex);
    this.saving = true;
    void this.net.api<StartersInfo>('/api/starters/nominate', { dexes: next }).then((r) => {
      this.saving = false;
      if (r.error) this.note = r.error;
      else {
        this.starters = r;
        this.note = on ? `${SPECIES.get(dex)?.name ?? dex} nominated` : 'Nomination removed';
        if (this.filter === 'nom') this.refresh();
      }
    });
  }

  /** Whether one more nomination fits (five spots, the points budget). */
  private canAdd(dex: string): boolean {
    const st = this.starters;
    if (!st || st.nominations.includes(dex)) return false;
    return st.nominations.length < st.slots && nominationCost([...st.nominations, dex]) <= st.budget;
  }

  /** Each spot's chance in the third slot's roll (an empty spot rolls a random Common). */
  private odds(): { spots: Array<{ dex: string | null; tier: string; chance: number }>; used: number } {
    const st = this.starters;
    if (!st) return { spots: [], used: 0 };
    const tierFor = (d: string): string => st.eligible.find((x) => x.dex === d)?.tier ?? tierOf(d);
    const wOf = (tier: string): number => st.weights[tier] ?? 1;
    const spots = Array.from({ length: st.slots }, (_, i) => {
      const d = st.nominations[i] ?? null;
      return { dex: d, tier: d ? tierFor(d) : 'common', chance: 0 };
    });
    const total = spots.reduce((n, x) => n + wOf(x.tier), 0) || 1;
    for (const x of spots) x.chance = wOf(x.tier) / total;
    return { spots, used: nominationCost(st.nominations) };
  }

  // ------------------------------------------------------------------ layout

  private layout(): {
    tool: Rect; box: Rect; slot: number; gx: number; gy: number; side: Rect; strip: Rect; title: Rect; left: Rect; right: Rect;
    sortR: Rect; chips: Array<{ r: Rect; id: string }>; searchR: Rect;
  } {
    const v = this.ctx.view;
    const s = v.baseScale;
    const slot = Math.round(64 * s);
    const bw = COLS * slot + 40 * s;
    const bh = ROWS * slot + 92 * s;
    const sideW = 330 * s;
    const gap = 20 * s;
    const total = bw + gap + sideW;
    const x0 = v.width / 2 - total / 2;
    const tool = { x: x0, y: 92 * s, w: total, h: 36 * s };
    const by = tool.y + tool.h + 10 * s;
    const box = { x: x0, y: by, w: bw, h: bh };
    const title = { x: x0 + 56 * s, y: by + 12 * s, w: bw - 112 * s, h: 40 * s };
    const strip = { x: x0, y: by + bh + 10 * s, w: bw, h: 82 * s };
    const sideH = (this.starters ? strip.y + strip.h : by + bh) - by;
    // The toolbar: Sort, the filter chips, then the search box filling the rest.
    let cx = x0;
    const at = (w: number): Rect => {
      const r = { x: cx, y: tool.y, w: w * s, h: tool.h };
      cx += w * s + 6 * s;
      return r;
    };
    const sortR = at(150);
    const chips = [
      { r: at(52), id: 'all' },
      { r: at(64), id: 'fav' },
      { r: at(70), id: 'shiny' },
      { r: at(92), id: 'nom' },
      { r: at(112), id: 'tier' },
    ];
    const searchR = { x: cx, y: tool.y, w: x0 + total - cx, h: tool.h };
    return {
      tool, box, slot, gx: x0 + 20 * s, gy: by + 66 * s,
      side: { x: x0 + bw + gap, y: by, w: sideW, h: sideH },
      strip, title, sortR, chips, searchR,
      left: { x: x0 + 12 * s, y: title.y, w: 38 * s, h: 40 * s },
      right: { x: x0 + bw - 50 * s, y: title.y, w: 38 * s, h: 40 * s },
    };
  }

  private backRect(): Rect {
    const v = this.ctx.view;
    const s = v.baseScale;
    return { x: v.width / 2 - 100 * s, y: v.height - 62 * s, w: 200 * s, h: 44 * s };
  }

  /** Side panel buttons: the star (top right) and Nominate (bottom). */
  private starRect(side: Rect): Rect {
    const s = this.ctx.view.baseScale;
    return { x: side.x + side.w - 50 * s, y: side.y + 14 * s, w: 36 * s, h: 36 * s };
  }

  private nomRect(side: Rect): Rect {
    const s = this.ctx.view.baseScale;
    return { x: side.x + 18 * s, y: side.y + side.h - 58 * s, w: side.w - 36 * s, h: 42 * s };
  }

  /** The strip's five spots. */
  private spotRects(strip: Rect): Rect[] {
    const s = this.ctx.view.baseScale;
    // Inside the cream piece: clear of its frame on top and its lip at the bottom.
    const lead = 100 * s;
    const gap = 6 * s;
    const right = 12 * s;
    const w = (strip.w - lead - right - gap * (NOMINATION_SLOTS - 1)) / NOMINATION_SLOTS;
    const top = strip.y + 9 * s;
    const h = strip.h - 9 * s - 15 * s;
    return Array.from({ length: NOMINATION_SLOTS }, (_, i) => ({ x: strip.x + lead + i * (w + gap), y: top, w, h }));
  }

  private placeSearch(r: Rect): void {
    const el = this.search;
    if (!el) return;
    const c = this.ctx.view.hudCanvas.getBoundingClientRect();
    const k = c.width / this.ctx.view.width;
    const hh = r.h * k;
    Object.assign(el.style, {
      left: `${c.left + r.x * k}px`, top: `${c.top + r.y * k}px`, width: `${Math.max(60, r.w * k)}px`, height: `${hh}px`,
      fontSize: `${Math.max(9, Math.round(hh * 0.5))}px`, padding: `0 ${Math.round(hh * 0.3)}px`, borderWidth: `${Math.max(1, Math.round(hh / 12))}px`,
    });
  }

  // ------------------------------------------------------------------ input

  step(dt: number, input: Input): void {
    this.t += dt;
    const shownI = this.selected >= 0 ? this.selected : this.hover;
    const shown = this.list[shownI];
    if (shown) this.anim(shown).update(dt);
    const L = this.layout();
    const b = this.backRect();
    const typing = document.activeElement === this.search;
    for (const c of input.takeClicks()) {
      if (typing) this.search?.blur();
      // Toolbar.
      if (hit(c.x, c.y, L.sortR.x, L.sortR.y, L.sortR.w, L.sortR.h)) {
        this.sort = SORTS[(SORTS.indexOf(this.sort) + 1) % SORTS.length] as SortKey;
        this.refresh();
        continue;
      }
      const chip = L.chips.find((x) => hit(c.x, c.y, x.r.x, x.r.y, x.r.w, x.r.h));
      if (chip) {
        if (chip.id === 'tier') {
          const i = this.tier ? TIER_ORDER.indexOf(this.tier) : -1;
          this.tier = i + 1 < TIER_ORDER.length ? (TIER_ORDER[i + 1] as string) : '';
        } else this.filter = this.filter === chip.id && chip.id !== 'all' ? 'all' : (chip.id as Filter);
        this.box = 0;
        this.refresh();
        continue;
      }
      // Side panel: star and nominate.
      if (shown) {
        const sr = this.starRect(L.side);
        if (hit(c.x, c.y, sr.x, sr.y, sr.w, sr.h)) {
          this.toggleFav(shownI);
          continue;
        }
        const nd = this.nomOf(shown);
        const nr = this.nomRect(L.side);
        if (nd && this.starters && hit(c.x, c.y, nr.x, nr.y, nr.w, nr.h)) {
          const on = !this.starters.nominations.includes(nd);
          if (!on || this.canAdd(nd)) this.nominate(nd, on);
          continue;
        }
      }
      // The strip: tap a nominated spot to remove it.
      if (this.starters) {
        const spots = this.spotRects(L.strip);
        const k = spots.findIndex((r) => hit(c.x, c.y, r.x, r.y, r.w, r.h));
        if (k >= 0) {
          const d = this.starters.nominations[k];
          if (d) this.nominate(d, false);
          continue;
        }
      }
      // The box.
      const col = Math.floor((c.x - L.gx) / L.slot);
      const row = Math.floor((c.y - L.gy) / L.slot);
      if (col >= 0 && col < COLS && row >= 0 && row < ROWS) {
        const idx = this.view[this.box * PER_BOX + row * COLS + col];
        this.selected = idx !== undefined && this.selected !== idx ? idx : -1;
        this.note = '';
        continue;
      }
      if (hit(c.x, c.y, b.x, b.y, b.w, b.h)) return this.onBack();
      if (hit(c.x, c.y, L.left.x, L.left.y, L.left.w, L.left.h)) this.turn(-1);
      else if (hit(c.x, c.y, L.right.x, L.right.y, L.right.w, L.right.h)) this.turn(1);
    }
    if (!typing) {
      if (input.pressed('Escape') || input.pressed('KeyP')) return this.onBack();
      if (input.pressed('ArrowLeft') || input.pressed('KeyA') || input.pressed('KeyQ')) this.turn(-1);
      if (input.pressed('ArrowRight') || input.pressed('KeyD') || input.pressed('KeyE')) this.turn(1);
      if (input.pressed('KeyF') && shown) this.toggleFav(shownI);
    }
    const mx = this.ctx.input.mouseX;
    const my = this.ctx.input.mouseY;
    const col = Math.floor((mx - L.gx) / L.slot);
    const row = Math.floor((my - L.gy) / L.slot);
    this.hover = col >= 0 && col < COLS && row >= 0 && row < ROWS ? (this.view[this.box * PER_BOX + row * COLS + col] ?? -1) : -1;
  }

  private turn(d: number): void {
    this.box = (this.box + d + this.boxes) % this.boxes;
  }

  // ------------------------------------------------------------------ drawing

  /** Each Pokémon's idle animation (by PC entry), made on first draw. */
  private anims = new Map<string, AnimPlayer>();

  private anim(e: PcEntry): AnimPlayer {
    let a = this.anims.get(e.uid);
    if (!a) {
      a = new AnimPlayer(this.sprites.get(e.dex, !!e.shiny));
      a.dir = 0;
      this.anims.set(e.uid, a);
    }
    return a;
  }

  render(): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    const h = v.hud;
    h.clearRect(0, 0, v.width, v.height);
    backdrop(v);
    const species = new Set(this.list.map((e) => pcBase(e.dex).split('-')[0])).size;
    heading(v, 'MY PC', this.list.length
      ? `${this.list.length} Pokémon · ${species} species collected · ${this.where}`
      : 'Nothing here yet. Win a match (you pick one Pokémon to keep), hatch the Daily Egg or use an Extraction Voucher.', 48 * s);
    const L = this.layout();
    this.drawToolbar(L);
    this.drawWallpaper(L.box);
    const mx = this.ctx.input.mouseX;
    const my = this.ctx.input.mouseY;
    // Box name with its arrows, and the page count.
    const k = skinPx(v);
    if (!skinPiece(v, 'cream', L.title.x, L.title.y, L.title.w, L.title.h, k)) panel(v, L.title.x, L.title.y, L.title.w, L.title.h);
    const label = this.view.length === this.list.length ? `BOX ${this.box + 1}` : `RESULTS ${this.view.length ? this.box + 1 : 0}`;
    text(v, `${label} / ${this.boxes}`, L.title.x + L.title.w / 2, L.title.y + L.title.h / 2 + 5 * s, 18, { align: 'center', color: INK.text, shadow: false });
    for (const [r, dir] of [[L.left, -1], [L.right, 1]] as Array<[Rect, number]>) {
      const over = hit(mx, my, r.x, r.y, r.w, r.h);
      const lift = over ? k : 0;
      button(v, '', r.x, r.y, r.w, r.h, over, CREAM);
      h.fillStyle = over ? INK.accent : INK.text;
      h.beginPath();
      const cx = r.x + r.w / 2;
      const cy = r.y + (r.h - 3 * k) / 2 - lift;
      h.moveTo(cx + dir * 8 * s, cy);
      h.lineTo(cx - dir * 6 * s, cy - 9 * s);
      h.lineTo(cx - dir * 6 * s, cy + 9 * s);
      h.closePath();
      h.fill();
    }
    // The slots.
    for (let i = 0; i < PER_BOX; i++) {
      const idx = this.view[this.box * PER_BOX + i];
      const e = idx !== undefined ? this.list[idx] : undefined;
      const x = L.gx + (i % COLS) * L.slot;
      const y = L.gy + Math.floor(i / COLS) * L.slot;
      const over = idx !== undefined && idx === this.hover;
      const k2 = skinPx2(v);
      const up = over && e ? k2 : 0;
      if (!skinPiece(v, e ? 'cream' : 'slotGhost', x + 3 * s, y + 3 * s - up, L.slot - 6 * s, L.slot - 6 * s, k2)) {
        h.fillStyle = over ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.1)';
        h.fillRect(x + 3 * s, y + 3 * s, L.slot - 6 * s, L.slot - 6 * s);
      }
      if (!e || idx === undefined) continue;
      // A small tier stripe along the slot's bottom edge.
      h.fillStyle = tierInfo(this.tierOf(e)).color;
      h.fillRect(x + 8 * s, y + L.slot - 9 * s - up, L.slot - 16 * s, 3 * s);
      // Centred in the well (which rises by `up` when pointed at); only its idle animation plays.
      // Clipped to its slot above the tier bar (and centred there): nothing spills over the edge.
      h.save();
      h.beginPath();
      h.rect(x + 5 * s, y + 5 * s - up, L.slot - 10 * s, L.slot - 16 * s);
      h.clip();
      this.drawIcon(e, x + L.slot / 2, y + 5 * s + (L.slot - 16 * s) / 2 - up, L.slot - 22 * s);
      h.restore();
      if (e.fav) text(v, '♥', x + 13 * s, y + 18 * s - up, 12, { align: 'center', weight: '900', color: '#e2574c' });
      if (e.shiny) text(v, '★', x + L.slot - 12 * s, y + 18 * s - up, 12, { align: 'center', weight: '900', color: '#ffd36b' });
      if (e.shadow) text(v, '◆', x + L.slot - 12 * s, y + L.slot - 14 * s - up, 11, { align: 'center', weight: '900', color: '#c48bff' });
      if (this.isNominated(e)) {
        h.fillStyle = INK.accent;
        h.beginPath();
        h.arc(x + 14 * s, y + L.slot - 16 * s - up, 8 * s, 0, Math.PI * 2);
        h.fill();
        text(v, '3', x + 14 * s, y + L.slot - 12 * s - up, 10, { align: 'center', weight: '900', color: '#fff', shadow: false });
      }
      if (idx === this.selected) {
        h.strokeStyle = INK.accent;
        h.lineWidth = 3 * s;
        h.strokeRect(x + 3 * s, y + 3 * s - up, L.slot - 6 * s, L.slot - 6 * s);
      }
    }
    if (!this.view.length && this.list.length) {
      text(v, 'No Pokémon match these filters', L.box.x + L.box.w / 2, L.gy + 2.5 * L.slot, 14, { align: 'center', color: '#ffffff', shadowColor: 'rgba(10,20,60,0.8)' });
    }
    if (this.starters) this.drawStrip(L.strip);
    this.drawSide(L.side);
    const b = this.backRect();
    button(v, 'Back', b.x, b.y, b.w, b.h, hit(mx, my, b.x, b.y, b.w, b.h), CREAM);
    this.placeSearch(L.searchR);
  }

  private drawToolbar(L: ReturnType<PcScreen['layout']>): void {
    const v = this.ctx.view;
    const mx = this.ctx.input.mouseX;
    const my = this.ctx.input.mouseY;
    const over = (r: Rect): boolean => hit(mx, my, r.x, r.y, r.w, r.h);
    button(v, `Sort: ${this.sort}`, L.sortR.x, L.sortR.y, L.sortR.w, L.sortR.h, over(L.sortR), CREAM);
    const labels: Record<string, string> = { all: 'All', fav: '♥ Favs', shiny: '★ Shiny', nom: '3rd slot', tier: this.tier ? tierInfo(this.tier).name : 'Any tier' };
    for (const c of L.chips) {
      const on = c.id === 'tier' ? !!this.tier : this.filter === c.id;
      if (c.id === 'nom' && !this.starters) {
        button(v, labels[c.id] as string, c.r.x, c.r.y, c.r.w, c.r.h, false, '#44405a');
        continue;
      }
      button(v, labels[c.id] as string, c.r.x, c.r.y, c.r.w, c.r.h, over(c.r), on ? undefined : CREAM);
    }
  }

  /** The third slot: five spots, each with its odds, and the points used. */
  private drawStrip(r: Rect): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    const h = v.hud;
    const st = this.starters;
    if (!st) return;
    if (!skinPiece(v, 'cream', r.x, r.y, r.w, r.h, skinPx(v))) panel(v, r.x, r.y, r.w, r.h);
    const { spots, used } = this.odds();
    const rects = this.spotRects(r);
    const first = rects[0] as Rect;
    // Left: the label, the points and their meter, centred against the spots.
    const lx = r.x + 16 * s;
    const mid = first.y + first.h / 2;
    text(v, '3RD SLOT', lx, mid - 10 * s, 13, { color: INK.accent, shadow: false, maxWidth: 80 * s });
    text(v, `${used} / ${st.budget} pts`, lx, mid + 8 * s, 11, { color: used > st.budget ? INK.bad : INK.text, shadow: false, maxWidth: 80 * s });
    const mw = 74 * s;
    h.fillStyle = '#e0d0b4';
    h.fillRect(lx, mid + 14 * s, mw, 5 * s);
    h.fillStyle = used > st.budget ? INK.bad : INK.accent;
    h.fillRect(lx, mid + 14 * s, mw * Math.min(1, used / st.budget), 5 * s);
    const mx = this.ctx.input.mouseX;
    const my = this.ctx.input.mouseY;
    spots.forEach((sp, i) => {
      const c = rects[i] as Rect;
      const over = !!sp.dex && hit(mx, my, c.x, c.y, c.w, c.h);
      h.fillStyle = over ? '#fde7cf' : '#fbf5e9';
      h.fillRect(c.x, c.y, c.w, c.h);
      h.strokeStyle = sp.dex ? tierInfo(sp.tier).color : '#d8c8aa';
      h.lineWidth = 2 * s;
      h.strokeRect(c.x + s, c.y + s, c.w - 2 * s, c.h - 2 * s);
      const cx = c.x + c.w / 2;
      const ps = 24 * s;
      if (sp.dex) {
        const f = this.sprites.get(sp.dex, false).portraitSource();
        h.save();
        h.imageSmoothingEnabled = false;
        h.drawImage(f.image, f.sx, f.sy, f.w, f.h, cx - ps / 2, c.y + 5 * s, ps, ps);
        h.restore();
        text(v, SPECIES.get(sp.dex)?.name ?? sp.dex, cx, c.y + ps + 17 * s, 10, { align: 'center', color: INK.text, shadow: false, maxWidth: c.w - 8 * s });
      } else {
        text(v, '?', cx, c.y + 5 * s + ps * 0.8, 18, { align: 'center', color: '#c8b896', shadow: false });
        text(v, 'Random', cx, c.y + ps + 17 * s, 10, { align: 'center', color: INK.dim, shadow: false, maxWidth: c.w - 8 * s });
      }
      text(v, `${(sp.chance * 100).toFixed(0)}%`, cx, c.y + c.h - 5 * s, 11, { align: 'center', color: INK.good, shadow: false, weight: '900' });
    });
  }

  /** The side panel: the selected (or pointed-at) Pokémon, or the collection at a glance. */
  private drawSide(r: Rect): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    const h = v.hud;
    panel(v, r.x, r.y, r.w, r.h, 16, 'rgba(22,30,52,0.94)');
    const i = this.selected >= 0 ? this.selected : this.hover;
    const e = this.list[i];
    if (!e) return this.drawSummary(r);
    const sp = SPECIES.get(e.dex);
    const pad = 16 * s;
    // Portrait, top left.
    const ps = 92 * s;
    const px = r.x + pad;
    const py = r.y + pad;
    const pk = skinPx(v);
    const f = this.sprites.get(e.dex, !!e.shiny).portraitSource();
    if (!skinPiece(v, e.shadow ? 'grey' : e.shiny ? 'blue' : 'orange', px, py, ps + 12 * s, ps + 12 * s, pk)) {
      h.fillStyle = 'rgba(0,0,0,0.08)';
      h.fillRect(px, py, ps + 12 * s, ps + 12 * s);
    }
    h.save();
    if (e.shadow) {
      h.fillStyle = 'rgba(70,20,110,0.55)';
      h.fillRect(px + 2 * pk, py + 2 * pk, ps + 12 * s - 4 * pk, ps + 12 * s - 4 * pk);
    }
    h.imageSmoothingEnabled = false;
    h.drawImage(f.image, f.sx, f.sy, f.w, f.h, px + 6 * s, py + 6 * s, ps, ps);
    h.restore();
    // Name, level, types and tier, right of the portrait.
    const tx = px + ps + 26 * s;
    const tw = r.x + r.w - pad - tx - 34 * s;
    const name = /^\d{4}/.test(e.name) ? (sp?.name ?? e.name) : e.name;
    text(v, name, tx, py + 18 * s, 18, { color: e.shiny ? INK.blue : INK.text, shadow: false, maxWidth: tw });
    const tags = [`Lv ${e.level}`, e.shiny ? 'Shiny' : '', e.alpha ? 'Alpha' : '', e.shadow ? 'Shadow' : '', e.legend ? 'Legend' : ''].filter(Boolean).join(' · ');
    text(v, tags, tx, py + 38 * s, 12, { color: INK.accent, shadow: false, maxWidth: r.x + r.w - pad - tx });
    let cx = tx;
    for (const ty of sp?.types ?? []) {
      const w = 58 * s;
      this.pill(cx, py + 50 * s, w, 18 * s, typeColor(ty), ty.toUpperCase());
      cx += w + 5 * s;
    }
    const tier = tierInfo(this.tierOf(e));
    this.pill(tx, py + 74 * s, 74 * s, 18 * s, tier.color, tier.name.toUpperCase());
    // The favourite heart, top right.
    const sr = this.starRect(r);
    const overStar = hit(this.ctx.input.mouseX, this.ctx.input.mouseY, sr.x, sr.y, sr.w, sr.h);
    button(v, '', sr.x, sr.y, sr.w, sr.h, overStar, CREAM);
    text(v, e.fav ? '♥' : '♡', sr.x + sr.w / 2, sr.y + sr.h / 2 + 4 * s - (overStar ? skinPx(v) : 0), 18, { align: 'center', color: e.fav ? '#e2574c' : INK.dim, shadow: false, weight: '900' });
    // Base stats.
    let y = py + ps + 34 * s;
    text(v, 'BASE STATS', r.x + pad, y, 11, { color: INK.dim, shadow: false });
    y += 8 * s;
    const stats = sp?.stats;
    const rows: Array<[string, number]> = stats ? [['HP', stats.hp], ['Atk', stats.atk], ['Def', stats.def], ['SpA', stats.spa], ['SpD', stats.spd], ['Spe', stats.spe]] : [];
    const colW = (r.w - pad * 2 - 12 * s) / 2;
    rows.forEach(([name, val], k) => {
      const cxx = r.x + pad + (k % 2) * (colW + 12 * s);
      const cyy = y + Math.floor(k / 2) * 18 * s;
      text(v, name, cxx, cyy + 11 * s, 10, { color: INK.text, shadow: false });
      text(v, String(val), cxx + 50 * s, cyy + 11 * s, 10, { align: 'right', color: INK.text, shadow: false, weight: '900' });
      const bx = cxx + 56 * s;
      const bw = colW - 56 * s;
      h.fillStyle = '#e0d0b4';
      h.fillRect(bx, cyy + 4 * s, bw, 7 * s);
      h.fillStyle = val >= 100 ? INK.good : val >= 70 ? '#c9a227' : '#d0703a';
      h.fillRect(bx, cyy + 4 * s, bw * Math.min(1, val / 160), 7 * s);
    });
    y += 3 * 18 * s + 18 * s;
    // Its line, where it came from, its moves.
    text(v, 'LINE', r.x + pad, y, 11, { color: INK.dim, shadow: false });
    text(v, this.lineText(e.dex), r.x + pad + 44 * s, y, 12, { color: INK.text, shadow: false, maxWidth: r.w - pad * 2 - 44 * s });
    y += 20 * s;
    text(v, 'FROM', r.x + pad, y, 11, { color: INK.dim, shadow: false });
    const when = (() => {
      const d = new Date(e.at);
      return Number.isFinite(d.getTime()) ? ` · ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : '';
    })();
    const traded = (e as PcEntry & { tradedFrom?: string }).tradedFrom;
    text(v, `${traded ? `Traded from ${traded}` : viaLabel(e.via)}${when}`, r.x + pad + 44 * s, y, 12, { color: INK.text, shadow: false, maxWidth: r.w - pad * 2 - 44 * s });
    y += 20 * s;
    if (e.moves?.length) {
      text(v, 'MOVES', r.x + pad, y, 11, { color: INK.dim, shadow: false });
      text(v, e.moves.map((m) => m.replace(/-/g, ' ')).join(' · '), r.x + pad + 44 * s, y, 11, { color: INK.text, shadow: false, maxWidth: r.w - pad * 2 - 44 * s });
    }
    this.drawNominate(r, e);
  }

  /** "Charmander → Charmeleon → Charizard" (branches: "Eevee → Vaporeon / Jolteon +6"). */
  private lineText(dex: string): string {
    const base = pcBase(dex);
    const names: string[] = [];
    let stage = [base];
    for (let i = 0; i < 4 && stage.length; i++) {
      const shown = stage.slice(0, 2).map((d) => SPECIES.get(d)?.name ?? d).join(' / ') + (stage.length > 2 ? ` +${stage.length - 2}` : '');
      names.push(shown);
      const next: string[] = [];
      for (const d of stage) for (const ev of SPECIES.get(d)?.evolves ?? []) if (SPECIES.has(ev.to) && !next.includes(ev.to) && !ev.to.includes('-mega')) next.push(ev.to);
      stage = next;
    }
    return names.join(' → ');
  }

  /** A small coloured label (types, tiers). */
  private pill(x: number, y: number, w: number, hgt: number, color: string, label: string): void {
    const v = this.ctx.view;
    const h = v.hud;
    h.fillStyle = color;
    h.beginPath();
    h.roundRect(x, y, w, hgt, hgt / 2);
    h.fill();
    h.strokeStyle = 'rgba(0,0,0,0.25)';
    h.lineWidth = Math.max(1, v.baseScale);
    h.stroke();
    text(v, label, x + w / 2, y + hgt / 2 + 1, 9, { align: 'center', baseline: 'middle', color: '#fff', shadowColor: 'rgba(0,0,0,0.55)', weight: '900', maxWidth: w - 6 * v.baseScale });
  }

  /** Nothing selected: the collection at a glance. */
  private drawSummary(r: Rect): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    const h = v.hud;
    const pad = 18 * s;
    if (!this.list.length) {
      text(v, 'Your box is empty', r.x + r.w / 2, r.y + r.h / 2, 15, { align: 'center', color: INK.dim, shadow: false });
      return;
    }
    text(v, 'COLLECTION', r.x + pad, r.y + 34 * s, 16, { color: INK.accent, shadow: false });
    const lines = new Set(this.list.map((e) => pcBase(e.dex).split('-')[0]));
    text(v, `${this.list.length} Pokémon · ${lines.size} species`, r.x + pad, r.y + 58 * s, 13, { color: INK.text, shadow: false });
    // By tier: a bar each.
    let y = r.y + 82 * s;
    const counts = TIER_ORDER.map((id) => ({ id, n: this.list.filter((e) => this.tierOf(e) === id).length }));
    const most = Math.max(1, ...counts.map((c) => c.n));
    for (const c of counts) {
      const t = tierInfo(c.id);
      text(v, t.name, r.x + pad, y + 12 * s, 12, { color: INK.text, shadow: false });
      const bx = r.x + pad + 76 * s;
      const bw = r.w - pad * 2 - 76 * s - 34 * s;
      h.fillStyle = '#e0d0b4';
      h.fillRect(bx, y + 3 * s, bw, 10 * s);
      h.fillStyle = t.color;
      h.fillRect(bx, y + 3 * s, (bw * c.n) / most, 10 * s);
      text(v, String(c.n), r.x + r.w - pad, y + 12 * s, 12, { align: 'right', color: INK.text, shadow: false, weight: '900' });
      y += 24 * s;
    }
    y += 10 * s;
    const shiny = this.list.filter((e) => e.shiny).length;
    const favs = this.list.filter((e) => e.fav).length;
    text(v, `★ ${shiny} shiny   ♥ ${favs} favourite${favs === 1 ? '' : 's'}`, r.x + pad, y + 10 * s, 12, { color: INK.text, shadow: false });
    y += 34 * s;
    const tips = this.starters ? ['Tap a Pokémon to see it, favourite it', 'or nominate it for your third starter slot.'] : ['Tap a Pokémon to see it', 'or favourite it.'];
    tips.forEach((t, k) => text(v, t, r.x + r.w / 2, y + 10 * s + k * 18 * s, 12, { align: 'center', color: INK.dim, shadow: false, maxWidth: r.w - pad * 2 }));
  }

  /** The side panel's third-slot part: the line it nominates, its tier and cost, and the button. */
  private drawNominate(r: Rect, e: PcEntry): void {
    const st = this.starters;
    if (!st) return;
    const v = this.ctx.view;
    const s = v.baseScale;
    const nd = this.nomOf(e);
    const b = this.nomRect(r);
    if (!nd) {
      text(v, 'Can not be nominated for the third slot', r.x + r.w / 2, b.y + 26 * s, 11, { align: 'center', color: INK.dim, shadow: false, maxWidth: r.w - 24 * s });
      return;
    }
    const info = st.eligible.find((x) => x.dex === nd);
    const on = st.nominations.includes(nd);
    const can = on || this.canAdd(nd);
    // What it would do to the odds.
    let line: string;
    if (on) {
      const k = st.nominations.indexOf(nd);
      line = `Nominated · ${((this.odds().spots[k]?.chance ?? 0) * 100).toFixed(0)}% in the third slot`;
    } else if (can) {
      const w = (t: string): number => st.weights[t] ?? 1;
      const next = [...st.nominations, nd];
      const total = next.reduce((n, d) => n + w(st.eligible.find((x) => x.dex === d)?.tier ?? 'common'), 0) + (st.slots - next.length) * w('common');
      line = `${SPECIES.get(nd)?.name ?? nd} · ${info?.cost ?? 1} pt · would be ${((w(info?.tier ?? 'common') / total) * 100).toFixed(0)}%`;
    } else line = st.nominations.length >= NOMINATION_SLOTS ? 'All five spots are taken' : `Would use ${nominationCost([...st.nominations, nd])} of ${st.budget} points`;
    text(v, this.note || line, r.x + r.w / 2, b.y - 10 * s, 11, { align: 'center', color: can ? INK.text : INK.bad, shadow: false, maxWidth: r.w - 24 * s });
    const over = hit(this.ctx.input.mouseX, this.ctx.input.mouseY, b.x, b.y, b.w, b.h);
    button(v, on ? 'Remove from third slot' : 'Nominate for third slot', b.x, b.y, b.w, b.h, over && can, can ? (on ? CREAM : undefined) : '#44405a');
  }

  /**
   * The Pokémon's own sprite, standing and facing out of the box. Every frame of its idle loop is
   * measured (the union of their opaque pixels), and that whole area is what gets fitted: every
   * Pokémon the same size, standing on one line near the bottom of the slot, centred across it.
   */
  private drawIcon(e: PcEntry, cx: number, cy: number, room: number): void {
    const h = this.ctx.view.hud;
    const a = this.anim(e);
    const f = a.current();
    if (f.placeholder) return;
    const box = this.idleBounds(e, f);
    if (!box) return;
    const bw = box.x1 - box.x0;
    const bh = box.y1 - box.y0;
    // Size classes XS to XXL by the idle animation's size; every Pokémon in a class is fitted to
    // that class's size (62% to 115% of the room): six clear sizes.
    const size = Math.max(bw, bh, 1);
    const cls = PC_SIZE_CLASSES.find((c) => size <= c.upTo) ?? (PC_SIZE_CLASSES[PC_SIZE_CLASSES.length - 1] as (typeof PC_SIZE_CLASSES)[number]);
    const k = (room * cls.fill) / size;
    const dx = Math.round(cx - ((box.x0 + box.x1) / 2) * k);
    // Centred in the slot by its resting frame (the first one), so a Pokémon that bobs
    // (Gengar) sits where it rests.
    const dy = Math.round(cy - ((box.restTop + box.rest) / 2) * k);
    h.save();
    h.imageSmoothingEnabled = false;
    if (e.shadow) {
      h.shadowColor = 'rgba(150,60,255,0.9)';
      h.shadowBlur = 8 * this.ctx.view.baseScale;
    }
    h.drawImage(f.image, f.sx, f.sy, f.w, f.h, dx, dy, f.w * k, f.h * k);
    h.restore();
  }

  /** Per species: the opaque area of all its front-facing idle frames, in frame pixels. */
  private static bounds = new Map<string, { x0: number; y0: number; x1: number; y1: number; rest: number; restTop: number } | null>();

  /** The union of every idle frame (for size), and `rest`: the first frame's bottom row (for the line). */
  private idleBounds(e: PcEntry, f: FrameRect): { x0: number; y0: number; x1: number; y1: number; rest: number; restTop: number } | null {
    const key = `${e.dex}:${f.w}x${f.h}`;
    const known = PcScreen.bounds.get(key);
    if (known !== undefined) return known;
    const img = f.image as HTMLImageElement | HTMLCanvasElement;
    const sheetW = 'naturalWidth' in img ? img.naturalWidth : img.width;
    const frames = Math.max(1, Math.floor(sheetW / f.w));
    const c = document.createElement('canvas');
    c.width = frames * f.w;
    c.height = f.h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    // Row 0 of the sheet is the facing-down (towards you) direction, the one the box shows.
    g.drawImage(img, 0, f.sy, frames * f.w, f.h, 0, 0, frames * f.w, f.h);
    let px: Uint8ClampedArray;
    try {
      px = g.getImageData(0, 0, c.width, c.height).data;
    } catch {
      return null;
    }
    let x0 = f.w, y0 = f.h, x1 = 0, y1 = 0, rest = 0, restTop = f.h;
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < c.width; x++) {
        if ((px[(y * c.width + x) * 4 + 3] ?? 0) < 24) continue;
        const fx = x % f.w;
        if (x < f.w) {
          if (y + 1 > rest) rest = y + 1;
          if (y < restTop) restTop = y;
        }
        if (fx < x0) x0 = fx;
        if (fx + 1 > x1) x1 = fx + 1;
        if (y < y0) y0 = y;
        if (y + 1 > y1) y1 = y + 1;
      }
    }
    const r = x1 > x0 && y1 > y0 ? { x0, y0, x1, y1, rest: rest || y1, restTop: rest ? restTop : y0 } : null;
    if (r) PcScreen.bounds.set(key, r);
    return r;
  }

  /** The box: the skin's blue frame, with Gen 5's soft diagonal bands across its field. */
  private drawWallpaper(r: Rect): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    const h = v.hud;
    const k = skinPx(v);
    if (!skinPiece(v, 'blue', r.x, r.y, r.w, r.h, k)) {
      h.fillStyle = '#3a8aa6';
      h.fillRect(r.x, r.y, r.w, r.h);
    }
    h.save();
    h.beginPath();
    h.rect(r.x + 3 * k, r.y + 3 * k, r.w - 6 * k, r.h - 6 * k);
    h.clip();
    h.strokeStyle = 'rgba(255,255,255,0.08)';
    h.lineWidth = 14 * s;
    for (let i = -r.h; i < r.w + r.h; i += 46 * s) {
      h.beginPath();
      h.moveTo(r.x + i, r.y);
      h.lineTo(r.x + i - r.h, r.y + r.h);
      h.stroke();
    }
    h.restore();
  }
}
