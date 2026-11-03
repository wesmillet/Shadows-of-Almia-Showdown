/**
 * The match's controls on a touch screen (phones and tablets), laid out for two thumbs.
 *
 * Left thumb: a floating stick anywhere on the open field (drawn by the match), and a compact party
 * strip along the left edge: tap a portrait for its actions (send out, recall, control...).
 * Right thumb: two large move buttons and a smaller dodge button; a ball button above them. A tap
 * on a move uses it on the selected target (or the way you face); dragging from the button aims,
 * and letting go uses it there. The ball works the same way, and a long press picks the ball type.
 * One Interact button shows when something usable is in reach. Bag and Menu sit under the
 * minimap. A knocked-out Pokémon in a trainer battle brings up large cards to pick the next one.
 *
 * This file only draws and reports: the match turns the reported actions into the same calls the
 * keyboard and mouse make, so the rules are the same whichever way a player plays.
 */
import { Input } from '../core/input';

interface Frame {
  image: CanvasImageSource;
  sx: number;
  sy: number;
  w: number;
  h: number;
}

export interface TouchMon {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  fainted: boolean;
  /** Out on the field (not in its ball). */
  out: boolean;
  lead: boolean;
  controlled: boolean;
  /** Roaming the island on its own (no orders). */
  roaming: boolean;
  /** Attack, Catch or Passive. */
  mode: string;
  portrait: Frame | null;
  canMega: boolean;
  /** It can carry the trainer (and is the one Ride uses), or carries them now. */
  ride: 'ride' | 'riding' | null;
  held: string | null;
}

export interface TouchMove {
  name: string;
  color: string;
  /** 0 ready .. 1 just used. */
  cd: number;
  ready: boolean;
}

export interface TouchBagEntry {
  index: number;
  name: string;
  count: number;
  icon: string | null;
  desc: string;
  /** What a tap on it can do. */
  use: 'self' | 'target' | 'ball' | 'teach' | 'give' | 'none';
}

export interface TouchFrame {
  /** A shop, chest or numbered prompt is open: only Close shows (the prompt itself is tapped). */
  prompt: boolean;
  battle: boolean;
  steering: boolean;
  /** Someone able is waiting in a ball (so a Pokémon out can be recalled for them). */
  bench: boolean;
  party: TouchMon[];
  moves: [TouchMove | null, TouchMove | null];
  dodge: { usable: boolean; cd: number };
  ball: { name: string; count: number; kinds: Array<{ slot: number; name: string; count: number; armed: boolean }> } | null;
  interact: string | null;
  auto: boolean | null;
  styler: boolean;
  /** Pick the next Pokémon for a trainer battle (seconds left), or null. */
  pick: number | null;
  bag: { items: TouchBagEntry[]; held: TouchBagEntry[] };
  /** The minimap's box in CSS pixels (Menu sits left of it, Bag under it), or null. */
  minimap: { left: number; top: number; bottom: number } | null;
}

/** A drag from a move or ball button: which way (unit vector) and how far (0..1 of full reach). */
export interface TouchAim {
  kind: 'move' | 'ball';
  slot: number;
  dx: number;
  dy: number;
  mag: number;
}

export type PartyAct = 'out' | 'recall' | 'control' | 'stop' | 'mode' | 'mega' | 'ride' | 'unequip' | 'release';

export type TouchAction =
  | { t: 'cast'; slot: number; aim: TouchAim | null }
  | { t: 'throw'; aim: TouchAim | null }
  | { t: 'ballType'; slot: number }
  | { t: 'dodge' }
  | { t: 'interact' }
  | { t: 'auto' }
  | { t: 'party'; index: number; act: PartyAct }
  | { t: 'pick'; index: number }
  | { t: 'item'; tab: 'items' | 'held'; index: number; target: number | null }
  | { t: 'drop'; tab: 'items' | 'held'; index: number };

const CSS = `
.almia-touch { position: fixed; z-index: 20; pointer-events: none; user-select: none; -webkit-user-select: none;
  top: env(safe-area-inset-top); right: env(safe-area-inset-right); bottom: env(safe-area-inset-bottom); left: env(safe-area-inset-left);
  font: 600 12px/1.15 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; }
.almia-touch * { box-sizing: border-box; }
.almia-touch button { pointer-events: auto; touch-action: none; -webkit-tap-highlight-color: transparent; font: inherit; color: #fff;
  border: 2px solid rgba(255,255,255,0.85); background: rgba(30,20,12,0.62); text-shadow: 0 1px 2px #000; padding: 0; margin: 0; }
.almia-touch button:disabled { opacity: 0.45; }
.almia-touch .on { filter: brightness(1.35); }
.almia-touch .pill { position: absolute; height: 32px; padding: 0 12px; border-radius: 16px; font-size: 12px; }
.almia-touch .round { position: absolute; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; overflow: hidden; }
.almia-touch .move { width: 78px; height: 78px; font-size: 12px; padding: 4px; }
.almia-touch .move .nm { position: relative; z-index: 1; max-width: 70px; overflow-wrap: anywhere; }
.almia-touch .move .cd { position: absolute; inset: 0; border-radius: 50%; pointer-events: none; }
.almia-touch .move.empty { opacity: 0.35; }
.almia-touch .dodge { width: 50px; height: 50px; font-size: 11px; }
.almia-touch .ball { width: 58px; height: 58px; font-size: 11px; background: rgba(200,40,40,0.7); }
.almia-touch .ball small, .almia-touch .move small { display: block; font-size: 10px; opacity: 0.9; position: relative; z-index: 1; }
.almia-touch .styler { width: 50px; height: 50px; font-size: 10px; background: rgba(40,110,170,0.7); }
.almia-touch .interact { position: absolute; height: 40px; max-width: 46vw; padding: 0 14px; border-radius: 20px; font-size: 13px;
  background: rgba(244,160,40,0.85); border-color: #fff3d6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.almia-touch .party { position: absolute; left: 6px; bottom: 8px; display: flex; flex-direction: column; gap: 4px; }
.almia-touch .pm { position: relative; width: var(--pm, 38px); height: var(--pm, 38px); border-radius: 8px; padding: 0; background: rgba(30,20,12,0.7); }
.almia-touch .pm canvas { position: absolute; left: 3px; top: 2px; width: calc(var(--pm, 38px) - 10px); height: calc(var(--pm, 38px) - 10px); margin-left: 2px; image-rendering: pixelated; }
.almia-touch .pm .hp { position: absolute; left: 3px; right: 3px; bottom: 3px; height: 4px; background: rgba(0,0,0,0.6); border-radius: 2px; overflow: hidden; }
.almia-touch .pm .hp i { display: block; height: 100%; background: #4cd964; }
.almia-touch .pm.out { border-color: #ffd66e; }
.almia-touch .pm.sel { box-shadow: 0 0 0 3px #f4a028; }
.almia-touch .pm.fainted canvas { filter: grayscale(1) brightness(0.6); }
.almia-touch .pm .tag { position: absolute; right: -4px; top: -6px; font-size: 9px; padding: 1px 4px; border-radius: 6px; background: #1f6aa0; border: 1px solid #fff; }
.almia-touch .sheet, .almia-touch .panel { pointer-events: auto; position: absolute; background: rgba(28,20,14,0.94); border: 2px solid #f4e6c8;
  border-radius: 12px; padding: 10px; color: #f4e6c8; }
.almia-touch .sheet { left: calc(var(--pm, 38px) + 16px); width: 210px; display: flex; flex-direction: column; gap: 6px; }
.almia-touch .sheet .ttl { font-size: 13px; color: #fff; }
.almia-touch .sheet .sub { font-size: 11px; opacity: 0.85; margin-bottom: 2px; }
.almia-touch .sheet button, .almia-touch .panel button.act { position: static; height: 36px; border-radius: 9px; font-size: 13px; text-align: left; padding: 0 12px; }
.almia-touch .sheet button.warn { border-color: #ff8a7a; }
.almia-touch .panel { left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(560px, calc(100% - 140px)); max-height: calc(100% - 16px);
  display: flex; flex-direction: column; gap: 8px; }
.almia-touch .panel .row { display: flex; gap: 6px; align-items: center; }
.almia-touch .panel .tabs button { position: static; height: 32px; padding: 0 14px; border-radius: 9px; }
.almia-touch .panel .tabs button.cur { background: rgba(244,160,40,0.85); }
.almia-touch .panel .close { margin-left: auto; position: static; height: 32px; padding: 0 14px; border-radius: 9px; }
.almia-touch .panel .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 6px; overflow-y: auto; min-height: 0; }
.almia-touch .panel .slot { position: static; height: 46px; border-radius: 9px; display: flex; align-items: center; gap: 6px; padding: 0 8px; text-align: left; font-size: 12px; }
.almia-touch .panel .slot img { width: 26px; height: 26px; image-rendering: pixelated; flex: none; }
.almia-touch .panel .slot.cur { background: rgba(244,160,40,0.55); }
.almia-touch .panel .detail { display: flex; flex-direction: column; gap: 6px; }
.almia-touch .panel .detail .acts { display: flex; flex-wrap: wrap; gap: 6px; }
.almia-touch .panel .empty { opacity: 0.7; padding: 8px 0; }
.almia-touch .pick { pointer-events: auto; position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 6px;
  background: rgba(28,20,14,0.9); border: 2px solid #f4e6c8; border-radius: 14px; padding: 8px 10px; }
.almia-touch .pick .ttl { font-size: 14px; color: #fff; }
.almia-touch .pick .cards { display: flex; gap: 8px; }
.almia-touch .pick button { position: static; width: 92px; height: 104px; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; font-size: 12px; }
.almia-touch .pick canvas { width: 52px; height: 52px; image-rendering: pixelated; }
.almia-touch .pick .hp { width: 70px; height: 5px; background: rgba(0,0,0,0.6); border-radius: 3px; overflow: hidden; }
.almia-touch .pick .hp i { display: block; height: 100%; background: #4cd964; }
.almia-touch .balls { pointer-events: auto; position: absolute; display: flex; flex-direction: column; gap: 5px; background: rgba(28,20,14,0.94);
  border: 2px solid #f4e6c8; border-radius: 12px; padding: 8px; }
.almia-touch .balls button { position: static; height: 36px; border-radius: 9px; padding: 0 12px; text-align: left; font-size: 13px; }
.almia-touch .balls button.cur { background: rgba(244,160,40,0.85); }
.almia-rotate { position: fixed; inset: 0; z-index: 100; display: none; align-items: center; justify-content: center; flex-direction: column;
  background: #0b0a12; color: #f4e6c8; font: 600 18px/1.4 system-ui, sans-serif; text-align: center; padding: 24px; }
.almia-rotate .phone { width: 40px; height: 66px; border: 3px solid #f4e6c8; border-radius: 8px; margin-bottom: 18px; animation: almia-turn 1.8s ease-in-out infinite; }
@keyframes almia-turn { 0%, 30% { transform: rotate(0deg); } 60%, 100% { transform: rotate(-90deg); } }
`;

/** How far (CSS px) a drag from a button reaches full range; under DEAD it is a tap. */
const REACH = 72;
const DEAD = 14;
const LONG_PRESS = 450;

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** A button that reports a tap, or a drag (aim) and its release, with pointer capture. */
function dragButton(
  el: HTMLElement,
  on: { down?: () => void; aim?: (a: { dx: number; dy: number; mag: number } | null) => void; up: (a: { dx: number; dy: number; mag: number } | null, cancelled: boolean) => void; long?: () => void },
): void {
  let id: number | null = null;
  let x0 = 0;
  let y0 = 0;
  let dragged = false;
  let longTimer: number | null = null;
  let longFired = false;
  const vec = (e: PointerEvent): { dx: number; dy: number; mag: number } | null => {
    const dx = e.clientX - x0;
    const dy = e.clientY - y0;
    const d = Math.hypot(dx, dy);
    if (d < DEAD) return null;
    return { dx: dx / d, dy: dy / d, mag: Math.min(1, d / REACH) };
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (id !== null) return;
    id = e.pointerId;
    el.setPointerCapture?.(e.pointerId);
    const r = el.getBoundingClientRect();
    x0 = r.left + r.width / 2;
    y0 = r.top + r.height / 2;
    dragged = false;
    longFired = false;
    el.classList.add('on');
    on.down?.();
    if (on.long) {
      longTimer = window.setTimeout(() => {
        longTimer = null;
        if (!dragged) {
          longFired = true;
          on.long?.();
        }
      }, LONG_PRESS);
    }
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const a = vec(e);
    if (a) dragged = true;
    if (dragged) on.aim?.(a);
  });
  const end = (e: PointerEvent, cancelled: boolean): void => {
    if (e.pointerId !== id) return;
    id = null;
    el.classList.remove('on');
    if (longTimer !== null) clearTimeout(longTimer);
    longTimer = null;
    on.aim?.(null);
    if (longFired) return;
    // Dragged out and back to the middle: a tap again (the same as never having dragged).
    on.up(dragged ? vec(e) : null, cancelled);
  };
  el.addEventListener('pointerup', (e) => end(e, false));
  el.addEventListener('pointercancel', (e) => end(e, true));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

/** A plain tap button (fires on release over it). */
function tapButton(el: HTMLElement, fn: () => void): void {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    fn();
  });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function drawFrame(c: HTMLCanvasElement, f: Frame | null): void {
  const g = c.getContext('2d');
  if (!g) return;
  if (c.width !== 40) c.width = c.height = 40;
  g.clearRect(0, 0, 40, 40);
  if (!f) return;
  g.imageSmoothingEnabled = false;
  try {
    g.drawImage(f.image, f.sx, f.sy, f.w, f.h, 0, 0, 40, 40);
  } catch {
    /* not loaded yet */
  }
}

export class TouchUi {
  private root: HTMLDivElement;
  private rotate: HTMLDivElement;
  private actions: TouchAction[] = [];
  /** What Menu opens when no prompt is up (unset: it reads as Esc). */
  onMenu: (() => void) | null = null;
  /** The drag in progress from a move or ball button (the match draws where it goes). */
  aim: TouchAim | null = null;
  private frame: TouchFrame | null = null;
  // Right thumb.
  private moveEls: HTMLButtonElement[] = [];
  private dodgeEl: HTMLButtonElement;
  private ballEl: HTMLButtonElement;
  private stylerEl: HTMLButtonElement;
  private interactEl: HTMLButtonElement;
  // Top right.
  private menuEl: HTMLButtonElement;
  private bagEl: HTMLButtonElement;
  // Party.
  private partyEl: HTMLDivElement;
  private partySig = '';
  private partyCanvases: HTMLCanvasElement[] = [];
  private partyHp: HTMLElement[] = [];
  private selected = -1;
  private sheetEl: HTMLDivElement | null = null;
  private sheetSig = '';
  private releaseArmed = -1;
  // Bag.
  private bagPanel: HTMLDivElement | null = null;
  private bagTab: 'items' | 'held' = 'items';
  private bagPick: number | null = null;
  private bagSig = '';
  // Ball types (long press on the ball).
  private ballsEl: HTMLDivElement | null = null;
  // Picking the next Pokémon in a battle.
  private pickEl: HTMLDivElement | null = null;
  private pickSig = '';
  private pickCanvases: HTMLCanvasElement[] = [];

  constructor(private readonly input: Input) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.root = h('div', 'almia-touch');
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
    // Nothing under the controls reaches the game: a stray touch between buttons is not a field tap.
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target !== this.root) e.stopPropagation();
    });

    for (let slot = 0; slot < 2; slot++) {
      const b = h('button', 'round move');
      b.append(h('span', 'cd'), h('span', 'nm'));
      dragButton(b, {
        aim: (a) => (this.aim = a ? { kind: 'move', slot, ...a } : null),
        up: (a, cancelled) => {
          if (!cancelled) this.actions.push({ t: 'cast', slot, aim: a ? { kind: 'move', slot, ...a } : null });
        },
      });
      this.moveEls.push(b);
      this.root.appendChild(b);
    }
    // Move 1 nearest the thumb's resting place, move 2 up and to its left.
    Object.assign(this.moveEls[0]!.style, { right: '14px', bottom: '14px' });
    Object.assign(this.moveEls[1]!.style, { right: '100px', bottom: '34px' });
    this.dodgeEl = h('button', 'round dodge', 'Dodge');
    Object.assign(this.dodgeEl.style, { right: '186px', bottom: '16px' });
    tapButton(this.dodgeEl, () => this.actions.push({ t: 'dodge' }));
    this.root.appendChild(this.dodgeEl);
    this.ballEl = h('button', 'round ball');
    Object.assign(this.ballEl.style, { right: '24px', bottom: '104px' });
    dragButton(this.ballEl, {
      aim: (a) => (this.aim = a ? { kind: 'ball', slot: 0, ...a } : null),
      up: (a, cancelled) => {
        if (!cancelled) this.actions.push({ t: 'throw', aim: a ? { kind: 'ball', slot: 0, ...a } : null });
      },
      long: () => this.openBalls(),
    });
    this.root.appendChild(this.ballEl);
    this.stylerEl = h('button', 'round styler', 'Styler');
    Object.assign(this.stylerEl.style, { right: '92px', bottom: '118px' });
    this.stylerEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.stylerEl.setPointerCapture?.(e.pointerId);
      this.input.virtualDown('KeyC');
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) this.stylerEl.addEventListener(ev, () => this.input.virtualUp('KeyC'));
    this.root.appendChild(this.stylerEl);
    this.interactEl = h('button', 'interact');
    Object.assign(this.interactEl.style, { right: '96px', bottom: '124px' });
    tapButton(this.interactEl, () => this.actions.push({ t: 'interact' }));
    this.root.appendChild(this.interactEl);

    // By the minimap: Menu (settings and controls) and Bag. Auto battle is keyboard only (not on touch).
    this.menuEl = h('button', 'pill', 'Menu');
    this.bagEl = h('button', 'pill', 'Bag');
    // Placed each frame against the minimap (placeTop); these are the fallbacks.
    Object.assign(this.menuEl.style, { right: '8px', top: '8px' });
    Object.assign(this.bagEl.style, { right: '8px', top: 'calc(33% + 6px)' });
    tapButton(this.menuEl, () => {
      this.closeAll();
      // A prompt open: Close is Esc. Otherwise the game's own menu (Esc, or the hook it set).
      if (this.frame?.prompt || !this.onMenu) this.input.virtualTap('Escape');
      else this.onMenu();
    });
    tapButton(this.bagEl, () => (this.bagPanel ? this.closeBag() : this.openBag()));
    this.root.append(this.menuEl, this.bagEl);

    this.partyEl = h('div', 'party');
    this.root.appendChild(this.partyEl);

    // A touch anywhere else closes a party member's actions and the ball list.
    window.addEventListener('pointerdown', (e) => {
      const t = e.target as Node | null;
      if (this.ballsEl && !(t && this.ballsEl.contains(t))) {
        this.ballsEl.remove();
        this.ballsEl = null;
      }
      if (this.sheetEl && !(t && (this.sheetEl.contains(t) || this.partyEl.contains(t)))) {
        this.selected = -1;
        this.releaseArmed = -1;
        this.sheetSig = '';
        this.partySig = '';
      }
    }, true);

    this.rotate = h('div', 'almia-rotate');
    this.rotate.append(h('div', 'phone'), document.createTextNode('Turn your phone sideways to play'));
    document.body.appendChild(this.rotate);
  }

  /** What the player asked for since the last call (the match acts on them in its step). */
  takeActions(): TouchAction[] {
    const a = this.actions;
    this.actions = [];
    return a;
  }

  /** Selects a party member (a tap on it out on the field does the same as a tap on its portrait). */
  select(index: number): void {
    this.selected = this.selected === index ? -1 : index;
    this.releaseArmed = -1;
    this.sheetSig = '';
  }

  private closeAll(): void {
    this.selected = -1;
    this.sheetSig = '';
    this.closeBag();
    this.ballsEl?.remove();
    this.ballsEl = null;
  }

  /** Hidden (a dialog is open, the match is over, someone else is playing...). */
  hide(): void {
    if (this.root.style.display !== 'none') {
      this.root.style.display = 'none';
      this.input.virtualUp('KeyC');
      this.aim = null;
      this.closeAll();
    }
  }

  /** Called every frame the match is on screen and the player can act. */
  update(f: TouchFrame): void {
    this.frame = f;
    const visible = Input.touch && !document.querySelector('.almia-modal-wrap');
    if (!visible) return this.hide();
    this.root.style.display = '';
    const play = !f.prompt;
    const show = (el: HTMLElement, on: boolean): void => {
      el.style.display = on ? '' : 'none';
    };
    // Moves: the name in its type colour, the cooldown as a shade that unwinds.
    f.moves.forEach((mv, i) => {
      const b = this.moveEls[i]!;
      show(b, play && f.pick === null);
      const nm = b.querySelector('.nm') as HTMLElement;
      const cd = b.querySelector('.cd') as HTMLElement;
      if (!mv) {
        b.classList.add('empty');
        b.style.background = '';
        nm.textContent = '-';
        cd.style.background = '';
        return;
      }
      b.classList.remove('empty');
      if (nm.textContent !== mv.name) nm.textContent = mv.name;
      b.style.background = mv.color;
      cd.style.background = mv.cd > 0 ? `conic-gradient(rgba(0,0,0,0.55) ${Math.round(mv.cd * 360)}deg, transparent 0)` : mv.ready ? '' : 'rgba(0,0,0,0.45)';
    });
    show(this.dodgeEl, play && f.pick === null);
    this.dodgeEl.disabled = !f.dodge.usable;
    this.dodgeEl.textContent = f.dodge.usable && f.dodge.cd > 0 ? `${f.dodge.cd.toFixed(1)}s` : 'Dodge';
    show(this.ballEl, play && !!f.ball && f.pick === null);
    if (f.ball) {
      const html = `Ball<small>${f.ball.count}</small>`;
      if (this.ballEl.innerHTML !== html) this.ballEl.innerHTML = html;
    }
    show(this.stylerEl, play && f.styler && !f.battle);
    show(this.interactEl, play && !!f.interact);
    if (f.interact && this.interactEl.textContent !== f.interact) this.interactEl.textContent = f.interact;
    this.menuEl.textContent = f.prompt ? 'Close' : 'Menu';
    show(this.bagEl, play);
    show(this.partyEl, play);
    this.placeTop(f);
    this.drawParty(f);
    this.drawSheet(f);
    this.drawPick(f);
    if (this.bagPanel) {
      if (!play) this.closeBag();
      else this.drawBag(f);
    }
    if (this.ballsEl && (!play || !f.ball)) {
      this.ballsEl.remove();
      this.ballsEl = null;
    }
  }

  // ------------------------------------------------------------------ layout

  /** Menu just left of the minimap, level with its top; Bag under the minimap, right-aligned. */
  private placeTop(f: TouchFrame): void {
    const mm = f.minimap;
    if (!mm) return;
    const w = this.root.clientWidth;
    const px = (n: number): string => `${Math.round(n)}px`;
    Object.assign(this.menuEl.style, { right: px(w - mm.left + 8), top: px(mm.top) });
    const below = px(mm.bottom + 6);
    Object.assign(this.bagEl.style, { right: '8px', top: below });
    // A short screen (a small phone, or browser bars showing) brings the right thumb's buttons up to
    // the Bag: then the Bag sits just under Menu, left of the minimap.
    const bag = this.bagEl.getBoundingClientRect();
    const clash = [this.ballEl, this.stylerEl, this.interactEl, ...this.moveEls].some((el) => {
      if (!el || el.style.display === 'none') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.left < bag.right + 6 && r.right > bag.left - 6 && r.top < bag.bottom + 6 && r.bottom > bag.top - 6;
    });
    if (clash) Object.assign(this.bagEl.style, { right: px(w - mm.left + 8), top: px(mm.top + (this.menuEl.offsetHeight || 32) + 6) });
    // The party strip: portraits sized so a full team of six fits under the trainers-left card.
    const n = Math.max(1, f.party.length);
    const room = this.root.clientHeight - 64;
    const size = Math.max(28, Math.min(38, Math.floor((room - 4 * (n - 1)) / n)));
    this.root.style.setProperty('--pm', `${size}px`);
  }

  // ------------------------------------------------------------------ party strip

  private drawParty(f: TouchFrame): void {
    const sig = f.party.map((m) => `${m.name}|${m.out}|${m.fainted}|${m.controlled}|${m.lead}`).join(';') + `|${this.selected}`;
    if (sig !== this.partySig) {
      this.partySig = sig;
      this.partyEl.replaceChildren();
      this.partyCanvases = [];
      this.partyHp = [];
      f.party.forEach((m, i) => {
        const b = h('button', `pm${m.out ? ' out' : ''}${m.fainted ? ' fainted' : ''}${this.selected === i ? ' sel' : ''}`);
        const c = h('canvas');
        const hp = h('div', 'hp');
        const bar = h('i');
        hp.appendChild(bar);
        b.append(c, hp);
        if (m.controlled) b.appendChild(h('span', 'tag', 'You'));
        else if (m.lead && m.out) b.appendChild(h('span', 'tag', 'Lead'));
        tapButton(b, () => {
          this.closeBag();
          this.select(i);
          this.partySig = '';
        });
        this.partyCanvases.push(c);
        this.partyHp.push(bar);
        this.partyEl.appendChild(b);
      });
    }
    f.party.forEach((m, i) => {
      const c = this.partyCanvases[i];
      if (c) drawFrame(c, m.portrait);
      const bar = this.partyHp[i];
      if (bar) {
        const frac = m.maxHp > 0 ? Math.max(0, m.hp / m.maxHp) : 0;
        bar.style.width = `${Math.round(frac * 100)}%`;
        bar.style.background = frac > 0.5 ? '#4cd964' : frac > 0.2 ? '#ffcc00' : '#ff3b30';
      }
    });
    if (this.selected >= f.party.length) this.selected = -1;
  }

  private drawSheet(f: TouchFrame): void {
    const m = this.selected >= 0 && !f.prompt ? f.party[this.selected] : undefined;
    if (!m) {
      this.sheetEl?.remove();
      this.sheetEl = null;
      this.sheetSig = '';
      return;
    }
    const i = this.selected;
    const sig = JSON.stringify([i, m.name, m.level, m.out, m.fainted, m.controlled, m.mode, m.canMega, m.ride, m.held, m.roaming, f.battle, this.releaseArmed, Math.ceil(m.hp)]);
    if (sig === this.sheetSig && this.sheetEl) return;
    this.sheetSig = sig;
    this.sheetEl?.remove();
    const s = h('div', 'sheet');
    s.appendChild(h('div', 'ttl', `${m.name}  Lv ${m.level}`));
    s.appendChild(h('div', 'sub', `${m.fainted ? 'Fainted' : `HP ${Math.ceil(m.hp)}/${m.maxHp}`} · ${m.roaming ? 'Roaming' : m.out ? 'Out' : 'In its ball'}`));
    const act = (label: string, a: PartyAct, cls = ''): void => {
      const b = h('button', cls, label);
      tapButton(b, () => {
        if (a === 'release' && this.releaseArmed !== i) {
          this.releaseArmed = i;
          this.sheetSig = '';
          return;
        }
        this.actions.push({ t: 'party', index: i, act: a });
        if (a !== 'mode') this.selected = -1;
        this.releaseArmed = -1;
        this.sheetSig = '';
        this.partySig = '';
      });
      s.appendChild(b);
    };
    if (f.battle) s.appendChild(h('div', 'sub', 'Party changes wait until the battle is over.'));
    else if (!m.fainted && !m.roaming) {
      if (!m.out && m.ride !== 'riding') act('Send out', 'out');
      if (m.out && f.bench) act('Recall', 'recall');
      if (m.out && !m.controlled) act(`Control ${m.name}`, 'control');
      if (m.controlled) act('Stop controlling', 'stop');
      act(`Mode: ${m.mode} (change)`, 'mode');
      if (m.canMega) act('Mega Evolve', 'mega');
      if (m.ride === 'ride') act(`Ride ${m.name}`, 'ride');
      if (m.ride === 'riding') act('Get off', 'ride');
    }
    if (!f.battle && m.held) act(`Take back ${m.held}`, 'unequip');
    if (!f.battle) act(this.releaseArmed === i ? `Tap again to release ${m.name}` : 'Release', 'release', 'warn');
    // Beside its portrait, kept on screen.
    const pe = this.partyEl.children[i] as HTMLElement | undefined;
    this.root.appendChild(s);
    const rr = this.root.getBoundingClientRect();
    const top = pe ? pe.getBoundingClientRect().top - rr.top : 8;
    s.style.top = `${Math.max(8, Math.min(top, rr.height - s.offsetHeight - 8))}px`;
    this.sheetEl = s;
  }

  // ------------------------------------------------------------------ replacement pick

  private drawPick(f: TouchFrame): void {
    if (f.pick === null) {
      this.pickEl?.remove();
      this.pickEl = null;
      this.pickSig = '';
      return;
    }
    const sig = f.party.map((m) => `${m.name}|${m.fainted}|${m.out}`).join(';');
    if (sig !== this.pickSig || !this.pickEl) {
      this.pickSig = sig;
      this.pickEl?.remove();
      this.selected = -1;
      const p = h('div', 'pick');
      p.appendChild(h('div', 'ttl'));
      const cards = h('div', 'cards');
      this.pickCanvases = [];
      f.party.forEach((m, i) => {
        if (m.fainted || m.roaming) return;
        const b = h('button');
        const c = h('canvas');
        const hp = h('div', 'hp');
        const bar = h('i');
        bar.style.width = `${Math.round((m.maxHp > 0 ? m.hp / m.maxHp : 0) * 100)}%`;
        hp.appendChild(bar);
        b.append(c, h('span', '', m.name), hp);
        tapButton(b, () => this.actions.push({ t: 'pick', index: i }));
        cards.appendChild(b);
        this.pickCanvases.push(c);
        drawFrame(c, m.portrait);
      });
      p.appendChild(cards);
      this.root.appendChild(p);
      this.pickEl = p;
    }
    const ttl = this.pickEl.querySelector('.ttl') as HTMLElement;
    const text = `Choose your next Pokémon · ${Math.max(0, Math.ceil(f.pick))}s`;
    if (ttl.textContent !== text) ttl.textContent = text;
  }

  // ------------------------------------------------------------------ ball types

  private openBalls(): void {
    const f = this.frame;
    if (!f?.ball || f.ball.kinds.length === 0) return;
    this.ballsEl?.remove();
    const el = h('div', 'balls');
    el.appendChild(h('div', '', 'Throw which ball?'));
    for (const k of f.ball.kinds) {
      const b = h('button', k.armed ? 'cur' : '', `${k.name} ×${k.count}`);
      tapButton(b, () => {
        this.actions.push({ t: 'ballType', slot: k.slot });
        el.remove();
        this.ballsEl = null;
      });
      el.appendChild(b);
    }
    Object.assign(el.style, { right: '90px', bottom: '100px' });
    this.root.appendChild(el);
    this.ballsEl = el;
  }

  // ------------------------------------------------------------------ bag

  private openBag(): void {
    this.selected = -1;
    this.bagPick = null;
    this.bagSig = '';
    this.bagPanel = h('div', 'panel');
    this.root.appendChild(this.bagPanel);
    if (this.frame) this.drawBag(this.frame);
  }

  private closeBag(): void {
    this.bagPanel?.remove();
    this.bagPanel = null;
    this.bagPick = null;
  }

  private drawBag(f: TouchFrame): void {
    const panel = this.bagPanel;
    if (!panel) return;
    const list = this.bagTab === 'items' ? f.bag.items : f.bag.held;
    const sig = JSON.stringify([this.bagTab, this.bagPick, list.map((e) => [e.index, e.name, e.count]), f.party.map((m) => [m.name, m.fainted]), f.battle]);
    if (sig === this.bagSig) return;
    this.bagSig = sig;
    panel.replaceChildren();
    const head = h('div', 'row tabs');
    for (const [tab, label] of [['items', 'Bag'], ['held', 'Held items & TMs']] as const) {
      const b = h('button', this.bagTab === tab ? 'cur' : '', label);
      tapButton(b, () => {
        this.bagTab = tab;
        this.bagPick = null;
        this.bagSig = '';
      });
      head.appendChild(b);
    }
    const close = h('button', 'close', 'Close');
    tapButton(close, () => this.closeBag());
    head.appendChild(close);
    panel.appendChild(head);
    const picked = this.bagPick === null ? undefined : list.find((e) => e.index === this.bagPick);
    if (picked) {
      // One item: what it is, and what it can do.
      const d = h('div', 'detail');
      d.appendChild(h('div', 'ttl', `${picked.name}${picked.count > 1 ? ` ×${picked.count}` : ''}`));
      if (picked.desc) d.appendChild(h('div', 'sub', picked.desc));
      const acts = h('div', 'acts');
      const btn = (label: string, fn: () => void): void => {
        const b = h('button', 'act', label);
        tapButton(b, fn);
        acts.appendChild(b);
      };
      const done = (a: TouchAction): void => {
        this.actions.push(a);
        this.closeBag();
      };
      const tab = this.bagTab;
      const onEach = (verb: string): void => {
        f.party.forEach((m, i) => {
          if (verb !== 'Teach' && verb !== 'Give to' && m.fainted && verb !== 'Use on') return;
          btn(`${verb} ${m.name}`, () => done({ t: 'item', tab, index: picked.index, target: i }));
        });
      };
      if (picked.use === 'self') btn('Use', () => done({ t: 'item', tab, index: picked.index, target: null }));
      else if (picked.use === 'ball') btn('Throw this kind', () => done({ t: 'ballType', slot: picked.index }));
      else if (picked.use === 'target') onEach('Use on');
      else if (picked.use === 'teach') onEach('Teach');
      else if (picked.use === 'give') onEach('Give to');
      btn('Drop', () => done({ t: 'drop', tab, index: picked.index }));
      btn('Back', () => {
        this.bagPick = null;
        this.bagSig = '';
      });
      d.appendChild(acts);
      panel.appendChild(d);
      return;
    }
    if (list.length === 0) {
      panel.appendChild(h('div', 'empty', this.bagTab === 'items' ? 'Your bag is empty.' : 'No held items or TMs.'));
      return;
    }
    const grid = h('div', 'grid');
    for (const e of list) {
      const b = h('button', 'slot');
      if (e.icon) {
        const img = h('img');
        img.src = e.icon;
        img.alt = '';
        b.appendChild(img);
      }
      b.appendChild(h('span', '', `${e.name}${e.count > 1 ? ` ×${e.count}` : ''}`));
      tapButton(b, () => {
        this.bagPick = e.index;
        this.bagSig = '';
      });
      grid.appendChild(b);
    }
    panel.appendChild(grid);
  }
}

let ui: TouchUi | null = null;
let shown = false;

/** The match's touch controls (made on first use). */
export function touchUi(input: Input): TouchUi {
  if (!ui) ui = new TouchUi(input);
  shown = true;
  return ui;
}

/** Once a frame after the screen drew: hides the controls if no match showed them; the turn-sideways notice. */
export function touchFrameEnd(input: Input): void {
  if (!ui && Input.touch) ui = new TouchUi(input);
  if (ui && !shown) ui.hide();
  shown = false;
  const rot = document.querySelector('.almia-rotate') as HTMLElement | null;
  if (rot) rot.style.display = Input.touch && window.innerHeight > window.innerWidth ? 'flex' : 'none';
}
