/**
 * The browser's line to the game server: one WebSocket, reconnecting on its own, plus the account
 * calls (/api). Screens subscribe to the messages they care about.
 *
 * The server is the page's own host when the game is served by it; ?server=host:port (or the
 * build-time VITE_GAME_SERVER) points elsewhere, e.g. the local server during development.
 */
import type { ClientMsg, CommandName, FriendEntry, PartyState, PrivateState, ServerMsg } from './protocol';

type Listener = (msg: ServerMsg) => void;

const GUEST_KEY = 'almia.guest.v1';
const DEVICE_KEY = 'almia.device.v1';

/** A random id this browser keeps (bans can follow a device, not just an account). */
function deviceId(): string {
  try {
    let d = localStorage.getItem(DEVICE_KEY);
    if (!d) {
      const b = new Uint8Array(18);
      crypto.getRandomValues(b);
      d = btoa(String.fromCharCode(...b)).replace(/[+/=]/g, (c) => (c === '+' ? '-' : c === '/' ? '_' : ''));
      localStorage.setItem(DEVICE_KEY, d);
    }
    return d;
  } catch {
    return '';
  }
}

export interface Me {
  signedIn: boolean;
  google: boolean;
  user?: { id: number; username: string; role: string; google: boolean; password?: boolean };
  look?: string | null;
  stats?: { matches: number; wins: number; catches: number; knockouts: number; eliminations?: number; damage: number; bestPlace: number | null };
  progress?: { xp: number; level: number; into: number; next: number };
  title?: string | null;
  /** Titles earned (to wear one). */
  titles?: string[];
  /** Achievement ids earned. */
  achievements?: string[];
  /** Looks given to this account by Mystery Gift codes. */
  looks?: string[];
}

/** What only the browser needs to send messages (the replay player feeds a mirror without a server). */
export interface MirrorNet {
  on(l: (msg: ServerMsg) => void): () => void;
  send(msg: ClientMsg): void;
  cmd(c: CommandName, ...a: Array<number | string | boolean | null>): void;
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

export type ConnStatus = 'up' | 'down' | 'takenOver';

export class Connection {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<(s: ConnStatus) => void>();
  private helloWaiters: Array<() => void> = [];
  private lastMsgAt = 0;
  private queue: ClientMsg[] = [];
  private retry = 0;
  private closedByUs = false;
  private cmdNo = 0;
  /** Another tab or device took this session over (close code 4000). */
  takenOver = false;
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
  /** Friends, party and party invites, as the server last sent them. */
  social: { friends: FriendEntry[]; party: PartyState | null; invites: string[] } = { friends: [], party: null, invites: [] };
  /** The private lobby this player is in. */
  privateLobby: PrivateState | null = null;
  /** The last match's XP, levels and achievements (shown on the end screen). */
  progress: Extract<ServerMsg, { t: 'progress' }> | null = null;
  /** Events on now (double XP, shiny hour...). */
  events: Extract<ServerMsg, { t: 'events' }>['active'] = [];

  constructor(readonly base: string) {}

  /** Opens the connection (again); resolves once the server says hello (this attempt's or a retry's). */
  open(): Promise<void> {
    this.closedByUs = false;
    this.takenOver = false;
    return new Promise((resolve) => {
      this.helloWaiters.push(resolve);
      const look = this.look ? `&look=${encodeURIComponent(this.look)}` : '';
      const device = deviceId();
      const wsUrl = `${this.base.replace(/^http/, 'ws')}/ws?guest=${encodeURIComponent(guestKey())}${look}${device ? `&device=${device}` : ''}`;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      let pinger: number | null = null;
      ws.onopen = () => {
        this.connected = true;
        this.retry = 0;
        this.lastMsgAt = performance.now();
        for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
        pinger = window.setInterval(() => {
          this.send({ t: 'ping', at: performance.now() });
          // The server answers every ping; a silent line this long is dead. It is given up at once:
          // closing a dead socket waits for a closing handshake that never comes (about 12 s more in
          // Chromium), so the retries start now and the old socket is left to close on its own.
          if (performance.now() - this.lastMsgAt > 9000) {
            ws.onclose = null;
            ws.onmessage = null;
            ws.close();
            lost(1006);
          }
        }, 3000);
      };
      ws.onmessage = (e) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(String(e.data)) as ServerMsg;
        } catch {
          return;
        }
        this.lastMsgAt = performance.now();
        if (msg.t === 'bye') {
          // Closed by the server: act on it now rather than when the close arrives (see protocol.ts).
          ws.onclose = null;
          ws.onmessage = null;
          lost(msg.code);
          return;
        }
        if (msg.t === 'hello') {
          this.hello = msg;
          resolve();
          for (const w of this.helloWaiters.splice(0)) w();
          for (const l of this.statusListeners) l('up');
        } else if (msg.t === 'pong') this.ping = Math.round(performance.now() - msg.at);
        else if (msg.t === 'social') this.social = { friends: msg.friends, party: msg.party, invites: msg.invites };
        else if (msg.t === 'private') this.privateLobby = msg.lobby;
        else if (msg.t === 'events') this.events = msg.active;
        else if (msg.t === 'progress') {
          this.progress = msg;
          void this.refreshMe();
        }
        else if (msg.t === 'chat') {
          if (!this.chat.some((c) => c.id !== undefined && c.id === msg.id)) this.chat.push(msg);
          if (this.chat.length > 100) this.chat.shift();
        } else if (msg.t === 'chatDelete') {
          const i = this.chat.findIndex((c) => c.id === msg.id);
          if (i >= 0) this.chat.splice(i, 1);
        }
        for (const l of this.listeners) l(msg);
      };
      const lost = (code: number): void => {
        if (this.ws !== ws) return;
        this.connected = false;
        // Banned, or a moderator's kick: no reconnecting. 4000: another tab or device took over,
        // and reconnecting would only kick it back out, so this one stands down until asked.
        if (code === 4003) this.closedByUs = true;
        if (code === 4000) {
          this.closedByUs = true;
          this.takenOver = true;
          for (const l of this.statusListeners) l('takenOver');
        }
        // The server forgets parties and lobbies of a dropped connection.
        this.social = { ...this.social, party: null, invites: [] };
        this.privateLobby = null;
        if (pinger !== null) clearInterval(pinger);
        if (this.closedByUs) return;
        for (const l of this.statusListeners) l('down');
        // Back off a little each time, up to 10 s.
        const wait = Math.min(10_000, 500 * 2 ** this.retry++);
        window.setTimeout(() => void this.open(), wait);
      };
      ws.onclose = (e) => lost(e.code);
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

  /** Connection state changes: 'down' (retrying), 'up' (hello again), 'takenOver' (another tab). */
  onStatus(l: (s: ConnStatus) => void): () => void {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
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
        headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Almia': '1', 'X-Device': deviceId() },
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

  /** In a party, and not its leader (the leader starts matches). */
  get partyFollower(): boolean {
    const p = this.social.party;
    return !!p && p.members.length > 1 && p.leader !== p.you;
  }

  /** After signing in or out the connection reopens, so the server knows who it is talking to. */
  async reconnect(): Promise<void> {
    this.closedByUs = true;
    this.ws?.close();
    await this.open();
  }
}
