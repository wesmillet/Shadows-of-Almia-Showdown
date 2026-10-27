/**
 * Matchmaking: the casual and ranked queues.
 *
 * Players queue alone or as a party (which plays as a squad: one team, see Trainer.team). Each
 * queue keeps forming lobbies; a group goes into the first one with room for all of it (ranked: the
 * first whose players are close to its rating). A lobby starts the moment it is full (after a short
 * beat to see who is in), or `wait` seconds after it opened, with computer trainers in the empty
 * seats.
 *
 * Ranked is solo, signed-in players only, and matches by rating: a lobby takes players within
 * RANKED_WINDOW of its average, a window that widens the longer the lobby has waited, so a quiet
 * night still gets matches and a busy one gets fair ones.
 */
import type { Peer } from './room';

export type QueueMode = 'casual' | 'ranked';

export interface Ticket {
  peer: Peer;
  starter: string;
  /** Ranked: the player's rating (casual: unused). */
  rating?: number;
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
  start: (players: Lineup[], mode: QueueMode) => void;
}

/** Ranked: a lobby takes players this close to its average rating, plus RANKED_WIDEN a second it has waited. */
export const RANKED_WINDOW = 150;
export const RANKED_WIDEN = 10;

interface Forming {
  mode: QueueMode;
  groups: Group[];
  openedAt: number;
  startAt: number;
}

export class Matchmaker {
  private lobbies: Forming[] = [];
  private lastStatus = 0;

  constructor(private readonly o: MatchmakerOptions) {}

  /** Players waiting, by queue. */
  get waiting(): Record<QueueMode, number> {
    const out = { casual: 0, ranked: 0 };
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
    const avg = mode === 'ranked' ? mean(group.tickets.map((t) => t.rating ?? 1500)) : 0;
    let lobby = this.lobbies.find((l) => {
      if (l.mode !== mode || count(l) + n > this.o.size) return false;
      if (mode !== 'ranked') return true;
      const window = RANKED_WINDOW + RANKED_WIDEN * Math.max(0, (now - l.openedAt) / 1000);
      return Math.abs(lobbyRating(l) - avg) <= window;
    });
    if (!lobby) {
      lobby = { mode, groups: [], openedAt: now, startAt: now + this.o.wait[mode] * 1000 };
      this.lobbies.push(lobby);
    }
    lobby.groups.push(group);
    if (count(lobby) >= this.o.size) lobby.startAt = Math.min(lobby.startAt, now + this.o.fullSeconds * 1000);
    this.status(now, true);
  }

  /** A queued player is done waiting: their casual lobby starts in two seconds (bots fill the rest). */
  startNow(key: string, now: number): void {
    for (const l of this.lobbies) {
      if (l.mode !== 'casual') continue;
      if (!l.groups.some((g) => g.tickets.some((t) => t.peer.key === key))) continue;
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
      const startsIn = Math.max(0, Math.ceil((l.startAt - now) / 1000));
      const players = l.groups.flatMap((g) => g.tickets.map((t) => t.peer.name));
      for (const g of l.groups) for (const t of g.tickets) t.peer.send({ t: 'lobby', players, startsIn, size: this.o.size, mode: l.mode });
    }
  }
}

function count(l: Forming): number {
  return l.groups.reduce((n, g) => n + g.tickets.length, 0);
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function lobbyRating(l: Forming): number {
  return mean(l.groups.flatMap((g) => g.tickets.map((t) => t.rating ?? 1500)));
}
