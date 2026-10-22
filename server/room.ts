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
import { Accounts } from './accounts';
import { runCommand } from './commands';
import { PlayerView } from './view';
import { createMatch, type Human, type World } from './world';

export const STEP = 1 / 60;
/** Simulation steps per view update (60 / 3 = 20 updates a second). */
const SEND_EVERY = 3;
const RECONNECT_SECONDS = 45;
/** Commands a player may send per second (beyond this they are dropped). */
const COMMAND_RATE = 30;

/** A connected player, as the room sees them. */
export interface Peer {
  key: string;
  name: string;
  look?: unknown;
  send(msg: ServerMsg): void;
}

interface Player {
  peer: Peer | null;
  seat: Seat;
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
  outcome: 'win' | 'loss';
  place: number;
  stats: { catches: number; knockouts: number; damage: number; timeSurvived: number };
  /** The player's Pokémon at the end (what an extraction can keep). */
  party: Array<ReturnType<typeof Accounts.pcFields>>;
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
  /** A Pokémon a player sent home mid-match with an Extraction Voucher. */
  extracted(key: string, mon: Mon, matchId: string): void;
}

export class Room {
  readonly id: string;
  readonly match: Match;
  private readonly ids = new IdTable();
  private readonly players = new Map<string, Player>();
  private steps = 0;
  private events: BattleEvent[] = [];
  private eliminatedOrder: string[] = [];
  closed = false;

  constructor(
    world: World,
    entries: Array<Human & { peer: Peer }>,
    size: number,
    readonly seed: number,
    private readonly hooks: RoomHooks,
    private readonly onEnd: (room: Room, results: RoomResult[]) => void,
  ) {
    this.id = `m${seed.toString(36)}`;
    this.match = createMatch(world, entries, size, seed);
    this.match.online = true;
    this.match.rareChest = hooks.rareChest;
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
      this.players.set(e.peer.key, { peer: e.peer, seat, view: new PlayerView(this.match, seat), enc, goneAt: null, commands: 0, ended: false });
    });
    const roster: RosterEntry[] = this.match.allTrainers.filter((t) => !t.visitor).map((t) => {
      const owner = [...this.players.values()].find((p) => p.seat.trainer === t);
      return { trainerId: t.id, name: t.name, human: t.isPlayer, look: owner?.peer?.look };
    });
    for (const p of this.players.values()) p.peer?.send({ t: 'start', matchId: this.id, seed, you: p.seat.trainer.id, roster });
  }

  private keyOf(t: Trainer): string | null {
    for (const [key, p] of this.players) if (p.seat.trainer === t) return key;
    return null;
  }

  has(key: string): boolean {
    return this.players.has(key);
  }

  /** A player came back (same account or guest key): they get their seat and a full view again. */
  rejoin(peer: Peer): void {
    const p = this.players.get(peer.key);
    if (!p) return;
    p.peer = peer;
    p.goneAt = null;
    p.enc = new SyncEncoder(this.ids, p.seat.trainer);
    const roster: RosterEntry[] = this.match.allTrainers.filter((t) => !t.visitor).map((t) => ({ trainerId: t.id, name: t.name, human: t.isPlayer }));
    peer.send({ t: 'start', matchId: this.id, seed: this.seed, you: p.seat.trainer.id, roster });
  }

  disconnect(key: string): void {
    const p = this.players.get(key);
    if (!p) return;
    p.peer = null;
    p.goneAt = this.match.time;
    p.seat.moveX = p.seat.moveY = 0;
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
        for (const fr of msg.f.slice(0, 12)) {
          if (!Array.isArray(fr) || typeof fr[0] !== 'number' || fr[0] <= last) continue;
          const [x, y] = unitAxis(fr[1], fr[2]);
          seat.inputs.push([fr[0], x, y]);
          last = fr[0];
        }
        // Far behind (a stall): catch up by dropping the oldest, the browser corrects itself.
        if (seat.inputs.length > 30) seat.inputs.splice(0, seat.inputs.length - 6);
      } else if (typeof msg.mx === 'number' && typeof msg.my === 'number') {
        [seat.moveX, seat.moveY] = unitAxis(msg.mx, msg.my);
      }
      if (typeof msg.ax === 'number' && typeof msg.ay === 'number' && Number.isFinite(msg.ax) && Number.isFinite(msg.ay)) p.seat.aim = { x: msg.ax, y: msg.ay };
      return;
    }
    if (msg.t === 'cmd') {
      if (++p.commands > COMMAND_RATE) return;
      if (!Array.isArray(msg.a) || msg.a.length > 4) return;
      const from = this.match.battle.events.length;
      const text = runCommand(this.match, p.seat, msg.c, msg.a);
      for (let i = from; i < this.match.battle.events.length; i++) {
        const ev = this.match.battle.events[i] as BattleEvent;
        if (ev.type === 'extracted' && ev.via === 'voucher') this.hooks.extracted(key, ev.mon, this.id);
      }
      if (text) p.peer?.send({ t: 'reply', n: msg.n, text, seconds: 1.8 });
      return;
    }
    if (msg.t === 'leave') {
      // Leaving mid-match: out for good.
      if (!p.seat.outcome && p.seat.trainer.alive) this.match.eliminate(p.seat.trainer);
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
    m.battle.events.length = 0;
    for (const p of this.players.values()) {
      if (p.seat.outcome && !p.ended) {
        p.ended = true;
        if (p.seat.outcome === 'loss') this.eliminatedOrder.push(p.peer?.key ?? '');
        p.peer?.send({ t: 'end', outcome: p.seat.outcome, place: this.placeOf(p) });
      }
    }
    if (++this.steps % SEND_EVERY === 0) {
      for (const p of this.players.values()) p.commands = Math.max(0, p.commands - COMMAND_RATE / 20);
      this.broadcast();
    }
    const anyone = [...this.players.values()].some((p) => p.peer && !p.ended);
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

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    const results: RoomResult[] = [];
    for (const [key, p] of this.players) {
      const t = p.seat.trainer;
      // Only the last trainer standing wins; leaving before the end is a loss.
      const outcome = p.seat.outcome ?? (this.match.over && t.alive ? 'win' : 'loss');
      if (!p.ended) p.peer?.send({ t: 'end', outcome, place: this.placeOf(p) });
      results.push({
        key, name: t.name, outcome, place: this.placeOf(p), stats: { ...t.stats },
        party: t.party.filter((x) => !x.captured).map((x) => Accounts.pcFields(x)),
        vouchers: t.items.reduce((n, e) => n + (e?.id === 'extraction-voucher' ? e.count : 0), 0),
      });
    }
    this.onEnd(this, results);
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

/** At most this many steps are walked on held keys while the browser's next ones are late (about 0.1 s). */
const MAX_AHEAD = 6;

/**
 * This step's keys for a seat: the next numbered frame. With none waiting (a late packet) the last
 * keys are held for up to MAX_AHEAD steps, and that many frames are skipped when they arrive, so the
 * trainer covers the same ground the browser walked it; past that it waits for the browser.
 */
function takeFrame(seat: Seat): void {
  while (seat.ahead > 0 && seat.inputs.length) {
    const f = seat.inputs.shift() as [number, number, number];
    seat.ack = f[0];
    seat.held = [f[1], f[2]];
    seat.ahead--;
  }
  const f = seat.inputs.shift();
  if (f) {
    seat.ack = f[0];
    seat.moveX = f[1];
    seat.moveY = f[2];
    seat.held = [f[1], f[2]];
    return;
  }
  const [hx, hy] = seat.held;
  if ((hx || hy) && seat.ahead < MAX_AHEAD) {
    seat.moveX = hx;
    seat.moveY = hy;
    seat.ahead++;
  } else {
    seat.moveX = 0;
    seat.moveY = 0;
  }
}
