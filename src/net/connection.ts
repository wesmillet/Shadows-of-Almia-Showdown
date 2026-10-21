/**
 * The browser's line to the game server: one WebSocket, reconnecting on its own, plus the account
 * calls (/api). Screens subscribe to the messages they care about.
 *
 * The server is the page's own host when the game is served by it; ?server=host:port (or the
 * build-time VITE_GAME_SERVER) points elsewhere, e.g. the local server during development.
 */
import type { ClientMsg, CommandName, ServerMsg } from './protocol';

type Listener = (msg: ServerMsg) => void;

const GUEST_KEY = 'almia.guest.v1';

export interface Me {
  signedIn: boolean;
  google: boolean;
  user?: { id: number; username: string; role: string; google: boolean };
  look?: string | null;
  stats?: { matches: number; wins: number; catches: number; knockouts: number; damage: number; bestPlace: number | null };
}

/** Where the game server is (no trailing slash), or null when this build has none (GitHub Pages). */
export function serverBase(): string | null {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return `${location.protocol}//${q}`;
  const env = (import.meta.env?.VITE_GAME_SERVER as string | undefined) ?? '';
  if (env) return env.replace(/\/$/, '');
  // GitHub Pages has no game server; anywhere else (the game's own domain, or Vite in development,
  // which passes /api and /ws through) it is the page's own origin.
  if (location.hostname.endsWith('github.io')) return null;
  return location.origin;
}

function guestKey(): string {
  try {
    let k = localStorage.getItem(GUEST_KEY);
    if (!k) {
      const b = new Uint8Array(18);
      crypto.getRandomValues(b);
      k = btoa(String.fromCharCode(...b)).replace(/[+/=]/g, (c) => (c === '+' ? '-' : c === '/' ? '_' : ''));
      localStorage.setItem(GUEST_KEY, k);
    }
    return k;
  } catch {
    return 'guest-no-storage-' + Math.random().toString(36).slice(2, 14);
  }
}

export class Connection {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private queue: ClientMsg[] = [];
  private retry = 0;
  private closedByUs = false;
  private cmdNo = 0;
  /** Latest hello from the server. */
  hello: Extract<ServerMsg, { t: 'hello' }> | null = null;
  connected = false;
  /** The global chat, newest last. */
  readonly chat: Array<Extract<ServerMsg, { t: 'chat' }>> = [];
  /** Round trip in ms (from pings). */
  ping = 0;
  me: Me = { signedIn: false, google: false };
  /** This browser's trainer look, shown to others while playing as a guest. */
  look: string | null = null;

  constructor(readonly base: string) {}

  /** Opens the connection (again); resolves once the server says hello. */
  open(): Promise<void> {
    this.closedByUs = false;
    return new Promise((resolve) => {
      const look = this.look ? `&look=${encodeURIComponent(this.look)}` : '';
      const wsUrl = `${this.base.replace(/^http/, 'ws')}/ws?guest=${encodeURIComponent(guestKey())}${look}`;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      let pinger: number | null = null;
      ws.onopen = () => {
        this.connected = true;
        this.retry = 0;
        for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
        pinger = window.setInterval(() => this.send({ t: 'ping', at: performance.now() }), 3000);
      };
      ws.onmessage = (e) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(String(e.data)) as ServerMsg;
        } catch {
          return;
        }
        if (msg.t === 'hello') {
          this.hello = msg;
          resolve();
        } else if (msg.t === 'pong') this.ping = Math.round(performance.now() - msg.at);
        else if (msg.t === 'chat') {
          if (!this.chat.some((c) => c.id !== undefined && c.id === msg.id)) this.chat.push(msg);
          if (this.chat.length > 100) this.chat.shift();
        }
        for (const l of this.listeners) l(msg);
      };
      ws.onclose = () => {
        this.connected = false;
        if (pinger !== null) clearInterval(pinger);
        if (this.closedByUs) return;
        // Back off a little each time, up to 10 s.
        const wait = Math.min(10_000, 500 * 2 ** this.retry++);
        window.setTimeout(() => void this.open(), wait);
      };
    });
  }

  close(): void {
    this.closedByUs = true;
    this.ws?.close();
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (msg.t !== 'in' && msg.t !== 'ping') this.queue.push(msg);
  }

  cmd(c: CommandName, ...a: Array<number | string | boolean | null>): void {
    this.send({ t: 'cmd', c, a, n: ++this.cmdNo });
  }

  // ---------------------------------------------------------------- accounts

  async api<T>(path: string, body?: unknown): Promise<T & { error?: string }> {
    try {
      const r = await fetch(`${this.base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'include',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Almia': '1' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return (await r.json()) as T & { error?: string };
    } catch {
      return { error: "Can't reach the game server" } as T & { error?: string };
    }
  }

  async refreshMe(): Promise<Me> {
    const me = await this.api<Me>('/api/me');
    if (!me.error) this.me = me;
    return this.me;
  }

  /** After signing in or out the connection reopens, so the server knows who it is talking to. */
  async reconnect(): Promise<void> {
    this.closedByUs = true;
    this.ws?.close();
    await this.open();
  }
}
