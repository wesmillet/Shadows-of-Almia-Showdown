/**
 * Private lobbies: a host makes one and shares its code; friends join with the code, the host sets
 * the rules and starts it. Everyone then rolls a starter (as for any match) and the match begins.
 *
 * Private matches are for fun: their wins, stats and Pokémon are not kept (server/accounts.ts
 * recordMatch), so nobody can farm the PC or the leaderboard with a friend's help.
 */
import { randomInt } from 'node:crypto';
import type { PrivateRules, PrivateState } from '../src/net/protocol';
import type { Lineup } from './matchmaker';
import type { Peer } from './room';

export const DEFAULT_RULES: PrivateRules = { size: 8, bots: true, level: 15, teams: 'solo', storm: 1, rareChest: false };
export const STORM_SPEEDS = [0.5, 0.75, 1, 1.5, 2];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** The host's rule changes, each checked (anything odd keeps the current value). */
export function cleanRules(cur: PrivateRules, patch: Partial<Record<keyof PrivateRules, unknown>>): PrivateRules {
  const r = { ...cur };
  const int = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const size = int(patch.size, 2, 8);
  if (size !== null) r.size = size;
  const level = int(patch.level, 5, 50);
  if (level !== null) r.level = level;
  if (typeof patch.bots === 'boolean') r.bots = patch.bots;
  if (typeof patch.rareChest === 'boolean') r.rareChest = patch.rareChest;
  if (patch.teams === 'solo' || patch.teams === 'duos' || patch.teams === 'squads' || patch.teams === 'pick') r.teams = patch.teams;
  if (typeof patch.storm === 'number' && STORM_SPEEDS.includes(patch.storm)) r.storm = patch.storm;
  return r;
}

export function newCode(taken: (code: string) => boolean): string {
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += CODE_CHARS[randomInt(CODE_CHARS.length)];
    if (!taken(c)) return c;
  }
}

interface Member {
  peer: Peer;
  team?: number;
  picked?: boolean;
}

export class PrivateLobby {
  rules: PrivateRules = { ...DEFAULT_RULES };
  readonly members = new Map<string, Member>();
  state: 'open' | 'picking' = 'open';

  constructor(readonly code: string, public hostKey: string, host: Peer) {
    this.members.set(host.key, { peer: host, team: 1 });
  }

  get host(): Peer {
    return (this.members.get(this.hostKey) as Member).peer;
  }

  join(peer: Peer): string | null {
    if (this.state !== 'open') return 'That lobby is starting a match';
    if (!this.members.has(peer.key) && this.members.size >= this.rules.size) return 'That lobby is full';
    // Pick mode: the team with the fewest players.
    const counts = [1, 2, 3, 4].map((t) => [...this.members.values()].filter((m) => m.team === t).length);
    this.members.set(peer.key, { peer, team: 1 + counts.indexOf(Math.min(...counts)) });
    return null;
  }

  /** A member leaves; the host role passes on. Returns true when the lobby is now empty. */
  leave(key: string): boolean {
    this.members.delete(key);
    if (key === this.hostKey) {
      const next = this.members.keys().next();
      if (!next.done) this.hostKey = next.value;
    }
    return this.members.size === 0;
  }

  setRules(key: string, patch: Partial<Record<keyof PrivateRules, unknown>>): void {
    if (key !== this.hostKey || this.state !== 'open') return;
    this.rules = cleanRules(this.rules, patch);
    // Shrinking below the players already in: the newest wait outside.
    while (this.members.size > this.rules.size) {
      const last = [...this.members.keys()].pop() as string;
      if (last === this.hostKey) break;
      this.members.get(last)?.peer.send({ t: 'private', lobby: null });
      this.members.get(last)?.peer.send({ t: 'notice', text: 'The lobby got smaller, and you were last in' });
      this.members.delete(last);
    }
  }

  setTeam(key: string, team: unknown): void {
    const m = this.members.get(key);
    if (m && this.state === 'open' && typeof team === 'number' && Number.isInteger(team) && team >= 1 && team <= 4) m.team = team;
  }

  view(you: string): PrivateState {
    return {
      code: this.code, host: this.host.name, you, rules: this.rules, state: this.state,
      members: [...this.members.values()].map((m) => ({ name: m.peer.name, team: this.rules.teams === 'pick' ? m.team : undefined, picked: this.state === 'picking' ? !!m.picked : undefined })),
    };
  }

  broadcast(): void {
    for (const m of this.members.values()) m.peer.send({ t: 'private', lobby: this.view(m.peer.name) });
  }

  /** Who plays on which team, by the rules (join order for duos and squads). */
  lineup(starters: Map<string, string>): Lineup[] {
    const per = this.rules.teams === 'duos' ? 2 : this.rules.teams === 'squads' ? 4 : 0;
    return [...this.members.values()].map((m, i) => ({
      peer: m.peer,
      starter: starters.get(m.peer.key) as string,
      team: this.rules.teams === 'pick' ? m.team : per ? 1 + Math.floor(i / per) : undefined,
    }));
  }
}
