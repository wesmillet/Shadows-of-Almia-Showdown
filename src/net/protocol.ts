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

export type QueueMode = 'casual' | 'ranked';

/** A private lobby's custom rules (server/privateLobby.ts checks every one). */
export interface PrivateRules {
  /** Trainers in the match, 2 to 8. */
  size: number;
  /** Fill empty spots with computer trainers. */
  bots: boolean;
  /** Starting level of each starter. */
  level: number;
  /** Solo, teams of two or four, or players pick their team. */
  teams: 'solo' | 'duos' | 'squads' | 'pick';
  /** How fast the storm closes in (1 is normal). */
  storm: number;
  /** The rare-item chest in the player's camp. */
  rareChest: boolean;
}

export interface PrivateState {
  code: string;
  host: string;
  you: string;
  rules: PrivateRules;
  members: Array<{ name: string; team?: number; picked?: boolean }>;
  /** 'picking': the host started; everyone rolls a starter. */
  state: 'open' | 'picking';
}

export interface PartyState {
  leader: string;
  you: string;
  members: Array<{ name: string; picked?: boolean }>;
  /** Invites sent and not answered yet. */
  invited: string[];
}

/** A friends list entry (server/accounts.ts friendList). */
export interface FriendEntry {
  name: string;
  relation: 'friend' | 'incoming' | 'outgoing';
  online: boolean;
  activity: 'offline' | 'menu' | 'queue' | 'match' | 'watching' | 'private';
  matchId?: string;
}

export type ClientMsg =
  /** Join the queue for a match with the starter picked from the server's roll (in a party or private lobby: that one's pick). */
  | { t: 'queue'; pick: number; mode?: QueueMode }
  /** Parties: invite a friend, answer an invite, leave, remove someone (leader), or queue together (leader). */
  | { t: 'party'; a: 'invite' | 'accept' | 'decline' | 'leave' | 'kick' | 'queue'; name?: string; mode?: QueueMode }
  /** Private lobbies: make one, join by code, change the rules (host), pick a team, start (host). */
  | { t: 'private'; a: 'create' | 'join' | 'leave' | 'rules' | 'team' | 'start' | 'kick'; code?: string; rules?: Partial<PrivateRules>; team?: number; name?: string }
  /** Watch a match: a friend's (by name), a match by id, or the featured one. `follow` switches whom the camera follows. */
  | { t: 'spectate'; name?: string; matchId?: string; featured?: boolean }
  | { t: 'follow'; trainerId?: number; step?: number }
  | { t: 'unspectate' }
  /** Ask the server for a starter roll (it rolls; the browser only shows it). */
  | { t: 'roll' }
  | { t: 'leaveQueue' }
  | { t: 'startNow' }
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
  /** Squad number, when the match has squads. */
  team?: number;
  /** The title a player wears (src/net/progression.ts). */
  title?: string;
}

export type ServerMsg =
  | { t: 'hello'; name: string; guest: boolean; server: 'live' | 'demo' | 'dev'; build: string }
  /** The starter roll: the browser animates the reels from this seed (src/sim/starters.ts) and the server knows what it offered. */
  | { t: 'roll'; seed: number; pool: string[] }
  | { t: 'lobby'; players: string[]; startsIn: number | null; size: number; mode?: QueueMode }
  /** Friends (with what they are doing), your party, and party invites waiting for an answer. */
  | { t: 'social'; friends: FriendEntry[]; party: PartyState | null; invites: string[] }
  /** Your trade offers changed (one came in, was answered or cancelled): fetch /api/trades again. */
  | { t: 'trades' }
  /** Roll a starter now: your party is queueing, or your private lobby is starting. */
  | { t: 'pick'; reason: 'party' | 'private'; seconds: number }
  | { t: 'private'; lobby: PrivateState | null }
  /** Watching a match: its updates follow (as 's' messages, `delay` seconds behind). */
  | { t: 'spectate'; matchId: string; seed: number; roster: RosterEntry[]; follow: number; delay: number; mode: string }
  | { t: 'spectateEnd'; text: string }
  /** Your match was called off (the server is updating): nothing was counted. */
  | { t: 'aborted'; text: string }
  /** Events on now (double XP, shiny hour...), sent on connect and when they change. */
  | { t: 'events'; active: Array<{ name: string; kind: string; value: number; endsAt: number }> }
  /** You are out of the queue (a party member left it, or the party broke up). */
  | { t: 'unqueued'; text: string }
  /** What a match did for your progress: XP line by line, levels, achievements earned. */
  | { t: 'progress'; xp: Array<{ what: string; xp: number }>; before: { level: number; into: number; next: number }; after: { level: number; into: number; next: number }; achievements: Array<{ id: string; name: string; desc: string; title?: string; look?: string }> }
  /** A ranked match's effect on your rating. */
  | { t: 'rated'; before: number; after: number; tier: { id: string; name: string; color: string } | null; placementLeft: number }
  /** A short message for whatever screen is up (a friend request, an invite, a party change). */
  | { t: 'notice'; text: string }
  | { t: 'start'; matchId: string; seed: number; you: number; roster: RosterEntry[]; mode?: string }
  /** State patch and the events since the last one. */
  | { t: 's'; p: SyncPatch; e: Array<Record<string, unknown>>; time: number; /** The last movement frame applied. */ ack?: number }
  /** A command's reply (what the offline game shows as a message). */
  | { t: 'reply'; n?: number; text: string; seconds: number }
  | { t: 'end'; outcome: 'win' | 'loss'; place: number }
  | { t: 'chat'; id?: number; from: string; text: string; at: number; system?: boolean; /** From a moderator. */ mod?: boolean; /** A server-wide announcement. */ announce?: boolean }
  /** A moderator removed a chat message. */
  | { t: 'chatDelete'; id: number }
  | { t: 'error'; text: string }
  | { t: 'pong'; at: number };
