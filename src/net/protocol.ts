/**
 * Messages between the browser and the game server (JSON over one WebSocket).
 *
 * The browser only ever sends intentions: movement keys, where the cursor points, and commands
 * (cast move 1, throw a ball, buy line 3). The server checks each against the real match (cooldowns,
 * ranges, money, what is in the bag) exactly as the offline game does, so a modified browser can
 * not do anything a player could not.
 */
import type { SyncPatch } from './sync';

/** Commands a player can give in a match (each maps to the same Match method the offline game calls). */
export type CommandName =
  | 'cast' | 'dodge' | 'auto' | 'take' | 'untake' | 'pickLock' | 'cycleLock' | 'swapLead' | 'unequip' | 'learn' | 'release'
  | 'mega' | 'ride' | 'sell' | 'buy' | 'deposit' | 'withdraw' | 'interact' | 'pickUp' | 'duelPick' | 'stylerLoop' | 'stylerBreak'
  | 'snag' | 'extract' | 'teach' | 'equip' | 'useItem' | 'discard' | 'throw';

export type ClientMsg =
  /** Join the queue for a match with the starter picked from the server's roll. */
  | { t: 'queue'; pick: number }
  /** Ask the server for a starter roll (it rolls; the browser only shows it). */
  | { t: 'roll' }
  | { t: 'leaveQueue' }
  /**
   * Movement keys, one frame per simulation step as [number, x, y] (sent a few at a time), and the
   * cursor in tiles. `mx`/`my` alone (no frames) holds the keys until the next message.
   */
  | { t: 'in'; f?: Array<[number, number, number]>; mx?: number; my?: number; ax?: number; ay?: number }
  | { t: 'cmd'; c: CommandName; a: Array<number | string | boolean | null>; n?: number }
  | { t: 'chat'; text: string }
  | { t: 'leave' }
  | { t: 'ping'; at: number };

export interface RosterEntry {
  trainerId: number;
  name: string;
  human: boolean;
  /** A player's look (src/look.ts), for drawing their trainer. */
  look?: unknown;
}

export type ServerMsg =
  | { t: 'hello'; name: string; guest: boolean; server: 'live' | 'demo' | 'dev'; build: string }
  /** The starter roll: the browser animates the reels from this seed (src/sim/starters.ts) and the server knows what it offered. */
  | { t: 'roll'; seed: number; pool: string[] }
  | { t: 'lobby'; players: string[]; startsIn: number | null; size: number }
  | { t: 'start'; matchId: string; seed: number; you: number; roster: RosterEntry[] }
  /** State patch and the events since the last one. */
  | { t: 's'; p: SyncPatch; e: Array<Record<string, unknown>>; time: number; /** The last movement frame applied. */ ack?: number }
  /** A command's reply (what the offline game shows as a message). */
  | { t: 'reply'; n?: number; text: string; seconds: number }
  | { t: 'end'; outcome: 'win' | 'loss'; place: number }
  | { t: 'chat'; id?: number; from: string; text: string; at: number; system?: boolean }
  | { t: 'error'; text: string }
  | { t: 'pong'; at: number };
