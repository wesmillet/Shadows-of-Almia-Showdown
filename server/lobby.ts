/**
 * Matchmaking: players who are ready wait together in one forming lobby. It starts the moment it
 * is full, or `waitSeconds` after the first player joined, with computer trainers in the empty
 * seats. Each player brings the starter they picked from the server's own roll.
 */
import type { Peer } from './room';

export interface Queued {
  peer: Peer;
  starter: string;
}

export interface LobbyOptions {
  size: number;
  waitSeconds: number;
  /** Seconds to wait once the lobby is full (a beat to see who is in). */
  fullSeconds: number;
  start: (players: Queued[]) => void;
}

export class Lobby {
  private queued: Queued[] = [];
  private startAt: number | null = null;
  private lastStatus = 0;

  constructor(private readonly o: LobbyOptions) {}

  get waiting(): number {
    return this.queued.length;
  }

  join(q: Queued, now: number): void {
    this.leave(q.peer.key);
    this.queued.push(q);
    if (this.startAt === null) this.startAt = now + this.o.waitSeconds * 1000;
    if (this.queued.length >= this.o.size) this.startAt = Math.min(this.startAt, now + this.o.fullSeconds * 1000);
    this.status(now, true);
  }

  leave(key: string): void {
    const before = this.queued.length;
    this.queued = this.queued.filter((q) => q.peer.key !== key);
    if (!this.queued.length) this.startAt = null;
    if (before !== this.queued.length) this.status(Date.now(), true);
  }

  has(key: string): boolean {
    return this.queued.some((q) => q.peer.key === key);
  }

  /** Called often: starts the match when it is time, and keeps the waiting players informed. */
  tick(now: number): void {
    if (this.startAt !== null && now >= this.startAt && this.queued.length) {
      const players = this.queued.splice(0, this.o.size);
      this.startAt = this.queued.length ? now + this.o.waitSeconds * 1000 : null;
      this.o.start(players);
      this.status(now, true);
      return;
    }
    this.status(now, false);
  }

  private status(now: number, force: boolean): void {
    if (!force && now - this.lastStatus < 1000) return;
    this.lastStatus = now;
    const startsIn = this.startAt === null ? null : Math.max(0, Math.ceil((this.startAt - now) / 1000));
    const players = this.queued.map((q) => q.peer.name);
    for (const q of this.queued) q.peer.send({ t: 'lobby', players, startsIn, size: this.o.size });
  }
}
