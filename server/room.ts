/**
 * One online match: the real simulation, stepped 60 times a second, with each player's view sent
 * 20 times a second. Players send movement keys, their cursor, and commands; nothing else they
 * send can change the match.
 *
 * A player who drops out keeps their seat for RECONNECT_SECONDS (their trainer stands still); after
 * that they are out of the match. The room closes once the match is over or no player is left.
 */
import type { BattleEvent } from '../src/sim/battle';
import type { InventorySlot, Mon, Trainer } from '../src/sim/entities';
import type { Match } from '../src/sim/match';
import type { Seat } from '../src/sim/seat';
import type { ClientMsg, RosterEntry, ServerMsg } from '../src/net/protocol';
import { IdTable, SyncEncoder } from '../src/net/sync';
import { newSeat } from '../src/sim/seat';
import { pcFields, type PcFields } from './pcFields';
import { runCommand } from './commands';
import type { EndReport, Follow, ReplaySummary, RoomHandle } from './roomHandle';
import { RECORD_EVERY, type ReplayRecorder } from './replays';
import { PlayerView } from './view';
import { createMatch, type Human, type MatchRules, type World } from './world';

export const STEP = 1 / 60;
/** Simulation steps per view update (60 / 3 = 20 updates a second). */
const SEND_EVERY = 3;
const RECONNECT_SECONDS = 45;
/** Commands a player may send per second (beyond this they are dropped). */
const COMMAND_RATE = 30;
/** Spectators see the match this many seconds late (so watching can not be used to help a player). */
export const SPECTATE_DELAY = 4;
/** Watching someone who was just knocked out: the camera moves on after this long. */
const FOLLOW_ON_AFTER = 3;

export type RoomMode = 'casual' | 'ranked' | 'private';

export interface RoomOptions extends MatchRules {
  mode: RoomMode;
  /** The rare-item chest (default: the server's setting). */
  rareChest?: boolean;
  /** Records the match (server/replays.ts), made once the match exists. */
  recorder?: (room: Room) => ReplayRecorder | null;
}

interface Watcher {
  peer: Peer;
  follow: Trainer;
  view: PlayerView;
  enc: SyncEncoder;
  /** Updates waiting out the delay (oldest first). */
  queue: Array<{ at: number; msg: ServerMsg }>;
  /** When the followed trainer went down (the camera moves on a little later). */
  downAt: number | null;
}

/** A connected player, as the room sees them. */
export interface Peer {
  key: string;
  name: string;
  look?: unknown;
  title?: string;
  send(msg: ServerMsg): void;
}

/**
 * How much each kind of flag counts (server/commands.ts Flag). A player past FLAG_REPORT in one match
 * is reported to the moderators automatically; lag and quirks can trip the light ones once or twice.
 */
const FLAG_WEIGHT: Record<string, number> = {
  'input': 5, 'aim-far': 3, 'aim-claim': 4, 'not-yours': 5, 'throw-range': 3, 'styler-range': 3, 'styler-pace': 1,
  'shop-range': 1, 'command-flood': 1, 'bad-args': 4,
};
export const FLAG_REPORT = 25;

interface Player {
  peer: Peer | null;
  seat: Seat;
  /** Flags this match: kind -> count, an example, and when it last counted. */
  flags: Map<string, { n: number; detail: string; at: number }>;
  flagScore: number;
  view: PlayerView;
  enc: SyncEncoder;
  /** Events waiting for the next view update. */
  goneAt: number | null;
  commands: number;
  ended: boolean;
}

export interface RoomResult {
  key: string;
  name: string;
  /** A squad's win counts for every member, even one knocked out before the end. */
  outcome: 'win' | 'loss';
  place: number;
  team?: number;
  stats: { catches: number; knockouts: number; damage: number; timeSurvived: number };
  /** The player's Pokémon at the end (what an extraction can keep). */
  party: PcFields[];
  /** Extraction Vouchers still in the bag (each is one more Pokémon to keep). */
  vouchers: number;
}

/** What the room needs from the rest of the server (accounts). */
export interface RoomHooks {
  /** The rare-item chest for players (demo server: on; live: off). */
  rareChest: boolean;
  /** Testing only: players start next to each other. */
  cluster?: boolean;
  chestLoad(key: string): InventorySlot[] | null;
  chestSave(key: string, box: Array<InventorySlot | null>): void;
  /** A Pokémon a player sent home mid-match with an Extraction Voucher (what its PC entry keeps). */
  extracted(key: string, mon: PcFields, matchId: string): void;
  /** A player's flags passed FLAG_REPORT this match. */
  flagged?(key: string, name: string, matchId: string, summary: string): void;
}

export class Room implements RoomHandle {
  readonly id: string;
  readonly match: Match;
  readonly ids = new IdTable();
  private readonly players = new Map<string, Player>();
  private steps = 0;
  private events: BattleEvent[] = [];
  private eliminatedOrder: string[] = [];
  private readonly watchers = new Map<string, Watcher>();
  /** Computer trainers' places as they go out (ranked counts them as opponents). */
  readonly botPlaces = new Map<Trainer, number>();
  readonly roster: RosterEntry[];
  readonly mode: RoomMode;
  readonly startedAt = Date.now();
  readonly recorder: ReplayRecorder | null;
  closed = false;

  constructor(
    world: World,
    entries: Array<Human & { peer: Peer }>,
    size: number,
    readonly seed: number,
    private readonly hooks: RoomHooks,
    private readonly onEnd: (room: Room, report: EndReport) => void,
    opts: RoomOptions = { mode: 'casual' },
  ) {
    this.id = `m${seed.toString(36)}`;
    this.mode = opts.mode;
    this.match = createMatch(world, entries, size, seed, opts);
    this.match.online = true;
    this.match.rareChest = opts.rareChest ?? hooks.rareChest;
    // Testing (DEV_CLUSTER=1, never on the live server): every player starts beside the first.
    if (hooks.cluster && this.match.seats.length > 1) {
      const first = (this.match.seats[0] as Seat).trainer;
      this.match.seats.slice(1).forEach((s, i) => {
        s.trainer.x = s.trainer.px = first.x + 3 + i;
        s.trainer.y = s.trainer.py = first.y + 1;
        this.match.placeParty(s.trainer);
      });
    }
    this.match.chestStore = {
      load: (t) => {
        const key = this.keyOf(t);
        return key ? hooks.chestLoad(key) : null;
      },
      save: (t, box) => {
        const key = this.keyOf(t);
        if (key) hooks.chestSave(key, box);
      },
    };
    this.match.seats.forEach((seat, i) => {
      const e = entries[i] as Human & { peer: Peer };
      const enc = new SyncEncoder(this.ids, seat.trainer);
      this.players.set(e.peer.key, { peer: e.peer, seat, view: new PlayerView(this.match, seat), enc, goneAt: null, commands: 0, ended: false, flags: new Map(), flagScore: 0 });
    });
    const roster: RosterEntry[] = this.match.allTrainers.filter((t) => !t.visitor).map((t) => {
      const owner = [...this.players.values()].find((p) => p.seat.trainer === t);
      return { trainerId: t.id, name: t.name, human: t.isPlayer, look: owner?.peer?.look, team: t.team, title: owner?.peer?.title };
    });
    this.roster = roster;
    for (const p of this.players.values()) p.peer?.send({ t: 'start', matchId: this.id, seed, you: p.seat.trainer.id, roster, mode: this.mode });
    this.recorder = opts.recorder?.(this) ?? null;
  }

  /** Notes an impossible action (refused already); past FLAG_REPORT the moderators hear of it. */
  private flag(key: string, kind: string, detail: string): void {
    const p = this.players.get(key);
    if (!p) return;
    const f = p.flags.get(kind) ?? { n: 0, detail, at: -Infinity };
    f.n++;
    p.flags.set(kind, f);
    // The same thing again within half a second is one event (a held key, a stream of aims), not many.
    if (this.match.time - f.at < 0.5) return;
    f.at = this.match.time;
    const before = p.flagScore;
    p.flagScore += FLAG_WEIGHT[kind] ?? 2;
    if (before < FLAG_REPORT && p.flagScore >= FLAG_REPORT) this.hooks.flagged?.(key, p.seat.trainer.name, this.id, [...p.flags].map(([k, v]) => `${k} x${v.n}`).join(', '));
  }

  /** Each player's flags (for the record when the match ends). */
  flagsOf(): Array<{ key: string; name: string; flags: Map<string, { n: number; detail: string; at: number }> }> {
    return [...this.players].filter(([, p]) => p.flags.size).map(([key, p]) => ({ key, name: p.seat.trainer.name, flags: p.flags }));
  }

  get time(): number {
    return this.match.time;
  }

  get botCount(): number {
    return this.match.trainers.filter((t) => !t.visitor && !t.challenger).length;
  }

  trainerIdOf(key: string): number | undefined {
    return this.trainerOf(key)?.id;
  }

  /** A squad mate still standing (a knocked-out player watches their squad first). */
  private teammateOf(key: string): number | undefined {
    const me = this.trainerOf(key);
    return this.match.allTrainers.find((t) => t !== me && t.alive && t.team !== undefined && t.team === me?.team)?.id;
  }

  /** Every player's key. */
  playerKeys(): string[] {
    return [...this.players.keys()];
  }

  /** Who is watching. */
  watcherKeys(): string[] {
    return [...this.watchers.keys()];
  }

  /** Humans still connected and playing. */
  get humansIn(): number {
    return [...this.players.values()].filter((p) => p.peer && !p.ended).length;
  }

  /** The trainer a player has in this match. */
  trainerOf(key: string): Trainer | null {
    return this.players.get(key)?.seat.trainer ?? null;
  }

  // ---------------------------------------------------------------- spectators

  /** Trainers a spectator can follow: everyone still in, the roster's order. */
  private followable(): Trainer[] {
    return this.match.allTrainers.filter((t) => t.alive && !t.visitor && !t.challenger && !t.legendBout && !t.hidden);
  }

  /** Starts watching (following a trainer, a player's squad mate, or the first human still in). */
  spectate(peer: Peer, follow?: Follow): boolean {
    if (this.closed) return false;
    const followId = typeof follow === 'object' ? this.teammateOf(follow.teamOf) : follow;
    const list = this.followable();
    const t = list.find((x) => x.id === followId) ?? list.find((x) => x.isPlayer) ?? list[0];
    if (!t) return false;
    const w: Watcher = { peer, follow: t, view: this.viewFor(t), enc: new SyncEncoder(this.ids, t), queue: [], downAt: null };
    this.watchers.set(peer.key, w);
    // Straight away, so the browser can get the screen ready while the delay runs.
    peer.send(this.spectateHeader(t));
    return true;
  }

  unspectate(key: string): void {
    this.watchers.delete(key);
  }

  isWatching(key: string): boolean {
    return this.watchers.has(key);
  }

  get watcherCount(): number {
    return this.watchers.size;
  }

  /** Follows another trainer: one by id, or the next/previous one (step). */
  follow(key: string, trainerId?: number, step?: number): void {
    const w = this.watchers.get(key);
    if (!w) return;
    const list = this.followable();
    let t: Trainer | undefined;
    if (typeof trainerId === 'number') t = list.find((x) => x.id === trainerId);
    else if (typeof step === 'number' && list.length) {
      const i = list.indexOf(w.follow);
      t = list[(((i < 0 ? 0 : i) + Math.sign(step)) % list.length + list.length) % list.length];
    }
    if (t && t !== w.follow) this.refollow(w, t);
  }

  private refollow(w: Watcher, t: Trainer): void {
    w.follow = t;
    w.view = this.viewFor(t);
    w.enc = new SyncEncoder(this.ids, t);
    w.downAt = null;
    // In line with the delayed updates, so the browser starts over exactly where this view does.
    w.queue.push({ at: this.match.time + SPECTATE_DELAY, msg: this.spectateHeader(t) });
  }

  private spectateHeader(t: Trainer): ServerMsg {
    return { t: 'spectate', matchId: this.id, seed: this.seed, roster: this.roster, follow: t.id, delay: SPECTATE_DELAY, mode: this.mode };
  }

  /** A view as `t` sees it (a player's own seat; a computer trainer gets a stand-in). */
  private viewFor(t: Trainer): PlayerView {
    const seat = this.match.seats.find((s) => s.trainer === t) ?? newSeat(t);
    return new PlayerView(this.match, seat);
  }

  private stepWatchers(evs: BattleEvent[]): void {
    const now = this.match.time;
    for (const w of this.watchers.values()) {
      if (!w.follow.alive) {
        if (w.downAt === null) w.downAt = now;
        else if (now - w.downAt > FOLLOW_ON_AFTER) {
          const next = this.followable().find((x) => x.isPlayer) ?? this.followable()[0];
          if (next) this.refollow(w, next);
        }
      }
      const patch = w.enc.encode(w.view.build(), w.view.visible);
      const out: Array<Record<string, unknown>> = [];
      for (const ev of evs) {
        if (ev.type === 'notice' && ev.to !== undefined && ev.to !== w.follow.id) continue;
        const e = w.enc.encodeEvent(ev);
        if (e) out.push(e);
      }
      w.queue.push({ at: now + SPECTATE_DELAY, msg: { t: 's', p: patch, e: out, time: Math.round(now * 1000) / 1000 } });
      while (w.queue.length && (w.queue[0] as { at: number }).at <= now) w.peer.send((w.queue.shift() as { msg: ServerMsg }).msg);
    }
  }

  /** The match ended: spectators get the rest of what they have not seen yet, then the result. */
  private releaseWatchers(text: string): void {
    const now = this.match.time;
    for (const w of this.watchers.values()) {
      for (const q of w.queue) setTimeout(() => w.peer.send(q.msg), Math.max(0, (q.at - now) * 1000));
      setTimeout(() => w.peer.send({ t: 'spectateEnd', text }), SPECTATE_DELAY * 1000 + 1500);
    }
    this.watchers.clear();
  }

  private keyOf(t: Trainer): string | null {
    for (const [key, p] of this.players) if (p.seat.trainer === t) return key;
    return null;
  }

  has(key: string): boolean {
    return this.players.has(key);
  }

  /** Still playing in this match (back after a dropped connection, they get their seat again). */
  playing(key: string): boolean {
    const p = this.players.get(key);
    return !!p && !p.ended && !p.seat.outcome && p.seat.trainer.alive && !this.closed;
  }

  /** A player came back (same account or guest key): they get their seat and a full view again. */
  rejoin(peer: Peer): void {
    const p = this.players.get(peer.key);
    if (!p) return;
    p.peer = peer;
    p.goneAt = null;
    p.seat.trainer.away = false;
    p.enc = new SyncEncoder(this.ids, p.seat.trainer);
    peer.send({ t: 'start', matchId: this.id, seed: this.seed, you: p.seat.trainer.id, roster: this.roster, mode: this.mode });
  }

  disconnect(key: string): void {
    const p = this.players.get(key);
    if (!p) return;
    p.peer = null;
    p.goneAt = this.match.time;
    p.seat.moveX = p.seat.moveY = 0;
    p.seat.trainer.away = true;
  }

  /** A message from a player in this room. */
  receive(key: string, msg: ClientMsg): void {
    const p = this.players.get(key);
    if (!p || this.closed) return;
    if (msg.t === 'in') {
      const seat = p.seat;
      if (Array.isArray(msg.f)) {
        // Numbered frames, one per step: queued in order, newer than anything already had.
        let last = seat.inputs.length ? (seat.inputs[seat.inputs.length - 1] as [number, number, number])[0] : seat.ack;
        if (msg.f.length > 12) this.flag(key, 'input', `${msg.f.length} frames in one message`);
        for (const fr of msg.f.slice(0, 12)) {
          if (!Array.isArray(fr) || typeof fr[0] !== 'number' || fr[0] <= last) continue;
          if (Math.hypot(Number(fr[1]) || 0, Number(fr[2]) || 0) > 1.01) this.flag(key, 'input', `move keys ${fr[1]},${fr[2]}`);
          const [x, y] = unitAxis(fr[1], fr[2]);
          seat.inputs.push([fr[0], x, y]);
          last = fr[0];
        }
        // Far behind (a stall): catch up by dropping the oldest, the browser corrects itself.
        if (seat.inputs.length > 30) seat.inputs.splice(0, seat.inputs.length - 6);
      } else if (typeof msg.mx === 'number' && typeof msg.my === 'number') {
        [seat.moveX, seat.moveY] = unitAxis(msg.mx, msg.my);
      }
      if (typeof msg.ax === 'number' && typeof msg.ay === 'number' && Number.isFinite(msg.ax) && Number.isFinite(msg.ay)) {
        // Aiming far past the screen: nothing honest points there.
        const me = p.seat.controlled ?? p.seat.trainer;
        if (Math.hypot(msg.ax - me.x, msg.ay - me.y) > 45) this.flag(key, 'aim-far', `${Math.hypot(msg.ax - me.x, msg.ay - me.y).toFixed(0)} tiles away`);
        p.seat.aim = { x: msg.ax, y: msg.ay };
      }
      return;
    }
    if (msg.t === 'cmd') {
      if (++p.commands > COMMAND_RATE) {
        if (p.commands === COMMAND_RATE + 1) this.flag(key, 'command-flood', `${msg.c}`);
        return;
      }
      if (!Array.isArray(msg.a) || msg.a.length > 4) return this.flag(key, 'bad-args', String(msg.c).slice(0, 20));
      const from = this.match.battle.events.length;
      const text = runCommand(this.match, p.seat, msg.c, msg.a, (kind, detail) => this.flag(key, kind, detail));
      for (let i = from; i < this.match.battle.events.length; i++) {
        const ev = this.match.battle.events[i] as BattleEvent;
        if (ev.type === 'extracted' && ev.via === 'voucher') this.hooks.extracted(key, pcFields(ev.mon), this.id);
      }
      if (text) p.peer?.send({ t: 'reply', n: msg.n, text, seconds: 1.8 });
      return;
    }
    if (msg.t === 'leave') {
      // Leaving mid-match: out for good (told so, so the browser can show the result).
      if (!p.seat.outcome && p.seat.trainer.alive) this.match.eliminate(p.seat.trainer);
      if (!p.ended) {
        p.seat.outcome ??= 'loss';
        this.eliminatedOrder.push(key);
        p.peer?.send({ t: 'end', outcome: p.seat.outcome, place: this.placeOf(p) });
      }
      p.ended = true;
      p.peer = null;
    }
  }

  /** One simulation step; every third, each player's view goes out. */
  step(): void {
    if (this.closed) return;
    const m = this.match;
    for (const [key, p] of this.players) {
      // Gone too long: out of the match.
      if (p.goneAt !== null && m.time - p.goneAt > RECONNECT_SECONDS && p.seat.trainer.alive && !p.seat.outcome) {
        m.eliminate(p.seat.trainer);
        void key;
      }
    }
    for (const p of this.players.values()) takeFrame(p.seat);
    m.step(STEP);
    this.events.push(...m.battle.events);
    this.recorder?.collect(m.battle.events);
    m.battle.events.length = 0;
    // Computer trainers' places, as they go out.
    for (const t of m.trainers) {
      if (!t.alive && !t.visitor && !t.challenger && !t.legendBout && !this.botPlaces.has(t)) {
        this.botPlaces.set(t, m.allTrainers.filter((x) => x.alive && !x.visitor && !x.challenger && !x.legendBout).length + 1);
      }
    }
    for (const p of this.players.values()) {
      if (p.seat.outcome && !p.ended) {
        p.ended = true;
        if (p.seat.outcome === 'loss') this.eliminatedOrder.push(p.peer?.key ?? '');
        p.peer?.send({ t: 'end', outcome: p.seat.outcome, place: this.placeOf(p) });
      }
    }
    ++this.steps;
    if (this.steps % RECORD_EVERY === 0) this.recorder?.frame();
    if (this.steps % SEND_EVERY === 0) {
      for (const p of this.players.values()) p.commands = Math.max(0, p.commands - COMMAND_RATE / 20);
      this.broadcast();
    }
    // A room stays open while anyone is still playing OR inside their reconnect window, so a
    // dropped solo player (or the last human standing) is not instantly handed a loss.
    const anyone = [...this.players.values()].some((p) => !p.ended && (p.peer !== null || (p.goneAt !== null && m.time - p.goneAt <= RECONNECT_SECONDS)));
    if (m.over || !anyone) this.close();
  }

  /** Place in the match: 1 for the winner, then by how many trainers were still standing. */
  private placeOf(p: Player): number {
    if (p.seat.outcome === 'win') return 1;
    return Math.max(2, this.match.allTrainers.filter((t) => t.alive && !t.visitor && !t.challenger && !t.legendBout).length + 1);
  }

  private broadcast(): void {
    const evs = this.events;
    this.events = [];
    if (this.watchers.size) this.stepWatchers(evs);
    for (const p of this.players.values()) {
      // Eliminated players keep watching until they leave.
      if (!p.peer) continue;
      const root = p.view.build();
      const patch = p.enc.encode(root, p.view.visible);
      const me = p.seat.trainer.id;
      const out: Array<Record<string, unknown>> = [];
      for (const ev of evs) {
        if (ev.type === 'notice' && ev.to !== undefined && ev.to !== me) continue;
        if (ev.type === 'scene-fx' || ev.type === 'fish' || ev.type === 'money') {
          const f = p.seat.controlled ?? p.seat.trainer;
          if (Math.hypot(ev.x - f.x, ev.y - f.y) > 34) continue;
        }
        const e = p.enc.encodeEvent(ev);
        if (e) out.push(e);
      }
      p.peer.send({ t: 's', p: patch, e: out, time: Math.round(this.match.time * 1000) / 1000, ack: p.seat.ack });
    }
  }

  /**
   * Called off before its end (the server is shutting down): nobody wins or loses, nothing is
   * counted (the hub sees `aborted`), and everyone is told why.
   */
  abort(text: string): void {
    if (this.closed) return;
    this.aborted = text;
    for (const p of this.players.values()) if (!p.ended) p.peer?.send({ t: 'aborted', text });
    this.close();
  }

  /** Why the match was called off, if it was. */
  aborted: string | null = null;

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    const results: RoomResult[] = [];
    // The squad still standing at the end (if the match finished): all its members won.
    const standing = this.match.allTrainers.filter((t) => t.alive && !t.visitor && !t.challenger && !t.legendBout);
    const winTeam = this.match.over && standing.length && standing.every((t) => t.team !== undefined && t.team === standing[0]?.team) ? standing[0]?.team : undefined;
    for (const t of this.match.trainers) if (!this.botPlaces.has(t) && t.alive && !t.visitor && !t.challenger && !t.legendBout) this.botPlaces.set(t, 1);
    for (const [key, p] of this.players) {
      const t = p.seat.trainer;
      // Only the last trainer (or squad) standing wins; leaving before the end is a loss.
      let outcome = p.seat.outcome ?? (this.match.over && t.alive ? 'win' : 'loss');
      let place = this.placeOf(p);
      if (winTeam !== undefined && t.team === winTeam) {
        outcome = 'win';
        place = 1;
      }
      if (!p.ended && !this.aborted) p.peer?.send({ t: 'end', outcome, place });
      results.push({
        key, name: t.name, outcome, place, team: t.team, stats: { ...t.stats },
        party: t.party.filter((x) => !x.captured).map((x) => pcFields(x)),
        vouchers: t.items.reduce((n, e) => n + (e?.id === 'extraction-voucher' ? e.count : 0), 0),
      });
    }
    const winner = results.filter((r) => r.outcome === 'win').map((r) => r.name).join(' & ') || this.match.trainers.find((t) => this.botPlaces.get(t) === 1)?.name || 'Nobody';
    this.releaseWatchers(this.aborted ?? `The match is over: ${winner} won`);
    this.onEnd(this, {
      results,
      botPlaces: [...this.botPlaces.values()],
      flags: this.flagsOf().map((f) => ({ key: f.key, name: f.name, flags: [...f.flags].map(([k, v]): [string, { n: number; detail: string }] => [k, { n: v.n, detail: v.detail }]) })),
      aborted: this.aborted,
      replay: this.finishReplay(results),
    });
  }

  /** Finishes the recording; who was in it and where they placed. */
  private async finishReplay(results: RoomResult[]): Promise<ReplaySummary | null> {
    const rec = this.recorder;
    if (!rec) return null;
    const bytes = await rec.close();
    const byName = new Map(results.map((r) => [r.name, r]));
    const players = this.roster.map((e) => {
      const r = e.human ? byName.get(e.name) : undefined;
      const bot = this.match.trainers.find((t) => t.id === e.trainerId);
      return { name: e.name, human: e.human, key: r?.key, place: r?.place ?? (bot ? (this.botPlaces.get(bot) ?? 0) : 0) };
    });
    return { bytes, seconds: this.match.time, players };
  }
}

/** Movement keys from a browser: each in -1..1, and no faster on a diagonal than straight. */
function unitAxis(x: unknown, y: unknown): [number, number] {
  const c = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
  let ax = c(x);
  let ay = c(y);
  const n = Math.hypot(ax, ay);
  if (n > 1) {
    ax /= n;
    ay /= n;
  }
  return [ax, ay];
}

/** Past this many frames waiting, idle ones (no key held) are dropped to cut the delay. */
const CUSHION = 4;

/**
 * This step's keys for a seat: the next numbered frame, in order, every one of them, so the server
 * walks exactly the path the browser predicted (src/net/mirror.ts) and never has to correct it.
 *
 * When the next frame is late, the trainer waits a step rather than guess: the frames that arrive
 * later are still applied one by one, a step behind, and that small queue then absorbs the next
 * bit of network jitter. If the queue grows past CUSHION, frames with no key held are dropped: a
 * trainer standing still moves nowhere either way, so nothing has to be corrected.
 */
function takeFrame(seat: Seat): void {
  if (seat.inputs.length > CUSHION) {
    for (let i = 0; i < seat.inputs.length - 1 && seat.inputs.length > CUSHION; ) {
      const f = seat.inputs[i] as [number, number, number];
      if (f[1] === 0 && f[2] === 0) {
        seat.inputs.splice(i, 1);
        seat.ack = Math.max(seat.ack, f[0]);
      } else i++;
    }
  }
  const f = seat.inputs.shift();
  if (f) {
    seat.ack = f[0];
    seat.moveX = f[1];
    seat.moveY = f[2];
    seat.held = [f[1], f[2]];
    return;
  }
  seat.moveX = 0;
  seat.moveY = 0;
}
