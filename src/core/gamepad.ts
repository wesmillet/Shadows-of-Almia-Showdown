/**
 * Controller play (the browser Gamepad API, "standard" layout: Xbox, PlayStation, Switch Pro...).
 *
 * The controller drives the same Input the keyboard and mouse do, so no screen needs its own
 * controller code: buttons become the keys they stand for, the triggers the mouse buttons, and the
 * sticks the movement keys and the cursor.
 *
 * Two ways the right stick works:
 *   aim      in a match while you play: the cursor sits a few tiles out from you in the stick's
 *            direction (or the way you walk, if the right stick is let go), so moves fire that way.
 *   pointer  menus, the shop, the storage chest, choosing who goes out next, or after View/Select
 *            in a match: the right stick (and outside a match, the left one too) moves a cursor
 *            and A clicks, on the canvas or on any dialog over it.
 *
 * Match buttons: A talk / pick up / dodge, B back, X throw a ball, Y Capture Styler (hold),
 * LB next target, RB ride / land, RT and LT moves 1 and 2 (hold), D-pad left/right switch the lead,
 * up Mega Evolve, down the bag's other tab, Start options, View/Select the pointer.
 */
import { Input } from './input';

const DEAD = 0.22;
const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

/** Button -> the key it holds in a match. */
const MATCH_KEYS: Partial<Record<number, string>> = {
  [B.A]: 'Space',
  [B.X]: 'KeyF',
  [B.Y]: 'KeyC',
  [B.LB]: 'Tab',
  [B.RB]: 'KeyV',
  [B.UP]: 'KeyM',
  [B.DOWN]: 'PadDown',
  [B.LEFT]: 'PadPrev',
  [B.RIGHT]: 'PadNext',
  [B.START]: 'Escape',
};
/** Button -> key in menus (A clicks and B goes back; those are handled apart). */
const MENU_KEYS: Partial<Record<number, string>> = {
  [B.UP]: 'ArrowUp',
  [B.DOWN]: 'ArrowDown',
  [B.LEFT]: 'ArrowLeft',
  [B.RIGHT]: 'ArrowRight',
  [B.START]: 'Escape',
};

function stick(x: number, y: number): { x: number; y: number; m: number } {
  const m = Math.hypot(x, y);
  if (m < DEAD) return { x: 0, y: 0, m: 0 };
  const k = Math.min(1, (m - DEAD) / (1 - DEAD));
  return { x: (x / m) * k, y: (y / m) * k, m: k };
}

export class Gamepads {
  private prev: boolean[] = [];
  /** Keys this controller holds down (released when the button lets go, or the mode changes). */
  private holding = new Map<number, string>();
  private lastDir = { x: 1, y: 0 };
  private pointerToggled = false;
  private cursorEl: HTMLDivElement | null = null;
  private last = performance.now();
  /** The controller has moved the cursor since the mouse last did. */
  private owns = false;
  /** The last mode used, to release held keys when it changes. */
  private mode: 'aim' | 'pointer' | 'menu' = 'menu';
  private aDom = false;

  constructor(private readonly input: Input, private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('mousemove', () => {
      if (!this.owns) return;
      this.owns = false;
      this.showCursor(null);
    });
    window.addEventListener('gamepadconnected', () => {
      Input.pad = true;
    });
  }

  private pad(): Gamepad | null {
    const list = navigator.getGamepads?.() ?? [];
    for (const g of list) if (g && g.connected && g.buttons.length >= 12) return g;
    return null;
  }

  /** Called at the start of every simulation step. */
  poll(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const g = this.pad();
    if (!g) {
      if (this.prev.length) this.releaseAll();
      this.prev = [];
      this.input.padMove = null;
      return;
    }
    const inp = this.input;
    const btn = g.buttons.map((b, i) => (i === B.LT || i === B.RT ? b.value > 0.4 : b.pressed));
    const went = (i: number) => !!btn[i] && !this.prev[i];
    const let_ = (i: number) => !btn[i] && !!this.prev[i];
    const ls = stick(g.axes[0] ?? 0, g.axes[1] ?? 0);
    const rs = stick(g.axes[2] ?? 0, g.axes[3] ?? 0);
    const anything = btn.some(Boolean) || ls.m > 0 || rs.m > 0;
    if (anything) {
      Input.pad = true;
      Input.touch = false;
    }

    const aim = Input.padAimFrom;
    if (went(B.BACK) && aim) this.pointerToggled = !this.pointerToggled;
    const mode: 'aim' | 'pointer' | 'menu' = aim ? (this.pointerToggled ? 'pointer' : 'aim') : Input.padInMatch ? 'pointer' : 'menu';
    if (mode !== this.mode) {
      this.releaseAll();
      this.mode = mode;
    }
    const modal = !!document.querySelector('.almia-modal-wrap');

    // Movement: the left stick in a match (menus use it for the cursor).
    inp.padMove = mode !== 'menu' && !modal && ls.m > 0 ? { x: ls.x, y: ls.y } : null;

    if (mode === 'aim' && aim && !modal) {
      const o = aim();
      if (rs.m > 0) this.lastDir = { x: rs.x / rs.m, y: rs.y / rs.m };
      else if (ls.m > 0) this.lastDir = { x: ls.x / ls.m, y: ls.y / ls.m };
      if (anything || this.owns) {
        inp.mouseX = o.x + this.lastDir.x * o.r;
        inp.mouseY = o.y + this.lastDir.y * o.r;
        this.owns = true;
      }
    } else {
      // A cursor: right stick, and outside a match the left stick too. Faster the further it leans.
      const s = rs.m > 0 ? rs : mode === 'menu' || modal ? ls : { x: 0, y: 0, m: 0 };
      if (s.m > 0) {
        const speed = 1400 * inp.dpr() * (0.25 + 0.75 * s.m * s.m);
        if (!this.owns) {
          this.owns = true;
          // Taking over from a mouse that never moved (or left at the corner): start in the middle.
          if (inp.mouseX < 2 && inp.mouseY < 2) {
            inp.mouseX = this.canvas.width / 2;
            inp.mouseY = this.canvas.height / 2;
          }
        }
        inp.mouseX = Math.max(0, Math.min(this.canvas.width - 1, inp.mouseX + (s.x / s.m) * s.m * speed * dt));
        inp.mouseY = Math.max(0, Math.min(this.canvas.height - 1, inp.mouseY + (s.y / s.m) * s.m * speed * dt));
      }
    }

    // Triggers: the mouse buttons (moves 1 and 2, held).
    if (went(B.RT)) inp.mouseDown = true;
    if (let_(B.RT)) inp.mouseDown = false;
    if (went(B.LT)) inp.rightDown = true;
    if (let_(B.LT)) inp.rightDown = false;

    if (mode === 'aim' && !modal) {
      for (const [i, code] of Object.entries(MATCH_KEYS)) {
        const n = Number(i);
        if (went(n)) this.hold(n, code as string);
        if (let_(n)) this.free(n);
      }
      if (went(B.B)) inp.virtualTap('Escape');
    } else {
      // A clicks where the cursor is: a dialog's button, or the canvas.
      if (went(B.A)) {
        const el = this.domAt();
        if (el) {
          this.aDom = true;
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) el.focus();
          el.click();
        } else {
          this.aDom = false;
          inp.padClick(0);
        }
      }
      if (let_(B.A) && !this.aDom) inp.mouseDown = false;
      if (went(B.X) && !this.domAt()) inp.padClick(2);
      if (let_(B.X)) inp.rightDown = false;
      if (went(B.B)) {
        if (modal) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        else inp.virtualTap('Escape');
      }
      if (modal) {
        // D-pad up/down (and the right stick when the cursor sits still) scroll the dialog.
        const box = document.querySelector('.almia-modal-wrap .almia-modal, .almia-modal-wrap > *') as HTMLElement | null;
        const target = (this.domAt()?.closest('.list, .almia-modal') as HTMLElement | null) ?? box;
        if (target) {
          if (btn[B.UP]) target.scrollTop -= 600 * dt;
          if (btn[B.DOWN]) target.scrollTop += 600 * dt;
        }
      } else {
        for (const [i, code] of Object.entries(MENU_KEYS)) {
          const n = Number(i);
          if (went(n)) this.hold(n, code as string);
          if (let_(n)) this.free(n);
        }
        if (mode === 'pointer') {
          // Still playing (pointer toggled on, or a chest open): the face buttons keep their keys.
          for (const n of [B.Y, B.LB, B.RB]) {
            const code = MATCH_KEYS[n] as string;
            if (went(n)) this.hold(n, code);
            if (let_(n)) this.free(n);
          }
          if (went(B.LEFT)) inp.virtualTap('PadPrev');
          if (went(B.RIGHT)) inp.virtualTap('PadNext');
        }
      }
    }
    this.prev = btn;
    this.showCursor(this.owns ? (mode === 'aim' && !modal ? 'aim' : 'pointer') : null);
  }

  private hold(i: number, code: string): void {
    this.free(i);
    this.holding.set(i, code);
    this.input.virtualDown(code);
  }

  private free(i: number): void {
    const code = this.holding.get(i);
    if (code === undefined) return;
    this.holding.delete(i);
    this.input.virtualUp(code);
  }

  private releaseAll(): void {
    for (const i of [...this.holding.keys()]) this.free(i);
    this.input.mouseDown = false;
    this.input.rightDown = false;
    this.input.padMove = null;
  }

  /** The cursor in page (CSS) pixels. */
  private client(): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + (this.input.mouseX / this.canvas.width) * r.width, y: r.top + (this.input.mouseY / this.canvas.height) * r.height };
  }

  /** A clickable page element under the cursor, other than the game's own canvases. */
  private domAt(): HTMLElement | null {
    const c = this.client();
    const el = document.elementFromPoint(c.x, c.y) as HTMLElement | null;
    if (!el || el.tagName === 'CANVAS' || el === document.body || el === document.documentElement) return null;
    return (el.closest('button, a, input, textarea, select, label, [role="button"], td, tr, .almia-btn') as HTMLElement | null) ?? el;
  }

  private showCursor(kind: 'aim' | 'pointer' | null): void {
    if (!kind) {
      if (this.cursorEl) this.cursorEl.style.display = 'none';
      return;
    }
    if (!this.cursorEl) {
      const d = document.createElement('div');
      d.setAttribute('aria-hidden', 'true');
      d.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647;';
      document.body.appendChild(d);
      this.cursorEl = d;
    }
    const d = this.cursorEl;
    if (d.dataset.kind !== kind) {
      d.dataset.kind = kind;
      d.innerHTML = kind === 'pointer'
        ? '<svg width="22" height="26" viewBox="0 0 22 26" style="position:absolute;left:-2px;top:-2px"><path d="M2 2 L2 21 L7 16.5 L10.5 24 L14 22.5 L10.6 15.2 L17 15.2 Z" fill="#fff8e6" stroke="#2a1d3d" stroke-width="2.2" stroke-linejoin="round"/></svg>'
        : '<svg width="26" height="26" viewBox="0 0 26 26" style="position:absolute;left:-13px;top:-13px"><circle cx="13" cy="13" r="8" fill="none" stroke="#2a1d3d" stroke-width="4"/><circle cx="13" cy="13" r="8" fill="none" stroke="#fff8e6" stroke-width="2"/><circle cx="13" cy="13" r="1.8" fill="#fff8e6" stroke="#2a1d3d" stroke-width="1"/></svg>';
    }
    const c = this.client();
    d.style.display = 'block';
    d.style.transform = `translate(${c.x}px, ${c.y}px)`;
  }
}
