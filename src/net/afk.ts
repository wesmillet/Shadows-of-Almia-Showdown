/**
 * Away-from-keyboard watch (online, only while playing a match): no key, click, tap or mouse movement for AFK_WARN_MS
 * shows a warning with a countdown; at AFK_KICK_MS the player is disconnected (out of any match
 * they were in) and shown a screen with a Reconnect button. A key or finger held down counts as
 * active (walking with a held key or the touch stick). A hidden tab keeps counting.
 */
export const AFK_KICK_MS = 120_000;
export const AFK_WARN_MS = 90_000;

const CSS = `
.almia-afk-warn { position: fixed; left: 50%; top: max(12px, env(safe-area-inset-top)); transform: translateX(-50%); z-index: 2147483000;
  background: #f4ecdc; color: #4a3424; border: 3px solid #4a3424; box-shadow: 0 4px 0 #2a1d14, 0 0 0 3px #f4ecdc inset; padding: 10px 18px;
  font: 16px/1.4 "BoldPixels", "Segoe UI", system-ui, sans-serif; text-align: center; pointer-events: none; max-width: calc(100vw - 24px); image-rendering: pixelated; }
.almia-afk-warn b { color: #c2611a; font-weight: normal; }
.almia-afk-gone { position: fixed; inset: 0; z-index: 2147483001; display: flex; align-items: center; justify-content: center;
  background: rgba(14,10,24,0.88); font: 16px/1.45 "BoldPixels", "Segoe UI", system-ui, sans-serif; padding: 16px; }
.almia-afk-gone .box { background: #f4ecdc; color: #4a3424; border: 3px solid #4a3424; box-shadow: 0 4px 0 #2a1d14, 0 0 0 3px #f4ecdc inset;
  padding: 22px 24px; max-width: 440px; text-align: center; }
.almia-afk-gone h2 { margin: 0 0 10px; font-size: 24px; font-weight: normal; color: #c2611a; }
.almia-afk-gone button { margin-top: 16px; min-height: 44px; padding: 0 26px; font: inherit; font-size: 17px; border: 0; background: #c2611a; color: #fff;
  text-shadow: 0 1px 0 #8a3a0a; box-shadow: 0 4px 0 #8a3a0a; cursor: pointer; }
`;

export class AfkWatch {
  private last = Date.now();
  private held = new Set<string>();
  private warn: HTMLDivElement | null = null;
  private timer: number;
  private kicked = false;

  /** `onKick` leaves any match and closes the connection; this then shows the away screen. */
  constructor(
    private readonly onKick: () => void,
    /** Playing a match right now (menus, the queue and watching never time out). */
    private readonly playing: () => boolean,
  ) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    const seen = (): void => {
      this.last = Date.now();
      this.hideWarn();
    };
    const opts = { capture: true, passive: true } as const;
    window.addEventListener('keydown', (e) => {
      this.held.add(`k${e.code}`);
      seen();
    }, opts);
    window.addEventListener('keyup', (e) => {
      this.held.delete(`k${e.code}`);
      seen();
    }, opts);
    window.addEventListener('pointerdown', (e) => {
      this.held.add(`p${e.pointerId}`);
      seen();
    }, opts);
    for (const ev of ['pointerup', 'pointercancel'] as const) {
      window.addEventListener(ev, (e) => {
        this.held.delete(`p${e.pointerId}`);
        seen();
      }, opts);
    }
    for (const ev of ['pointermove', 'wheel', 'touchstart', 'touchmove'] as const) window.addEventListener(ev, seen, opts);
    // A lost focus drops held keys (their keyup never comes).
    window.addEventListener('blur', () => this.held.clear());
    this.timer = window.setInterval(() => this.tick(), 1000);
  }

  private tick(): void {
    if (this.kicked) return;
    if (!this.playing()) {
      this.last = Date.now();
      this.hideWarn();
      return;
    }
    if (this.held.size && document.visibilityState === 'visible') this.last = Date.now();
    const idle = Date.now() - this.last;
    if (idle >= AFK_KICK_MS) return this.kick();
    if (idle >= AFK_WARN_MS) {
      const left = Math.ceil((AFK_KICK_MS - idle) / 1000);
      if (!this.warn) {
        this.warn = document.createElement('div');
        this.warn.className = 'almia-afk-warn';
        document.body.appendChild(this.warn);
      }
      this.warn.innerHTML = `Are you still there? Move, tap or press a key.<br>Disconnecting in <b>${left}s</b>`;
    }
  }

  private hideWarn(): void {
    this.warn?.remove();
    this.warn = null;
  }

  private kick(): void {
    this.kicked = true;
    clearInterval(this.timer);
    this.hideWarn();
    try {
      this.onKick();
    } catch {
      /* still show the screen */
    }
    const wrap = document.createElement('div');
    wrap.className = 'almia-afk-gone';
    const box = document.createElement('div');
    box.className = 'box';
    const h = document.createElement('h2');
    h.textContent = 'Disconnected';
    const p = document.createElement('div');
    p.textContent = `You were away for ${Math.round(AFK_KICK_MS / 60_000)} minutes during a match, so you left it and were disconnected. Your account, PC and progress are saved.`;
    const b = document.createElement('button');
    b.textContent = 'Reconnect';
    b.addEventListener('click', () => location.reload());
    box.append(h, p, b);
    wrap.appendChild(box);
    document.body.appendChild(wrap);
  }
}
