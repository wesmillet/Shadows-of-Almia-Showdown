/**
 * Watching: a live match (a friend's, your own after being knocked out, or the featured one), a few
 * seconds behind, and replays of finished ones. Both draw with the ordinary match screen in its
 * spectator mode (src/ui/matchScreen.ts), fed by a mirror in observe mode (src/net/mirror.ts).
 *
 * A replay file (server/replays.ts) is a header line and one line per update, with a full keyframe
 * every 30 seconds. Playing it feeds the lines to the mirror on a clock; jumping back (or far ahead)
 * starts the mirror over from the keyframe before the spot and runs quickly up to it.
 */
import type { Input } from '../core/input';
import type { MirrorNet } from '../net/connection';
import type { MirrorMatch } from '../net/mirror';
import type { RosterEntry, ServerMsg } from '../net/protocol';
import type { SyncPatch } from '../net/sync';
import type { View } from '../render/view';
import type { MatchScreen } from './matchScreen';
import { INK, panel, text } from './screens';

/** The bar along the bottom of a watched match. */
function bar(v: View, title: string, hint: string, color = INK.accent): void {
  const s = v.baseScale;
  const w = Math.min(v.width - 40 * s, 620 * s);
  const x = v.width / 2 - w / 2;
  const y = v.height - 64 * s;
  panel(v, x, y, w, 50 * s, 14, 'rgba(18,14,34,0.88)');
  text(v, title, v.width / 2, y + 20 * s, 15, { align: 'center', color, shadow: false, maxWidth: w - 30 * s });
  text(v, hint, v.width / 2, y + 39 * s, 11, { align: 'center', color: INK.dim, shadow: false, maxWidth: w - 30 * s });
}

const nameOf = (roster: RosterEntry[], id: number) => roster.find((r) => r.trainerId === id)?.name ?? 'a trainer';

/** Live spectating: ←/→ (or A/D) switch whom the camera follows, Esc leaves. */
export function setupSpectate(screen: MatchScreen, mirror: MirrorMatch, net: MirrorNet, header: Extract<ServerMsg, { t: 'spectate' }>, onLeave: () => void): void {
  let follow = header.follow;
  mirror.onFollow = (id) => {
    follow = id;
    const t = mirror.match.player;
    screen.snapCamera(t.x, t.y);
  };
  screen.spectator = {
    step(input: Input) {
      if (input.pressed('Escape')) {
        net.send({ t: 'unspectate' });
        onLeave();
        return;
      }
      if (input.pressed('ArrowRight') || input.pressed('KeyD') || input.pressed('KeyE')) net.send({ t: 'follow', step: 1 });
      if (input.pressed('ArrowLeft') || input.pressed('KeyA') || input.pressed('KeyQ')) net.send({ t: 'follow', step: -1 });
    },
    draw(v: View) {
      const mode = header.mode === 'ranked' ? 'Ranked · ' : header.mode === 'private' ? 'Private · ' : '';
      bar(v, `${mode}Watching ${nameOf(mirror.roster, follow)} · ${header.delay} s behind`, '← → switch trainer   ·   Esc leave');
    },
  };
}

// ---------------------------------------------------------------- replays

export interface ReplayHeader {
  v: number;
  matchId: string;
  seed: number;
  mode: string;
  roster: RosterEntry[];
  startedAt: number;
}

export interface ReplayLine {
  k?: 1;
  time: number;
  p: SyncPatch;
  e: Array<Record<string, unknown>>;
}

/** Splits a replay file into its header and updates. */
export function parseReplay(body: string): { header: ReplayHeader; lines: ReplayLine[] } {
  const rows = body.split('\n').filter((l) => l.trim());
  const header = JSON.parse(rows[0] ?? '{}') as ReplayHeader;
  const lines = rows.slice(1).map((l) => JSON.parse(l) as ReplayLine);
  return { header, lines };
}

/** Stands in for the server: the replay player hands the mirror its messages. */
export class ReplayFeed implements MirrorNet {
  private listeners = new Set<(m: ServerMsg) => void>();
  on(l: (m: ServerMsg) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  send(): void {}
  cmd(): void {}
  emit(m: ServerMsg): void {
    for (const l of this.listeners) l(m);
  }
}

const SPEEDS = [0.5, 1, 2, 4, 8];

/**
 * Plays a replay: Space pauses, ←/→ jump 10 s, ↑/↓ change speed, Q/E (or A/D) follow another
 * trainer, Esc leaves. Returns a step function for the match screen's spectator hooks.
 */
export class ReplayPlayer {
  private i = 0;
  private clock = 0;
  private speed = 1;
  paused = false;
  private follow: number;
  private readonly end: number;
  private readonly start: number;
  private readonly trainers: RosterEntry[];

  private screen: MatchScreen | null = null;

  constructor(
    private readonly feed: ReplayFeed,
    private readonly mirror: MirrorMatch,
    private readonly header: ReplayHeader,
    private readonly lines: ReplayLine[],
    private readonly onLeave: () => void,
  ) {
    this.start = lines[0]?.time ?? 0;
    this.end = lines[lines.length - 1]?.time ?? 0;
    this.trainers = header.roster.filter((r) => r.name);
    // Start on a player (the first human), if there was one.
    this.follow = (header.roster.find((r) => r.human) ?? header.roster[0])?.trainerId ?? 0;
    this.clock = this.start;
    this.seek(this.start);
  }

  /** The match screen it plays on (made once the first update is in, so it has someone to look at). */
  attach(screen: MatchScreen): void {
    this.screen = screen;
    screen.spectator = { step: (input, dt) => this.step(input, dt), draw: (v) => this.draw(v) };
  }

  /** Feeds every line up to the clock (events only within the last second, so a jump is quiet). */
  private feedTo(t: number, quiet: boolean): void {
    while (this.i < this.lines.length && (this.lines[this.i] as ReplayLine).time <= t) {
      const l = this.lines[this.i++] as ReplayLine;
      this.feed.emit({ t: 's', p: l.p, e: quiet && t - l.time > 1 ? [] : l.e, time: l.time });
    }
  }

  /** Jumps to `t`: from the keyframe before it, everything starts over and runs up to it. */
  seek(t: number): void {
    t = Math.max(this.start, Math.min(this.end, t));
    let k = 0;
    for (let j = 0; j < this.lines.length; j++) {
      const l = this.lines[j] as ReplayLine;
      if (l.time > t) break;
      if (l.k) k = j;
    }
    this.mirror.restart(this.follow);
    this.i = k;
    this.clock = t;
    this.feedTo(t, true);
    const p = this.mirror.match.player;
    this.screen?.snapCamera(p.x, p.y);
  }

  private step(input: Input, dt: number): void {
    if (input.pressed('Escape')) return this.onLeave();
    if (input.pressed('Space')) this.paused = !this.paused;
    if (input.pressed('ArrowRight')) this.seek(this.clock + 10);
    if (input.pressed('ArrowLeft')) this.seek(this.clock - 10);
    const si = SPEEDS.indexOf(this.speed);
    if (input.pressed('ArrowUp')) this.speed = SPEEDS[Math.min(SPEEDS.length - 1, si + 1)] as number;
    if (input.pressed('ArrowDown')) this.speed = SPEEDS[Math.max(0, si - 1)] as number;
    const next = input.pressed('KeyE') || input.pressed('KeyD') ? 1 : input.pressed('KeyQ') || input.pressed('KeyA') ? -1 : 0;
    if (next) this.switchTrainer(next);
    // A click on the progress bar jumps there.
    for (const c of input.takeClicks()) {
      const b = this.barRect();
      if (c.y >= b.y - 6 && c.y <= b.y + b.h + 6 && c.x >= b.x && c.x <= b.x + b.w) this.seek(this.start + ((c.x - b.x) / b.w) * (this.end - this.start));
    }
    if (!this.paused && this.clock < this.end) {
      this.clock = Math.min(this.end, this.clock + dt * this.speed);
      this.feedTo(this.clock, this.speed > 2);
    }
  }

  private switchTrainer(dir: number): void {
    const alive = this.mirror.match.allTrainers.filter((t) => t.alive && !t.visitor && !t.challenger);
    const ids = this.trainers.map((r) => r.trainerId).filter((id) => alive.some((t) => t.id === id));
    if (!ids.length) return;
    const i = ids.indexOf(this.follow);
    this.follow = ids[(((i < 0 ? 0 : i) + dir) % ids.length + ids.length) % ids.length] as number;
    this.mirror.follow(this.follow);
    const p = this.mirror.match.player;
    this.screen?.snapCamera(p.x, p.y);
  }

  private barRect(): { x: number; y: number; w: number; h: number } {
    const v = (this.screen as MatchScreen).view;
    const s = v.baseScale;
    const w = Math.min(v.width - 80 * s, 560 * s);
    return { x: v.width / 2 - w / 2, y: v.height - 22 * s, w, h: 6 * s };
  }

  private draw(v: View): void {
    const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const mode = this.header.mode === 'ranked' ? 'Ranked · ' : this.header.mode === 'private' ? 'Private · ' : '';
    const s = v.baseScale;
    const w = Math.min(v.width - 40 * s, 620 * s);
    const x = v.width / 2 - w / 2;
    const y = v.height - 78 * s;
    panel(v, x, y, w, 70 * s, 14, 'rgba(18,14,34,0.88)');
    const title = `Replay · ${mode}${nameOf(this.header.roster, this.follow)} · ${fmt(this.clock - this.start)} / ${fmt(this.end - this.start)} · ${this.paused ? 'paused' : `${this.speed}x`}`;
    text(v, title, v.width / 2, y + 20 * s, 14, { align: 'center', color: INK.accent, shadow: false, maxWidth: w - 30 * s });
    text(v, 'Space pause · ← → 10 s · ↑ ↓ speed · Q E switch trainer · Esc leave', v.width / 2, y + 38 * s, 11, { align: 'center', color: INK.dim, shadow: false, maxWidth: w - 30 * s });
    const b = this.barRect();
    const ctx = v.hud;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#f2c24a';
    const k = this.end > this.start ? (this.clock - this.start) / (this.end - this.start) : 0;
    ctx.fillRect(b.x, b.y, b.w * k, b.h);
  }
}
