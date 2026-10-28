/**
 * What the hub (server/hub.ts) needs from a running match, whether it runs in this thread
 * (server/room.ts, used by the checks) or in a worker thread (server/remoteRoom.ts, the server's
 * default: each worker runs its matches on its own CPU core, so one match being set up or going
 * wrong never stalls the others).
 */
import type { ClientMsg, RosterEntry } from '../src/net/protocol';
import type { Peer, RoomMode, RoomResult } from './room';

/** How a match ended: everything the hub records. */
export interface EndReport {
  results: RoomResult[];
  /** Computer trainers' places. */
  botPlaces: number[];
  /** Anti-cheat flags per player: kind -> count and an example. */
  flags: Array<{ key: string; name: string; flags: Array<[string, { n: number; detail: string }]> }>;
  /** Called off before its end (nothing is counted): why. */
  aborted: string | null;
  /** The finished replay (null: not recorded). */
  replay: Promise<ReplaySummary | null>;
}

export interface ReplaySummary {
  bytes: number;
  seconds: number;
  players: Array<{ name: string; human: boolean; key?: string; place: number }>;
}

/** Whom to follow when watching: a trainer, or a squad mate of a player (knocked out, watching their squad). */
export type Follow = number | { teamOf: string } | undefined;

export interface RoomHandle {
  readonly id: string;
  readonly mode: RoomMode;
  readonly seed: number;
  readonly startedAt: number;
  readonly roster: RosterEntry[];
  /** Match time in seconds. */
  readonly time: number;
  readonly closed: boolean;
  /** Humans still connected and playing. */
  readonly humansIn: number;
  readonly watcherCount: number;
  /** Computer trainers in it. */
  readonly botCount: number;
  has(key: string): boolean;
  /** Still playing (back after a dropped connection, they get their seat again). */
  playing(key: string): boolean;
  trainerIdOf(key: string): number | undefined;
  rejoin(peer: Peer): void;
  disconnect(key: string): void;
  receive(key: string, msg: ClientMsg): void;
  spectate(peer: Peer, follow?: Follow): boolean;
  unspectate(key: string): void;
  follow(key: string, trainerId?: number, step?: number): void;
  isWatching(key: string): boolean;
  abort(text: string): void;
}
