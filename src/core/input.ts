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
      // Typing in a text box (chat, sign-in) is not playing: the game does not see those keys.
      if (Input.typing(e.target)) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      // While the Options screen listens for a new key, the game sees nothing.
      if (Input.capture) {
        e.preventDefault();
        Input.capture(e.code);
        return;
      }
      // Rebound keys (Options) arrive as the default code the game listens for.
      const code = logicalKey(e.code);
      if (!code) return;
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
    canvas.addEventListener('pointermove', (e) => this.updateMouse(e));
    canvas.addEventListener('pointerdown', (e) => {
      this.updateMouse(e);
      if (e.button === 2) this.rightDown = true;
      else this.mouseDown = true;
      this.clicks.push({ x: this.mouseX, y: this.mouseY, button: e.button });
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 2) this.rightDown = false;
      else this.mouseDown = false;
    });
    window.addEventListener('blur', () => {
      this.mouseDown = false;
      this.rightDown = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private updateMouse(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.mouseX = ((e.clientX - r.left) / r.width) * this.canvas.width;
    this.mouseY = ((e.clientY - r.top) / r.height) * this.canvas.height;
  }

  down(code: string): boolean {
    return this.held.has(code);
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
