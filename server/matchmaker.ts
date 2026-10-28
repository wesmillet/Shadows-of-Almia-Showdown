/**
 * Matchmaking: the public queue (ranked play has been retired; every public match is casual).
 *
 * Players queue alone or as a party (which plays as a squad: one team, see Trainer.team). The
 * queue keeps forming lobbies; a group goes into the first one with room for all of it. A lobby
 * starts the moment it is full (after a short beat to see who is in), or `wait` seconds after it
 * opened, with computer trainers in the empty seats, but never with fewer than minPlayers real
 * players: neither the wait running out nor "Start now with bots" starts it before then. The one
 * exception is an administrator (checked by the hub from their account's role, never their name):
 * they may start their lobby at once with whoever is in it, even alone, bots filling every other seat.
 */
import type { Peer } from './room';

export type QueueMode = 'casual';

export interface Ticket {
  peer: Peer;
  starter: string;
}

export interface Group {
  tickets: Ticket[];
  /** A party: its players are one team in the match. */
  party: boolean;
}

export interface Lineup {
  peer: Peer;
  starter: string;
  team?: number;
}

export interface MatchmakerOptions {
  size: number;
  /** Seconds a lobby waits for players before starting with computer trainers. */
  wait: Record<QueueMode, number>;
  /** Seconds to wait once a lobby is full. */
  fullSeconds: number;
  /** Real players a lobby needs before it starts with computer trainers in the empty seats
   * (default half the lobby, rounded up). Below that it keeps waiting. */
  minPlayers?: number;
  start: (players: Lineup[], mode: QueueMode) => void;
  /** Whether this queued player's account is an administrator (may start a lobby below minPlayers). */
  isAdmin?: (peer: Peer) => boolean;
}

interface Forming {
  mode: QueueMode;
  groups: Group[];
  openedAt: number;
  startAt: number;
  /** An administrator started it: it goes ahead below minPlayers. */
  forced?: boolean;
}

export class Matchmaker {
  private lobbies: Forming[] = [];
  private lastStatus = 0;

  constructor(private readonly o: MatchmakerOptions) {}

  /** Real players needed to start (the rest are computer trainers). */
  get minPlayers(): number {
    return Math.min(this.o.size, this.o.minPlayers ?? Math.ceil(this.o.size / 2));
  }

  /** Players waiting, by queue. */
  get waiting(): Record<QueueMode, number> {
    const out = { casual: 0 };
    for (const l of this.lobbies) out[l.mode] += count(l);
    return out;
  }

  has(key: string): boolean {
    return this.lobbies.some((l) => l.groups.some((g) => g.tickets.some((t) => t.peer.key === key)));
  }

  join(group: Group, mode: QueueMode, now: number): void {
    for (const t of group.tickets) this.leave(t.peer.key, false);
    const n = group.tickets.length;
    if (n > this.o.size) return;
    let lobby = this.lobbies.find((l) => l.mode === mode && count(l) + n <= this.o.size);
    if (!lobby) {
      lobby = { mode, groups: [], openedAt: now, startAt: now + this.o.wait[mode] * 1000 };
      this.lobbies.push(lobby);
    }
    lobby.groups.push(group);
    if (count(lobby) >= this.o.size) lobby.startAt = Math.min(lobby.startAt, now + this.o.fullSeconds * 1000);
    this.status(now, true);
  }

  /** A queued player is done waiting: their casual lobby starts in two seconds (bots fill the rest). */
  startNow(key: string, now: number, admin = false): void {
    for (const l of this.lobbies) {
      if (l.mode !== 'casual') continue;
      if (!l.groups.some((g) => g.tickets.some((t) => t.peer.key === key))) continue;
      if (admin) l.forced = true;
      else if (count(l) < this.minPlayers) return;
      l.startAt = Math.min(l.startAt, now + 2000);
      this.status(now, true);
      return;
    }
  }

  /** Takes a player (and the rest of their party) out of the queue. */
  leave(key: string, notify = true): Peer[] {
    const gone: Peer[] = [];
    for (const l of this.lobbies) {
      const g = l.groups.find((x) => x.tickets.some((t) => t.peer.key === key));
      if (!g) continue;
      l.groups.splice(l.groups.indexOf(g), 1);
      gone.push(...g.tickets.map((t) => t.peer));
    }
    this.lobbies = this.lobbies.filter((l) => l.groups.length);
    if (gone.length && notify) this.status(Date.now(), true);
    return gone;
  }

  /** Called often: starts lobbies whose time has come, and keeps the waiting players informed. */
  tick(now: number): void {
    for (const l of [...this.lobbies]) {
      if (now < l.startAt) continue;
      // Not enough real players yet: keep waiting (the wait starts over once there are).
      if (count(l) < this.minPlayers && !l.forced) {
        l.startAt = now + this.o.wait[l.mode] * 1000;
        continue;
      }
      this.lobbies.splice(this.lobbies.indexOf(l), 1);
      // Parties are squads (team 1, 2, ...); everyone else plays alone.
      let team = 0;
      const players: Lineup[] = [];
      for (const g of l.groups) {
        const t = g.party && g.tickets.length > 1 ? ++team : undefined;
        for (const x of g.tickets) players.push({ peer: x.peer, starter: x.starter, team: t });
      }
      this.o.start(players, l.mode);
      this.status(now, true);
    }
    this.status(now, false);
  }

  private status(now: number, force: boolean): void {
    if (!force && now - this.lastStatus < 1000) return;
    this.lastStatus = now;
    for (const l of this.lobbies) {
      const players = l.groups.flatMap((g) => g.tickets.map((t) => t.peer.name));
      // null: waiting for more players (`need` of them) before any countdown
      const need = l.forced ? 0 : Math.max(0, this.minPlayers - players.length);
      const startsIn = need ? null : Math.max(0, Math.ceil((l.startAt - now) / 1000));
      for (const g of l.groups) {
        for (const t of g.tickets) {
          // Only an administrator's own lobby message offers the admin start (the server checks again).
          const admin = this.o.isAdmin?.(t.peer) || undefined;
          t.peer.send({ t: 'lobby', players, startsIn, size: this.o.size, mode: l.mode, need, min: this.minPlayers, admin });
        }
      }
    }
  }
}

function count(l: Forming): number {
  return l.groups.reduce((n, g) => n + g.tickets.length, 0);
}

