/**
 * The online screens: the hub (your account, friends and party, private lobbies,
 * watching and replays), a private lobby, the lobby while a match fills up, and the end of a match
 * (the result, and for a win the Pokémon to keep; the server checks every
 * pick and keeps the PC).
 */
import type { Input } from '../core/input';
import type { Connection } from '../net/connection';
import type { PrivateRules, QueueMode, ServerMsg } from '../net/protocol';
import { accountDialog, ChatPanel, el, overlayRoot } from './overlay';
import { recoverDialog, recoveryCodesDialog } from './socialPanel';
import { openOptions } from './optionsMenu';
import { LEVELS_ON } from '../net/progression';
import { incomingTrades, openTrades, openTrainerCard } from './tradeMenu';
import { ASSET_ROOT } from '../sprites/assets';
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

type HubButton = 'find' | 'signin' | 'register' | 'signout' | 'trade' | 'options' | 'back' | 'me' | 'privacy';

/** The game logo, shared by every hub screen once loaded. */
let hubLogo: HTMLImageElement | null = null;
function loadHubLogo(): void {
  if (hubLogo) return;
  const im = new Image();
  im.src = `${ASSET_ROOT}ui/logo.png`;
  im.onload = () => (hubLogo = im);
}

/** A piece of the island (the castle and the forest lake, assets/ui/hub_bg.png) behind the hub. */
let hubBg: HTMLImageElement | null = null;
let hubBgAsked = false;
function hubBackdrop(v: GameContext['view'], t: number): void {
  if (!hubBgAsked) {
    hubBgAsked = true;
    const im = new Image();
    im.src = `${ASSET_ROOT}ui/hub_bg.png`;
    im.onload = () => (hubBg = im);
  }
  const h = v.hud;
  if (!hubBg) return backdrop(v);
  // Cover the screen at a whole-number scale (crisp pixels), drifting slowly side to side.
  const k = Math.max(1, Math.ceil(Math.max(v.width / hubBg.width, v.height / hubBg.height) * 1.15));
  const w = hubBg.width * k;
  const hh = hubBg.height * k;
  const spare = Math.max(0, w - v.width);
  const x = -spare / 2 - Math.sin(t * 0.05) * spare * 0.4;
  const y = -(hh - v.height) / 2;
  h.save();
  h.imageSmoothingEnabled = false;
  h.drawImage(hubBg, Math.round(x), Math.round(y), w, hh);
  // dusk over it, darker toward the edges, so the cream panel reads
  h.fillStyle = 'rgba(20,12,40,0.38)';
  h.fillRect(0, 0, v.width, v.height);
  const g = h.createRadialGradient(v.width / 2, v.height * 0.45, Math.min(v.width, v.height) * 0.25, v.width / 2, v.height * 0.5, Math.max(v.width, v.height) * 0.75);
  g.addColorStop(0, 'rgba(8,4,18,0)');
  g.addColorStop(1, 'rgba(8,4,18,0.6)');
  h.fillStyle = g;
  h.fillRect(0, 0, v.width, v.height);
  h.restore();
}

/**
 * The hub: the game's logo over a night sky, your trainer card, one big Find a
 * Match, private matches with friends, and the leaderboard. Chat sits bottom left.
 */
export class OnlineScreen implements Screen {
  private chat: ChatPanel | null = null;
  private busy = false;
  private t = 0;
  private message = '';
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
    loadHubLogo();
    this.chat = new ChatPanel(this.net, { side: true, collapsed: window.innerWidth < 900, onName: (n) => void openTrainerCard(this.net, n).then(() => this.checkTrades()) });
    void this.net.refreshMe().then(() => this.checkTrades());
    this.unsubTrades = this.net.on((m) => {
      if (m.t === 'trades') void this.checkTrades();
    });
    const q = new URLSearchParams(location.search).get('signin');
    if (q && !this.message) this.message = q;
  }

  exit(): void {
    this.chat?.dispose();
    this.chat = null;
    this.unsubTrades?.();
  }

  private unsubTrades: (() => void) | null = null;
  /** Trade offers waiting for this player (the Trade button's badge). */
  private tradesWaiting = 0;

  private async checkTrades(): Promise<void> {
    if (!this.net.me.signedIn) {
      this.tradesWaiting = 0;
      return;
    }
    const n = await incomingTrades(this.net);
    if (n > this.tradesWaiting) this.message = `You have ${n} trade update${n === 1 ? '' : 's'} waiting`;
    else if (!n && this.message.includes('trade update')) this.message = '';
    this.tradesWaiting = n;
  }

  /** The column everything sits in. */
  private layout(): { cx: number; w: number; logoY: number; logoH: number; cardY: number; cardH: number } {
    const v = this.ctx.view;
    const s = v.baseScale;
    const w = Math.min(520 * s, v.width - 32 * s);
    const logoH = Math.min(v.height * 0.22, 160 * s);
    const logoY = 24 * s;
    const cardY = logoY + logoH + 16 * s;
    const cardH = 150 * s;
    return { cx: v.width / 2, w, logoY, logoH, cardY, cardH };
  }

  private rects(): Record<HubButton, Rect> {
    const v = this.ctx.view;
    const s = v.baseScale;
    const L = this.layout();
    const x0 = L.cx - L.w / 2;
    const y = L.cardY;
    const signedIn = this.net.me.signedIn;
    return {
      me: { x: x0, y, w: L.w, h: L.cardH },
      signin: signedIn ? { x: -999, y: -999, w: 0, h: 0 } : { x: L.cx - 228 * s, y: y + 92 * s, w: 220 * s, h: 42 * s },
      register: signedIn ? { x: -999, y: -999, w: 0, h: 0 } : { x: L.cx + 8 * s, y: y + 92 * s, w: 220 * s, h: 42 * s },
      signout: signedIn ? { x: L.cx - 80 * s, y: y + 98 * s, w: 160 * s, h: 36 * s } : { x: -999, y: -999, w: 0, h: 0 },
      find: { x: L.cx - 170 * s, y: y + L.cardH + 26 * s, w: 340 * s, h: 66 * s },
      trade: signedIn ? { x: L.cx - 172 * s, y: y + L.cardH + 132 * s, w: 164 * s, h: 44 * s } : { x: -999, y: -999, w: 0, h: 0 },
      options: signedIn ? { x: L.cx + 8 * s, y: y + L.cardH + 132 * s, w: 164 * s, h: 44 * s } : { x: L.cx - 84 * s, y: y + L.cardH + 132 * s, w: 168 * s, h: 44 * s },
      back: { x: 24 * s, y: 24 * s, w: 140 * s, h: 44 * s },
      privacy: { x: L.cx - 40 * s, y: v.height - 30 * s, w: 80 * s, h: 22 * s },
    };
  }

  /** What Find a Match does right now, and why it can not. */
  private findState(): { label: string; ok: boolean; why?: string } {
    const net = this.net;
    if (!net.connected) return { label: 'Connecting...', ok: false };
    return { label: 'Find a Match (Space)', ok: true };
  }

  private find(): void {
    const f = this.findState();
    if (!f.ok) return;
    // One queue for everyone for now, so every player fills the same matches.
    this.actions.find('casual');
  }

  step(dt: number, input: Input): void {
    this.t += dt;
    if (this.chat?.focused() || this.busy || document.querySelector('.almia-modal-wrap')) {
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
      if (signedIn && on(c, 'trade')) {
        this.busy = true;
        void openTrades(this.net).then(() => {
          this.busy = false;
          void this.checkTrades();
        });
        return;
      }
      if (on(c, 'options')) {
        this.busy = true;
        void openOptions().then(() => (this.busy = false));
        return;
      }
      if (on(c, 'privacy')) window.open(`${this.net.base}/privacy`, '_blank', 'noopener');
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
      this.chat?.dispose();
      this.chat = new ChatPanel(this.net, { side: true, onName: (n) => void openTrainerCard(this.net, n) });
      void this.checkTrades();
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
    this.chat = new ChatPanel(this.net, { side: true, onName: (n) => void openTrainerCard(this.net, n) });
    this.tradesWaiting = 0;
  }

  render(): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    const h = v.hud;
    hubBackdrop(v, this.t);
    const L = this.layout();
    const mx = this.ctx.input.mouseX;
    const my = this.ctx.input.mouseY;
    const r = this.rects();
    const over = (k: HubButton) => hit(mx, my, r[k].x, r[k].y, r[k].w, r[k].h);
    // The game's logo, as on the title.
    if (hubLogo) {
      const k = Math.min((L.w * 1.15) / hubLogo.width, L.logoH / hubLogo.height);
      const lw = hubLogo.width * k;
      const lh = hubLogo.height * k;
      h.save();
      h.imageSmoothingEnabled = true;
      h.imageSmoothingQuality = 'high';
      h.drawImage(hubLogo, L.cx - lw / 2, L.logoY + (L.logoH - lh) / 2, lw, lh);
      h.restore();
    } else heading(v, 'Play Online', null, L.logoY + L.logoH / 2);
    const ev = this.net.events;
    if (ev.length) {
      const left = (t: number) => {
        const m = Math.max(0, Math.round((t - Date.now()) / 60000));
        return m >= 120 ? `${Math.round(m / 60)} h left` : `${m} min left`;
      };
      text(v, `★ ${ev.map((e) => `${e.name} · ${left(e.endsAt)}`).join('   ★ ')}`, L.cx, L.cardY - 6 * s, 14, { align: 'center', color: '#f2c24a', maxWidth: v.width - 80 * s });
    }
    // Your trainer card.
    const me = this.net.me;
    const card = r.me;
    panel(v, card.x, card.y, card.w, card.h, 18, 'rgba(18,14,34,0.9)');
    const cx = L.cx;
    if (me.signedIn && me.user) {
      const pr = me.progress;
      text(v, `${me.user.username}${pr && LEVELS_ON ? `  ·  Lv ${pr.level}` : ''}`, cx, card.y + 36 * s, 22, { align: 'center', color: INK.text, shadow: false });
      if (me.title) text(v, me.title, cx, card.y + 16 * s, 11, { align: 'center', color: INK.accent, shadow: false });
      if (pr && pr.next) {
        const bw = 220 * s;
        h.fillStyle = 'rgba(74,52,36,0.25)';
        h.fillRect(cx - bw / 2, card.y + 46 * s, bw, 4 * s);
        h.fillStyle = '#f2c24a';
        h.fillRect(cx - bw / 2, card.y + 46 * s, (bw * pr.into) / pr.next, 4 * s);
      }
      const st = me.stats;
      text(v, st ? `${st.wins} wins · ${st.eliminations ?? 0} eliminations · ${st.matches} matches · ${st.catches} catches` : '', cx, card.y + 74 * s, 13, { align: 'center', color: INK.dim, shadow: false });
      button(v, 'Sign out', r.signout.x, r.signout.y, r.signout.w, r.signout.h, over('signout'), '#f4e6c8');
    } else {
      text(v, this.net.hello?.name ?? 'Guest', cx, card.y + 38 * s, 22, { align: 'center', color: INK.text, shadow: false });
      wrapText(v, 'Playing as a guest: sign in to keep the Pokémon you win.', cx, card.y + 64 * s, 12, card.w - 40 * s, 16 * s, 2, { align: 'center', color: INK.dim, shadow: false });
      button(v, 'Sign in', r.signin.x, r.signin.y, r.signin.w, r.signin.h, over('signin'), '#f4e6c8');
      button(v, 'Create account', r.register.x, r.register.y, r.register.w, r.register.h, over('register'), '#f4e6c8');
    }
    // One way in: everyone fills the same matches.
    const f = this.findState();
    button(v, f.label, r.find.x, r.find.y, r.find.w, r.find.h, f.ok && over('find'), f.ok ? undefined : '#44405a');
    text(v, 'Ten trainers, one island, one winner.', cx, r.find.y + r.find.h + 22 * s, 12, { align: 'center', color: '#cfc6ea', maxWidth: v.width - 60 * s });
    if (me.signedIn) button(v, this.tradesWaiting ? `Trade (${this.tradesWaiting})` : 'Trade', r.trade.x, r.trade.y, r.trade.w, r.trade.h, over('trade'), this.tradesWaiting ? undefined : '#f4e6c8');
    button(v, 'Options', r.options.x, r.options.y, r.options.w, r.options.h, over('options'), '#f4e6c8');
    const sy = r.options.y + r.options.h + 34 * s;
    text(v, this.net.connected ? `Connected${this.net.ping ? ` · ${this.net.ping} ms` : ''}` : 'Connecting...', cx, sy, 12, { align: 'center', color: this.net.connected ? '#9fe8b8' : '#ffe2a0' });
    if (this.message) text(v, this.message, cx, sy + 22 * s, 13, { align: 'center', color: '#f4ecdc', maxWidth: v.width - 60 * s });
    if (this.net.hello?.server === 'demo') text(v, 'DEMO SERVER: progress here is separate', cx, sy + 42 * s, 11, { align: 'center', color: '#ff9a9a' });
    button(v, 'Back (Esc)', r.back.x, r.back.y, r.back.w, r.back.h, over('back'), '#f4e6c8');
    text(v, 'Privacy', cx, r.privacy.y + 15 * s, 11, { align: 'center', color: over('privacy') ? '#f4ecdc' : '#9f97bb' });
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
    select('Trainers', String(l.rules.size), [2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [String(n), String(n)]), (v) => send({ size: Number(v) }));
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
  private need = 0;
  /** Real players a match needs before computer trainers fill the rest (the server says). */
  private min = 5;
  private size = 10;
  /** An administrator's lobby: they may start it now, alone or with whoever is here (the server checks). */
  private admin = false;
  private mode: QueueMode | undefined;
  private unsub: (() => void) | null = null;
  private t = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly net: Connection,
    private readonly onLeave: (why?: string) => void,
  ) {}

  enter(): void {
    this.chat = new ChatPanel(this.net, { side: true, onName: (n) => void openTrainerCard(this.net, n) });
    this.unsub = this.net.on((m) => {
      if (m.t === 'lobby') {
        this.players = m.players;
        this.startsIn = m.startsIn;
        this.need = m.need ?? 0;
        this.size = m.size;
        this.min = m.min ?? Math.ceil(m.size / 2);
        this.admin = !!m.admin;
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
    return { x: v.width / 2 - 110 * s, y: v.height / 2 + 232 * s, w: 220 * s, h: 50 * s };
  }

  /** Casual queues only: done waiting, start with computer trainers filling the rest. */
  private startNowRect(): Rect | null {
    // An administrator may start at any time (even alone); everyone else once the countdown runs.
    if (!this.admin && (this.startsIn === null || this.startsIn < 4)) return null;
    if (this.admin && this.startsIn !== null && this.startsIn < 4) return null;
    const v = this.ctx.view;
    const s = v.baseScale;
    return { x: v.width / 2 - 110 * s, y: v.height / 2 + 176 * s, w: 220 * s, h: 50 * s };
  }

  step(dt: number, input: Input): void {
    this.t += dt;
    if (this.startsIn !== null) this.startsIn = Math.max(0, this.startsIn - dt);
    const b = this.leaveRect();
    const sn = this.startNowRect();
    for (const c of input.takeClicks()) {
      if (sn && hit(c.x, c.y, sn.x, sn.y, sn.w, sn.h)) {
        this.net.send({ t: 'startNow' });
        this.startsIn = Math.min(this.startsIn ?? 2, 2);
      } else if (hit(c.x, c.y, b.x, b.y, b.w, b.h)) {
        this.net.send({ t: 'leaveQueue' });
        return this.onLeave(party(this.net) ? 'You left the queue (your party too)' : undefined);
      }
    }
  }

  render(): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    hubBackdrop(v, this.t);
    const dots = '.'.repeat(1 + (Math.floor(this.t * 2) % 3));
    const party = this.net.social.party;
    const waitingParty = this.startsIn === null && party && party.members.length > 1;
    const picked = party?.members.filter((m) => m.picked).length ?? 0;
    const sub = waitingParty
      ? `Your party is picking starters (${picked}/${party.members.length})`
      : this.need > 0
        ? `Waiting for ${this.need} more player${this.need === 1 ? '' : 's'} (${this.min} needed before bots fill in)`
        : this.startsIn === null
          ? 'Joining the queue'
          : `Starting in ${Math.ceil(this.startsIn)}s`;
    heading(v, `Finding trainers${dots}`, sub, 80 * s);
    const pw = 460 * s;
    const px = v.width / 2 - pw / 2;
    const py = v.height / 2 - 170 * s;
    panel(v, px, py, pw, 340 * s, 18, 'rgba(18,14,34,0.9)');
    text(v, `${this.players.length} / ${this.size} trainers`, v.width / 2, py + 34 * s, 18, { align: 'center', color: INK.accent, shadow: false });
    for (let i = 0; i < this.size; i++) {
      const y = py + 66 * s + i * 27 * s;
      const name = this.players[i];
      text(v, name ?? (i < this.players.length ? '' : 'waiting...'), v.width / 2, y, 15, { align: 'center', color: name ? INK.text : INK.dim, shadow: false });
    }
    const b = this.leaveRect();
    const sn = this.startNowRect();
    if (sn) button(v, this.admin && this.need > 0 ? 'Start now (admin)' : 'Start now with bots', sn.x, sn.y, sn.w, sn.h, hit(this.ctx.input.mouseX, this.ctx.input.mouseY, sn.x, sn.y, sn.w, sn.h));
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
    if (prog && this.net.me.signedIn && LEVELS_ON) {
      const total = prog.xp.reduce((n, x) => n + x.xp, 0);
      const up = prog.after.level > prog.before.level;
      text(v, `+${total} XP${up ? `  ·  Level ${prog.after.level}!` : `  ·  Level ${prog.after.level}`}`, v.width / 2, py + 134 * s, 15, { align: 'center', color: up ? INK.accent : INK.text, shadow: false });
      const lines = prog.xp.map((x) => `${x.what} +${x.xp}`).join('  ·  ');
      wrapText(v, lines, v.width / 2, py + 152 * s, 11, pw - 60 * s, 14 * s, 2, { align: 'center', color: INK.dim, shadow: false });
      prog.achievements.slice(0, 2).forEach((a, i) => {
        text(v, `★ ${a.name}${a.title ? ` · new title: ${a.title}` : ''}${a.look ? ' · new look' : ''}`, v.width / 2, py + 186 * s + i * 18 * s, 13, { align: 'center', color: '#c2611a', shadow: false, maxWidth: pw - 40 * s });
      });
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
