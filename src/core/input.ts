/** Keyboard and pointer state, polled by the fixed-step simulation. */
import { logicalKey } from '../settings';

export class Input {
  private held = new Set<string>();
  private pressedThisStep = new Set<string>();
  private releasedThisStep = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  /** Left button held. */
  mouseDown = false;
  /** Right button held. */
  rightDown = false;
  private clicks: Array<{ x: number; y: number; button: number }> = [];
  /** The pointer whose press set mouseDown/rightDown (another finger lifting does not release it). */
  private buttonPointer: number | null = null;

  /**
   * Touch play. True once the player touches the screen (or on a touch-first device); the game
   * then shows on-screen controls. A mouse or key press turns it back off.
   */
  static touch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(any-pointer: fine)').matches;
  /**
   * Set by the match while it runs: true for a canvas point where a finger becomes the movement
   * stick (the open field on the left), not a click.
   */
  static stickZone: ((x: number, y: number) => boolean) | null = null;
  /** The on-screen stick: where the finger went down and where it is now (canvas pixels). */
  stick: { id: number; x0: number; y0: number; x: number; y: number; t0: number } | null = null;
  /** Keys held by on-screen buttons (kept apart from the keyboard's). */
  private virtualHeld = new Set<string>();

  /** Set by the Options screen while it waits for a key to bind. */
  static capture: ((code: string) => void) | null = null;

  /** True for a text box the player is typing in. */
  static typing(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // While the Options screen listens for a new key, it gets the key and the game sees nothing.
      // (First: Options is itself a dialog, and dialogs otherwise hide every key from the game.)
      if (Input.capture) {
        e.preventDefault();
        Input.capture(e.code);
        return;
      }
      // Typing in a text box (chat, sign-in) is not playing: the game does not see those keys; nor
      // while a dialog (Options, a profile) is open over the game.
      if (Input.typing(e.target) || document.querySelector('.almia-modal-wrap')) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      // Rebound keys (Options) arrive as the default code the game listens for.
      const code = logicalKey(e.code);
      if (!code) return;
      Input.touch = false;
      this.held.add(code);
      this.pressedThisStep.add(code);
    });
    window.addEventListener('keyup', (e) => {
      const code = logicalKey(e.code);
      if (!code) return;
      this.held.delete(code);
      this.releasedThisStep.add(code);
    });
    window.addEventListener('blur', () => this.held.clear());
    window.addEventListener('pointermove', (e) => {
      if (this.stick && e.pointerId === this.stick.id) {
        const p = this.canvasPoint(e);
        this.stick.x = p.x;
        this.stick.y = p.y;
        return;
      }
      if (e.target === canvas && (e.pointerType !== 'touch' || e.pointerId === this.buttonPointer)) this.updateMouse(e);
    });
    canvas.addEventListener('pointerdown', (e) => {
      Input.touch = e.pointerType === 'touch' || e.pointerType === 'pen';
      if (Input.touch) {
        const p = this.canvasPoint(e);
        if (!this.stick && Input.stickZone?.(p.x, p.y)) {
          this.stick = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, t0: performance.now() };
          return;
        }
      }
      this.updateMouse(e);
      this.buttonPointer = e.pointerId;
      if (e.button === 2) this.rightDown = true;
      else this.mouseDown = true;
      this.clicks.push({ x: this.mouseX, y: this.mouseY, button: e.button });
    });
    const up = (e: PointerEvent): void => {
      if (this.stick && e.pointerId === this.stick.id) {
        // A quick tap that never moved is still a tap (target a Pokémon, steer one of yours).
        const s = this.stick;
        this.stick = null;
        if (e.type === 'pointerup' && performance.now() - s.t0 < 250 && Math.hypot(s.x - s.x0, s.y - s.y0) < 12 * this.dpr()) {
          this.mouseX = s.x0;
          this.mouseY = s.y0;
          this.clicks.push({ x: s.x0, y: s.y0, button: 0 });
        }
        return;
      }
      if (this.buttonPointer !== null && e.pointerId !== this.buttonPointer) return;
      this.buttonPointer = null;
      if (e.button === 2) this.rightDown = false;
      else this.mouseDown = false;
      if (e.pointerType === 'touch') this.rightDown = this.mouseDown = false;
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') Input.touch = false;
      else Input.touch = true;
    }, true);
    window.addEventListener('blur', () => {
      this.mouseDown = false;
      this.rightDown = false;
      this.stick = null;
      this.virtualHeld.clear();
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private canvasPoint(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * this.canvas.width, y: ((e.clientY - r.top) / r.height) * this.canvas.height };
  }

  /** Canvas pixels per CSS pixel. */
  dpr(): number {
    const r = this.canvas.getBoundingClientRect();
    return r.width > 0 ? this.canvas.width / r.width : 1;
  }

  private updateMouse(e: PointerEvent): void {
    const p = this.canvasPoint(e);
    this.mouseX = p.x;
    this.mouseY = p.y;
  }

  /** An on-screen button went down (it reads as that key: pressed this step, then held). */
  virtualDown(code: string): void {
    if (this.virtualHeld.has(code)) return;
    this.virtualHeld.add(code);
    this.pressedThisStep.add(code);
  }

  virtualUp(code: string): void {
    if (!this.virtualHeld.delete(code)) return;
    this.releasedThisStep.add(code);
  }

  /** A tap on an on-screen button: that key pressed once. */
  virtualTap(code: string): void {
    this.pressedThisStep.add(code);
  }

  down(code: string): boolean {
    return this.held.has(code) || this.virtualHeld.has(code);
  }

  /** True on the step after the key went down. */
  pressed(code: string): boolean {
    return this.pressedThisStep.has(code);
  }

  released(code: string): boolean {
    return this.releasedThisStep.has(code);
  }

  /** Clicks since the last step (canvas pixel coordinates). */
  takeClicks(): Array<{ x: number; y: number; button: number }> {
    const c = this.clicks;
    this.clicks = [];
    return c;
  }

  /** Movement axis from WASD / arrows, normalised so diagonals are not faster. */
  moveAxis(): { x: number; y: number } {
    const st = this.stick;
    if (st) {
      // The stick: full speed past about 40 px of drag, nothing inside a small dead zone.
      const r = 40 * this.dpr();
      const dx = st.x - st.x0;
      const dy = st.y - st.y0;
      const d = Math.hypot(dx, dy);
      if (d > r * 0.2) {
        const k = Math.min(1, d / r) / d;
        return { x: dx * k, y: dy * k };
      }
    }
    let x = 0;
    let y = 0;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyW') || this.down('ArrowUp')) y -= 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y += 1;
    if (x !== 0 && y !== 0) {
      x *= Math.SQRT1_2;
      y *= Math.SQRT1_2;
    }
    return { x, y };
  }

  /** Called at the end of every simulation step. */
  endStep(): void {
    this.pressedThisStep.clear();
    this.releasedThisStep.clear();
  }
}
