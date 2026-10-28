/**
 * Everything outside a match: who is connected and what they are doing, the public
 * queues, parties, private lobbies, starter picks, spectating, and what happens when a match ends
 * (stats, progress, the replay). main.ts feeds it connections and messages; it runs the rest.
 *
 * Starter picks: every match starts with each player picking one of three starters the server
 * rolled for them (src/sim/starters.ts). Alone, a player rolls and then queues. A party or a private
 * lobby rolls together: the server asks everyone to pick (a "pick session"), and goes ahead when all
 * have, or after PICK_SECONDS with the first offer for anyone still choosing.
 */
import { randomBytes, randomInt } from 'node:crypto';
import type { ClientMsg, PartyState, QueueMode, ServerMsg } from '../src/net/protocol';
import { starterChoices, unlockedFromPc } from '../src/sim/starters';
import type { Accounts, Presence } from './accounts';
import { Matchmaker, type Lineup } from './matchmaker';
import { newCode, PrivateLobby } from './privateLobby';
import { deleteReplay, ReplayRecorder } from './replays';
import type { EndReport, RoomHandle } from './roomHandle';
import type { Events } from './events';
import { Room, type Peer, type RoomHooks, type RoomMode, type RoomOptions } from './room';
import type { Human } from './world';
import type { World } from './world';

/** Seconds a party or private lobby has to pick starters. */
export const PICK_SECONDS = 40;
/** A party is a squad: at most this many. */
export const PARTY_MAX = 4;
const DRAIN_TEXT = 'The server is updating in a few minutes. Matches already running will finish; new ones start right after';

export interface Client extends Peer {
  accountId: number | null;
  guest: boolean;
  rollSeed: number | null;
  /** The starters this player's roll was drawn from (their PC's unlocks). */
  rollPool: string[];
  /** The match they are playing in. */
  room: RoomHandle | null;
  /** The match they are watching. */
  watching: RoomHandle | null;
  party: Party | null;
  /** Parties that invited them (by party id). */
  invites: Set<string>;
  private: PrivateLobby | null;
  pick: PickSession | null;
  /** What friends last saw them doing (pushed again when it changes). */
  shown: string;
}

export interface Party {
  id: string;
  leader: Client;
  members: Client[];
  invited: Set<Client>;
}

class PickSession {
  readonly picks = new Map<string, string>();
  constructor(
    readonly reason: 'party' | 'private',
    readonly members: Client[],
    readonly deadline: number,
    readonly done: (picks: Map<string, string>) => void,
  ) {}

  get complete(): boolean {
    return this.members.every((m) => this.picks.has(m.key));
  }
}

/** A new match: who plays, and how. */
export interface RoomSpec {
  entries: Array<Human & { peer: Peer }>;
  size: number;
  seed: number;
  opts: Omit<RoomOptions, 'recorder'>;
  /** Where its replay goes (null: not recorded). */
  replayDir: string | null;
}

/** Makes a match: in this thread (the default), or in a worker (server/remoteRoom.ts). */
export type RoomFactory = (spec: RoomSpec, hooks: RoomHooks, onEnd: (room: RoomHandle, report: EndReport) => void) => RoomHandle;

export interface HubOptions {
  world: World;
  accounts: Accounts;
  size: number;
  wait: Record<QueueMode, number>;
  /** Real players a public lobby needs before computer trainers fill the rest (default half the lobby). */
  minPlayers?: number;
  hooks: RoomHooks;
  /** Where replays go (null: not recorded). */
  replayDir: string | null;
  /** Replays kept, in bytes (oldest go first). */
  replayBytes: number;
  log: (...a: unknown[]) => void;
  /** Every match's end (metrics). */
  onMatchEnd?: (room: RoomHandle, report: EndReport) => void;
  onMatchStart?: (room: RoomHandle) => void;
  /** Where matches run (default: this thread). */
  makeRoom?: RoomFactory;
}

/** Matches in this thread (the checks use it; the server prefers workers). */
export function localRoom(world: World): RoomFactory {
  return (spec, hooks, onEnd) => {
    const dir = spec.replayDir;
    return new Room(world, spec.entries, spec.size, spec.seed, hooks, onEnd, {
      ...spec.opts,
      recorder: dir ? (r) => new ReplayRecorder(dir, r.id, spec.seed, spec.opts.mode, r.roster, r.match, r.ids) : undefined,
    });
  };
}

export class Hub {
  readonly clients = new Map<string, Client>();
  readonly rooms = new Set<RoomHandle>();
  private readonly privates = new Map<string, PrivateLobby>();
  private readonly parties = new Map<string, Party>();
  private sessions = new Set<PickSession>();
  readonly matchmaker: Matchmaker;
  private lastPresence = 0;
  /** Getting ready to update: matches running finish, no new ones start. */
  draining = false;
  /** Timed events (XP, shiny, storm boosts), set once the chat exists to announce them. */
  events: Events | null = null;

  constructor(private readonly o: HubOptions) {
    this.matchmaker = new Matchmaker({
      size: o.size,
      wait: o.wait,
      fullSeconds: 3,
      minPlayers: o.minPlayers,
      start: (players, mode) => this.startRoom(players, mode, {}),
    });
    o.accounts.presence = (id) => this.presence(id);
    o.accounts.onTradesChanged = (ids) => {
      for (const id of ids) this.clients.get(`u${id}`)?.send({ t: 'trades' });
    };
    o.accounts.onFriendsChanged = (ids) => {
      for (const id of ids) {
        const c = this.clients.get(`u${id}`);
        if (c) this.pushSocial(c);
      }
    };
  }

  // ---------------------------------------------------------------- connections

  connect(c: Client): void {
    // The same player connecting twice (a second tab) is handled by main.ts before this.
    this.clients.set(c.key, c);
    // Back after a dropped connection: straight into the match still running.
    for (const r of this.rooms) {
      if (r.playing(c.key)) {
        c.room = r;
        r.rejoin(c);
      }
    }
    this.pushSocial(c);
    this.presenceChanged(c);
    const ev = this.events?.active() ?? [];
    if (ev.length) c.send({ t: 'events', active: ev.map((e) => ({ name: e.name, kind: e.kind, value: e.value, endsAt: e.endsAt })) });
  }

  disconnect(c: Client): void {
    if (this.clients.get(c.key) !== c) return;
    this.clients.delete(c.key);
    this.leaveQueue(c, `${c.name} disconnected`);
    this.cancelPick(c, `${c.name} disconnected`);
    if (c.party) this.leaveParty(c);
    for (const p of this.parties.values()) p.invited.delete(c);
    if (c.private) this.leavePrivate(c);
    c.watching?.unspectate(c.key);
    c.room?.disconnect(c.key);
    this.presenceChanged(c, true);
  }

  // ---------------------------------------------------------------- messages

  message(c: Client, msg: ClientMsg): void {
    switch (msg.t) {
      case 'roll':
        if (c.room) return;
        c.rollSeed = randomInt(1, 2 ** 31);
        // A signed-in player's pool grows with their PC; a guest rolls from the starting pool.
        c.rollPool = c.accountId === null ? [] : unlockedFromPc(this.o.accounts.pcDexes(c.accountId));
        c.send({ t: 'roll', seed: c.rollSeed, pool: c.rollPool });
        return;
      case 'queue':
        // Every public match is casual (ranked play has been retired; an old client asking for it plays casual).
        return this.queue(c, msg.pick);
      case 'leaveQueue':
        this.leaveQueue(c, `${c.name} left the queue`);
        this.cancelPick(c, `${c.name} left`);
        return;
      case 'startNow':
        this.matchmaker.startNow(c.key, Date.now());
        return;
      case 'party':
        return this.partyMsg(c, msg);
      case 'private':
        return this.privateMsg(c, msg);
      case 'spectate':
        return this.spectate(c, msg);
      case 'follow':
        c.watching?.follow(c.key, msg.trainerId, msg.step);
        return;
      case 'unspectate':
        c.watching?.unspectate(c.key);
        c.watching = null;
        return;
      case 'leave':
        // Out of the match for good (knocked out, or quitting): free to queue again at once.
        c.room?.receive(c.key, msg);
        c.room = null;
        return;
      default:
        c.room?.receive(c.key, msg);
    }
  }

  // ---------------------------------------------------------------- solo queue and picks

  /** Stops new matches (the server is about to update), or lets them start again. */
  drain(on: boolean): void {
    this.draining = on;
    if (!on) return;
    for (const c of this.clients.values()) {
      if (this.matchmaker.has(c.key) || c.pick) {
        this.leaveQueue(c, DRAIN_TEXT);
        this.cancelPick(c, DRAIN_TEXT);
        c.send({ t: 'unqueued', text: DRAIN_TEXT });
      }
      if (c.private?.state === 'picking') c.private.state = 'open';
    }
  }

  /** Shutting down now: every match still running is called off (nothing counted). */
  shutdown(text: string): void {
    for (const r of [...this.rooms]) r.abort(text);
  }

  private queue(c: Client, pick: unknown): void {
    if (c.room) return;
    if (c.rollSeed === null) return c.send({ t: 'unqueued', text: 'Your roll expired, roll again' });
    if (this.draining && !c.pick) return c.send({ t: 'notice', text: DRAIN_TEXT });
    const choices = starterChoices(c.rollSeed, c.rollPool);
    const starter = typeof pick === 'number' && Number.isInteger(pick) ? choices[pick] : undefined;
    if (!starter) return c.send({ t: 'unqueued', text: 'Pick one of the starters you rolled' });
    // Part of a party or a private lobby that is picking: this is that pick.
    if (c.pick) {
      c.pick.picks.set(c.key, starter);
      this.pickProgress(c.pick);
      return;
    }
    if (c.party && c.party.members.length > 1) return c.send({ t: 'error', text: 'Your party leader starts the matches' });
    if (c.private) return c.send({ t: 'error', text: 'Leave your private lobby to queue' });
    this.matchmaker.join({ tickets: [{ peer: c, starter }], party: false }, 'casual', Date.now());
    this.presenceChanged(c);
  }

  private leaveQueue(c: Client, why: string): void {
    const gone = this.matchmaker.leave(c.key);
    for (const p of gone) {
      if (p.key !== c.key) p.send({ t: 'unqueued', text: why });
      const pc = this.clients.get(p.key);
      if (pc) this.presenceChanged(pc);
    }
  }

  /** Everyone in `members` picks a starter; `done` runs when all have (or time is up). */
  private startPick(reason: 'party' | 'private', members: Client[], done: (picks: Map<string, string>) => void): void {
    const s = new PickSession(reason, members, Date.now() + PICK_SECONDS * 1000, done);
    this.sessions.add(s);
    for (const m of members) {
      m.pick = s;
      m.rollSeed = null;
      m.send({ t: 'pick', reason, seconds: PICK_SECONDS });
      this.presenceChanged(m);
    }
  }

  private pickProgress(s: PickSession): void {
    if (s.reason === 'party') for (const m of s.members) this.pushSocial(m);
    else s.members[0]?.private?.broadcast();
    if (s.complete) this.finishPick(s);
  }

  private finishPick(s: PickSession): void {
    this.sessions.delete(s);
    for (const m of s.members) m.pick = null;
    s.done(s.picks);
  }

  /** Someone in a pick session left: a party's pick is off; a private lobby goes on without them. */
  private cancelPick(c: Client, why: string): void {
    const s = c.pick;
    if (!s) return;
    c.pick = null;
    if (s.reason === 'party') {
      this.sessions.delete(s);
      for (const m of s.members) {
        m.pick = null;
        if (m !== c) m.send({ t: 'unqueued', text: why });
      }
    } else {
      (s.members as Client[]).splice(s.members.indexOf(c), 1);
      s.picks.delete(c.key);
      if (!s.members.length) this.sessions.delete(s);
      else if (s.complete) this.finishPick(s);
    }
  }

  // ---------------------------------------------------------------- parties

  private partyMsg(c: Client, msg: Extract<ClientMsg, { t: 'party' }>): void {
    const name = String(msg.name ?? '');
    const target = [...this.clients.values()].find((x) => x.name.toLowerCase() === name.toLowerCase());
    switch (msg.a) {
      case 'invite': {
        if (c.accountId === null) return c.send({ t: 'notice', text: 'Sign in to make a party' });
        if (!target || target.accountId === null) return c.send({ t: 'notice', text: `${name} is not online` });
        if (!this.o.accounts.areFriends(c.accountId, target.accountId)) return c.send({ t: 'notice', text: 'You can invite friends to your party' });
        if (target.party && target.party === c.party) return;
        let p = c.party;
        if (p && p.leader !== c) return c.send({ t: 'notice', text: 'Only the party leader can invite' });
        if (!p) {
          p = { id: randomBytes(6).toString('base64url'), leader: c, members: [c], invited: new Set() };
          this.parties.set(p.id, p);
          c.party = p;
        }
        if (p.members.length + p.invited.size >= PARTY_MAX) return c.send({ t: 'notice', text: `A party is at most ${PARTY_MAX} trainers` });
        p.invited.add(target);
        target.invites.add(p.id);
        target.send({ t: 'notice', text: `${c.name} invited you to their party` });
        this.pushSocial(target);
        this.pushParty(p);
        return;
      }
      case 'accept': {
        const p = [...c.invites].map((id) => this.parties.get(id)).find((x) => x && x.leader.name.toLowerCase() === name.toLowerCase());
        c.invites.clear();
        if (!p || !p.invited.has(c)) {
          this.pushSocial(c);
          return c.send({ t: 'notice', text: 'That invite is gone' });
        }
        if (c.party) this.leaveParty(c);
        if (c.private) this.leavePrivate(c);
        this.leaveQueue(c, `${c.name} joined a party`);
        p.invited.delete(c);
        if (p.members.length >= PARTY_MAX) return c.send({ t: 'notice', text: 'That party is full' });
        // The party might be queued or picking: that stops, as the squad changed.
        this.leaveQueue(p.leader, `${c.name} joined the party`);
        p.members.push(c);
        c.party = p;
        for (const m of p.members) if (m !== c) m.send({ t: 'notice', text: `${c.name} joined the party` });
        this.pushParty(p);
        return;
      }
      case 'decline': {
        for (const id of c.invites) {
          const p = this.parties.get(id);
          if (p && p.leader.name.toLowerCase() === name.toLowerCase()) {
            p.invited.delete(c);
            c.invites.delete(id);
            p.leader.send({ t: 'notice', text: `${c.name} declined your invite` });
            this.pushParty(p);
          }
        }
        this.pushSocial(c);
        return;
      }
      case 'leave':
        if (c.party) this.leaveParty(c);
        return;
      case 'kick': {
        const p = c.party;
        if (!p || p.leader !== c || !target || target.party !== p || target === c) return;
        target.send({ t: 'notice', text: 'You were removed from the party' });
        this.leaveParty(target);
        return;
      }
      case 'queue': {
        const p = c.party;
        if (!p || p.leader !== c) return;
        if (this.draining) return c.send({ t: 'notice', text: DRAIN_TEXT });
        if (p.members.length < 2) return c.send({ t: 'notice', text: 'Your party is just you: use Find a Match' });
        if (p.members.some((m) => m.room || m.pick)) return c.send({ t: 'notice', text: 'Someone in your party is still in a match' });
        for (const m of p.members) {
          m.watching?.unspectate(m.key);
          m.watching = null;
        }
        this.startPick('party', [...p.members], (picks) => {
          // Everyone picked: the party queues as one squad.
          if (!this.parties.has(p.id)) return;
          const tickets = p.members.filter((m) => picks.has(m.key) && this.clients.get(m.key) === m).map((m) => ({ peer: m, starter: picks.get(m.key) as string }));
          this.matchmaker.join({ tickets, party: true }, 'casual', Date.now());
          for (const m of p.members) this.presenceChanged(m);
        });
        return;
      }
    }
  }

  private leaveParty(c: Client): void {
    const p = c.party;
    if (!p) return;
    this.leaveQueue(c, `${c.name} left the party`);
    this.cancelPick(c, `${c.name} left the party`);
    p.members.splice(p.members.indexOf(c), 1);
    c.party = null;
    this.pushSocial(c);
    if (p.leader === c && p.members.length) p.leader = p.members[0] as Client;
    if (p.members.length <= 1 && !(p.members.length === 1 && p.invited.size)) {
      // Down to one: no party left.
      for (const m of p.members) {
        m.party = null;
        this.pushSocial(m);
      }
      for (const inv of p.invited) {
        inv.invites.delete(p.id);
        this.pushSocial(inv);
      }
      this.parties.delete(p.id);
      return;
    }
    for (const m of p.members) m.send({ t: 'notice', text: `${c.name} left the party` });
    this.pushParty(p);
  }

  private partyState(c: Client): PartyState | null {
    const p = c.party;
    if (!p) return null;
    const s = c.pick?.reason === 'party' ? c.pick : null;
    return { leader: p.leader.name, you: c.name, members: p.members.map((m) => ({ name: m.name, picked: s ? s.picks.has(m.key) : undefined })), invited: [...p.invited].map((m) => m.name) };
  }

  private pushParty(p: Party): void {
    for (const m of p.members) this.pushSocial(m);
  }

  /** A player's friends (with what each is up to), party, and party invites. */
  pushSocial(c: Client): void {
    const friends = c.accountId === null ? [] : this.o.accounts.friendList(c.accountId);
    const invites = [...c.invites].map((id) => this.parties.get(id)?.leader.name).filter((x): x is string => !!x);
    c.send({ t: 'social', friends, party: this.partyState(c), invites });
  }

  // ---------------------------------------------------------------- private lobbies

  private privateMsg(c: Client, msg: Extract<ClientMsg, { t: 'private' }>): void {
    const lobby = c.private;
    switch (msg.a) {
      case 'create': {
        if (c.room) return;
        if (lobby) this.leavePrivate(c);
        if (c.party) this.leaveParty(c);
        this.leaveQueue(c, `${c.name} left the queue`);
        const l = new PrivateLobby(newCode((x) => this.privates.has(x)), c.key, c);
        this.privates.set(l.code, l);
        c.private = l;
        l.broadcast();
        this.presenceChanged(c);
        return;
      }
      case 'join': {
        if (c.room) return;
        const code = String(msg.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const l = this.privates.get(code);
        if (!l) return c.send({ t: 'notice', text: `No lobby with the code ${code || '(none)'}` });
        if (l === lobby) return l.broadcast();
        const err = l.join(c);
        if (err) return c.send({ t: 'notice', text: err });
        if (lobby) this.leavePrivate(c);
        if (c.party) this.leaveParty(c);
        this.leaveQueue(c, `${c.name} left the queue`);
        c.private = l;
        l.broadcast();
        this.presenceChanged(c);
        return;
      }
      case 'leave':
        if (lobby) this.leavePrivate(c);
        return;
      case 'rules':
        if (lobby && msg.rules && typeof msg.rules === 'object') {
          lobby.setRules(c.key, msg.rules as Record<string, unknown>);
          for (const [k] of [...this.clients]) {
            const x = this.clients.get(k);
            if (x?.private === lobby && !lobby.members.has(k)) {
              x.private = null;
              this.presenceChanged(x);
            }
          }
          lobby.broadcast();
        }
        return;
      case 'team':
        if (lobby) {
          lobby.setTeam(c.key, msg.team);
          lobby.broadcast();
        }
        return;
      case 'kick': {
        if (!lobby || lobby.hostKey !== c.key || lobby.state !== 'open') return;
        const t = [...lobby.members.values()].find((m) => m.peer.name === msg.name);
        const tc = t ? this.clients.get(t.peer.key) : undefined;
        if (tc && tc !== c) {
          tc.send({ t: 'notice', text: 'The host removed you from the lobby' });
          this.leavePrivate(tc);
        }
        return;
      }
      case 'start': {
        if (!lobby || lobby.hostKey !== c.key || lobby.state !== 'open') return;
        if (this.draining) return c.send({ t: 'notice', text: DRAIN_TEXT });
        const members = [...lobby.members.keys()].map((k) => this.clients.get(k)).filter((x): x is Client => !!x);
        if (members.some((m) => m.room)) return c.send({ t: 'notice', text: 'Someone is still in a match' });
        if (!lobby.rules.bots && members.length < 2) return c.send({ t: 'notice', text: 'Two trainers at least, or turn computer trainers on' });
        const sides = new Set(lobby.lineup(new Map()).map((x, i) => (x.team === undefined ? `solo${i}` : `team${x.team}`)));
        if (sides.size < 2 && !(lobby.rules.bots && members.length < lobby.rules.size)) return c.send({ t: 'notice', text: 'Everyone is on one team: split up, or add computer trainers' });
        lobby.state = 'picking';
        for (const m of members) {
          m.watching?.unspectate(m.key);
          m.watching = null;
        }
        this.startPick('private', members, (picks) => {
          if (!this.privates.has(lobby.code)) return;
          lobby.state = 'open';
          const present = new Map([...picks].filter(([k]) => lobby.members.has(k) && this.clients.has(k)));
          if (!present.size) return lobby.broadcast();
          const lineup = lobby.lineup(present).filter((x) => present.has(x.peer.key));
          const r = lobby.rules;
          this.startRoom(lineup, 'private', { size: r.size, bots: r.bots, level: r.level, storm: r.storm, rareChest: r.rareChest });
        });
        lobby.broadcast();
        return;
      }
    }
  }

  private leavePrivate(c: Client): void {
    const l = c.private;
    if (!l) return;
    this.cancelPick(c, `${c.name} left`);
    c.private = null;
    c.send({ t: 'private', lobby: null });
    if (l.leave(c.key)) this.privates.delete(l.code);
    else l.broadcast();
    this.presenceChanged(c);
  }

  // ---------------------------------------------------------------- matches

  private startRoom(players: Lineup[], mode: RoomMode, rules: { size?: number; bots?: boolean; level?: number; storm?: number; rareChest?: boolean }): void {
    const live = players.filter((p) => this.clients.get(p.peer.key) === p.peer);
    if (!live.length) return;
    if (this.draining) {
      for (const p of live) p.peer.send({ t: 'unqueued', text: DRAIN_TEXT });
      return;
    }
    const seed = randomInt(1, 2 ** 31);
    const size = rules.size ?? this.o.size;
    // Events boost public matches; private ones keep their own rules.
    const ev = this.events;
    const boosts = mode !== 'private' && ev ? { shinyBoost: ev.boost('shiny'), storm: ev.storm() } : {};
    const make = this.o.makeRoom ?? localRoom(this.o.world);
    const spec: RoomSpec = {
      entries: live.map((q) => ({ name: q.peer.name, starter: q.starter, team: q.team, peer: q.peer })), size, seed,
      opts: { mode, id: `m${randomBytes(8).toString('hex')}`, bots: rules.bots, level: rules.level, storm: rules.storm, rareChest: rules.rareChest, ...boosts }, replayDir: this.o.replayDir,
    };
    const room = make(spec, this.o.hooks, (r, report) => this.endRoom(r, report));
    this.rooms.add(room);
    this.o.onMatchStart?.(room);
    for (const q of live) {
      const c = this.clients.get(q.peer.key);
      if (!c) continue;
      c.room = room;
      c.watching?.unspectate(c.key);
      c.watching = null;
      this.presenceChanged(c);
    }
    const bots = rules.bots === false ? 0 : Math.max(0, size - live.length);
    this.o.log(`Match ${room.id} (${mode}): ${live.length} player(s)${live.some((x) => x.team !== undefined) ? ' in squads' : ''}, ${bots} computer trainer(s)`);
  }

  private endRoom(room: RoomHandle, report: EndReport): void {
    const results = report.results;
    this.rooms.delete(room);
    for (const c of this.clients.values()) {
      if (c.room === room) c.room = null;
      if (c.watching === room) c.watching = null;
      if (c.private) c.private.broadcast();
      this.presenceChanged(c);
    }
    for (const f of report.flags) this.o.accounts.addFlags(f.key, f.name, room.id, new Map(f.flags));
    this.o.onMatchEnd?.(room, report);
    if (report.aborted) {
      // Called off (a shutdown): nothing is counted, for anyone.
      this.o.log(`Match ${room.id} called off: ${report.aborted}`);
      void this.saveReplay(room, report);
      return;
    }
    const progress = this.o.accounts.recordMatch(room.id, results, room.mode, new Map(), room.roster.length, room.mode === 'private' ? 1 : (this.events?.boost('xp') ?? 1));
    for (const [key, p] of progress) this.clients.get(key)?.send({ t: 'progress', ...p });
    this.o.log(`Match ${room.id} over: ${results.map((r) => `${r.name} #${r.place}`).join(', ')}`);
    void this.saveReplay(room, report);
  }

  private async saveReplay(room: RoomHandle, report: EndReport): Promise<void> {
    const dir = this.o.replayDir;
    try {
      const r = await report.replay;
      if (!r || !dir) return;
      const winner = r.players.filter((p) => p.place === 1).map((p) => p.name).join(' & ') || null;
      this.o.accounts.addReplay({ id: room.id, mode: room.mode, startedAt: room.startedAt, seconds: r.seconds, players: r.players, winner, bytes: r.bytes });
      for (const id of this.o.accounts.replaysOver(this.o.replayBytes)) {
        deleteReplay(dir, id);
        this.o.accounts.dropReplay(id);
      }
    } catch (e) {
      this.o.log(`Replay ${room.id} not saved:`, e);
    }
  }

  // ---------------------------------------------------------------- spectating

  /** The match most worth watching: the most players still in (and watched), never a private one. */
  featured(): RoomHandle | null {
    let best: RoomHandle | null = null;
    let score = -1;
    for (const r of this.rooms) {
      if (r.mode === 'private' || r.closed) continue;
      const s = r.humansIn * 10 + r.watcherCount;
      if (s > score) {
        score = s;
        best = r;
      }
    }
    return best;
  }

  private spectate(c: Client, msg: Extract<ClientMsg, { t: 'spectate' }>): void {
    if (c.room && c.room.playing(c.key)) return;
    let room: RoomHandle | null = null;
    let follow: number | { teamOf: string } | undefined;
    if (typeof msg.name === 'string') {
      const f = [...this.clients.values()].find((x) => x.name.toLowerCase() === String(msg.name).toLowerCase());
      if (!f?.room) return c.send({ t: 'notice', text: `${msg.name} is not in a match` });
      const friends = c.accountId !== null && f.accountId !== null && this.o.accounts.areFriends(c.accountId, f.accountId);
      const lobbyMates = !!c.private && c.private === f.private;
      if (!friends && !lobbyMates) return c.send({ t: 'notice', text: 'You can watch your friends' });
      room = f.room;
      follow = room.trainerIdOf(f.key);
    } else if (typeof msg.matchId === 'string') {
      room = [...this.rooms].find((r) => r.id === msg.matchId) ?? null;
      // A private match: only for the players who were in it (watching the rest after being knocked out).
      if (room && room.mode === 'private' && !room.has(c.key)) room = null;
      if (room?.has(c.key)) follow = { teamOf: c.key };
    } else if (msg.featured) room = this.featured();
    if (!room) return c.send({ t: 'spectateEnd', text: 'No match to watch right now' });
    c.watching?.unspectate(c.key);
    c.watching = room.spectate(c, follow) ? room : null;
    this.presenceChanged(c);
  }

  // ---------------------------------------------------------------- presence

  presence(userId: number): Presence {
    const c = this.clients.get(`u${userId}`);
    if (!c) return { online: false, status: 'offline' };
    if (c.room) return { online: true, status: 'match', matchId: c.room.mode === 'private' ? undefined : c.room.id };
    if (c.watching) return { online: true, status: 'watching', matchId: c.watching.mode === 'private' ? undefined : c.watching.id };
    if (c.pick || this.matchmaker.has(c.key)) return { online: true, status: 'queue' };
    if (c.private) return { online: true, status: 'private' };
    return { online: true, status: 'menu' };
  }

  /** Tells a player's online friends what they are doing now (if it changed). */
  private presenceChanged(c: Client, gone = false): void {
    if (c.accountId === null) return;
    const p = gone ? 'offline' : JSON.stringify(this.presence(c.accountId));
    if (p === c.shown) return;
    c.shown = p;
    for (const f of this.o.accounts.friends(c.accountId)) {
      if (f.status !== 'friend') continue;
      const fc = this.clients.get(`u${f.id}`);
      if (fc) this.pushSocial(fc);
    }
  }

  // ---------------------------------------------------------------- the clock

  tick(now: number): void {
    this.matchmaker.tick(now);
    for (const s of [...this.sessions]) {
      if (now < s.deadline) continue;
      // Time is up: anyone still choosing gets the first starter they were (or would be) offered.
      for (const m of s.members) {
        if (s.picks.has(m.key)) continue;
        const seed = m.rollSeed ?? randomInt(1, 2 ** 31);
        const pool = m.rollSeed !== null ? m.rollPool : m.accountId === null ? [] : unlockedFromPc(this.o.accounts.pcDexes(m.accountId));
        s.picks.set(m.key, starterChoices(seed, pool)[0] as string);
      }
      this.finishPick(s);
    }
    // Queue changes are pushed as they happen; this catches anything slower (once a second).
    if (now - this.lastPresence > 1000) {
      this.lastPresence = now;
      for (const c of this.clients.values()) this.presenceChanged(c);
    }
  }

  /** Numbers for /health and the status page. */
  stats(): { rooms: number; players: number; queued: Record<QueueMode, number>; privateLobbies: number; parties: number; watching: number; draining: boolean } {
    let watching = 0;
    for (const r of this.rooms) watching += r.watcherCount;
    return { rooms: this.rooms.size, players: this.clients.size, queued: this.matchmaker.waiting, privateLobbies: this.privates.size, parties: this.parties.size, watching, draining: this.draining };
  }
}

export type { ServerMsg };
