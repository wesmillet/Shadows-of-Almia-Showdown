/**
 * The queue's mini window: while queued for a match, players can leave the lobby screen and use
 * the menus (PC, Trainer, Options...). A small window in the corner shows the queue (trainers in,
 * the countdown, or when computer trainers fill in) with Open (back to the lobby screen) and Leave.
 * The match starts from wherever they are (main.ts handles 'start' on any screen).
 */
import type { Connection } from '../net/connection';
import type { ServerMsg } from '../net/protocol';
import { timeOfDay } from './onlineScreens';

type LobbyMsg = Extract<ServerMsg, { t: 'lobby' }>;

const CSS = `
.almia-qmini { position: fixed; right: max(12px, env(safe-area-inset-right)); bottom: max(12px, env(safe-area-inset-bottom)); z-index: 2147482000;
  width: min(270px, calc(100vw - 24px)); background: #f4ecdc; color: #4a3424; border: 3px solid #4a3424;
  box-shadow: 0 4px 0 #2a1d14, 0 0 0 3px #f4ecdc inset; padding: 10px 12px 12px; font: 14px/1.4 "BoldPixels", "Segoe UI", system-ui, sans-serif; image-rendering: pixelated; }
.almia-qmini .top { display: flex; align-items: center; gap: 8px; font-size: 16px; color: #c2611a; }
.almia-qmini .dot { width: 10px; height: 10px; background: #2e7d32; flex: none; animation: almia-qpulse 1.2s steps(2) infinite; }
.almia-qmini .dot.go { background: #c2611a; }
@keyframes almia-qpulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.almia-qmini .line { color: #8a6a4a; margin-top: 4px; }
.almia-qmini .time { color: #c2611a; }
.almia-qmini .bar { height: 6px; background: #e0d0b4; margin-top: 8px; }
.almia-qmini .bar i { display: block; height: 100%; background: #c2611a; transition: width 0.4s; }
.almia-qmini .btns { display: flex; gap: 8px; margin-top: 12px; }
.almia-qmini button { flex: 1; min-height: 36px; border: 0; font: inherit; font-size: 15px; cursor: pointer; }
.almia-qmini button.open { background: #c2611a; color: #fff; text-shadow: 0 1px 0 #8a3a0a; box-shadow: 0 3px 0 #8a3a0a; }
.almia-qmini button.leave { background: #fbf5e9; color: #4a3424; border: 2px solid #4a3424; box-shadow: 0 3px 0 #c9b48e; }
`;

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class QueueMini {
  /** Queued for a public match (set when this browser queues; cleared by a start, a leave or 'unqueued'). */
  active = false;
  /** The lobby screen is showing (it has its own full view): the mini window hides. */
  onLobbyScreen = false;
  private last: LobbyMsg | null = null;
  private at = 0;
  private el: HTMLDivElement | null = null;
  private timer: number | null = null;

  constructor(
    private readonly net: Connection,
    /** Back to the full lobby screen. */
    private readonly onOpen: () => void,
    /** Left the queue (the hub says so if they are on it). */
    private readonly onLeft: () => void,
  ) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    net.on((m) => {
      if (m.t === 'lobby') {
        this.last = m;
        this.at = performance.now();
        this.active = true;
      } else if (m.t === 'start' || m.t === 'unqueued') this.stop();
      this.sync();
    });
    net.onStatus((s) => {
      // A dropped connection loses the queue on the server.
      if (s === 'down' || s === 'takenOver') this.stop();
      this.sync();
    });
  }

  /** This browser just queued (the lobby messages follow). */
  queued(): void {
    this.active = true;
    this.last = null;
    this.sync();
  }

  stop(): void {
    this.active = false;
    this.last = null;
    this.sync();
  }

  leave(): void {
    this.net.send({ t: 'leaveQueue' });
    this.stop();
    this.onLeft();
  }

  /** Shows, updates or hides the window. */
  sync(): void {
    const show = this.active && !this.onLobbyScreen;
    if (!show) {
      this.el?.remove();
      this.el = null;
      if (this.timer !== null) clearInterval(this.timer);
      this.timer = null;
      return;
    }
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'almia-qmini';
      this.el.innerHTML = `<div class="top"><span class="dot"></span><span class="title">Finding a match</span></div>
        <div class="line who"></div><div class="line when"></div><div class="bar"><i></i></div>
        <div class="btns"><button class="open">Open</button><button class="leave">Leave</button></div>`;
      for (const ev of ['pointerdown', 'mousedown', 'touchstart', 'click'] as const) this.el.addEventListener(ev, (e) => e.stopPropagation());
      (this.el.querySelector('.open') as HTMLButtonElement).onclick = () => this.onOpen();
      (this.el.querySelector('.leave') as HTMLButtonElement).onclick = () => this.leave();
      document.body.appendChild(this.el);
      this.timer = window.setInterval(() => this.paint(), 250);
    }
    this.paint();
  }

  /** Out of the chat's way: beside the side chat (menu screens) when there is room, else above it. */
  private place(el: HTMLDivElement): void {
    el.style.right = '';
    el.style.bottom = '';
    const chat = document.querySelector('.almia-chat') as HTMLElement | null;
    if (!chat || chat.offsetParent === null) return;
    const c = chat.getBoundingClientRect();
    const q = el.getBoundingClientRect();
    const overlaps = q.left < c.right && q.right > c.left && q.top < c.bottom && q.bottom > c.top;
    if (!overlaps) return;
    if (c.left - q.width - 24 >= 0) el.style.right = `${Math.round(window.innerWidth - c.left + 12)}px`;
    else el.style.bottom = `${Math.round(window.innerHeight - c.top + 12)}px`;
  }

  private paint(): void {
    const el = this.el;
    if (!el) return;
    this.place(el);
    const m = this.last;
    const gone = (performance.now() - this.at) / 1000;
    const who = el.querySelector('.who') as HTMLElement;
    const when = el.querySelector('.when') as HTMLElement;
    const bar = el.querySelector('.bar i') as HTMLElement;
    const dot = el.querySelector('.dot') as HTMLElement;
    const title = el.querySelector('.title') as HTMLElement;
    if (!m) {
      who.textContent = 'Joining the queue...';
      when.textContent = '';
      bar.style.width = '0%';
      return;
    }
    who.textContent = `${m.players.length} / ${m.size} trainers in the lobby`;
    bar.style.width = `${Math.round((m.players.length / m.size) * 100)}%`;
    const starting = m.startsIn !== null;
    dot.classList.toggle('go', starting);
    title.textContent = m.at !== undefined && starting ? `Your match: ${timeOfDay(this.at + (m.startsIn ?? 0) * 1000 - performance.now() + Date.now())}` : starting ? 'Match starting' : 'Finding a match';
    if (starting) {
      const left = Math.max(0, (m.startsIn ?? 0) - gone);
      when.innerHTML = `Starts in <span class="time">${clock(Math.ceil(left))}</span>`;
    } else if (m.botsIn !== undefined) {
      const left = Math.max(0, m.botsIn - gone);
      when.innerHTML = `Starting in <span class="time">${clock(Math.ceil(left))}</span>`;
    } else when.textContent = m.need ? `Waiting for ${m.need} more` : '';
  }
}
