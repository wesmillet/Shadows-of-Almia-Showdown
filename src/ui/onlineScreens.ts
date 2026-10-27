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
import { recoverDialog, recoveryCodesDialog } from './socialPanel';
import { ASSET_ROOT } from '../sprites/assets';
import { backdrop, button, heading, hit, INK, panel, text, uiFont, wrapText, type GameContext, type Screen } from './screens';

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

type HubButton = 'find' | 'signin' | 'register' | 'signout' | 'back' | 'me' | 'privacy';

/** The game logo, shared by every hub screen once loaded. */
let hubLogo: HTMLImageElement | null = null;
function loadHubLogo(): void {
  if (hubLogo) return;
  const im = new Image();
  im.src = `${ASSET_ROOT}ui/logo.png`;
  im.onload = () => (hubLogo = im);
}

const GOLD = '#f2c24a';
const EMBER = '#ff8a3d';
const VIOLET = '#9b7bff';

/** A rounded rectangle path. */
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Text drawn straight on the HUD in the game font. */
function label(ctx: CanvasRenderingContext2D, v: { baseScale: number }, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center', maxW?: number): void {
  ctx.save();
  let px = size * v.baseScale;
  ctx.font = uiFont(px);
  if (maxW) while (ctx.measureText(s).width > maxW && px > 8) ctx.font = uiFont((px -= 1));
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(6,2,16,0.75)';
  ctx.fillText(s, x + v.baseScale * 1.5, y + v.baseScale * 1.5);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
  ctx.restore();
}

/**
 * A hub button. `primary` glows ember-gold (the one big action); `ghost` is a quiet outline;
 * `on` is a selected segment; `off` is disabled.
 */
function hubButton(ctx: CanvasRenderingContext2D, v: { baseScale: number }, r: Rect, text_: string, kind: 'primary' | 'ghost' | 'on' | 'off', hover: boolean, t: number, size = 14): void {
  const s = v.baseScale;
  const lift = hover && kind !== 'off' ? -2 * s : 0;
  const x = r.x;
  const y = r.y + lift;
  const rad = Math.min(r.h / 2, 12 * s);
  ctx.save();
  if (kind === 'primary') {
    const pulse = 0.55 + 0.25 * Math.sin(t * 2.4);
    ctx.shadowColor = `rgba(255,140,60,${hover ? 0.9 : pulse})`;
    ctx.shadowBlur = (hover ? 30 : 22) * s;
    const g = ctx.createLinearGradient(0, y, 0, y + r.h);
    g.addColorStop(0, hover ? '#ffd27a' : '#ffc45c');
    g.addColorStop(0.55, '#ff8a3d');
    g.addColorStop(1, '#d9531f');
    ctx.fillStyle = g;
    rr(ctx, x, y, r.w, r.h, rad);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,240,200,0.85)';
    ctx.lineWidth = 2 * s;
    rr(ctx, x + 1 * s, y + 1 * s, r.w - 2 * s, r.h - 2 * s, rad);
    ctx.stroke();
    // a sheen sweeping across now and then
    const k = (t * 0.35) % 1.6;
    if (k < 1) {
      ctx.save();
      rr(ctx, x, y, r.w, r.h, rad);
      ctx.clip();
      const sx = x - r.w * 0.3 + k * r.w * 1.6;
      const sh = ctx.createLinearGradient(sx - 40 * s, 0, sx + 40 * s, 0);
      sh.addColorStop(0, 'rgba(255,255,255,0)');
      sh.addColorStop(0.5, 'rgba(255,255,255,0.35)');
      sh.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sh;
      ctx.fillRect(x, y, r.w, r.h);
      ctx.restore();
    }
    ctx.restore();
    label(ctx, v, text_, x + r.w / 2, y + r.h / 2 + 1 * s, size, '#2a0f04', 'center', r.w - 24 * s);
    return;
  }
  if (kind === 'on') {
    const g = ctx.createLinearGradient(0, y, 0, y + r.h);
    g.addColorStop(0, '#8f6cff');
    g.addColorStop(1, '#5a3cc8');
    ctx.fillStyle = g;
  } else if (kind === 'off') {
    ctx.fillStyle = 'rgba(70,64,96,0.6)';
  } else {
    ctx.fillStyle = hover ? 'rgba(155,123,255,0.22)' : 'rgba(30,22,58,0.7)';
  }
  rr(ctx, x, y, r.w, r.h, rad);
  ctx.fill();
  ctx.strokeStyle = kind === 'on' ? 'rgba(220,206,255,0.9)' : kind === 'off' ? 'rgba(120,112,150,0.6)' : hover ? 'rgba(220,206,255,0.9)' : 'rgba(155,123,255,0.55)';
  ctx.lineWidth = 1.5 * s;
  rr(ctx, x + 0.75 * s, y + 0.75 * s, r.w - 1.5 * s, r.h - 1.5 * s, rad);
  ctx.stroke();
  ctx.restore();
  label(ctx, v, text_, x + r.w / 2, y + r.h / 2 + 1 * s, size, kind === 'off' ? '#8c85a8' : '#f4eeff', 'center', r.w - 16 * s);
}

/**
 * The hub: the game's logo over a night sky, your trainer card, Casual or Ranked, one big Find a
 * Match, private matches with friends, and the leaderboard. Chat sits bottom left.
 */
export class OnlineScreen implements Screen {
  private chat: ChatPanel | null = null;
  private busy = false;
  private t = 0;
  private message = '';
  /** When a dialog or text box last had the keyboard. */
  private dialogAt = -1;
  private readonly stars: Array<{ x: number; y: number; r: number; p: number }> = [];

  constructor(
    private readonly ctx: GameContext,
    private readonly net: Connection,
    private readonly actions: HubActions,
    message = '',
  ) {
    this.message = message;
    for (let i = 0; i < 90; i++) this.stars.push({ x: Math.random(), y: Math.random() * 0.75, r: Math.random() * 1.4 + 0.4, p: Math.random() * 10 });
  }

  enter(): void {
    loadHubLogo();
    this.chat = new ChatPanel(this.net);
    void this.net.refreshMe();
    const q = new URLSearchParams(location.search).get('signin');
    if (q && !this.message) this.message = q;
  }

  exit(): void {
    this.chat?.dispose();
    this.chat = null;
  }

  /** The column everything sits in. */
  private layout(): { cx: number; w: number; logoY: number; logoH: number; cardY: number; cardH: number } {
    const v = this.ctx.view;
    const s = v.baseScale;
    const w = Math.min(600 * s, v.width - 32 * s);
    const logoH = Math.min(v.height * 0.2, 150 * s);
    const logoY = 26 * s;
    const cardY = logoY + logoH + 18 * s;
    const cardH = 236 * s;
    return { cx: v.width / 2, w, logoY, logoH, cardY, cardH };
  }

  private rects(): Record<HubButton, Rect> {
    const v = this.ctx.view;
    const s = v.baseScale;
    const L = this.layout();
    const x0 = L.cx - L.w / 2;
    const pad = 24 * s;
    const inner = L.w - 2 * pad;
    const y = L.cardY;
    const findY = y + 128 * s;
    const signedIn = this.net.me.signedIn;
    return {
      me: { x: x0 + pad, y: y + 18 * s, w: inner, h: 84 * s },
      signin: { x: x0 + L.w - pad - 250 * s, y: y + 40 * s, w: 118 * s, h: 38 * s },
      register: { x: x0 + L.w - pad - 124 * s, y: y + 40 * s, w: 124 * s, h: 38 * s },
      signout: signedIn ? { x: x0 + L.w - pad - 96 * s, y: y + 22 * s, w: 96 * s, h: 30 * s } : { x: -999, y: -999, w: 0, h: 0 },
      find: { x: x0 + pad, y: findY, w: inner, h: 76 * s },
      back: { x: 20 * s, y: 20 * s, w: 110 * s, h: 40 * s },
      privacy: { x: L.cx - 40 * s, y: v.height - 30 * s, w: 80 * s, h: 22 * s },
    };
  }

  /** What Find a Match does right now, and why it can not. */
  private findState(): { label: string; ok: boolean; why?: string } {
    const net = this.net;
    if (!net.connected) return { label: 'Connecting...', ok: false };
    return { label: 'FIND A MATCH', ok: true };
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
      if (on(c, 'privacy')) window.open(`${this.net.base}/privacy`, '_blank', 'noopener');
      else if (!signedIn && on(c, 'signin')) void this.account('signin');
      else if (!signedIn && on(c, 'register')) void this.account('register');
      else if (signedIn && on(c, 'signout')) void this.signOut();
      else if (signedIn && on(c, 'me') && this.net.me.user) this.actions.profile(this.net.me.user.username);
    }
    if (input.pressed('Escape')) this.actions.back();
    if ((input.pressed('Space') || input.pressed('Enter')) && this.net.connected) this.find();
  }

  private async account(mode: 'signin' | 'register'): Promise<void> {
    this.busy = true;
    const ok = await accountDialog(this.net, mode, { recovery: (codes) => recoveryCodesDialog(codes), forgot: () => recoverDialog(this.net) });
    this.busy = false;
    if (ok) {
      this.message = `Welcome, ${this.net.me.user?.username}!`;
      this.chat?.dispose();
      this.chat = new ChatPanel(this.net);
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

  /** Night sky: a deep gradient, two slow violet nebulae, twinkling stars, a horizon glow. */
  private drawSky(): void {
    const v = this.ctx.view;
    const h = v.hud;
    const W = v.width;
    const H = v.height;
    const g = h.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b0718');
    g.addColorStop(0.55, '#1a1036');
    g.addColorStop(1, '#2a1238');
    h.fillStyle = g;
    h.fillRect(0, 0, W, H);
    const neb = (cx: number, cy: number, r: number, col: string) => {
      const n = h.createRadialGradient(cx, cy, 0, cx, cy, r);
      n.addColorStop(0, col);
      n.addColorStop(1, 'rgba(0,0,0,0)');
      h.fillStyle = n;
      h.fillRect(cx - r, cy - r, r * 2, r * 2);
    };
    neb(W * (0.22 + 0.03 * Math.sin(this.t * 0.07)), H * 0.3, W * 0.42, 'rgba(120,70,220,0.22)');
    neb(W * (0.8 + 0.03 * Math.cos(this.t * 0.05)), H * 0.62, W * 0.38, 'rgba(60,110,230,0.16)');
    neb(W * 0.5, H * 1.05, W * 0.6, 'rgba(255,120,60,0.18)');
    for (const st of this.stars) {
      const a = 0.35 + 0.45 * Math.sin(this.t * 1.6 + st.p);
      h.fillStyle = `rgba(230,220,255,${a})`;
      h.fillRect(st.x * W, st.y * H, st.r * v.baseScale, st.r * v.baseScale);
    }
  }

  render(): void {
    const v = this.ctx.view;
    const s = v.baseScale;
    const h = v.hud;
    // The world layers stay dark under the hub.
    v.ctx.fillStyle = '#0b0718';
    v.ctx.fillRect(0, 0, v.width, v.height);
    h.clearRect(0, 0, v.width, v.height);
    this.drawSky();
    const L = this.layout();
    const mx = this.ctx.input.mouseX;
    const my = this.ctx.input.mouseY;
    const r = this.rects();
    const over = (k: HubButton) => hit(mx, my, r[k].x, r[k].y, r[k].w, r[k].h);
    // The logo.
    if (hubLogo) {
      const k = Math.min(L.w * 1.1 / hubLogo.width, L.logoH / hubLogo.height);
      const lw = hubLogo.width * k;
      const lh = hubLogo.height * k;
      h.save();
      h.imageSmoothingEnabled = true;
      h.imageSmoothingQuality = 'high';
      h.shadowColor = `rgba(150,90,255,${0.45 + 0.2 * Math.sin(this.t * 1.5)})`;
      h.shadowBlur = 26 * s;
      h.drawImage(hubLogo, L.cx - lw / 2, L.logoY + (L.logoH - lh) / 2 + Math.sin(this.t * 1.1) * 2 * s, lw, lh);
      h.restore();
    } else label(h, v, 'SHADOWS OF ALMIA SHOWDOWN', L.cx, L.logoY + L.logoH / 2, 28, GOLD);
    // Events on now, as a ribbon under the logo.
    const ev = this.net.events;
    if (ev.length) {
      const left = (t: number) => {
        const m = Math.max(0, Math.round((t - Date.now()) / 60000));
        return m >= 120 ? `${Math.round(m / 60)} h left` : `${m} min left`;
      };
      label(h, v, `★ ${ev.map((e) => `${e.name} · ${left(e.endsAt)}`).join('   ★ ')}`, L.cx, L.cardY - 8 * s, 12, GOLD, 'center', L.w);
    }
    // The card: dark glass with a violet rim.
    const x0 = L.cx - L.w / 2;
    h.save();
    h.shadowColor = 'rgba(0,0,0,0.6)';
    h.shadowBlur = 30 * s;
    const cg = h.createLinearGradient(0, L.cardY, 0, L.cardY + L.cardH);
    cg.addColorStop(0, 'rgba(34,24,66,0.92)');
    cg.addColorStop(1, 'rgba(18,12,38,0.94)');
    h.fillStyle = cg;
    rr(h, x0, L.cardY, L.w, L.cardH, 20 * s);
    h.fill();
    h.restore();
    h.save();
    h.strokeStyle = 'rgba(155,123,255,0.55)';
    h.lineWidth = 2 * s;
    rr(h, x0 + 1 * s, L.cardY + 1 * s, L.w - 2 * s, L.cardH - 2 * s, 20 * s);
    h.stroke();
    h.restore();
    // Trainer card.
    const me = this.net.me;
    const signedIn = !!(me.signedIn && me.user);
    const name = signedIn ? (me.user as { username: string }).username : this.net.hello?.name ?? 'Guest';
    const av = { x: r.me.x + 36 * s, y: r.me.y + 42 * s, r: 30 * s };
    h.save();
    const ag = h.createLinearGradient(av.x - av.r, av.y - av.r, av.x + av.r, av.y + av.r);
    ag.addColorStop(0, VIOLET);
    ag.addColorStop(1, EMBER);
    h.fillStyle = ag;
    h.beginPath();
    h.arc(av.x, av.y, av.r, 0, Math.PI * 2);
    h.fill();
    h.fillStyle = '#1a1036';
    h.beginPath();
    h.arc(av.x, av.y, av.r - 3 * s, 0, Math.PI * 2);
    h.fill();
    h.restore();
    label(h, v, name.slice(0, 1).toUpperCase(), av.x, av.y + 1 * s, 26, '#f4eeff');
    const tx = av.x + av.r + 16 * s;
    const textW = (signedIn ? r.signout.x : r.signin.x) - tx - 12 * s;
    const pr = me.progress;
    label(h, v, name, tx, r.me.y + 22 * s, 20, '#fff3d6', 'left', textW);
    if (signedIn) {
      if (me.title) label(h, v, me.title, tx, r.me.y + 44 * s, 11, GOLD, 'left', textW);
      if (pr) {
        const bw = Math.min(220 * s, textW);
        const by = r.me.y + 58 * s;
        h.fillStyle = 'rgba(255,255,255,0.1)';
        rr(h, tx, by, bw, 6 * s, 3 * s);
        h.fill();
        h.fillStyle = GOLD;
        rr(h, tx, by, Math.max(6 * s, (bw * (pr.next ? pr.into / pr.next : 1))), 6 * s, 3 * s);
        h.fill();
        label(h, v, `Lv ${pr.level}`, tx + bw + 10 * s, by + 3 * s, 11, GOLD, 'left');
      }
      const st = me.stats;
      if (st) label(h, v, `${st.wins} wins · ${st.matches} matches · ${st.catches} catches`, tx, r.me.y + 78 * s, 11, '#b9aee0', 'left', textW + 120 * s);
      hubButton(h, v, r.signout, 'Sign out', 'ghost', over('signout'), this.t, 11);
    } else {
      label(h, v, 'Playing as a guest', tx, r.me.y + 46 * s, 12, '#b9aee0', 'left', textW);
      label(h, v, 'Sign in to keep the Pokémon you win', tx, r.me.y + 66 * s, 10, '#8f84b8', 'left', textW);
      hubButton(h, v, r.signin, 'Sign in', 'ghost', over('signin'), this.t, 12);
      hubButton(h, v, r.register, 'Create account', 'on', over('register'), this.t, 12);
    }
    // Divider.
    h.fillStyle = 'rgba(155,123,255,0.25)';
    h.fillRect(x0 + 24 * s, r.find.y - 18 * s, L.w - 48 * s, 1.5 * s);
    // Find a Match.
    const f = this.findState();
    hubButton(h, v, r.find, f.label, f.ok ? 'primary' : 'off', f.ok && over('find'), this.t, 20);
    label(h, v, 'Eight trainers · one island · one winner · empty seats filled by bots', L.cx, r.find.y + r.find.h + 14 * s, 10, '#a99bd6', 'center', L.w - 48 * s);
    // Status under the card: connection and ping, then any message.
    const sy = L.cardY + L.cardH + 20 * s;
    const live = this.net.connected;
    h.fillStyle = live ? '#5dff9b' : '#ffcc55';
    h.beginPath();
    h.arc(L.cx - 70 * s, sy, 4 * s * (live ? 1 + 0.15 * Math.sin(this.t * 4) : 1), 0, Math.PI * 2);
    h.fill();
    label(h, v, live ? `Connected${this.net.ping ? ` · ${this.net.ping} ms` : ''}` : 'Connecting...', L.cx - 58 * s, sy, 11, live ? '#c9ffe0' : '#ffe2a0', 'left');
    if (this.message) label(h, v, this.message, L.cx, sy + 24 * s, 12, '#fff3d6', 'center', v.width - 60 * s);
    if (this.net.hello?.server === 'demo') label(h, v, 'DEMO SERVER · progress here is separate', L.cx, sy + 44 * s, 10, '#ff9a9a');
    hubButton(h, v, r.back, '← Back', 'ghost', over('back'), this.t, 12);
    label(h, v, 'Privacy', L.cx, r.privacy.y + 11 * s, 10, over('privacy') ? '#f4eeff' : '#7d72a6');
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

  /** Casual queues only: done waiting, start with computer trainers filling the rest. */
  private startNowRect(): Rect | null {
    if (this.mode === 'ranked' || this.startsIn === null || this.startsIn < 4) return null;
    const v = this.ctx.view;
    const s = v.baseScale;
    return { x: v.width / 2 - 110 * s, y: v.height / 2 + 142 * s, w: 220 * s, h: 50 * s };
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
    const sn = this.startNowRect();
    if (sn) button(v, 'Start now with bots', sn.x, sn.y, sn.w, sn.h, hit(this.ctx.input.mouseX, this.ctx.input.mouseY, sn.x, sn.y, sn.w, sn.h));
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
