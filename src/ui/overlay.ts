/**
 * HTML on top of the game canvas, for the few things a canvas is bad at: typing (chat, sign-in)
 * and scrolling text. Styled after the pixel skin: cream panels, dark ink, BoldPixels lettering.
 */
import type { Connection } from '../net/connection';
import type { ServerMsg } from '../net/protocol';

const CSS = `
.almia-ui { position: fixed; inset: 0; pointer-events: none; z-index: 10; font-family: "BoldPixels", "Segoe UI", system-ui, sans-serif; }
.almia-ui * { box-sizing: border-box; }
.almia-panel { pointer-events: auto; background: #f4ecdc; color: #4a3424; border: 3px solid #4a3424; box-shadow: 0 4px 0 #2a1d14, 0 0 0 3px #f4ecdc inset; image-rendering: pixelated; }
.almia-chat { position: absolute; left: 16px; bottom: 16px; width: min(380px, calc(100vw - 32px)); display: flex; flex-direction: column; font-size: 15px; }
.almia-chat.compact { opacity: 0.88; }
.almia-chat-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: #4a3424; color: #f4ecdc; font-size: 14px; letter-spacing: 0.5px; cursor: pointer; }
.almia-chat-log { height: 180px; overflow-y: auto; padding: 6px 10px; line-height: 1.35; overflow-wrap: anywhere; }
.almia-chat.collapsed .almia-chat-log, .almia-chat.collapsed .almia-chat-row { display: none; }
.almia-chat-log .who { color: #c2611a; cursor: pointer; }
.almia-chat-log .sys { color: #8a6a4a; font-style: italic; }
.almia-chat-row { display: flex; border-top: 2px solid #4a3424; }
.almia-chat-row input { flex: 1; min-width: 0; border: 0; padding: 7px 10px; font: inherit; background: #fffaf0; color: #4a3424; outline: none; }
.almia-chat-row button, .almia-btn { font: inherit; border: 0; background: #c2611a; color: #fff; padding: 7px 12px; cursor: pointer; text-shadow: 0 1px 0 #8a3a0a; }
.almia-btn.alt { background: #e9dcc2; color: #4a3424; text-shadow: none; }
.almia-btn:disabled { background: #b8ad98; cursor: default; }
.almia-menu { position: absolute; padding: 4px; display: flex; flex-direction: column; gap: 4px; }
.almia-modal-wrap { position: absolute; inset: 0; background: rgba(8,4,20,0.55); display: flex; align-items: center; justify-content: center; pointer-events: auto; }
.almia-modal { width: min(380px, calc(100vw - 32px)); padding: 18px 20px 20px; font-size: 16px; }
.almia-modal h2 { margin: 0 0 4px; font-size: 26px; font-weight: normal; }
.almia-modal p { margin: 4px 0 12px; color: #8a6a4a; font-size: 14px; line-height: 1.35; }
.almia-modal label { display: block; margin: 10px 0 4px; font-size: 14px; }
.almia-modal input { width: 100%; padding: 9px 10px; font: inherit; border: 2px solid #4a3424; background: #fffaf0; color: #4a3424; outline: none; }
.almia-modal .row { display: flex; gap: 8px; margin-top: 14px; }
.almia-modal .row .almia-btn { flex: 1; }
.almia-modal .err { color: #b0302a; min-height: 18px; margin-top: 8px; font-size: 14px; }
.almia-modal .google { display: block; text-align: center; margin-top: 10px; background: #fff; color: #4a3424; border: 2px solid #4a3424; padding: 8px; text-decoration: none; }
.almia-modal .switch { margin-top: 12px; font-size: 14px; text-align: center; color: #8a6a4a; }
.almia-modal .switch a { color: #c2611a; cursor: pointer; }
`;

let root: HTMLDivElement | null = null;

export function overlayRoot(): HTMLDivElement {
  if (root) return root;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  root = document.createElement('div');
  root.className = 'almia-ui';
  document.body.appendChild(root);
  return root;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

const MUTED_KEY = 'almia.muted.v1';

function loadMuted(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(MUTED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/**
 * The global chat, bottom left. Enter focuses it (and sends); Esc leaves it. Clicking a name offers
 * Mute (hidden for you, kept in this browser) and Report (sent to the moderators).
 */
export class ChatPanel {
  readonly el: HTMLDivElement;
  private log: HTMLDivElement;
  private input: HTMLInputElement;
  private unsub: () => void;
  private muted = loadMuted();
  private menu: HTMLDivElement | null = null;
  private keyHandler: (e: KeyboardEvent) => void;

  constructor(private readonly net: Connection, opts: { compact?: boolean; collapsed?: boolean } = {}) {
    this.el = el('div', `almia-panel almia-chat${opts.compact ? ' compact' : ''}${opts.collapsed ? ' collapsed' : ''}`);
    const head = el('div', 'almia-chat-head');
    head.append(el('span', '', 'Global chat'), el('span', '', 'Enter to talk'));
    head.onclick = () => this.el.classList.toggle('collapsed');
    this.log = el('div', 'almia-chat-log');
    const row = el('div', 'almia-chat-row');
    this.input = el('input');
    this.input.maxLength = 200;
    this.input.placeholder = net.me.signedIn ? 'Say something nice' : 'Sign in to chat';
    const send = el('button', '', 'Send');
    send.onclick = () => this.send();
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.send();
      if (e.key === 'Escape') this.input.blur();
      e.stopPropagation();
    });
    row.append(this.input, send);
    this.el.append(head, this.log, row);
    overlayRoot().appendChild(this.el);
    for (const m of net.chat) this.add(m);
    this.unsub = net.on((m) => {
      if (m.t === 'chat') this.add(m);
    });
    // Enter anywhere opens the chat line.
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && document.activeElement !== this.input && !(e.target as HTMLElement)?.closest?.('.almia-modal')) {
        this.el.classList.remove('collapsed');
        this.input.focus();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  private send(): void {
    const text = this.input.value.trim();
    if (text) this.net.send({ t: 'chat', text });
    this.input.value = '';
    this.input.blur();
  }

  private add(m: Extract<ServerMsg, { t: 'chat' }>): void {
    if (!m.system && this.muted.has(m.from)) return;
    const line = el('div');
    if (m.system) line.append(el('span', 'sys', m.text));
    else {
      const who = el('span', 'who', m.from);
      who.onclick = (e) => this.openMenu(m, e.clientX, e.clientY);
      line.append(who, document.createTextNode(`: ${m.text}`));
    }
    const atBottom = this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 8;
    this.log.appendChild(line);
    while (this.log.childElementCount > 100) this.log.firstElementChild?.remove();
    if (atBottom) this.log.scrollTop = this.log.scrollHeight;
  }

  private openMenu(m: Extract<ServerMsg, { t: 'chat' }>, x: number, y: number): void {
    this.menu?.remove();
    const menu = el('div', 'almia-panel almia-menu');
    menu.style.left = `${x}px`;
    menu.style.top = `${Math.max(8, y - 90)}px`;
    const mute = el('button', 'almia-btn alt', `Mute ${m.from}`);
    mute.onclick = () => {
      this.muted.add(m.from);
      try {
        localStorage.setItem(MUTED_KEY, JSON.stringify([...this.muted]));
      } catch {
        // kept for this visit only
      }
      for (const line of [...this.log.children]) if (line.querySelector('.who')?.textContent === m.from) line.remove();
      menu.remove();
    };
    const report = el('button', 'almia-btn alt', 'Report');
    report.onclick = async () => {
      menu.remove();
      if (!this.net.me.signedIn) return this.add({ t: 'chat', from: 'System', text: 'Sign in to report players.', at: Date.now(), system: true });
      const r = await this.net.api<{ ok?: boolean }>('/api/report', { name: m.from, reason: m.text, chatId: m.id ?? null });
      this.add({ t: 'chat', from: 'System', text: r.ok ? `Thanks, ${m.from} was reported to the moderators.` : (r.error ?? 'Could not send the report'), at: Date.now(), system: true });
    };
    const close = el('button', 'almia-btn alt', 'Cancel');
    close.onclick = () => menu.remove();
    menu.append(mute, report, close);
    overlayRoot().appendChild(menu);
    this.menu = menu;
  }

  focused(): boolean {
    return document.activeElement === this.input;
  }

  dispose(): void {
    this.unsub();
    window.removeEventListener('keydown', this.keyHandler);
    this.menu?.remove();
    this.el.remove();
  }
}

/**
 * Sign in or create an account: a username and password, or Google when the server has it set up.
 * Resolves true once signed in, false if closed.
 */
export function accountDialog(net: Connection, startWith: 'signin' | 'register' = 'signin'): Promise<boolean> {
  return new Promise((resolve) => {
    let mode = startWith;
    const wrap = el('div', 'almia-modal-wrap');
    const box = el('div', 'almia-panel almia-modal');
    wrap.appendChild(box);
    overlayRoot().appendChild(wrap);
    const close = (ok: boolean) => {
      wrap.remove();
      resolve(ok);
    };
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target === wrap) close(false);
    });
    const render = () => {
      box.replaceChildren();
      box.append(el('h2', '', mode === 'signin' ? 'Sign in' : 'Create an account'));
      box.append(el('p', '', mode === 'signin' ? 'Your PC box, chest, look and stats are kept on the server.' : 'Pick a trainer name others will see. Don’t use your real name. We keep no email.'));
      const name = el('input');
      name.autocomplete = 'username';
      name.maxLength = 16;
      const pass = el('input');
      pass.type = 'password';
      pass.autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
      const nl = el('label', '', 'Trainer name');
      const pl = el('label', '', mode === 'signin' ? 'Password' : 'Password (8+ characters)');
      const err = el('div', 'err');
      const go = el('button', 'almia-btn', mode === 'signin' ? 'Sign in' : 'Create account');
      const cancel = el('button', 'almia-btn alt', 'Cancel');
      const row = el('div', 'row');
      row.append(cancel, go);
      box.append(nl, name, pl, pass, err, row);
      if (net.me.google) {
        const g = el('a', 'google', 'Continue with Google');
        g.href = `${net.base}/api/auth/google`;
        box.append(g);
      }
      const sw = el('div', 'switch');
      const link = el('a', '', mode === 'signin' ? 'Create one' : 'Sign in');
      link.onclick = () => {
        mode = mode === 'signin' ? 'register' : 'signin';
        render();
      };
      sw.append(document.createTextNode(mode === 'signin' ? 'New here? ' : 'Have an account? '), link);
      box.append(sw);
      cancel.onclick = () => close(false);
      const submit = async () => {
        go.disabled = true;
        err.textContent = '';
        const r = await net.api<{ ok?: boolean }>(mode === 'signin' ? '/api/login' : '/api/register', { username: name.value.trim(), password: pass.value });
        go.disabled = false;
        if (!r.ok) {
          err.textContent = r.error ?? 'That did not work';
          return;
        }
        await net.refreshMe();
        await net.reconnect();
        close(true);
      };
      go.onclick = () => void submit();
      for (const i of [name, pass]) {
        i.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') void submit();
          if (e.key === 'Escape') close(false);
          e.stopPropagation();
        });
      }
      name.focus();
    };
    render();
  });
}
