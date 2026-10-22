/**
 * The online screens: the hub (your account, casual or ranked, friends and party, private lobbies,
 * watching and replays), a private lobby, the lobby while a match fills up, and the end of a match
 * (the result, a ranked rating change, and for a win the Pokémon to keep; the server checks every
 * pick and keeps the PC).
 */
import type { Input } from '../core/input';
import type { Connection } from '../net/connection';
import type { PrivateRules, QueueMode, ServerMsg } from '../net/protocol';
import { accountDialog, ChatPanel, el, overlayRoot } from './overlay';
import { recoverDialog, recoveryCodesDialog, SocialPanel } from './socialPanel';
import { backdrop, button, heading, hit, INK, panel, text, wrapText, type GameContext, type Screen } from './screens';

type Rect = { x: number; y: number; w: number; h: number };

/** What the hub's buttons lead to (main.ts wires them up). */
export interface HubActions {
  find: (mode: QueueMode) => void;
  back: () => void;
  createPrivate: () => void;
  joinPrivate: () => void;
  watchFeatured: () => void;
  replays: () => void;
  leaderboards: () => void;
  watchFriend: (name: string) => void;
  profile: (name: string) => void;
}

type HubButton = 'find' | 'casual' | 'ranked' | 'signin' | 'register' | 'signout' | 'create' | 'join' | 'watch' | 'replays' | 'boards' | 'back' | 'me';

/**
 * The hub: who you are (and your ranked standing), Casual or Ranked, Find a Match (with your party,
 * if you lead one), private lobbies, watching live and replays. Friends and party are on the right.
 */
export class OnlineScreen implements Screen {
  private chat: ChatPanel | null = null;
  private social: SocialPanel | null = null;
  private busy = false;
  private t = 0;
  private message = '';
  private mode: QueueMode = 'casual';
  /** When a dialog or text box last had the keyboard. */
  private dialogAt = -1;

  constructor(
    private readonly ctx: GameContext,
    private readonly net: Connection,
    private readonly actions: HubActions,
    message = '',
  ) {
    this.message = message;
  }

  enter(): void {
    this.chat = new ChatPanel(this.net);
    this.social = new SocialPanel(this.net, { watch: this.actions.watchFriend, profile: this.actions.profile });
    this.social.setCollapsed(window.innerWidth < 900);
    void this.net.refreshMe();
    const q = new URLSearchParams(location.search).get('signin');
    if (q && !this.message) this.message = q;
    try {
      if (localStorage.getItem('almia.queue.v1') === 'ranked' && this.net.me.signedIn) this.mode = 'ranked';
    } catch {
      // casual
    }
  }

  exit(): void {
    this.chat?.dispose();
    this.chat = null;
    this.social?.dispose();
    this.social = null;
  }

  private rects(): Record<HubButton, Rect> {
    const v = this.ctx.view;
    const s = v.baseScale;
    const cx = v.width / 2;
    const top = v.height / 2 - 175 * s;
    const fy = top + 214 * s;
    const row = fy + 84 * s;
    const bw = 148 * s;
    const gap = 10 * s;
    return {
      me: { x: cx - 250 * s, y: top, w: 500 * s, h: 150 * s },
      signin: { x: cx - 230 * s, y: top + 90 * s, w: 220 * s, h: 42 * s },
      register: { x: cx + 10 * s, y: top + 90 * s, w: 220 * s, h: 42 * s },
      signout: { x: cx - 80 * s, y: top + 98 * s, w: 160 * s, h: 36 * s },
      casual: { x: cx - 150 * s, y: top + 162 * s, w: 146 * s, h: 38 * s },
      ranked: { x: cx + 4 * s, y: top + 162 * s, w: 146 * s, h: 38 * s },
      find: { x: cx - 150 * s, y: fy, w: 300 * s, h: 62 * s },
      create: { x: cx - bw - gap / 2, y: row, w: bw, h: 40 * s },
      join: { x: cx + gap / 2, y: row, w: bw, h: 40 * s },
      watch: { x: cx - bw * 1.5 - gap, y: row + 50 * s, w: bw, h: 40 * s },
      replays: { x: cx - bw / 2, y: row + 50 * s, w: bw, h: 40 * s },
      boards: { x: cx + bw / 2 + gap, y: row + 50 * s, w: bw, h: 40 * s },
      back: { x: 24 * s, y: 24 * s, w: 140 * s, h: 44 * s },
    };
  }

  /** What Find a Match does right now, and why it can not. */
  private findState(): { label: string; ok: boolean; why?: string } {
    const net = this.net;
    if (!net.connected) return { label: 'Connecting...', ok: false };
    const party = net.social.party;
    if (party && party.members.length > 1) {
      if (party.leader !== party.you) return { label: `${party.leader} starts the match`, ok: false };
      if (this.mode === 'ranked') return { label: 'Ranked is solo', ok: false, why: 'Parties play casual. Leave the party to play ranked' };
      return { label: `Find a Match · party of ${party.members.length}`, ok: true };
    }
    if (this.mode === 'ranked' && !net.me.signedIn) return { label: 'Sign in for ranked', ok: false };
    return { label: this.mode === 'ranked' ? 'Find a Ranked Match (Space)' : 'Find a Match (Space)', ok: true };
  }

  private find(): void {
    const f = this.findState();
    if (!f.ok) {
      if (f.why) this.message = f.why;
      return;
    }
    this.actions.find(this.mode);
  }

  private setMode(m: QueueMode): void {
    if (m === 'ranked' && !this.net.me.signedIn) {
      this.message = 'Ranked needs an account: your rating is kept on the server';
      return;
    }
    this.mode = m;
    try {
      localStorage.setItem('almia.queue.v1', m);
    } catch {
      // not kept
    }
  }

  step(dt: number, input: Input): void {
    this.t += dt;
    if (this.chat?.focused() || this.social?.focused() || this.busy || document.querySelector('.almia-modal-wrap')) {
      input.takeClicks();
      this.dialogAt = this.t;
      return;
    }
    // The Esc that just closed a dialog is not also for this screen.
    if (this.t - this.dialogAt < 0.25) {
      input.takeClicks();
      return;
    }
    const r = this.rects();
    const signedIn = this.net.me.signedIn;
    const on = (c: { x: number; y: number }, k: HubButton) => hit(c.x, c.y, r[k].x, r[k].y, r[k].w, r[k].h);
    for (const c of input.takeClicks()) {
      if (on(c, 'find')) return this.find();
      if (on(c, 'back')) return this.actions.back();
      if (on(c, 'casual')) this.setMode('casual');
      else if (on(c, 'ranked')) this.setMode('ranked');
      else if (on(c, 'create')) return this.actions.createPrivate();
      else if (on(c, 'join')) return this.actions.joinPrivate();
      else if (on(c, 'watch')) return this.actions.watchFeatured();
      else if (on(c, 'replays')) return this.actions.replays();
      else if (on(c, 'boards')) return this.actions.leaderboards();
      else if (!signedIn && on(c, 'signin')) void this.account('signin');
      else if (!signedIn && on(c, 'register')) void this.account('register');
      else if (signedIn && on(c, 'signout')) void this.signOut();
      else if (signedIn && on(c, 'me') && this.net.me.user) this.actions.profile(this.net.me.user.username);
    }
    if (input.pressed('Escape')) this.actions.back();
    if (input.pressed('Space') && this.net.connected) this.find();
  }

  private async account(mode: 'signin' | 'register'): Promise<void> {
    this.busy = true;
    const ok = await accountDialog(this.net, mode, { recovery: (codes) => recoveryCodesDialog(codes), forgot: () => recoverDialog(this.net) });
    this.busy = false;
    if (ok) {
      this.message = `Welcome, ${this.net.me.user?.username}!`;
      this.reopenPanels();
    }
  }

  private reopenPanels(): void {
    this.chat?.dispose();
    this.chat = new ChatPanel(this.net);
    this.social?.dispose();
    this.social = new SocialPanel(this.net, { watch: this.actions.watchFriend, profile: this.actions.profile });
  }

  private async signOut(): Promise<void> {
    this.busy = true;
    await this.net.api('/api/logout', {});
    await this.net.refreshMe();
    await this.net.reconnect();
    this.busy = false;
    this.mode = 'casual';
    this.message = 'Signed out';
    this.reopenPanels();
  }

  render(): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    backdrop(v);
    const kind = this.net.hello?.server;
    heading(v, 'Play Online', kind === 'demo' ? 'DEMO SERVER: new things being tested, progress here is separate' : 'Eight trainers, one island, one winner', 52 * s);
    const mx = this.ctx.input.mouseX;
    const my = this.ctx.input.mouseY;
    const r = this.rects();
    const over = (k: HubButton) => hit(mx, my, r[k].x, r[k].y, r[k].w, r[k].h);
    const me = this.net.me;
    const card = r.me;
    panel(v, card.x, card.y, card.w, card.h, 18, 'rgba(18,14,34,0.9)');
    const cx = v.width / 2;
    if (me.signedIn && me.user) {
      const pr = me.progress;
      text(v, `${me.user.username}${pr ? `  ·  Lv ${pr.level}` : ''}`, cx, card.y + 30 * s, 22, { align: 'center', color: INK.text, shadow: false });
      if (me.title) text(v, me.title, cx, card.y + 12 * s, 11, { align: 'center', color: INK.accent, shadow: false });
      if (pr && pr.next) {
        // Progress to the next level, a thin bar along the card's top edge.
        const bw = 220 * s;
        const h = v.hud;
        h.fillStyle = 'rgba(74,52,36,0.25)';
        h.fillRect(cx - bw / 2, card.y + 40 * s, bw, 4 * s);
        h.fillStyle = '#f2c24a';
        h.fillRect(cx - bw / 2, card.y + 40 * s, (bw * pr.into) / pr.next, 4 * s);
      }
      const rk = this.net.ranked;
      const rankLine = !rk ? '' : rk.tier ? `${rk.tier.name} · ${rk.rating}${rk.rank ? ` · #${rk.rank}` : ''} · season ${rk.season}` : rk.games ? `Ranked: ${rk.placementLeft} placement game${rk.placementLeft === 1 ? '' : 's'} left` : `Ranked season ${rk.season}: play 5 placement games for a tier`;
      text(v, rankLine, cx, card.y + 60 * s, 14, { align: 'center', color: rk?.tier?.color ?? INK.accent, shadow: false });
      const st = me.stats;
      text(v, st ? `${st.wins} wins · ${st.matches} matches · ${st.catches} catches` : '', cx, card.y + 80 * s, 12, { align: 'center', color: INK.dim, shadow: false });
      button(v, 'Sign out', r.signout.x, r.signout.y, r.signout.w, r.signout.h, over('signout'), '#f4e6c8');
    } else {
      text(v, this.net.hello?.name ?? 'Guest', cx, card.y + 34 * s, 22, { align: 'center', color: INK.text, shadow: false });
      wrapText(v, 'Playing as a guest: nothing you win is kept, and ranked, friends and parties need an account.', cx, card.y + 58 * s, 12, card.w - 40 * s, 16 * s, 2, { align: 'center', color: INK.dim, shadow: false });
      button(v, 'Sign in', r.signin.x, r.signin.y, r.signin.w, r.signin.h, over('signin'), '#f4e6c8');
      button(v, 'Create account', r.register.x, r.register.y, r.register.w, r.register.h, over('register'), '#f4e6c8');
    }
    button(v, 'Casual', r.casual.x, r.casual.y, r.casual.w, r.casual.h, over('casual'), this.mode === 'casual' ? undefined : '#f4e6c8');
    button(v, 'Ranked', r.ranked.x, r.ranked.y, r.ranked.w, r.ranked.h, over('ranked'), this.mode === 'ranked' ? undefined : '#f4e6c8');
    const f = this.findState();
    button(v, f.label, r.find.x, r.find.y, r.find.w, r.find.h, f.ok && over('find'), f.ok ? undefined : '#44405a');
    const small: Array<[HubButton, string]> = [['create', 'Private Lobby'], ['join', 'Join with Code'], ['watch', 'Watch Live'], ['replays', 'Replays'], ['boards', 'Leaderboards']];
    for (const [k, label] of small) button(v, label, r[k].x, r[k].y, r[k].w, r[k].h, over(k), '#f4e6c8');
    if (this.message) text(v, this.message, cx, r.watch.y + r.watch.h + 26 * s, 13, { align: 'center', color: '#f4ecdc', maxWidth: v.width - 60 * s });
    button(v, 'Back (Esc)', r.back.x, r.back.y, r.back.w, r.back.h, over('back'), '#f4e6c8');
    if (this.net.ping) text(v, `${this.net.ping} ms`, v.width - 20 * s, v.height - 16 * s, 11, { align: 'right', color: '#9f97bb' });
  }
}

const TEAM_LABEL: Record<PrivateRules['teams'], string> = { solo: 'Everyone for themselves', duos: 'Teams of two', squads: 'Teams of four', pick: 'Players pick a team' };

/**
 * A private lobby: the code to share, who is in, and the rules (the host changes them; everyone
 * sees). The host starts it; then everyone rolls a starter and the match begins.
 */
export class PrivateLobbyScreen implements Screen {
  private chat: ChatPanel | null = null;
  private box: HTMLDivElement | null = null;
  private unsub: (() => void) | null = null;
  private t = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly net: Connection,
    private readonly onLeave: () => void,
  ) {}

  enter(): void {
    this.chat = new ChatPanel(this.net);
    this.box = el('div', 'almia-panel almia-center beside-chat');
    overlayRoot().appendChild(this.box);
    this.unsub = this.net.on((m) => {
      if (m.t !== 'private') return;
      if (!m.lobby) return this.onLeave();
      this.draw();
    });
    this.draw();
  }

  exit(): void {
    this.unsub?.();
    this.chat?.dispose();
    this.box?.remove();
  }

  private draw(): void {
    const box = this.box;
    const l = this.net.privateLobby;
    if (!box || !l) return;
    const host = l.host === l.you;
    const send = (rules: Partial<PrivateRules>) => this.net.send({ t: 'private', a: 'rules', rules });
    box.replaceChildren();
    const head = el('div');
    head.style.display = 'flex';
    head.style.justifyContent = 'space-between';
    head.style.alignItems = 'center';
    const title = el('div');
    title.append(el('h2', '', 'Private lobby'), el('div', 'almia-note', host ? 'You host: share the code, set the rules, start when ready.' : `${l.host} hosts this lobby.`));
    const codeBox = el('div');
    codeBox.style.textAlign = 'right';
    const code = el('div', 'almia-code', l.code);
    const copy = el('button', 'almia-small alt', 'Copy code');
    copy.onclick = () => {
      void navigator.clipboard?.writeText(l.code).then(() => (copy.textContent = 'Copied'));
    };
    codeBox.append(code, copy);
    head.append(title, codeBox);
    box.append(head);
    // Who is in.
    box.append(el('h3', '', `Trainers · ${l.members.length}/${l.rules.size}${l.rules.bots && l.members.length < l.rules.size ? ' (computer trainers fill the rest)' : ''}`));
    for (const m of l.members) {
      const row = el('div', 'almia-row');
      const nm = el('span', 'nm', `${m.name === l.host ? '♛ ' : ''}${m.name}${m.name === l.you ? ' (you)' : ''}`);
      if (m.picked !== undefined) nm.append(el('span', 'sub', m.picked ? 'Starter picked' : 'Picking a starter...'));
      row.append(nm);
      if (l.rules.teams === 'pick') {
        const sel = el('select');
        for (let t = 1; t <= 4; t++) {
          const o = el('option', '', `Team ${t}`);
          o.value = String(t);
          if (m.team === t) o.selected = true;
          sel.append(o);
        }
        sel.disabled = m.name !== l.you || l.state !== 'open';
        sel.onchange = () => this.net.send({ t: 'private', a: 'team', team: Number(sel.value) });
        row.append(sel);
      }
      if (host && m.name !== l.you && l.state === 'open') {
        const kick = el('button', 'almia-small alt', 'Remove');
        kick.onclick = () => this.net.send({ t: 'private', a: 'kick', name: m.name });
        row.append(kick);
      }
      box.append(row);
    }
    // The rules.
    box.append(el('h3', '', 'Rules'));
    const grid = el('div', 'almia-rules');
    const locked = !host || l.state !== 'open';
    const select = (label: string, value: string, options: Array<[string, string]>, on: (v: string) => void) => {
      const s = el('select');
      for (const [v, t] of options) {
        const o = el('option', '', t);
        o.value = v;
        if (v === value) o.selected = true;
        s.append(o);
      }
      s.disabled = locked;
      s.onchange = () => on(s.value);
      grid.append(el('label', '', label), s);
    };
    const check = (label: string, value: boolean, on: (v: boolean) => void) => {
      const c = el('input');
      c.type = 'checkbox';
      c.checked = value;
      c.disabled = locked;
      c.onchange = () => on(c.checked);
      const wrap = el('div');
      wrap.append(c);
      grid.append(el('label', '', label), wrap);
    };
    select('Trainers', String(l.rules.size), [2, 3, 4, 5, 6, 7, 8].map((n) => [String(n), String(n)]), (v) => send({ size: Number(v) }));
    check('Computer trainers', l.rules.bots, (v) => send({ bots: v }));
    select('Teams', l.rules.teams, Object.entries(TEAM_LABEL) as Array<[string, string]>, (v) => send({ teams: v as PrivateRules['teams'] }));
    select('Starter level', String(l.rules.level), [5, 10, 15, 20, 30, 40, 50].map((n) => [String(n), `Level ${n}`]), (v) => send({ level: Number(v) }));
    select('Storm', String(l.rules.storm), [['0.5', 'Slow (half speed)'], ['0.75', 'Slower'], ['1', 'Normal'], ['1.5', 'Fast'], ['2', 'Very fast (double)']], (v) => send({ storm: Number(v) }));
    check('Rare-item chest', l.rules.rareChest, (v) => send({ rareChest: v }));
    box.append(grid, el('div', 'almia-note', 'Private matches are for fun: wins, stats and Pokémon from them are not kept.'));
    const actions = el('div', 'almia-actions');
    const leave = el('button', 'almia-btn alt', 'Leave');
    leave.onclick = () => this.net.send({ t: 'private', a: 'leave' });
    actions.append(leave);
    if (host) {
      const start = el('button', 'almia-btn', l.state === 'picking' ? 'Starting...' : 'Start the match');
      start.disabled = l.state !== 'open';
      start.onclick = () => this.net.send({ t: 'private', a: 'start' });
      actions.append(start);
    }
    box.append(actions);
  }

  step(dt: number, input: Input): void {
    this.t += dt;
    input.takeClicks();
  }

  render(): void {
    const v = this.ctx.view;
    backdrop(v);
  }
}

/**
 * Waiting for the match to fill: who is in, and how long until it starts (empty seats get computer
 * trainers). A party waits here first for everyone to pick. The match itself starts from main.ts,
 * whatever screen is up when the server says so.
 */
export class LobbyScreen implements Screen {
  private chat: ChatPanel | null = null;
  private players: string[] = [];
  private startsIn: number | null = null;
  private size = 8;
  private mode: QueueMode | undefined;
  private unsub: (() => void) | null = null;
  private t = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly net: Connection,
    private readonly onLeave: (why?: string) => void,
  ) {}

  enter(): void {
    this.chat = new ChatPanel(this.net);
    this.unsub = this.net.on((m) => {
      if (m.t === 'lobby') {
        this.players = m.players;
        this.startsIn = m.startsIn;
        this.size = m.size;
        this.mode = m.mode;
      } else if (m.t === 'unqueued') this.onLeave(m.text);
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
        return this.onLeave(party(this.net) ? 'You left the queue (your party too)' : undefined);
      }
    }
  }

  render(): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    backdrop(v);
    const dots = '.'.repeat(1 + (Math.floor(this.t * 2) % 3));
    const party = this.net.social.party;
    const waitingParty = this.startsIn === null && party && party.members.length > 1;
    const picked = party?.members.filter((m) => m.picked).length ?? 0;
    const sub = waitingParty ? `Your party is picking starters (${picked}/${party.members.length})` : this.startsIn === null ? 'Joining the queue' : `Starting in ${Math.ceil(this.startsIn)}s · empty spots get computer trainers`;
    heading(v, `${this.mode === 'ranked' ? 'Ranked · ' : ''}Finding trainers${dots}`, sub, 80 * s);
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

const party = (net: Connection) => (net.social.party?.members.length ?? 0) > 1;

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
    /** Knocked out while the match goes on: watch the rest of it (your squad first). */
    private readonly onWatch: (() => void) | null = null,
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
    if (this.onWatch) return { x: v.width / 2 + 6 * s, y: v.height / 2 + 196 * s, w: 220 * s, h: 52 * s };
    return { x: v.width / 2 - 110 * s, y: v.height / 2 + 196 * s, w: 220 * s, h: 52 * s };
  }

  private watchRect(): Rect {
    const v = this.ctx.view;
    const s = v.baseScale;
    return { x: v.width / 2 - 226 * s, y: v.height / 2 + 196 * s, w: 220 * s, h: 52 * s };
  }

  step(dt: number, input: Input): void {
    this.t += dt;
    const d = this.doneRect();
    for (const c of input.takeClicks()) {
      if (hit(c.x, c.y, d.x, d.y, d.w, d.h)) return this.onDone();
      const w = this.watchRect();
      if (this.onWatch && hit(c.x, c.y, w.x, w.y, w.w, w.h)) return this.onWatch();
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
    text(v, win ? (this.place === 1 && this.net.social.party ? 'Your squad is the last standing!' : 'Last trainer standing!') : `You placed #${this.place}`, v.width / 2, py + 86 * s, 16, { align: 'center', color: INK.dim, shadow: false });
    const prog = this.net.progress;
    if (prog && this.net.me.signedIn) {
      const total = prog.xp.reduce((n, x) => n + x.xp, 0);
      const up = prog.after.level > prog.before.level;
      text(v, `+${total} XP${up ? `  ·  Level ${prog.after.level}!` : `  ·  Level ${prog.after.level}`}`, v.width / 2, py + 134 * s, 15, { align: 'center', color: up ? INK.accent : INK.text, shadow: false });
      const lines = prog.xp.map((x) => `${x.what} +${x.xp}`).join('  ·  ');
      wrapText(v, lines, v.width / 2, py + 152 * s, 11, pw - 60 * s, 14 * s, 2, { align: 'center', color: INK.dim, shadow: false });
      prog.achievements.slice(0, 2).forEach((a, i) => {
        text(v, `★ ${a.name}${a.title ? ` · new title: ${a.title}` : ''}${a.look ? ' · new look' : ''}`, v.width / 2, py + 186 * s + i * 18 * s, 13, { align: 'center', color: '#c2611a', shadow: false, maxWidth: pw - 40 * s });
      });
    }
    const rated = this.net.rated;
    if (rated) {
      const d = rated.after - rated.before;
      const tier = rated.tier ? `${rated.tier.name} · ` : rated.placementLeft ? `${rated.placementLeft} placement game${rated.placementLeft === 1 ? '' : 's'} left · ` : '';
      text(v, `Ranked: ${tier}${rated.after} (${d >= 0 ? '+' : ''}${d})`, v.width / 2, py + 108 * s, 14, { align: 'center', color: rated.tier?.color ?? (d >= 0 ? INK.good : INK.bad), shadow: false });
    }
    const mx = this.ctx.input.mouseX;
    const my = this.ctx.input.mouseY;
    if (!this.net.me.signedIn) {
      wrapText(v, win ? 'You won as a guest, so nothing could be kept. Sign in next time to keep a Pokémon from every win.' : 'Sign in to keep your stats and the Pokémon you win.', v.width / 2, py + 140 * s, 14, pw - 80 * s, 20 * s, 3, { align: 'center', color: INK.text, shadow: false });
    } else if (this.info?.picks) {
      text(v, `Keep ${this.info.picks > 1 ? `up to ${this.info.picks} Pokémon` : 'one Pokémon'}: it goes to your PC on the server`, v.width / 2, py + 232 * s, 14, { align: 'center', color: INK.blue, shadow: false, maxWidth: pw - 60 * s });
      this.pickRects().forEach((r, i) => {
        const m = this.info?.party?.[i];
        if (!m) return;
        button(v, `${m.shiny ? '★ ' : ''}${m.name} Lv ${m.level}${m.taken ? '  ✓' : ''}`, r.x, r.y, r.w, r.h, !m.taken && hit(mx, my, r.x, r.y, r.w, r.h), m.taken ? '#44405a' : '#f4e6c8');
      });
    } else if (this.net.me.signedIn) {
      text(v, win ? (this.note ? 'Your win and stats are saved.' : 'Saving your win...') : 'Your stats were saved.', v.width / 2, py + 232 * s, 14, { align: 'center', color: INK.text, shadow: false });
    }
    if (this.note) text(v, this.note, v.width / 2, py + ph - 110 * s, 14, { align: 'center', color: INK.good, shadow: false });
    const d = this.doneRect();
    button(v, this.net.privateLobby ? 'Back to the lobby' : 'Back', d.x, d.y, d.w, d.h, hit(mx, my, d.x, d.y, d.w, d.h));
    if (this.onWatch) {
      const w = this.watchRect();
      button(v, 'Watch the rest', w.x, w.y, w.w, w.h, hit(mx, my, w.x, w.y, w.w, w.h), '#f4e6c8');
    }
  }
}
