/**
 * On-screen controls for phones and tablets. The left side of the field is a movement stick
 * (drawn by the match where the finger goes down); these buttons sit on the right. Each one reads
 * as the key a keyboard player would press, so the game itself does not care which was used.
 * Shown only in a match, only while the player is using touch, and never over a dialog.
 */
import { Input } from '../core/input';

interface Btn {
  el: HTMLButtonElement;
  code: string;
  /** Held keys (moves, styler) stay down while the finger is on the button; others are one tap. */
  hold: boolean;
}

const CSS = `
.almia-touch { position: fixed; inset: 0; pointer-events: none; z-index: 20; user-select: none; -webkit-user-select: none; }
.almia-touch button { pointer-events: auto; position: absolute; touch-action: none; -webkit-tap-highlight-color: transparent;
  border: 2px solid rgba(255,255,255,0.85); color: #fff; background: rgba(30,20,12,0.55); font: 600 11px/1.1 system-ui, sans-serif;
  text-shadow: 0 1px 2px #000; padding: 0; margin: 0; }
.almia-touch button.on { background: rgba(244,160,40,0.75); }
.almia-touch .big { width: 64px; height: 64px; border-radius: 50%; font-size: 13px; }
.almia-touch .mid { width: 50px; height: 50px; border-radius: 50%; }
.almia-touch .small { height: 30px; padding: 0 9px; border-radius: 15px; font-size: 11px; }
.almia-touch .move1 { background: rgba(212,128,20,0.7); }
.almia-touch .move2 { background: rgba(90,70,150,0.7); }
.almia-rotate { position: fixed; inset: 0; z-index: 100; display: none; align-items: center; justify-content: center; flex-direction: column;
  background: #0b0a12; color: #f4e6c8; font: 600 18px/1.4 system-ui, sans-serif; text-align: center; padding: 24px; }
.almia-rotate .phone { width: 40px; height: 66px; border: 3px solid #f4e6c8; border-radius: 8px; margin-bottom: 18px; animation: almia-turn 1.8s ease-in-out infinite; }
@keyframes almia-turn { 0%, 30% { transform: rotate(0deg); } 60%, 100% { transform: rotate(-90deg); } }
`;

let root: HTMLDivElement | null = null;
let rotate: HTMLDivElement | null = null;
let buttons: Record<string, Btn> = {};
let input: Input | null = null;
let shownThisFrame = false;

function make(inp: Input): void {
  input = inp;
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
  root = document.createElement('div');
  root.className = 'almia-touch';
  root.style.display = 'none';
  document.body.appendChild(root);
  // Right thumb: the two moves (hold to keep using), a ball, and act (talk, pick up, dodge).
  const add = (key: string, label: string, cls: string, code: string, hold: boolean, pos: Partial<Record<'right' | 'bottom' | 'top' | 'left', string>>): void => {
    const el = document.createElement('button');
    el.className = cls;
    el.innerHTML = label;
    Object.assign(el.style, pos);
    const b: Btn = { el, code, hold };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('on');
      if (!input) return;
      if (b.hold) input.virtualDown(b.code);
      else input.virtualTap(b.code);
    });
    const up = (e: PointerEvent): void => {
      e.preventDefault();
      el.classList.remove('on');
      if (b.hold) input?.virtualUp(b.code);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    root!.appendChild(el);
    buttons[key] = b;
  };
  const R = (px: number): string => `calc(${px}px + env(safe-area-inset-right))`;
  add('move1', 'Move<br>1', 'big move1', 'TouchA', true, { right: R(16), bottom: '34%' });
  add('move2', 'Move<br>2', 'big move2', 'TouchB', true, { right: R(92), bottom: 'calc(34% + 34px)' });
  add('ball', 'Ball', 'mid', 'KeyF', false, { right: R(172), bottom: 'calc(34% + 64px)' });
  add('act', 'Act', 'mid', 'Space', false, { right: R(100), bottom: 'calc(34% - 44px)' });
  // A column down the left edge, under the trainers-left card: the rest of the keyboard.
  const L = 'calc(10px + env(safe-area-inset-left))';
  const col = ['menu', 'target', 'auto', 'ride', 'mega', 'styler'];
  const at = (k: string): string => `calc(17% + ${col.indexOf(k) * 36}px)`;
  add('menu', 'Menu', 'small', 'Escape', false, { left: L, top: at('menu') });
  add('target', 'Target', 'small', 'Tab', false, { left: L, top: at('target') });
  add('auto', 'Auto', 'small', 'KeyR', false, { left: L, top: at('auto') });
  add('ride', 'Ride', 'small', 'KeyV', false, { left: L, top: at('ride') });
  add('mega', 'Mega', 'small', 'KeyM', false, { left: L, top: at('mega') });
  add('styler', 'Styler', 'small', 'KeyC', true, { left: L, top: at('styler') });
  rotate = document.createElement('div');
  rotate.className = 'almia-rotate';
  rotate.innerHTML = '<div class="phone"></div>Turn your phone sideways to play';
  document.body.appendChild(rotate);
}

export interface TouchState {
  /** A prompt (shop, chest, TM) is open: only Menu (to close it) is shown. */
  prompt: boolean;
  /** In a trainer battle: no ball unless a legendary can be caught, no riding. */
  battle: boolean;
  /** The player holds a Capture Styler. */
  styler: boolean;
  auto: boolean;
  /** Steering one of the party (Menu goes back to the trainer). */
  steering: boolean;
}

/** Called by the match every frame it is on screen and the player can act. */
export function showTouchControls(inp: Input, s: TouchState): void {
  if (!root) make(inp);
  shownThisFrame = true;
  const visible = Input.touch && !document.querySelector('.almia-modal-wrap');
  root!.style.display = visible ? '' : 'none';
  if (!visible) return;
  const show = (k: string, on: boolean): void => {
    const b = buttons[k];
    if (b) b.el.style.display = on ? '' : 'none';
  };
  for (const k of ['move1', 'move2', 'act', 'target', 'auto']) show(k, !s.prompt);
  show('ball', !s.prompt);
  show('ride', !s.prompt && !s.battle);
  show('mega', !s.prompt);
  show('styler', !s.prompt && s.styler && !s.battle);
  const menu = buttons.menu?.el;
  if (menu) menu.textContent = s.prompt ? 'Close' : s.steering ? 'Trainer' : 'Menu';
  const auto = buttons.auto?.el;
  if (auto) auto.textContent = s.auto ? 'Auto on' : 'Auto off';
}

/** Called once per frame after the screen drew: hides the controls when no match asked for them. */
export function touchFrameEnd(inp: Input): void {
  if (!root && Input.touch) make(inp);
  if (root && !shownThisFrame && root.style.display !== 'none') {
    root.style.display = 'none';
    for (const b of Object.values(buttons)) if (b.hold) inp.virtualUp(b.code);
  }
  shownThisFrame = false;
  if (rotate) rotate.style.display = Input.touch && window.innerHeight > window.innerWidth ? 'flex' : 'none';
}
