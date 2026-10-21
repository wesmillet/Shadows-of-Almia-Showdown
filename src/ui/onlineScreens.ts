/**
 * The online screens: the hub (your account, Find a Match, the leaderboard), the lobby while a
 * match fills up, and the end of a match (the result, and for a win the Pokémon to keep; the
 * server checks every pick and keeps the PC).
 */
import type { Input } from '../core/input';
import type { Connection } from '../net/connection';
import type { ServerMsg } from '../net/protocol';
import { accountDialog, ChatPanel } from './overlay';
import { backdrop, button, heading, hit, INK, panel, text, wrapText, type GameContext, type Screen } from './screens';

type Rect = { x: number; y: number; w: number; h: number };

interface Leader {
  name: string;
  wins: number;
  matches: number;
}

/** The hub: who you are, Find a Match, and the top trainers. */
export class OnlineScreen implements Screen {
  private chat: ChatPanel | null = null;
  private leaders: Leader[] = [];
  private busy = false;
  private t = 0;
  private message = '';

  constructor(
    private readonly ctx: GameContext,
    private readonly net: Connection,
    private readonly onFind: () => void,
    private readonly onBack: () => void,
  ) {}

  enter(): void {
    this.chat = new ChatPanel(this.net);
    void this.refresh();
    const q = new URLSearchParams(location.search).get('signin');
    if (q) this.message = q;
  }

  exit(): void {
    this.chat?.dispose();
    this.chat = null;
  }

  private async refresh(): Promise<void> {
    await this.net.refreshMe();
    const r = await this.net.api<{ players: Leader[] }>('/api/leaderboard');
    this.leaders = r.players ?? [];
  }

  private rects(): { find: Rect; signin: Rect; register: Rect; back: Rect } {
    const v = this.ctx.view;
    const s = v.baseScale;
    const cx = v.width / 2;
    return {
      find: { x: cx - 150 * s, y: v.height / 2 + 40 * s, w: 300 * s, h: 64 * s },
      signin: { x: cx - 230 * s, y: v.height / 2 - 70 * s, w: 220 * s, h: 46 * s },
      register: { x: cx + 10 * s, y: v.height / 2 - 70 * s, w: 220 * s, h: 46 * s },
      back: { x: 24 * s, y: 24 * s, w: 140 * s, h: 44 * s },
    };
  }

  step(dt: number, input: Input): void {
    this.t += dt;
    if (this.chat?.focused() || this.busy) {
      input.takeClicks();
      return;
    }
    const r = this.rects();
    const signedIn = this.net.me.signedIn;
    for (const c of input.takeClicks()) {
      if (hit(c.x, c.y, r.find.x, r.find.y, r.find.w, r.find.h)) return this.onFind();
      if (hit(c.x, c.y, r.back.x, r.back.y, r.back.w, r.back.h)) return this.onBack();
      if (!signedIn && hit(c.x, c.y, r.signin.x, r.signin.y, r.signin.w, r.signin.h)) void this.account('signin');
      else if (!signedIn && hit(c.x, c.y, r.register.x, r.register.y, r.register.w, r.register.h)) void this.account('register');
      else if (signedIn && hit(c.x, c.y, r.signin.x, r.signin.y, r.signin.w + r.register.w + 20, r.signin.h)) void this.signOut();
    }
    if (input.pressed('Escape')) this.onBack();
  }

  private async account(mode: 'signin' | 'register'): Promise<void> {
    this.busy = true;
    const ok = await accountDialog(this.net, mode);
    this.busy = false;
    if (ok) {
      this.message = `Welcome, ${this.net.me.user?.username}!`;
      this.chat?.dispose();
      this.chat = new ChatPanel(this.net);
      void this.refresh();
    }
  }

  private async signOut(): Promise<void> {
    this.busy = true;
    await this.net.api('/api/logout', {});
    await this.net.refreshMe();
    await this.net.reconnect();
    this.busy = false;
    this.message = 'Signed out';
    this.chat?.dispose();
    this.chat = new ChatPanel(this.net);
  }

  render(): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    backdrop(v);
    const kind = this.net.hello?.server;
    heading(v, 'Play Online', kind === 'demo' ? 'DEMO SERVER: new things being tested, progress here is separate' : 'Eight trainers, one island, one winner', 70 * s);
    const mx = this.ctx.input.mouseX;
    const my = this.ctx.input.mouseY;
    const r = this.rects();
    const me = this.net.me;
    // Account card.
    const cw = 500 * s;
    const cx = v.width / 2 - cw / 2;
    const cy = v.height / 2 - 180 * s;
    panel(v, cx, cy, cw, 180 * s, 18, 'rgba(18,14,34,0.9)');
    if (me.signedIn && me.user) {
      text(v, me.user.username, v.width / 2, cy + 40 * s, 26, { align: 'center', color: INK.text, shadow: false });
      const st = me.stats;
      const line = st ? `${st.wins} wins · ${st.matches} matches · ${st.catches} catches · best place ${st.bestPlace ?? '-'}` : '';
      text(v, line, v.width / 2, cy + 68 * s, 14, { align: 'center', color: INK.dim, shadow: false });
      button(v, 'Sign out', r.signin.x + r.signin.w / 2 + 10 * s, r.signin.y, r.signin.w, r.signin.h, hit(mx, my, r.signin.x + r.signin.w / 2, r.signin.y, r.signin.w, r.signin.h), '#f4e6c8');
    } else {
      text(v, this.net.hello?.name ?? 'Guest', v.width / 2, cy + 40 * s, 24, { align: 'center', color: INK.text, shadow: false });
      text(v, 'Playing as a guest: nothing you win is kept. Sign in to save your PC box and stats.', v.width / 2, cy + 68 * s, 13, { align: 'center', color: INK.dim, shadow: false, maxWidth: cw - 40 * s });
      button(v, 'Sign in', r.signin.x, r.signin.y, r.signin.w, r.signin.h, hit(mx, my, r.signin.x, r.signin.y, r.signin.w, r.signin.h), '#f4e6c8');
      button(v, 'Create account', r.register.x, r.register.y, r.register.w, r.register.h, hit(mx, my, r.register.x, r.register.y, r.register.w, r.register.h), '#f4e6c8');
    }
    const connected = this.net.connected;
    button(v, connected ? 'Find a Match' : 'Connecting...', r.find.x, r.find.y, r.find.w, r.find.h, connected && hit(mx, my, r.find.x, r.find.y, r.find.w, r.find.h), connected ? undefined : '#44405a');
    if (this.message) text(v, this.message, v.width / 2, r.find.y + r.find.h + 30 * s, 14, { align: 'center', color: '#f4ecdc' });
    button(v, 'Back (Esc)', r.back.x, r.back.y, r.back.w, r.back.h, hit(mx, my, r.back.x, r.back.y, r.back.w, r.back.h), '#f4e6c8');
    // Leaderboard, right.
    const lw = 260 * s;
    const lx = v.width - lw - 24 * s;
    const ly = 120 * s;
    const lh = Math.min(v.height - ly - 24 * s, 40 * s + 24 * s * Math.max(1, Math.min(12, this.leaders.length)));
    if (v.width > 1100 * s * 0.8) {
      panel(v, lx, ly, lw, lh, 16, 'rgba(18,14,34,0.9)');
      text(v, 'Top trainers', lx + lw / 2, ly + 26 * s, 16, { align: 'center', color: INK.accent, shadow: false });
      if (!this.leaders.length) text(v, 'No wins yet. Be the first!', lx + lw / 2, ly + 52 * s, 12, { align: 'center', color: INK.dim, shadow: false });
      this.leaders.slice(0, 12).forEach((l, i) => {
        const y = ly + 52 * s + i * 24 * s;
        text(v, `${i + 1}. ${l.name}`, lx + 18 * s, y, 13, { color: INK.text, shadow: false, maxWidth: lw - 90 * s });
        text(v, `${l.wins} W`, lx + lw - 18 * s, y, 13, { align: 'right', color: INK.dim, shadow: false });
      });
    }
    if (this.net.ping) text(v, `${this.net.ping} ms`, v.width - 20 * s, v.height - 16 * s, 11, { align: 'right', color: '#9f97bb' });
  }
}

/** Waiting for the match to fill: who is in, and how long until it starts (empty seats get computer trainers). */
export class LobbyScreen implements Screen {
  private chat: ChatPanel | null = null;
  private players: string[] = [];
  private startsIn: number | null = null;
  private size = 8;
  private unsub: (() => void) | null = null;
  private t = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly net: Connection,
    private readonly onLeave: () => void,
    private readonly onStart: (msg: Extract<ServerMsg, { t: 'start' }>) => void,
  ) {}

  enter(): void {
    this.chat = new ChatPanel(this.net);
    this.unsub = this.net.on((m) => {
      if (m.t === 'lobby') {
        this.players = m.players;
        this.startsIn = m.startsIn;
        this.size = m.size;
      } else if (m.t === 'start') this.onStart(m);
    });
  }

  exit(): void {
    this.unsub?.();
    this.chat?.dispose();
  }

  private leaveRect(): Rect {
    const v = this.ctx.view;
    const s = v.baseScale;
    return { x: v.width / 2 - 110 * s, y: v.height / 2 + 200 * s, w: 220 * s, h: 50 * s };
  }

  step(dt: number, input: Input): void {
    this.t += dt;
    if (this.startsIn !== null) this.startsIn = Math.max(0, this.startsIn - dt);
    const b = this.leaveRect();
    for (const c of input.takeClicks()) {
      if (hit(c.x, c.y, b.x, b.y, b.w, b.h)) {
        this.net.send({ t: 'leaveQueue' });
        return this.onLeave();
      }
    }
  }

  render(): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    backdrop(v);
    const dots = '.'.repeat(1 + (Math.floor(this.t * 2) % 3));
    heading(v, `Finding trainers${dots}`, this.startsIn === null ? 'Joining the queue' : `Starting in ${Math.ceil(this.startsIn)}s · empty spots get computer trainers`, 80 * s);
    const pw = 460 * s;
    const px = v.width / 2 - pw / 2;
    const py = v.height / 2 - 150 * s;
    panel(v, px, py, pw, 320 * s, 18, 'rgba(18,14,34,0.9)');
    text(v, `${this.players.length} / ${this.size} trainers`, v.width / 2, py + 34 * s, 18, { align: 'center', color: INK.accent, shadow: false });
    for (let i = 0; i < this.size; i++) {
      const y = py + 70 * s + i * 30 * s;
      const name = this.players[i];
      text(v, name ?? (i < this.players.length ? '' : 'waiting...'), v.width / 2, y, 15, { align: 'center', color: name ? INK.text : INK.dim, shadow: false });
    }
    const b = this.leaveRect();
    button(v, 'Leave queue', b.x, b.y, b.w, b.h, hit(this.ctx.input.mouseX, this.ctx.input.mouseY, b.x, b.y, b.w, b.h), '#f4e6c8');
  }
}

interface ExtractInfo {
  match: string | null;
  party?: Array<{ name: string; level: number; shiny: boolean; taken?: boolean }>;
  picks?: number;
  outcome?: string;
}

/** The result, drawn over the last of the match; a winner (or a voucher carrier) picks Pokémon to keep. */
export class OnlineEndScreen implements Screen {
  private t = 0;
  private info: ExtractInfo | null = null;
  private note = '';
  private sending = false;

  constructor(
    private readonly ctx: GameContext,
    private readonly net: Connection,
    private readonly behind: Screen,
    private readonly outcome: 'win' | 'loss',
    private readonly place: number,
    private readonly onDone: () => void,
  ) {}

  enter(): void {
    if (this.net.me.signedIn) {
      // The server writes the match result as it closes; ask a moment later.
      window.setTimeout(() => void this.load(), 600);
    }
  }

  private async load(): Promise<void> {
    const r = await this.net.api<ExtractInfo>('/api/extract');
    this.info = r.match ? r : null;
  }

  private pickRects(): Rect[] {
    const v = this.ctx.view;
    const s = v.baseScale;
    const pw = 520 * s;
    const px = v.width / 2 - pw / 2;
    const y0 = v.height / 2 + 30 * s;
    const bw = (pw - 80 * s - 12 * s) / 2;
    return (this.info?.party ?? []).map((_, i) => ({ x: px + 40 * s + (i % 2) * (bw + 12 * s), y: y0 + Math.floor(i / 2) * 44 * s, w: bw, h: 38 * s }));
  }

  private doneRect(): Rect {
    const v = this.ctx.view;
    const s = v.baseScale;
    return { x: v.width / 2 - 110 * s, y: v.height / 2 + 196 * s, w: 220 * s, h: 52 * s };
  }

  step(dt: number, input: Input): void {
    this.t += dt;
    const d = this.doneRect();
    for (const c of input.takeClicks()) {
      if (hit(c.x, c.y, d.x, d.y, d.w, d.h)) return this.onDone();
      const info = this.info;
      if (!info || !info.picks || this.sending) continue;
      this.pickRects().forEach((r, i) => {
        const m = info.party?.[i];
        if (m && !m.taken && hit(c.x, c.y, r.x, r.y, r.w, r.h)) void this.extract(i);
      });
    }
    if (this.t > 1 && input.pressed('Escape')) this.onDone();
  }

  private async extract(i: number): Promise<void> {
    if (!this.info?.match) return;
    this.sending = true;
    const r = await this.net.api<{ ok?: boolean; name?: string }>('/api/extract', { match: this.info.match, index: i });
    this.sending = false;
    this.note = r.ok ? `${r.name} was sent to your PC` : (r.error ?? 'Could not extract');
    await this.load();
  }

  render(alpha: number, frameDt: number): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    this.behind.render(alpha, frameDt);
    const h = v.hud;
    h.fillStyle = `rgba(6,3,14,${0.72 * Math.min(1, this.t / 0.8)})`;
    h.fillRect(0, 0, v.width, v.height);
    const pw = 520 * s;
    const ph = 420 * s;
    const px = v.width / 2 - pw / 2;
    const py = v.height / 2 - ph / 2 - 20 * s;
    panel(v, px, py, pw, ph, 22, 'rgba(18,14,34,0.92)');
    const win = this.outcome === 'win';
    text(v, win ? 'VICTORY' : 'ELIMINATED', v.width / 2, py + 50 * s, 40, { align: 'center', color: win ? INK.accent : INK.bad, shadow: false });
    text(v, win ? 'Last trainer standing!' : `You placed #${this.place}`, v.width / 2, py + 86 * s, 16, { align: 'center', color: INK.dim, shadow: false });
    const mx = this.ctx.input.mouseX;
    const my = this.ctx.input.mouseY;
    if (!this.net.me.signedIn) {
      wrapText(v, win ? 'You won as a guest, so nothing could be kept. Sign in next time to keep a Pokémon from every win.' : 'Sign in to keep your stats and the Pokémon you win.', v.width / 2, py + 140 * s, 14, pw - 80 * s, 20 * s, 3, { align: 'center', color: INK.text, shadow: false });
    } else if (this.info?.picks) {
      text(v, `Keep ${this.info.picks > 1 ? `up to ${this.info.picks} Pokémon` : 'one Pokémon'}: it goes to your PC on the server`, v.width / 2, py + 130 * s, 14, { align: 'center', color: INK.blue, shadow: false, maxWidth: pw - 60 * s });
      this.pickRects().forEach((r, i) => {
        const m = this.info?.party?.[i];
        if (!m) return;
        button(v, `${m.shiny ? '★ ' : ''}${m.name} Lv ${m.level}${m.taken ? '  ✓' : ''}`, r.x, r.y, r.w, r.h, !m.taken && hit(mx, my, r.x, r.y, r.w, r.h), m.taken ? '#44405a' : '#f4e6c8');
      });
    } else if (this.net.me.signedIn) {
      text(v, win ? 'Saving your win...' : 'Your stats were saved.', v.width / 2, py + 140 * s, 14, { align: 'center', color: INK.text, shadow: false });
    }
    if (this.note) text(v, this.note, v.width / 2, py + ph - 110 * s, 14, { align: 'center', color: INK.good, shadow: false });
    const d = this.doneRect();
    button(v, 'Back to lobby', d.x, d.y, d.w, d.h, hit(mx, my, d.x, d.y, d.w, d.h));
  }
}
