/**
 * Timed events, set up by the moderators (/mod -> Events): for a while every public
 * match gets a boost, and everyone online is told when it starts and ends.
 *
 *   xp       XP from matches times `value` (Double XP: 2)
 *   shiny    shiny odds times `value` (Shiny Hour: 5)
 *   storm    the storm closes in `value` times as fast (Storm Rush: 1.5)
 *   message  an announcement in chat at the start time (the name is the message)
 *   wins     a contest: the trainers with the most public-match wins while it runs top a
 *            leaderboard of their own; when it ends the top places are sent prizes
 *            (CONTEST_PRIZE: 1st place's prize is shiny), claimed on the online menu
 *
 * Private matches keep their own rules.
 */
import type { DatabaseSync } from 'node:sqlite';

export type EventKind = 'xp' | 'shiny' | 'storm' | 'message' | 'wins';

export interface GameEvent {
  id: number;
  kind: EventKind;
  name: string;
  startsAt: number;
  endsAt: number;
  value: number;
  by: string;
}

const LIMITS: Record<EventKind, [number, number]> = { xp: [1.1, 5], shiny: [1.5, 20], storm: [0.5, 3], message: [0, 0], wins: [0, 0] };
/** A contest's prizes: the top `places` trainers each get `dex` at `level`; 1st place's is shiny. */
export const CONTEST_PRIZE = { dex: '0025-libre', name: 'Pikachu Libre', level: 25, places: 5 };
/** Kinds with no amount. */
const NO_VALUE = new Set<EventKind>(['message', 'wins']);

export interface ContestPlace {
  userId: number;
  name: string;
  wins: number;
}

export class Events {
  private shown = '';
  private announced = new Set<number>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly onChange: (active: GameEvent[]) => void,
    private readonly announce: (text: string) => void,
    /** A contest just ended: send the prizes (called once per contest; the places are final). */
    private readonly settle: (e: GameEvent, places: ContestPlace[]) => void = () => {},
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, value REAL NOT NULL, by_name TEXT NOT NULL
    )`);
    // Contests are settled once: prizes sent and the time noted.
    const cols = db.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'settled_at')) db.exec('ALTER TABLE events ADD COLUMN settled_at INTEGER');
    // Already running when the server starts: not announced again.
    for (const e of this.active()) this.announced.add(e.id);
    for (const e of this.list()) if (e.kind === 'message' && e.startsAt <= Date.now()) this.announced.add(e.id);
  }

  list(): GameEvent[] {
    const rows = this.db.prepare('SELECT * FROM events WHERE ends_at > ? OR (kind = ? AND starts_at > ?) ORDER BY starts_at').all(Date.now() - 86400_000, 'message', Date.now() - 86400_000) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ id: Number(r.id), kind: r.kind as EventKind, name: String(r.name), startsAt: Number(r.starts_at), endsAt: Number(r.ends_at), value: Number(r.value), by: String(r.by_name) }));
  }

  active(now = Date.now()): GameEvent[] {
    return this.list().filter((e) => e.kind !== 'message' && e.startsAt <= now && now < e.endsAt);
  }

  /** A new event (checked); returns why it can not be made, or null. */
  create(e: { kind: unknown; name: unknown; startsAt: unknown; hours: unknown; value: unknown }, by: string): string | null {
    const kind = String(e.kind) as EventKind;
    if (!(kind in LIMITS)) return 'Pick a kind of event';
    const name = String(e.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!name) return 'Give it a name';
    const startsAt = Number(e.startsAt) || Date.now();
    const hours = kind === 'message' ? 0 : Number(e.hours);
    if (kind !== 'message' && !(hours > 0 && hours <= 24 * 14)) return 'Between a few minutes and two weeks';
    const [lo, hi] = LIMITS[kind];
    const value = NO_VALUE.has(kind) ? 0 : Number(e.value);
    if (!NO_VALUE.has(kind) && !(value >= lo && value <= hi)) return `The amount must be between ${lo} and ${hi}`;
    this.db.prepare('INSERT INTO events (kind, name, starts_at, ends_at, value, by_name) VALUES (?, ?, ?, ?, ?, ?)').run(kind, name, startsAt, startsAt + hours * 3600_000, value, by);
    this.tick();
    return null;
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM events WHERE id = ?').run(id);
    this.tick();
  }

  /** The strongest boost of a kind running now (1: none). */
  boost(kind: 'xp' | 'shiny' | 'storm'): number {
    return Math.max(1, ...this.active().filter((e) => e.kind === kind).map((e) => e.value)) || 1;
  }

  /** Storm speed for a match (an event can also slow it, below 1). */
  storm(): number {
    const s = this.active().filter((e) => e.kind === 'storm');
    return s.length ? (s[s.length - 1] as GameEvent).value : 1;
  }

  /** The running contest, if any (the newest one when several overlap). */
  contest(now = Date.now()): GameEvent | null {
    const c = this.active(now).filter((e) => e.kind === 'wins');
    return c.length ? (c[c.length - 1] as GameEvent) : null;
  }
  /**
   * A contest's standings: public-match wins between its start and end, most first. Ties go to
   * fewer matches played, then to whoever reached their total first.
   */
  standings(e: GameEvent, limit = 10): ContestPlace[] {
    const rows = this.db.prepare(`
      SELECT p.user_id AS uid, u.username AS name,
        SUM(CASE WHEN p.outcome = 'win' THEN 1 ELSE 0 END) AS wins, COUNT(*) AS played,
        MAX(CASE WHEN p.outcome = 'win' THEN m.ended_at END) AS last_win
      FROM match_log_players p JOIN match_log m ON m.id = p.match_id JOIN users u ON u.id = p.user_id
      WHERE m.mode != 'private' AND m.aborted IS NULL AND m.ended_at >= ? AND m.ended_at < ? AND u.banned = 0
      GROUP BY p.user_id HAVING wins > 0
      ORDER BY wins DESC, played ASC, last_win ASC LIMIT ?`).all(e.startsAt, e.endsAt, limit) as Array<{ uid: number; name: string; wins: number }>;
    return rows.map((r) => ({ userId: Number(r.uid), name: String(r.name), wins: Number(r.wins) }));
  }
  /** Contests that have ended and not been settled yet: settle them (once each). */
  private settleEnded(now: number): void {
    const rows = this.db.prepare("SELECT id FROM events WHERE kind = 'wins' AND ends_at <= ? AND settled_at IS NULL").all(now) as Array<{ id: number }>;
    for (const { id } of rows) {
      const e = this.list().find((x) => x.id === Number(id));
      // Mark first, so a failure while sending can never send the prizes twice.
      const took = this.db.prepare('UPDATE events SET settled_at = ? WHERE id = ? AND settled_at IS NULL').run(now, id);
      if (!e || Number(took.changes) !== 1) continue;
      try {
        this.settle(e, this.standings(e));
      } catch (err) {
        console.error('contest settle failed', id, err);
      }
    }
  }
  /** Starts and ends are announced; the browsers hear when the list changes. Call every few seconds. */
  tick(now = Date.now()): void {
    this.settleEnded(now);
    for (const e of this.list()) {
      if (e.startsAt > now || this.announced.has(e.id)) continue;
      this.announced.add(e.id);
      if (e.kind === 'message') this.announce(e.name);
      else if (now < e.endsAt) this.announce(`${e.name} has started! It runs until ${new Date(e.endsAt).toUTCString().slice(0, 22)} UTC`);
    }
    const active = this.active(now);
    const sig = active.map((e) => e.id).join(',');
    if (sig !== this.shown) {
      const before = new Set(this.shown.split(',').filter(Boolean).map(Number));
      for (const id of before) if (!active.some((e) => e.id === id)) this.announce('An event just ended. Thanks for playing!');
      this.shown = sig;
      this.onChange(active);
    }
  }
}
