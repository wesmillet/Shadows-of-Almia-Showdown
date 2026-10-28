/**
 * Matches in worker threads (the server's default; ROOM_WORKERS sets how many, 0 runs them in the
 * main thread). Each worker (server/roomWorker.ts) loads the world once, runs any number of matches
 * on its own 60 Hz clock, and talks to this thread in messages:
 *
 *   main -> worker   create a match, a player's message, a dropped or returning connection,
 *                    spectators coming and going, call a match off
 *   worker -> main   a message for a player (already JSON), each match's state (twice a second),
 *                    what the match needs from the database (a chest saved, a Pokémon extracted,
 *                    a player flagged), how it ended, errors, step timings
 *
 * So a match being set up, or one going badly wrong, never stalls the others, the server uses
 * every CPU core, and a worker that dies takes only its own matches with it (they are called off,
 * nothing counted, and a new worker starts).
 */
import { existsSync } from 'node:fs';
import { totalmem } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { InventorySlot } from '../src/sim/entities';
import type { ClientMsg, RosterEntry } from '../src/net/protocol';
import type { RoomFactory, RoomSpec } from './hub';
import type { PcFields } from './pcFields';
import type { Peer, RoomHooks, RoomMode, RoomResult } from './room';
import type { EndReport, Follow, ReplaySummary, RoomHandle } from './roomHandle';

export interface PeerInfo {
  key: string;
  name: string;
  look?: unknown;
  title?: string;
}

export type ToWorker =
  | { op: 'create'; id: string; spec: Omit<RoomSpec, 'entries'> & { entries: Array<PeerInfo & { starter: string; team?: number }> }; hooks: { rareChest: boolean; cluster?: boolean }; chests: Record<string, InventorySlot[]> }
  | { op: 'receive'; room: string; key: string; msg: ClientMsg }
  | { op: 'disconnect'; room: string; key: string }
  | { op: 'rejoin'; room: string; peer: PeerInfo }
  | { op: 'spectate'; room: string; peer: PeerInfo; follow: Follow }
  | { op: 'unspectate'; room: string; key: string }
  | { op: 'follow'; room: string; key: string; trainerId?: number; step?: number }
  | { op: 'abort'; room: string; text: string };

export interface RoomState {
  time: number;
  closed: boolean;
  humansIn: number;
  watcherCount: number;
  botCount: number;
  playing: string[];
  trainerIds: Record<string, number>;
  roster: RosterEntry[];
  watchers: string[];
}

export type FromWorker =
  | { ev: 'ready' }
  | { ev: 'send'; key: string; data: string }
  | { ev: 'state'; room: string; state: RoomState }
  | { ev: 'chestSave'; key: string; box: Array<InventorySlot | null> }
  | { ev: 'extracted'; key: string; mon: PcFields; matchId: string }
  | { ev: 'flagged'; key: string; name: string; matchId: string; summary: string }
  | { ev: 'end'; room: string; results: RoomResult[]; botPlaces: number[]; flags: EndReport['flags']; aborted: string | null; replay: ReplaySummary | null }
  | { ev: 'error'; room: string; message: string; stack: string; time: number }
  | { ev: 'stats'; n: number; total: number; max: number };

/** An idle worker beyond the spares is closed this long after its last match ends. */
const RETIRE_AFTER_MS = 15_000;

/** The same id a Room gives itself (server/room.ts). */
export const roomId = (seed: number) => `m${seed.toString(36)}`;

const info = (p: Peer): PeerInfo => ({ key: p.key, name: p.name, look: p.look, title: p.title });

/** A match running in a worker, as the hub sees it. */
export class RemoteRoom implements RoomHandle {
  readonly id: string;
  readonly mode: RoomMode;
  readonly seed: number;
  readonly startedAt = Date.now();
  private state: RoomState;
  private readonly players: Set<string>;
  private ended = false;

  constructor(
    private readonly w: PoolWorker,
    spec: RoomSpec,
    readonly onEnd: (room: RoomHandle, report: EndReport) => void,
  ) {
    this.id = spec.opts.id ?? roomId(spec.seed);
    this.mode = spec.opts.mode;
    this.seed = spec.seed;
    this.players = new Set(spec.entries.map((e) => e.peer.key));
    this.state = { time: 0, closed: false, humansIn: spec.entries.length, watcherCount: 0, botCount: spec.opts.bots === false ? 0 : Math.max(0, spec.size - spec.entries.length), playing: [...this.players], trainerIds: {}, roster: [], watchers: [] };
  }

  private post(m: ToWorker): void {
    if (!this.ended) this.w.worker.postMessage(m);
  }

  get roster(): RosterEntry[] {
    return this.state.roster;
  }
  get time(): number {
    return this.state.time;
  }
  get closed(): boolean {
    return this.ended || this.state.closed;
  }
  get humansIn(): number {
    return this.state.humansIn;
  }
  get watcherCount(): number {
    return this.state.watcherCount;
  }
  get botCount(): number {
    return this.state.botCount;
  }
  has(key: string): boolean {
    return this.players.has(key);
  }
  playing(key: string): boolean {
    return !this.closed && this.state.playing.includes(key);
  }
  trainerIdOf(key: string): number | undefined {
    return this.state.trainerIds[key];
  }
  isWatching(key: string): boolean {
    return this.state.watchers.includes(key);
  }
  rejoin(peer: Peer): void {
    this.post({ op: 'rejoin', room: this.id, peer: info(peer) });
  }
  disconnect(key: string): void {
    this.post({ op: 'disconnect', room: this.id, key });
  }
  receive(key: string, msg: ClientMsg): void {
    if (msg.t === 'leave') this.state.playing = this.state.playing.filter((k) => k !== key);
    this.post({ op: 'receive', room: this.id, key, msg });
  }
  spectate(peer: Peer, follow?: Follow): boolean {
    if (this.closed) return false;
    this.state.watchers = [...this.state.watchers, peer.key];
    this.post({ op: 'spectate', room: this.id, peer: info(peer), follow });
    return true;
  }
  unspectate(key: string): void {
    this.state.watchers = this.state.watchers.filter((k) => k !== key);
    this.post({ op: 'unspectate', room: this.id, key });
  }
  follow(key: string, trainerId?: number, step?: number): void {
    this.post({ op: 'follow', room: this.id, key, trainerId, step });
  }
  abort(text: string): void {
    this.post({ op: 'abort', room: this.id, text });
  }

  setState(s: RoomState): void {
    this.state = s;
  }

  /** Everyone to tell if the match is lost: its players and spectators. */
  everyone(): string[] {
    return [...this.players, ...this.state.watchers];
  }

  /** The worker says it ended (or the worker is gone: `lost`). */
  finish(m: Extract<FromWorker, { ev: 'end' }>): void {
    if (this.ended) return;
    this.ended = true;
    this.onEnd(this, { results: m.results, botPlaces: m.botPlaces, flags: m.flags, aborted: m.aborted, replay: Promise.resolve(m.replay) });
  }
}

interface PoolWorker {
  worker: Worker;
  rooms: Map<string, RemoteRoom>;
  n: number;
  /** Loaded the world and listening. */
  ready: boolean;
  /** Being shut down on purpose (no longer needed): not replaced. */
  retiring: boolean;
}

export interface PoolOptions {
  assets: string;
  /** A message for a player (JSON already). */
  deliver(key: string, data: string): void;
  hooks: RoomHooks;
  log(...a: unknown[]): void;
  /** A match crashed (it was called off). */
  onError(message: string, stack: string, context: Record<string, unknown>): void;
  onStats(n: number, total: number, max: number): void;
}

/**
 * One match per worker, so a match being set up (a few hundred ms of building the island) never
 * stalls another, with SPARES workers kept loaded and waiting so a new match starts at once. Workers
 * cost about 60 MB each, so there are at most `max` (from the machine's memory); past that, matches
 * share the least busy worker. A worker no longer needed is closed.
 */
export class WorkerPool {
  private readonly workers = new Set<PoolWorker>();
  private readonly file: string;
  private next = 0;
  private stopping = false;
  static readonly SPARES = 1;

  constructor(readonly max: number, private readonly o: PoolOptions) {
    // Built: the bundle beside main.js. In development: the source, through a small bootstrap that
    // registers tsx in the worker (server/roomWorker.dev.mjs).
    const js = join(import.meta.dirname, 'roomWorker.js');
    this.file = existsSync(js) ? js : join(import.meta.dirname, 'roomWorker.dev.mjs');
    this.topUp();
    o.log(`Matches run in worker threads: up to ${max}, one each, ${WorkerPool.SPARES} kept ready`);
  }

  /** Workers this machine can afford (about 110 MB with a match running), at least 2, at most 16. */
  static defaultSize(): number {
    return Math.max(2, Math.min(16, Math.floor((totalmem() / 1048576 - 350) / 110)));
  }

  private get spares(): number {
    let n = 0;
    for (const w of this.workers) if (!w.retiring && w.rooms.size === 0) n++;
    return n;
  }

  /** Keeps SPARES idle workers loaded (within `max`). */
  private topUp(): void {
    while (!this.stopping && this.spares < WorkerPool.SPARES && this.workers.size < this.max) this.spawn();
  }

  /** Restarts in a row that died young (for backing off). */
  private quickDeaths = 0;

  private spawn(): PoolWorker {
    const n = this.next++;
    const worker = new Worker(this.file, { workerData: { assets: this.o.assets, n }, execArgv: ['--disable-warning=ExperimentalWarning'] });
    const born = Date.now();
    const pw: PoolWorker = { worker, rooms: new Map(), n, ready: false, retiring: false };
    this.workers.add(pw);
    worker.on('message', (m: FromWorker) => this.onMessage(pw, m));
    worker.on('error', (e) => this.o.onError(`Match worker ${n} failed: ${e.message}`, e.stack ?? '', { worker: n }));
    worker.on('exit', (code) => {
      this.workers.delete(pw);
      // Its matches are lost: called off (nothing counted), players told.
      const lost = [...pw.rooms.values()];
      if (lost.length || (code !== 0 && !pw.retiring && !this.stopping)) this.o.log(`Match worker ${n} stopped (code ${code}), ${lost.length} match(es) called off`);
      for (const r of lost) {
        for (const key of r.everyone()) this.o.deliver(key, JSON.stringify({ t: 'aborted', text: 'Something went wrong on the server, so this match was called off. It does not count as a loss, but items taken out of your storage chest during it could not be put back. Sorry!' }));
        r.finish({ ev: 'end', room: r.id, results: [], botPlaces: [], flags: [], aborted: 'worker stopped', replay: null });
      }
      pw.rooms.clear();
      if (this.stopping || pw.retiring) return;
      // One that dies at once keeps dying: wait longer each time (up to a minute) before replacing it.
      this.quickDeaths = Date.now() - born < 15_000 ? this.quickDeaths + 1 : 0;
      setTimeout(() => this.topUp(), Math.min(60_000, 1000 * 2 ** this.quickDeaths));
    });
    return pw;
  }

  private onMessage(pw: PoolWorker, m: FromWorker): void {
    const h = this.o.hooks;
    switch (m.ev) {
      case 'ready':
        pw.ready = true;
        return;
      case 'send':
        return this.o.deliver(m.key, m.data);
      case 'state':
        return pw.rooms.get(m.room)?.setState(m.state);
      case 'chestSave':
        return h.chestSave(m.key, m.box);
      case 'extracted':
        return h.extracted(m.key, m.mon, m.matchId);
      case 'flagged':
        return h.flagged?.(m.key, m.name, m.matchId, m.summary);
      case 'end': {
        const r = pw.rooms.get(m.room);
        pw.rooms.delete(m.room);
        r?.finish(m);
        // Idle again: kept as a spare, or closed if there are enough, after a while (spectators
        // still have the last few delayed seconds and the result coming from it).
        if (pw.rooms.size === 0) setTimeout(() => this.retire(pw), RETIRE_AFTER_MS);
        return;
      }
      case 'error':
        return this.o.onError(m.message, m.stack, { match: m.room, time: m.time });
      case 'stats':
        return this.o.onStats(m.n, m.total, m.max);
    }
  }

  private retire(pw: PoolWorker): void {
    if (pw.retiring || pw.rooms.size > 0 || this.spares <= WorkerPool.SPARES) return;
    pw.retiring = true;
    void pw.worker.terminate();
  }

  /** Where a new match goes: an idle worker (loaded first), a new one, or the least busy. */
  private pick(): PoolWorker {
    const idle = [...this.workers].filter((w) => !w.retiring && w.rooms.size === 0).sort((a, b) => Number(b.ready) - Number(a.ready));
    if (idle[0]) return idle[0];
    if (this.workers.size < this.max) return this.spawn();
    return [...this.workers].filter((w) => !w.retiring).reduce((a, b) => (b.rooms.size < a.rooms.size ? b : a));
  }

  /** The hub's way to make matches. */
  factory(): RoomFactory {
    return (spec, hooks, onEnd) => {
      const pw = this.pick();
      const room = new RemoteRoom(pw, spec, onEnd);
      pw.rooms.set(room.id, room);
      const chests: Record<string, InventorySlot[]> = {};
      for (const e of spec.entries) chests[e.peer.key] = hooks.chestLoad(e.peer.key) ?? [];
      // A worker still loading keeps this until it is listening.
      const msg: ToWorker = {
        op: 'create', id: room.id, chests, hooks: { rareChest: hooks.rareChest, cluster: hooks.cluster },
        spec: { ...spec, entries: spec.entries.map((e) => ({ ...info(e.peer), starter: e.starter, team: e.team })) },
      };
      pw.worker.postMessage(msg);
      this.topUp();
      return room;
    };
  }

  /** Workers running, and how many matches each has (for the Server tab). */
  status(): Array<{ n: number; ready: boolean; matches: number }> {
    return [...this.workers].map((w) => ({ n: w.n, ready: w.ready, matches: w.rooms.size }));
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await Promise.all([...this.workers].map((w) => w.worker.terminate()));
  }
}
