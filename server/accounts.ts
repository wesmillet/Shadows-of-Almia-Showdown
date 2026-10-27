/**
 * Accounts, profiles and saves, in one SQLite file (DATA_DIR/almia.db).
 *
 * Sign-in: a username and password (stored only as a salted scrypt hash), or Google (OpenID
 * Connect with PKCE; only Google's account id and first name are kept, never an email). A signed
 * in browser holds a random session token in an HttpOnly cookie; the database keeps only its
 * SHA-256, so a leaked database can not be used to sign in.
 *
 * Saves are written here and only here: the PC box (Pokémon extracted from matches), the storage
 * chest, the trainer look and the stats. Browsers read them through /api and change them only by
 * playing (the match decides) or through the few profile actions below, each checked.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { InventorySlot, Mon } from '../src/sim/entities';
import { ITEMS } from '../src/sim/items';
import { cleanName, isClean } from './moderation';
import { pcFields } from './pcFields';
import { DEFAULT_RATING, decay, PLACEMENT_GAMES, seasonAt, seasonReset, tierOf, type Rating } from './rating';
import { ACHIEVEMENTS, canWear, isFreeLook, levelOf, matchXp, titlesFor, type Achievement, type MatchFacts } from '../src/net/progression';
import type { RoomResult } from './room';

const COOKIE = 'almia_session';
const SESSION_DAYS = 30;
const USERNAME = /^[A-Za-z0-9_]{3,16}$/;
const RESERVED = new Set(['admin', 'administrator', 'moderator', 'mod', 'system', 'server', 'celeste', 'hoopa', 'darkrai', 'support', 'staff', 'guest']);

export interface Identity {
  key: string;
  name: string;
  accountId: number | null;
  look?: unknown;
  title?: string;
  /** This device or address is banned (the connection is refused, with this reason). */
  banned?: string;
}

/** What a finished match did for a player's progress (sent to them for the end screen). */
export interface Progress {
  xp: Array<{ what: string; xp: number }>;
  before: { level: number; into: number; next: number };
  after: { level: number; into: number; next: number };
  achievements: Array<Pick<Achievement, 'id' | 'name' | 'desc' | 'title' | 'look'>>;
}

export interface UserRow {
  id: number;
  username: string;
  pass_hash: string | null;
  google_sub: string | null;
  created_at: number;
  banned: number;
  muted_until: number;
  role: string;
}

interface RatingRow {
  user_id: number;
  season: number;
  rating: number;
  rd: number;
  vol: number;
  games: number;
  wins: number;
  peak: number;
  last_at: number;
}

const MAX_FRIENDS = 200;
const RECOVERY_CODES = 8;
/** Recovery codes are typed by hand: case, spaces and dashes do not matter. */
const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface PublicProfile {
  name: string;
  joined: number;
  look: unknown;
  stats: Stats;
  recent: Array<{ match: string; place: number; outcome: string; mode: string; at: number; ratingDelta: number | null; xp: number | null; replay: boolean }>;
  pc: number;
  ranked: ReturnType<Accounts['rankedCard']>;
  online: boolean;
  progress: { xp: number; level: number; into: number; next: number };
  title: string | null;
  achievements: Array<{ id: string; at: number }>;
}

export interface FriendEntry {
  name: string;
  relation: 'friend' | 'incoming' | 'outgoing';
  online: boolean;
  activity: Presence['status'];
  matchId?: string;
}

export interface Presence {
  online: boolean;
  status: 'offline' | 'menu' | 'queue' | 'match' | 'watching' | 'private';
  matchId?: string;
}

interface Stats {
  matches: number;
  wins: number;
  catches: number;
  knockouts: number;
  eliminations: number;
  damage: number;
  bestPlace: number | null;
}

const EMPTY_STATS: Stats = { matches: 0, wins: 0, catches: 0, knockouts: 0, eliminations: 0, damage: 0, bestPlace: null };

export class Accounts {
  readonly db: DatabaseSync;
  /** Failed sign-ins per IP and per username: [count, window start]. */
  private failures = new Map<string, [number, number]>();
  private readonly google: { id: string; secret: string } | null;
  private readonly publicUrl: string | null;
  /** Who is online and doing what (main.ts fills this in), for the friends list. */
  presence: (userId: number) => Presence = () => ({ online: false, status: 'offline' });
  /** An API request failed (main.ts records it with the other errors). */
  onError: (e: unknown, context: Record<string, unknown>) => void = () => {};
  /** Friends lists changed for these players (main.ts pushes the new lists to them). */
  onFriendsChanged: (userIds: number[]) => void = () => {};

  constructor(dataDir: string, private readonly kind: 'live' | 'demo' | 'dev') {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'almia.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, pass_hash TEXT, google_sub TEXT UNIQUE,
        created_at INTEGER NOT NULL, banned INTEGER NOT NULL DEFAULT 0, muted_until INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT 'player'
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        look TEXT, chest TEXT NOT NULL DEFAULT '[]', stats TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS pc (
        id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        entry TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS pc_user ON pc(user_id);
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY, from_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        to_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        give_pc INTEGER NOT NULL, want_pc INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, closed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS trades_to ON trades(to_user, status);
      CREATE INDEX IF NOT EXISTS trades_from ON trades(from_user, status);
      CREATE TABLE IF NOT EXISTS wonder (
        id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pc_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'waiting', got_pc INTEGER, partner TEXT,
        seen INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, closed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS wonder_wait ON wonder(status, created_at);
      CREATE INDEX IF NOT EXISTS wonder_user ON wonder(user_id, status);
      CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, ended_at INTEGER NOT NULL, summary TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS match_players (
        match_id TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, place INTEGER NOT NULL,
        outcome TEXT NOT NULL, stats TEXT NOT NULL, party TEXT NOT NULL, picks_left INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (match_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ratings (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, season INTEGER NOT NULL,
        rating REAL NOT NULL, rd REAL NOT NULL, vol REAL NOT NULL, games INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
        peak REAL NOT NULL, last_at INTEGER NOT NULL, PRIMARY KEY (user_id, season)
      );
      CREATE INDEX IF NOT EXISTS ratings_board ON ratings(season, rating DESC);
      CREATE TABLE IF NOT EXISTS friends (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, friend_id)
      );
      CREATE INDEX IF NOT EXISTS friends_of ON friends(friend_id);
      CREATE TABLE IF NOT EXISTS replays (
        id TEXT PRIMARY KEY, mode TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL, seconds REAL NOT NULL,
        players TEXT NOT NULL, winner TEXT, bytes INTEGER NOT NULL, humans INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS replay_players (replay_id TEXT NOT NULL REFERENCES replays(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, PRIMARY KEY (replay_id, user_id));
      CREATE INDEX IF NOT EXISTS replay_players_user ON replay_players(user_id);
      CREATE TABLE IF NOT EXISTS achievements (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, id)
      );
      CREATE TABLE IF NOT EXISTS recovery (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, code_hash TEXT NOT NULL, used_at INTEGER, PRIMARY KEY (user_id, code_hash)
      );
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT NOT NULL, user_id INTEGER NOT NULL DEFAULT 0, ip TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
        PRIMARY KEY (device_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS devices_user ON devices(user_id);
      CREATE TABLE IF NOT EXISTS bans (kind TEXT NOT NULL, value TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL, until INTEGER, by_user INTEGER, PRIMARY KEY (kind, value));
      CREATE TABLE IF NOT EXISTS flags (
        id INTEGER PRIMARY KEY, user_id INTEGER, player_key TEXT NOT NULL, name TEXT NOT NULL, match_id TEXT NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL, detail TEXT, at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS flags_at ON flags(at);
      CREATE TABLE IF NOT EXISTS mod_actions (id INTEGER PRIMARY KEY, by_user INTEGER, by_name TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY, reporter_id INTEGER, reporter_key TEXT NOT NULL, target TEXT NOT NULL, reason TEXT NOT NULL,
        chat_id INTEGER, at INTEGER NOT NULL, resolved INTEGER NOT NULL DEFAULT 0
      );
    `);
    // Columns added after the first release (older databases get them here).
    for (const [table, col, def] of [['match_players', 'rating_delta', 'REAL'], ['match_players', 'team_place', 'INTEGER'], ['matches', 'mode', "TEXT NOT NULL DEFAULT 'casual'"], ['profiles', 'xp', 'INTEGER NOT NULL DEFAULT 0'], ['profiles', 'title', 'TEXT'], ['match_players', 'xp', 'INTEGER']] as const) {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === col)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
    const gid = process.env.GOOGLE_CLIENT_ID;
    const gsecret = process.env.GOOGLE_CLIENT_SECRET;
    this.google = gid && gsecret ? { id: gid, secret: gsecret } : null;
    this.publicUrl = process.env.PUBLIC_URL?.replace(/\/$/, '') ?? null;
    // Expired sessions go once an hour.
    setInterval(() => this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600_000).unref();
  }

  // ---------------------------------------------------------------- trading

  /**
   * Trading between accounts (guests can not trade): an offer is "my Pokémon for yours", picked
   * from both PCs. The other player accepts or declines whenever they next look; accepting swaps
   * the two PC rows in one transaction, after checking both trainers still own them. Offers that
   * involved either Pokémon are closed when it changes hands.
   */
  private async tradeApi(req: IncomingMessage, path: string, me: UserRow, send: (status: number, body: unknown) => void): Promise<void> {
    const card = (id: number): Record<string, unknown> | null => {
      const r = this.db.prepare('SELECT id, user_id, entry FROM pc WHERE id = ?').get(id) as { id: number; user_id: number; entry: string } | undefined;
      if (!r) return null;
      const e = JSON.parse(r.entry) as Record<string, unknown>;
      return { pcId: r.id, owner: r.user_id, dex: e.dex, name: e.name, level: e.level, shiny: !!e.shiny, alpha: !!e.alpha, shadow: !!e.shadow };
    };
    const nameOf = (id: number): string => (this.db.prepare('SELECT username FROM users WHERE id = ?').get(id) as { username: string } | undefined)?.username ?? '?';
    if (req.method === 'GET' && path.startsWith('/api/trade/pc/')) {
      // Someone's PC, to pick what to ask them for.
      const name = decodeURIComponent(path.slice('/api/trade/pc/'.length));
      const u = this.db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(name) as UserRow | undefined;
      if (!u || u.banned) return send(404, { error: 'No player with that name' });
      if (u.id === me.id) return send(400, { error: "That's you!" });
      const pooled = this.pooledIds(u.id);
      const rows = (this.db.prepare('SELECT id FROM pc WHERE user_id = ? ORDER BY id').all(u.id) as Array<{ id: number }>).filter((r) => !pooled.has(r.id));
      return send(200, { name: u.username, pc: rows.map((r) => card(r.id)) });
    }
    if (req.method === 'GET' && path === '/api/trades') {
      const rows = this.db.prepare("SELECT * FROM trades WHERE status = 'open' AND (from_user = ? OR to_user = ?) ORDER BY id DESC").all(me.id, me.id) as Array<{ id: number; from_user: number; to_user: number; give_pc: number; want_pc: number; created_at: number }>;
      const offers = rows.map((t) => ({ id: t.id, from: nameOf(t.from_user), to: nameOf(t.to_user), incoming: t.to_user === me.id, give: card(t.give_pc), want: card(t.want_pc), at: t.created_at }));
      const waiting = this.db.prepare("SELECT pc_id FROM wonder WHERE user_id = ? AND status = 'waiting'").get(me.id) as { pc_id: number } | undefined;
      const news = (this.db.prepare("SELECT id, got_pc, partner, pc_id FROM wonder WHERE user_id = ? AND status = 'done' AND seen = 0 ORDER BY id").all(me.id) as Array<{ id: number; got_pc: number; partner: string; pc_id: number }>)
        .map((w) => ({ id: w.id, got: card(w.got_pc), gave: card(w.pc_id), partner: w.partner }));
      return send(200, { offers, wonder: { waiting: waiting ? card(waiting.pc_id) : null, news } });
    }
    if (req.method === 'POST' && path === '/api/wonder') return this.wonderSend(req, me, send, card, nameOf);
    if (req.method === 'POST' && path === '/api/wonder/cancel') {
      const r = this.db.prepare("UPDATE wonder SET status = 'cancelled', closed_at = ? WHERE user_id = ? AND status = 'waiting'").run(Date.now(), me.id);
      return send(200, r.changes ? { ok: true, text: 'Taken back. It is in your PC as before' } : { error: 'Nothing is out on Wonder Trade' });
    }
    if (req.method === 'POST' && path === '/api/wonder/seen') {
      this.db.prepare("UPDATE wonder SET seen = 1 WHERE user_id = ? AND status = 'done'").run(me.id);
      return send(200, { ok: true });
    }
    if (req.method !== 'POST') return send(404, { error: 'Not found' });
    const b = await readJson(req);
    if (path === '/api/trades/offer') {
      if (this.limited(`trade:${me.id}`, 20, 3600_000)) return send(429, { error: 'Too many trade offers. Try again later' });
      const give = card(Number(b.give));
      const want = card(Number(b.want));
      if (!give || give.owner !== me.id) return send(400, { error: 'Pick one of your own Pokémon to give' });
      if (!want || want.owner === me.id) return send(400, { error: "Pick one of the other trainer's Pokémon" });
      if (this.isPooled(give.pcId as number) || this.isPooled(want.pcId as number)) return send(400, { error: 'That Pokémon is out on Wonder Trade' });
      const other = want.owner as number;
      const target = this.db.prepare('SELECT banned FROM users WHERE id = ?').get(other) as { banned: number } | undefined;
      if (!target || target.banned) return send(400, { error: 'That trainer can not trade' });
      const open = (this.db.prepare("SELECT COUNT(*) AS n FROM trades WHERE from_user = ? AND status = 'open'").get(me.id) as { n: number }).n;
      if (open >= 10) return send(400, { error: 'You have 10 offers waiting already. Cancel one first' });
      const dup = this.db.prepare("SELECT id FROM trades WHERE status = 'open' AND from_user = ? AND give_pc = ? AND want_pc = ?").get(me.id, give.pcId as number, want.pcId as number);
      if (dup) return send(400, { error: 'You already offered that trade' });
      this.fail(`trade:${me.id}`);
      this.db.prepare('INSERT INTO trades (from_user, to_user, give_pc, want_pc, created_at) VALUES (?, ?, ?, ?, ?)').run(me.id, other, give.pcId as number, want.pcId as number, Date.now());
      this.onTradesChanged([other]);
      return send(200, { ok: true, text: `Offer sent to ${nameOf(other)}: your ${give.name} for their ${want.name}` });
    }
    const t = this.db.prepare("SELECT * FROM trades WHERE id = ? AND status = 'open'").get(Number(b.id)) as { id: number; from_user: number; to_user: number; give_pc: number; want_pc: number } | undefined;
    if (!t) return send(400, { error: 'That offer is gone' });
    if (path === '/api/trades/cancel') {
      if (t.from_user !== me.id) return send(403, { error: 'Not your offer' });
      this.db.prepare("UPDATE trades SET status = 'cancelled', closed_at = ? WHERE id = ?").run(Date.now(), t.id);
      this.onTradesChanged([t.to_user]);
      return send(200, { ok: true });
    }
    if (path === '/api/trades/respond') {
      if (t.to_user !== me.id) return send(403, { error: 'Not your offer' });
      if (!b.accept) {
        this.db.prepare("UPDATE trades SET status = 'declined', closed_at = ? WHERE id = ?").run(Date.now(), t.id);
        this.onTradesChanged([t.from_user]);
        return send(200, { ok: true, text: 'Declined' });
      }
      // The swap: both Pokémon must still be where the offer found them.
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const g = this.db.prepare('SELECT user_id, entry FROM pc WHERE id = ?').get(t.give_pc) as { user_id: number; entry: string } | undefined;
        const w = this.db.prepare('SELECT user_id, entry FROM pc WHERE id = ?').get(t.want_pc) as { user_id: number; entry: string } | undefined;
        if (!g || !w || g.user_id !== t.from_user || w.user_id !== t.to_user || this.isPooled(t.give_pc) || this.isPooled(t.want_pc)) {
          this.db.prepare("UPDATE trades SET status = 'cancelled', closed_at = ? WHERE id = ?").run(Date.now(), t.id);
          this.db.exec('COMMIT');
          return send(400, { error: 'One of those Pokémon is not there any more, so the offer was closed' });
        }
        const stamp = (entry: string, from: number): string => JSON.stringify({ ...JSON.parse(entry), tradedFrom: nameOf(from), tradedAt: new Date().toISOString() });
        this.db.prepare('UPDATE pc SET user_id = ?, entry = ? WHERE id = ?').run(t.to_user, stamp(g.entry, t.from_user), t.give_pc);
        this.db.prepare('UPDATE pc SET user_id = ?, entry = ? WHERE id = ?').run(t.from_user, stamp(w.entry, t.to_user), t.want_pc);
        this.db.prepare("UPDATE trades SET status = 'done', closed_at = ? WHERE id = ?").run(Date.now(), t.id);
        // Any other open offer that involved either Pokémon is now stale.
        this.db.prepare("UPDATE trades SET status = 'cancelled', closed_at = ? WHERE status = 'open' AND (give_pc IN (?, ?) OR want_pc IN (?, ?))").run(Date.now(), t.give_pc, t.want_pc, t.give_pc, t.want_pc);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
      this.onTradesChanged([t.from_user, t.to_user]);
      const gName = (JSON.parse((this.db.prepare('SELECT entry FROM pc WHERE id = ?').get(t.give_pc) as { entry: string }).entry) as { name: string }).name;
      return send(200, { ok: true, text: `Trade complete! ${gName} is in your PC` });
    }
    return send(404, { error: 'Not found' });
  }

  private pooledIds(userId: number): Set<number> {
    return new Set((this.db.prepare("SELECT pc_id FROM wonder WHERE user_id = ? AND status = 'waiting'").all(userId) as Array<{ pc_id: number }>).map((r) => r.pc_id));
  }

  private isPooled(pcId: number): boolean {
    return !!this.db.prepare("SELECT 1 FROM wonder WHERE pc_id = ? AND status = 'waiting'").get(pcId);
  }

  /**
   * Wonder Trade: send one Pokémon off without choosing who gets it. If another trainer has one
   * waiting, the two swap at once (oldest waiting first); otherwise it waits (still in your PC,
   * marked, and you can take it back) until the next trainer sends one. One out at a time each.
   */
  private async wonderSend(
    req: IncomingMessage,
    me: UserRow,
    send: (status: number, body: unknown) => void,
    card: (id: number) => Record<string, unknown> | null,
    nameOf: (id: number) => string,
  ): Promise<void> {
    const b = await readJson(req);
    if (this.limited(`wonder:${me.id}`, 30, 3600_000)) return send(429, { error: 'Too many Wonder Trades. Try again later' });
    const give = card(Number(b.give));
    if (!give || give.owner !== me.id) return send(400, { error: 'Pick one of your own Pokémon' });
    if (this.db.prepare("SELECT 1 FROM wonder WHERE user_id = ? AND status = 'waiting'").get(me.id)) return send(400, { error: 'You already have one out on Wonder Trade' });
    this.fail(`wonder:${me.id}`);
    const now = Date.now();
    let partnerId = 0;
    let got: Record<string, unknown> | null = null;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const waiting = this.db.prepare("SELECT w.id, w.user_id, w.pc_id FROM wonder w JOIN pc p ON p.id = w.pc_id AND p.user_id = w.user_id JOIN users u ON u.id = w.user_id WHERE w.status = 'waiting' AND w.user_id != ? AND u.banned = 0 ORDER BY w.created_at LIMIT 1").get(me.id) as { id: number; user_id: number; pc_id: number } | undefined;
      if (!waiting) {
        this.db.prepare('INSERT INTO wonder (user_id, pc_id, created_at) VALUES (?, ?, ?)').run(me.id, give.pcId as number, now);
      } else {
        partnerId = waiting.user_id;
        const stamp = (id: number, from: number): string => {
          const e = (this.db.prepare('SELECT entry FROM pc WHERE id = ?').get(id) as { entry: string }).entry;
          return JSON.stringify({ ...JSON.parse(e), tradedFrom: nameOf(from), tradedAt: new Date().toISOString(), wonderTrade: true });
        };
        const mine = give.pcId as number;
        const theirs = waiting.pc_id;
        const a = stamp(mine, me.id);
        const c = stamp(theirs, partnerId);
        this.db.prepare('UPDATE pc SET user_id = ?, entry = ? WHERE id = ?').run(partnerId, a, mine);
        this.db.prepare('UPDATE pc SET user_id = ?, entry = ? WHERE id = ?').run(me.id, c, theirs);
        this.db.prepare("UPDATE wonder SET status = 'done', got_pc = ?, partner = ?, closed_at = ? WHERE id = ?").run(mine, me.username, now, waiting.id);
        this.db.prepare("INSERT INTO wonder (user_id, pc_id, status, got_pc, partner, seen, created_at, closed_at) VALUES (?, ?, 'done', ?, ?, 1, ?, ?)").run(me.id, mine, theirs, nameOf(partnerId), now, now);
        this.db.prepare("UPDATE trades SET status = 'cancelled', closed_at = ? WHERE status = 'open' AND (give_pc IN (?, ?) OR want_pc IN (?, ?))").run(now, mine, theirs, mine, theirs);
        got = card(theirs);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    if (!got) return send(200, { ok: true, waiting: true, text: `${give.name} is out on Wonder Trade. It swaps with the next trainer who sends one` });
    this.onTradesChanged([partnerId]);
    return send(200, { ok: true, got, partner: nameOf(partnerId), text: `Wonder Trade! ${nameOf(partnerId)} sent you ${got.name}` });
  }

  /** Set by main.ts: tell these accounts (when online) their trade offers changed. */
  onTradesChanged: (userIds: number[]) => void = () => {};

  // ---------------------------------------------------------------- identity

  /** Who a connecting browser is: their account from the session cookie, else a guest (by the key the browser keeps). */
  async identify(req: IncomingMessage): Promise<Identity> {
    const url0 = new URL(req.url ?? '/', 'http://x');
    const device = cleanDevice(url0.searchParams.get('device'));
    const ip = clientIp(req);
    const ban = this.banFor(device, ip);
    const user = this.userFromRequest(req);
    if (user) this.seeDevice(device, user.id, ip);
    else if (device) this.seeDevice(device, 0, ip);
    if (ban) return { key: `x${randomBytes(6).toString('base64url')}`, name: 'Banned', accountId: null, banned: ban };
    if (user && !user.banned) {
      const prof = this.profile(user.id);
      const look = typeof prof.look === 'string' && this.canWear(user.id, prof.look) ? prof.look : undefined;
      return { key: `u${user.id}`, name: user.username, accountId: user.id, look, title: this.title(user.id) ?? undefined };
    }
    const url = new URL(req.url ?? '/', 'http://x');
    const g = url.searchParams.get('guest') ?? '';
    const key = /^[A-Za-z0-9_-]{16,64}$/.test(g) ? g : randomBytes(12).toString('base64url');
    const n = parseInt(createHash('sha256').update(key).digest('hex').slice(0, 6), 16) % 10000;
    const look = url.searchParams.get('look');
    // Guests wear the free looks only (the rest are unlocked by playing signed in).
    return { key: `g${key}`, name: `Guest${String(n).padStart(4, '0')}`, accountId: null, look: look && /^[A-Za-z0-9_-]{1,48}$/.test(look) && isFreeLook(look) ? look : undefined };
  }

  userFromRequest(req: IncomingMessage): UserRow | null {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const row = this.db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').get(sha256(token), Date.now()) as UserRow | undefined;
    return row ?? null;
  }

  user(id: number): UserRow | null {
    return (this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined) ?? null;
  }

  // ---------------------------------------------------------------- saves

  profile(userId: number): { look: unknown; chest: InventorySlot[]; stats: Stats } {
    const row = this.db.prepare('SELECT look, chest, stats FROM profiles WHERE user_id = ?').get(userId) as { look: string | null; chest: string; stats: string } | undefined;
    return {
      look: row?.look ? JSON.parse(row.look) : null,
      chest: row ? (JSON.parse(row.chest) as InventorySlot[]) : [],
      stats: { ...EMPTY_STATS, ...(row ? (JSON.parse(row.stats) as Partial<Stats>) : {}) },
    };
  }

  /** The chest a player's account keeps between matches (only real items, sensible counts). */
  loadChest(userId: number): InventorySlot[] {
    return this.profile(userId).chest.filter((e) => e && ITEMS[e.id] && Number.isInteger(e.count) && e.count > 0 && e.count < 10000);
  }

  saveChest(userId: number, box: Array<InventorySlot | null>): void {
    const list = box.filter((e): e is InventorySlot => !!e).map((e) => ({ id: e.id, count: e.count }));
    this.db.prepare('UPDATE profiles SET chest = ? WHERE user_id = ?').run(JSON.stringify(list), userId);
  }

  /** The species in a player's PC (for their starter pool). */
  pcDexes(userId: number): string[] {
    const rows = this.db.prepare("SELECT json_extract(entry, '$.dex') AS dex FROM pc WHERE user_id = ?").all(userId) as Array<{ dex: string }>;
    return rows.map((r) => r.dex).filter((d) => typeof d === 'string');
  }

  /** A Pokémon into the player's PC (an extraction: a win's pick, or an Extraction Voucher). */
  addToPc(userId: number, m: { dex: string; name: string; level: number; shiny?: boolean; alpha?: boolean; legend?: boolean; shadow?: boolean; moves: string[]; heldItem?: string | null }, via: 'win' | 'voucher', matchId: string): void {
    const entry = {
      uid: randomBytes(6).toString('base64url'), dex: m.dex, name: m.name, level: m.level, shiny: m.shiny || undefined, alpha: m.alpha || undefined,
      legend: m.legend || undefined, shadow: m.shadow || undefined, moves: m.moves, heldItem: m.heldItem ?? null, via, at: new Date().toISOString(), match: matchId,
    };
    this.db.prepare('INSERT INTO pc (user_id, entry, created_at) VALUES (?, ?, ?)').run(userId, JSON.stringify(entry), Date.now());
  }

  /** What a Pokémon in a match goes home as (server/pcFields.ts). */
  static pcFields = pcFields;

  /**
   * A finished match: stats for every signed-in player, and extraction picks for winners (and
   * vouchers). Private matches (custom rules, friends only) keep nothing: they would be too easy to
   * farm. `ratingDeltas` is filled in for ranked matches.
   */
  recordMatch(matchId: string, results: RoomResult[], mode: 'casual' | 'ranked' | 'private' = 'casual', ratingDeltas: Map<string, number> = new Map(), field = 8, xpBoost = 1): Map<string, Progress> {
    const progress = new Map<string, Progress>();
    this.db.prepare('INSERT OR IGNORE INTO matches (id, ended_at, summary, mode) VALUES (?, ?, ?, ?)').run(matchId, Date.now(), JSON.stringify(results.map((r) => ({ name: r.name, place: r.place, outcome: r.outcome, team: r.team }))), mode);
    if (mode === 'private') return progress;
    for (const r of results) {
      if (!r.key.startsWith('u')) continue;
      const userId = Number(r.key.slice(1));
      const picks = (r.outcome === 'win' ? 1 : 0) + r.vouchers;
      this.db.prepare('INSERT OR REPLACE INTO match_players (match_id, user_id, place, outcome, stats, party, picks_left, rating_delta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(matchId, userId, r.place, r.outcome, JSON.stringify(r.stats), JSON.stringify(r.party), picks, ratingDeltas.get(r.key) ?? null);
      const p = this.profile(userId);
      const s = p.stats;
      s.matches++;
      if (r.outcome === 'win') s.wins++;
      s.catches += r.stats.catches;
      s.knockouts += r.stats.knockouts;
      s.eliminations += r.stats.eliminations ?? 0;
      s.damage += Math.round(r.stats.damage);
      s.bestPlace = s.bestPlace === null ? r.place : Math.min(s.bestPlace, r.place);
      this.db.prepare('UPDATE profiles SET stats = ? WHERE user_id = ?').run(JSON.stringify(s), userId);
      // XP, levels and achievements.
      const facts: MatchFacts = {
        mode, place: r.place, field, outcome: r.outcome, squad: r.team !== undefined && r.outcome === 'win', stats: r.stats,
        party: r.party.map((m) => ({ dex: m.dex, level: m.level, shiny: m.shiny, alpha: m.alpha, legend: m.legend, shadow: m.shadow })),
      };
      const lines = matchXp(facts);
      // An XP event (server/events.ts): the bonus on its own line.
      if (xpBoost > 1 && lines.length) lines.push({ what: `${xpBoost}x XP event`, xp: Math.round(lines.reduce((n, x) => n + x.xp, 0) * (xpBoost - 1)) });
      const gained = lines.reduce((n, x) => n + x.xp, 0);
      const xpBefore = this.xp(userId);
      this.db.prepare('UPDATE profiles SET xp = xp + ? WHERE user_id = ?').run(gained, userId);
      this.db.prepare('UPDATE match_players SET xp = ? WHERE match_id = ? AND user_id = ?').run(gained, matchId, userId);
      progress.set(r.key, { xp: lines, before: levelOf(xpBefore), after: levelOf(xpBefore + gained), achievements: this.checkAchievements(userId, facts) });
    }
    return progress;
  }

  xp(userId: number): number {
    return (this.db.prepare('SELECT xp FROM profiles WHERE user_id = ?').get(userId) as { xp: number } | undefined)?.xp ?? 0;
  }

  earned(userId: number): string[] {
    return (this.db.prepare('SELECT id FROM achievements WHERE user_id = ?').all(userId) as Array<{ id: string }>).map((r) => r.id);
  }

  title(userId: number): string | null {
    const t = (this.db.prepare('SELECT title FROM profiles WHERE user_id = ?').get(userId) as { title: string | null } | undefined)?.title ?? null;
    return t && titlesFor(this.earned(userId)).includes(t) ? t : null;
  }

  canWear(userId: number, look: string): boolean {
    return canWear(look, levelOf(this.xp(userId)).level, this.earned(userId));
  }

  /** Awards any achievements newly earned (after a match, or `match` null after an extraction). */
  checkAchievements(userId: number, match: MatchFacts | null): Progress['achievements'] {
    const have = new Set(this.earned(userId));
    const st = this.profile(userId).stats;
    const card = this.rankedCard(userId);
    const ctx = {
      match, life: { matches: st.matches, wins: st.wins, catches: st.catches, knockouts: st.knockouts, eliminations: st.eliminations, damage: st.damage },
      level: levelOf(this.xp(userId)).level, tier: card.tier?.id ?? null, rankedWins: card.wins,
      pc: (this.db.prepare('SELECT COUNT(*) AS n FROM pc WHERE user_id = ?').get(userId) as { n: number }).n,
    };
    const out: Progress['achievements'] = [];
    for (const a of ACHIEVEMENTS) {
      if (have.has(a.id) || !a.check(ctx)) continue;
      this.db.prepare('INSERT OR IGNORE INTO achievements (user_id, id, at) VALUES (?, ?, ?)').run(userId, a.id, Date.now());
      out.push({ id: a.id, name: a.name, desc: a.desc, title: a.title, look: a.look });
    }
    return out;
  }

  /** Everything a trainer's profile shows anyone (in the game and at /u/<name>). */
  publicProfile(u: UserRow, prof = this.profile(u.id)): PublicProfile {
    const recent = (this.db.prepare(`SELECT m.match_id, m.place, m.outcome, m.rating_delta, m.xp, x.ended_at, x.mode, (SELECT 1 FROM replays r WHERE r.id = m.match_id) AS replay
      FROM match_players m JOIN matches x ON x.id = m.match_id WHERE m.user_id = ? ORDER BY x.ended_at DESC LIMIT 12`).all(u.id) as Array<Record<string, unknown>>)
      .map((r) => ({ match: String(r.match_id), place: Number(r.place), outcome: String(r.outcome), mode: String(r.mode), at: Number(r.ended_at), ratingDelta: r.rating_delta === null ? null : Math.round(Number(r.rating_delta)), xp: r.xp === null ? null : Number(r.xp), replay: !!r.replay }));
    const pcCount = (this.db.prepare('SELECT COUNT(*) AS n FROM pc WHERE user_id = ?').get(u.id) as { n: number }).n;
    const ach = this.db.prepare('SELECT id, at FROM achievements WHERE user_id = ? ORDER BY at').all(u.id) as Array<{ id: string; at: number }>;
    const xp = this.xp(u.id);
    return {
      name: u.username, joined: u.created_at, look: prof.look, stats: prof.stats, recent, pc: pcCount, ranked: this.rankedCard(u.id), online: this.presence(u.id).online,
      progress: { xp, ...levelOf(xp) }, title: this.title(u.id), achievements: ach,
    };
  }

  // ---------------------------------------------------------------- recovery codes

  /** Fresh recovery codes (the old ones stop working). Shown once; only their hashes are kept. */
  newRecoveryCodes(userId: number): string[] {
    const codes = Array.from({ length: RECOVERY_CODES }, () => {
      const b = randomBytes(5).toString('hex').toUpperCase();
      return `${b.slice(0, 5)}-${b.slice(5)}`;
    });
    this.db.prepare('DELETE FROM recovery WHERE user_id = ?').run(userId);
    for (const c of codes) this.db.prepare('INSERT INTO recovery (user_id, code_hash) VALUES (?, ?)').run(userId, sha256(normCode(c)));
    return codes;
  }

  /** Uses one recovery code to set a new password. */
  private useRecoveryCode(userId: number, code: string): boolean {
    const r = this.db.prepare('UPDATE recovery SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL').run(Date.now(), userId, sha256(normCode(code)));
    return Number(r.changes) === 1;
  }

  // ---------------------------------------------------------------- devices, bans, flags, the moderators' log

  /** Remembers which device (a random id the browser keeps) and address an account uses. */
  seeDevice(device: string | null, userId: number, ip: string): void {
    if (!device) return;
    const now = Date.now();
    this.db.prepare(`INSERT INTO devices (device_id, user_id, ip, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(device_id, user_id) DO UPDATE SET ip = excluded.ip, last_seen = excluded.last_seen`).run(device, userId, ip, now, now);
  }

  /** Why this device or address is banned (null: it is not). Expired bans are lifted on the way. */
  banFor(device: string | null, ip: string): string | null {
    const now = Date.now();
    this.db.prepare('DELETE FROM bans WHERE until IS NOT NULL AND until < ?').run(now);
    const row = this.db.prepare("SELECT reason FROM bans WHERE (kind = 'device' AND value = ?) OR (kind = 'ip' AND value = ?) LIMIT 1").get(device ?? '', ip) as { reason: string } | undefined;
    return row ? row.reason : null;
  }

  /** Bans an account, and with `devices` every device it used and its recent addresses (for a week). */
  ban(userId: number, reason: string, by: number | null, devices: boolean): { devices: number; ips: number } {
    const now = Date.now();
    this.db.prepare('UPDATE users SET banned = 1 WHERE id = ?').run(userId);
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    let nd = 0;
    let ni = 0;
    if (devices) {
      const rows = this.db.prepare('SELECT device_id, ip, last_seen FROM devices WHERE user_id = ?').all(userId) as Array<{ device_id: string; ip: string; last_seen: number }>;
      for (const r of rows) {
        nd += Number(this.db.prepare("INSERT OR IGNORE INTO bans (kind, value, reason, at, until, by_user) VALUES ('device', ?, ?, ?, NULL, ?)").run(r.device_id, reason, now, by).changes);
        // Addresses are shared (homes, schools): only recent ones, only for a week.
        if (now - r.last_seen < 14 * 86400_000) ni += Number(this.db.prepare("INSERT OR IGNORE INTO bans (kind, value, reason, at, until, by_user) VALUES ('ip', ?, ?, ?, ?, ?)").run(r.ip, reason, now, now + 7 * 86400_000, by).changes);
      }
    }
    return { devices: nd, ips: ni };
  }

  unban(userId: number): void {
    this.db.prepare('UPDATE users SET banned = 0 WHERE id = ?').run(userId);
    const rows = this.db.prepare('SELECT device_id, ip FROM devices WHERE user_id = ?').all(userId) as Array<{ device_id: string; ip: string }>;
    for (const r of rows) {
      this.db.prepare("DELETE FROM bans WHERE kind = 'device' AND value = ?").run(r.device_id);
      this.db.prepare("DELETE FROM bans WHERE kind = 'ip' AND value = ?").run(r.ip);
    }
  }

  /** A match's flags for one player (impossible actions the server refused). */
  addFlags(key: string, name: string, matchId: string, counts: Map<string, { n: number; detail: string }>): void {
    const userId = key.startsWith('u') ? Number(key.slice(1)) : null;
    for (const [kind, f] of counts) this.db.prepare('INSERT INTO flags (user_id, player_key, name, match_id, kind, count, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(userId, key, name, matchId, kind, f.n, f.detail.slice(0, 200), Date.now());
  }

  /** A report the server files itself (cheating flags, chat strikes). */
  autoReport(target: string, reason: string): void {
    const open = this.db.prepare("SELECT 1 FROM reports WHERE target = ? AND reporter_key = 'system' AND resolved = 0 AND reason = ?").get(target, reason);
    if (!open) this.db.prepare("INSERT INTO reports (reporter_id, reporter_key, target, reason, chat_id, at) VALUES (NULL, 'system', ?, ?, NULL, ?)").run(target, reason.slice(0, 300), Date.now());
  }

  logMod(by: { id: number | null; name: string }, action: string, target: string, detail = ''): void {
    this.db.prepare('INSERT INTO mod_actions (by_user, by_name, action, target, detail, at) VALUES (?, ?, ?, ?, ?, ?)').run(by.id, by.name, action, target, detail.slice(0, 300), Date.now());
  }

  /** Mutes from chat for `minutes` (0 lifts it). */
  mute(userId: number, minutes: number): void {
    this.db.prepare('UPDATE users SET muted_until = ? WHERE id = ?').run(minutes > 0 ? Date.now() + minutes * 60_000 : 0, userId);
  }

  // ---------------------------------------------------------------- ranked

  /**
   * A player's rating this season (as of now: the deviation grows with days away). Their first
   * ranked game of a season starts from last season's rating, halfway back to 1500.
   */
  rating(userId: number, now = Date.now()): { r: Rating; games: number; wins: number; peak: number; season: number } {
    const { season } = seasonAt(now);
    const row = this.db.prepare('SELECT * FROM ratings WHERE user_id = ? AND season = ?').get(userId, season) as RatingRow | undefined;
    if (row) return { r: decay({ rating: row.rating, rd: row.rd, vol: row.vol }, (now - row.last_at) / 86400_000), games: row.games, wins: row.wins, peak: row.peak, season };
    const prev = this.db.prepare('SELECT * FROM ratings WHERE user_id = ? AND season < ? ORDER BY season DESC LIMIT 1').get(userId, season) as RatingRow | undefined;
    const r = prev ? seasonReset({ rating: prev.rating, rd: prev.rd, vol: prev.vol }) : { ...DEFAULT_RATING };
    return { r, games: 0, wins: 0, peak: r.rating, season };
  }

  /** What a player's ranked standing looks like on screen. */
  rankedCard(userId: number): { season: number; rating: number; rd: number; games: number; wins: number; peak: number; tier: ReturnType<typeof tierOf>; placementLeft: number; rank: number | null } {
    const x = this.rating(userId);
    const shown = Math.round(x.r.rating);
    const rank = x.games >= PLACEMENT_GAMES ? 1 + (this.db.prepare('SELECT COUNT(*) AS n FROM ratings r JOIN users u ON u.id = r.user_id WHERE r.season = ? AND r.games >= ? AND r.rating > ? AND u.banned = 0').get(x.season, PLACEMENT_GAMES, x.r.rating) as { n: number }).n : null;
    return { season: x.season, rating: shown, rd: Math.round(x.r.rd), games: x.games, wins: x.wins, peak: Math.round(x.peak), tier: tierOf(x.r.rating, x.games), placementLeft: Math.max(0, PLACEMENT_GAMES - x.games), rank };
  }

  saveRating(userId: number, r: Rating, won: boolean, now = Date.now()): void {
    const cur = this.rating(userId, now);
    this.db.prepare(`INSERT INTO ratings (user_id, season, rating, rd, vol, games, wins, peak, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, season) DO UPDATE SET rating = excluded.rating, rd = excluded.rd, vol = excluded.vol, games = excluded.games, wins = excluded.wins, peak = excluded.peak, last_at = excluded.last_at`)
      .run(userId, cur.season, r.rating, r.rd, r.vol, cur.games + 1, cur.wins + (won ? 1 : 0), Math.max(cur.peak, r.rating), now);
  }

  // ---------------------------------------------------------------- friends

  /** Friends, and requests both ways. */
  friends(userId: number): Array<{ id: number; name: string; status: 'friend' | 'incoming' | 'outgoing' }> {
    const out = this.db.prepare(`SELECT f.friend_id AS id, u.username AS name, f.status FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? AND u.banned = 0`).all(userId) as Array<{ id: number; name: string; status: string }>;
    const inc = this.db.prepare(`SELECT f.user_id AS id, u.username AS name FROM friends f JOIN users u ON u.id = f.user_id WHERE f.friend_id = ? AND f.status = 'pending' AND u.banned = 0`).all(userId) as Array<{ id: number; name: string }>;
    return [
      ...out.map((r) => ({ id: r.id, name: r.name, status: (r.status === 'accepted' ? 'friend' : 'outgoing') as 'friend' | 'outgoing' })),
      ...inc.map((r) => ({ id: r.id, name: r.name, status: 'incoming' as const })),
    ].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The friends list as a browser shows it: each friend's relation, and for friends what they are up to. */
  friendList(userId: number): FriendEntry[] {
    return this.friends(userId).map((f) => {
      const p = f.status === 'friend' ? this.presence(f.id) : { online: false, status: 'offline' as const };
      return { name: f.name, relation: f.status, online: p.online, activity: p.status, matchId: p.matchId };
    });
  }

  areFriends(a: number, b: number): boolean {
    return !!this.db.prepare("SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'accepted'").get(a, b);
  }

  /** Sends a request (or accepts theirs, if they already asked). Returns what happened, for the reply. */
  addFriend(userId: number, name: string): { ok: boolean; text: string; other?: number } {
    const u = this.db.prepare('SELECT * FROM users WHERE username = ?').get(name) as UserRow | undefined;
    if (!u || u.banned) return { ok: false, text: 'No trainer by that name' };
    if (u.id === userId) return { ok: false, text: "That's you!" };
    if (this.areFriends(userId, u.id)) return { ok: false, text: `${u.username} is already your friend` };
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM friends WHERE user_id = ?').get(userId) as { n: number }).n;
    if (count >= MAX_FRIENDS) return { ok: false, text: `You can have up to ${MAX_FRIENDS} friends and requests` };
    const theirs = this.db.prepare("SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'pending'").get(u.id, userId);
    const now = Date.now();
    if (theirs) {
      this.db.prepare("UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ?").run(u.id, userId);
      this.db.prepare("INSERT OR REPLACE INTO friends (user_id, friend_id, status, created_at) VALUES (?, ?, 'accepted', ?)").run(userId, u.id, now);
      return { ok: true, text: `You and ${u.username} are now friends`, other: u.id };
    }
    this.db.prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, status, created_at) VALUES (?, ?, 'pending', ?)").run(userId, u.id, now);
    return { ok: true, text: `Friend request sent to ${u.username}`, other: u.id };
  }

  /** Unfriends, cancels a request, or declines one. */
  removeFriend(userId: number, name: string): { ok: boolean; other?: number } {
    const u = this.db.prepare('SELECT id FROM users WHERE username = ?').get(name) as { id: number } | undefined;
    if (!u) return { ok: false };
    this.db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(userId, u.id, u.id, userId);
    return { ok: true, other: u.id };
  }

  // ---------------------------------------------------------------- replays

  addReplay(r: { id: string; mode: string; startedAt: number; seconds: number; players: Array<{ name: string; place: number; human: boolean; key?: string }>; winner: string | null; bytes: number }): void {
    this.db.prepare('INSERT OR REPLACE INTO replays (id, mode, started_at, ended_at, seconds, players, winner, bytes, humans) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(r.id, r.mode, r.startedAt, Date.now(), r.seconds, JSON.stringify(r.players.map((p) => ({ name: p.name, place: p.place, human: p.human }))), r.winner, r.bytes, r.players.filter((p) => p.human).length);
    for (const p of r.players) if (p.key?.startsWith('u')) this.db.prepare('INSERT OR IGNORE INTO replay_players (replay_id, user_id) VALUES (?, ?)').run(r.id, Number(p.key.slice(1)));
  }

  /** Replays to delete so the kept ones fit in `maxBytes` (oldest first). */
  replaysOver(maxBytes: number): string[] {
    const rows = this.db.prepare('SELECT id, bytes FROM replays ORDER BY ended_at DESC').all() as Array<{ id: string; bytes: number }>;
    let total = 0;
    const out: string[] = [];
    for (const r of rows) {
      total += r.bytes;
      if (total > maxBytes) out.push(r.id);
    }
    return out;
  }

  dropReplay(id: string): void {
    this.db.prepare('DELETE FROM replays WHERE id = ?').run(id);
  }

  replayList(userId: number | null, limit = 30): unknown[] {
    const rows = (userId === null
      ? this.db.prepare("SELECT * FROM replays WHERE mode != 'private' ORDER BY humans DESC, ended_at DESC LIMIT ?").all(limit)
      : this.db.prepare('SELECT r.* FROM replays r JOIN replay_players p ON p.replay_id = r.id WHERE p.user_id = ? ORDER BY r.ended_at DESC LIMIT ?').all(userId, limit)) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ id: r.id, mode: r.mode, endedAt: r.ended_at, seconds: r.seconds, players: JSON.parse(String(r.players)), winner: r.winner, humans: r.humans }));
  }

  /** Replays kept, in bytes. */
  replayBytes(): number {
    return (this.db.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM replays').get() as { n: number }).n;
  }

  hasReplay(id: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM replays WHERE id = ?').get(id);
  }

  // ---------------------------------------------------------------- HTTP API

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    const send = (status: number, body: unknown, headers: Record<string, string | string[]> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }).end(JSON.stringify(body));
    };
    try {
      if (req.method === 'POST') {
        // Cross-site forms can not set this header: a simple guard against request forgery.
        if (req.headers['x-almia'] !== '1') return send(403, { error: 'Missing header' });
      }
      const me = this.userFromRequest(req);
      if (req.method === 'GET' && path === '/api/me') {
        if (!me) return send(200, { signedIn: false, google: !!this.google });
        const prof = this.profile(me.id);
        const earned = this.earned(me.id);
        return send(200, {
          signedIn: true, google: !!this.google, user: { id: me.id, username: me.username, role: me.role, google: !!me.google_sub, password: !!me.pass_hash }, look: prof.look, stats: prof.stats,
          progress: { xp: this.xp(me.id), ...levelOf(this.xp(me.id)) }, title: this.title(me.id), titles: titlesFor(earned), achievements: earned,
        });
      }
      if (req.method === 'POST' && path === '/api/register') return this.register(req, res, send);
      if (req.method === 'POST' && path === '/api/login') return this.login(req, res, send);
      if (req.method === 'POST' && path === '/api/recover') return this.recover(req, send);
      if (req.method === 'POST' && path === '/api/logout') {
        const token = parseCookies(req.headers.cookie)[COOKIE];
        if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
        return send(200, { ok: true }, { 'Set-Cookie': this.cookie(req, '', 0) });
      }
      if (req.method === 'GET' && path === '/api/auth/google') return this.googleStart(req, res);
      if (req.method === 'GET' && path === '/api/auth/google/callback') return this.googleCallback(req, res, url);
      if (req.method === 'GET' && path === '/api/season') return send(200, seasonAt(Date.now()));
      if (req.method === 'GET' && path === '/api/leaderboard' && url.searchParams.get('mode') === 'ranked') {
        const season = Number(url.searchParams.get('season')) || seasonAt(Date.now()).season;
        const rows = this.db.prepare('SELECT u.username, r.rating, r.games, r.wins, r.peak FROM ratings r JOIN users u ON u.id = r.user_id WHERE r.season = ? AND r.games >= ? AND u.banned = 0 ORDER BY r.rating DESC LIMIT 100').all(season, PLACEMENT_GAMES) as Array<{ username: string; rating: number; games: number; wins: number; peak: number }>;
        return send(200, { season, players: rows.map((r) => ({ name: r.username, rating: Math.round(r.rating), games: r.games, wins: r.wins, tier: tierOf(r.rating, r.games) })) });
      }
      if (req.method === 'GET' && path === '/api/replays' && !url.searchParams.get('mine')) return send(200, { replays: this.replayList(null) });
      if (req.method === 'GET' && path === '/api/leaderboard') {
        const rows = this.db.prepare("SELECT u.username, p.stats FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.banned = 0 AND json_extract(p.stats, '$.wins') > 0 ORDER BY json_extract(p.stats, '$.wins') DESC LIMIT 50").all() as Array<{ username: string; stats: string }>;
        return send(200, { players: rows.map((r) => ({ name: r.username, ...JSON.parse(r.stats) })) });
      }
      if (req.method === 'GET' && path.startsWith('/api/profile/')) {
        const name = decodeURIComponent(path.slice('/api/profile/'.length));
        const u = this.db.prepare('SELECT * FROM users WHERE username = ?').get(name) as UserRow | undefined;
        if (!u || u.banned) return send(404, { error: 'No such player' });
        const prof = this.profile(u.id);
        return send(200, this.publicProfile(u, prof));
      }
      if (!me) return send(401, { error: 'Sign in first' });
      if (me.banned) return send(403, { error: 'This account is banned' });
      if (req.method === 'GET' && path === '/api/ranked') return send(200, this.rankedCard(me.id));
      if (req.method === 'GET' && path === '/api/replays') return send(200, { replays: this.replayList(me.id) });
      if (req.method === 'GET' && path === '/api/friends') {
        return send(200, { friends: this.friendList(me.id) });
      }
      if (req.method === 'POST' && (path === '/api/friends/add' || path === '/api/friends/remove')) {
        const b = await readJson(req);
        const name = String(b.name ?? '').slice(0, 32);
        if (path === '/api/friends/add') {
          if (this.limited(`friend:${me.id}`, 30, 3600_000)) return send(429, { error: 'Too many friend requests. Try again later' });
          this.fail(`friend:${me.id}`);
          const r = this.addFriend(me.id, name);
          if (r.other !== undefined) this.onFriendsChanged([me.id, r.other]);
          return send(r.ok ? 200 : 400, r.ok ? { ok: true, text: r.text } : { error: r.text });
        }
        const r = this.removeFriend(me.id, name);
        if (r.other !== undefined) this.onFriendsChanged([me.id, r.other]);
        return send(200, { ok: r.ok });
      }
      if (req.method === 'GET' && path === '/api/pc') {
        const rows = this.db.prepare('SELECT id, entry FROM pc WHERE user_id = ? ORDER BY id').all(me.id) as Array<{ id: number; entry: string }>;
        const pooled = this.pooledIds(me.id);
        return send(200, { pc: rows.map((r) => ({ ...JSON.parse(r.entry), pcId: r.id, ...(pooled.has(r.id) ? { wonder: true } : {}) })) });
      }
      if (path.startsWith('/api/trade') || path.startsWith('/api/wonder')) return this.tradeApi(req, path, me, send);
      if (req.method === 'GET' && path === '/api/extract') {
        const row = this.db.prepare('SELECT match_id, party, picks_left, outcome FROM match_players WHERE user_id = ? AND picks_left > 0 ORDER BY rowid DESC LIMIT 1').get(me.id) as { match_id: string; party: string; picks_left: number; outcome: string } | undefined;
        return send(200, row ? { match: row.match_id, party: JSON.parse(row.party), picks: row.picks_left, outcome: row.outcome } : { match: null });
      }
      if (req.method === 'POST' && path === '/api/extract') {
        const b = await readJson(req);
        const row = this.db.prepare('SELECT party, picks_left, outcome FROM match_players WHERE user_id = ? AND match_id = ?').get(me.id, String(b.match ?? '')) as { party: string; picks_left: number; outcome: string } | undefined;
        if (!row || row.picks_left <= 0) return send(400, { error: 'Nothing to extract from that match' });
        const party = JSON.parse(row.party) as Array<{ dex: string; name: string; level: number; shiny: boolean; moves: string[]; taken?: boolean }>;
        const i = Number(b.index);
        const pick = Number.isInteger(i) ? party[i] : undefined;
        if (!pick || pick.taken) return send(400, { error: 'Pick one of your Pokémon from that match' });
        pick.taken = true;
        this.addToPc(me.id, pick, row.outcome === 'win' ? 'win' : 'voucher', String(b.match));
        this.db.prepare('UPDATE match_players SET picks_left = picks_left - 1, party = ? WHERE user_id = ? AND match_id = ?').run(JSON.stringify(party), me.id, String(b.match));
        return send(200, { ok: true, name: pick.name, achievements: this.checkAchievements(me.id, null) });
      }
      if (req.method === 'POST' && path === '/api/title') {
        const b = await readJson(req);
        const t = typeof b.title === 'string' ? b.title : '';
        if (t && !titlesFor(this.earned(me.id)).includes(t)) return send(400, { error: 'Earn that title first' });
        this.db.prepare('UPDATE profiles SET title = ? WHERE user_id = ?').run(t || null, me.id);
        return send(200, { ok: true, title: t || null });
      }
      if (req.method === 'POST' && path === '/api/recovery/new') {
        if (!me.pass_hash) return send(400, { error: 'Your account signs in with Google: Google handles its recovery' });
        return send(200, { ok: true, recovery: this.newRecoveryCodes(me.id) });
      }
      if (req.method === 'POST' && path === '/api/password') {
        const b = await readJson(req);
        const cur = String(b.current ?? '');
        const next = String(b.password ?? '');
        if (!me.pass_hash) return send(400, { error: 'Your account signs in with Google' });
        if (this.limited(`pw:${me.id}`, 8, 900_000)) return send(429, { error: 'Too many tries. Wait 15 minutes' });
        if (!checkPassword(cur, me.pass_hash)) {
          this.fail(`pw:${me.id}`);
          return send(401, { error: 'Your current password is not right' });
        }
        const err = passwordProblem(next, me.username);
        if (err) return send(400, { error: err });
        this.db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(next), me.id);
        // Every other browser signed in to this account is signed out.
        const token = parseCookies(req.headers.cookie)[COOKIE] ?? '';
        this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(me.id, sha256(token));
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/look') {
        const b = await readJson(req);
        const look = typeof b.look === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(b.look) ? b.look : null;
        if (!look) return send(400, { error: 'Pick a look' });
        if (!this.canWear(me.id, look)) return send(403, { error: 'That look is not unlocked yet' });
        this.db.prepare('UPDATE profiles SET look = ? WHERE user_id = ?').run(JSON.stringify(look), me.id);
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/rename') {
        const b = await readJson(req);
        const name = String(b.username ?? '');
        const err = this.checkUsername(name);
        if (err) return send(400, { error: err });
        try {
          this.db.prepare('UPDATE users SET username = ? WHERE id = ?').run(name, me.id);
        } catch {
          return send(409, { error: 'That name is taken' });
        }
        return send(200, { ok: true, username: name });
      }
      if (req.method === 'POST' && path === '/api/report') {
        const b = await readJson(req);
        const target = String(b.name ?? '').slice(0, 32);
        const reason = String(b.reason ?? '').slice(0, 300);
        if (!target) return send(400, { error: 'Who are you reporting?' });
        this.db.prepare('INSERT INTO reports (reporter_id, reporter_key, target, reason, chat_id, at) VALUES (?, ?, ?, ?, ?, ?)').run(me.id, `u${me.id}`, target, reason, typeof b.chatId === 'number' ? b.chatId : null, Date.now());
        return send(200, { ok: true });
      }
      return send(404, { error: 'Not found' });
    } catch (e) {
      console.error('api error', e);
      this.onError(e, { path, method: req.method });
      return send(500, { error: 'Something went wrong' });
    }
  }

  private checkUsername(name: string): string | null {
    if (!USERNAME.test(name)) return 'Names are 3-16 letters, numbers or _';
    if (RESERVED.has(name.toLowerCase()) || !isClean(name)) return 'Pick a different name';
    return null;
  }

  private async register(req: IncomingMessage, res: ServerResponse, send: (s: number, b: unknown, h?: Record<string, string | string[]>) => void): Promise<void> {
    const ip = clientIp(req);
    if (this.banFor(cleanDevice(String(req.headers['x-device'] ?? '')), ip)) return send(403, { error: 'New accounts can not be made from here' });
    if (this.limited(`reg:${ip}`, this.kind === 'dev' ? 100 : 5, 3600_000)) return send(429, { error: 'Too many new accounts from here. Try again later' });
    const b = await readJson(req);
    const username = String(b.username ?? '');
    const password = String(b.password ?? '');
    const err = this.checkUsername(username);
    if (err) return send(400, { error: err });
    const perr = passwordProblem(password, username);
    if (perr) return send(400, { error: perr });
    let id: number;
    try {
      id = Number(this.db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)').run(username, hashPassword(password), Date.now()).lastInsertRowid);
    } catch {
      return send(409, { error: 'That name is taken' });
    }
    this.fail(`reg:${ip}`);
    this.db.prepare('INSERT INTO profiles (user_id) VALUES (?)').run(id);
    // No email is kept, so these codes are how a forgotten password is reset: shown once, now.
    const recovery = this.newRecoveryCodes(id);
    return send(200, { ok: true, username, recovery }, { 'Set-Cookie': this.cookie(req, this.newSession(id), SESSION_DAYS * 86400) });
  }

  private async login(req: IncomingMessage, res: ServerResponse, send: (s: number, b: unknown, h?: Record<string, string | string[]>) => void): Promise<void> {
    const ip = clientIp(req);
    const b = await readJson(req);
    const username = String(b.username ?? '');
    const password = String(b.password ?? '');
    if (this.limited(`ip:${ip}`, 20, 900_000) || this.limited(`user:${username.toLowerCase()}`, 8, 900_000)) {
      return send(429, { error: 'Too many tries. Wait 15 minutes and try again' });
    }
    const u = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
    if (!u || !u.pass_hash || !checkPassword(password, u.pass_hash)) {
      this.fail(`ip:${ip}`);
      this.fail(`user:${username.toLowerCase()}`);
      return send(401, { error: 'Wrong name or password' });
    }
    if (u.banned) return send(403, { error: 'This account is banned' });
    if (this.banFor(cleanDevice(String(req.headers['x-device'] ?? '')), ip)) return send(403, { error: 'Signing in from here is blocked' });
    return send(200, { ok: true, username: u.username }, { 'Set-Cookie': this.cookie(req, this.newSession(u.id), SESSION_DAYS * 86400) });
  }

  /** A forgotten password: a recovery code sets a new one (and signs out everywhere else). */
  private async recover(req: IncomingMessage, send: (s: number, b: unknown, h?: Record<string, string | string[]>) => void): Promise<void> {
    const ip = clientIp(req);
    const b = await readJson(req);
    const username = String(b.username ?? '');
    const code = String(b.code ?? '');
    const password = String(b.password ?? '');
    if (this.limited(`rec:${ip}`, 10, 3600_000) || this.limited(`recuser:${username.toLowerCase()}`, 5, 3600_000)) return send(429, { error: 'Too many tries. Try again in an hour' });
    const u = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
    if (!u || !u.pass_hash || u.banned || !this.useRecoveryCode(u.id, code)) {
      this.fail(`rec:${ip}`);
      this.fail(`recuser:${username.toLowerCase()}`);
      return send(401, { error: 'That name and code do not match' });
    }
    const err = passwordProblem(password, u.username);
    if (err) {
      // The code was good: give it back so they can try a better password.
      this.db.prepare('UPDATE recovery SET used_at = NULL WHERE user_id = ? AND code_hash = ?').run(u.id, sha256(normCode(code)));
      return send(400, { error: err });
    }
    this.db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(password), u.id);
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    const left = (this.db.prepare('SELECT COUNT(*) AS n FROM recovery WHERE user_id = ? AND used_at IS NULL').get(u.id) as { n: number }).n;
    return send(200, { ok: true, username: u.username, codesLeft: left }, { 'Set-Cookie': this.cookie(req, this.newSession(u.id), SESSION_DAYS * 86400) });
  }

  // ---------------------------------------------------------------- Google

  private googleRedirect(req: IncomingMessage): string {
    const base = this.publicUrl ?? `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`;
    return `${base}/api/auth/google/callback`;
  }

  private googleStart(req: IncomingMessage, res: ServerResponse): void {
    if (!this.google) {
      res.writeHead(404).end('Google sign-in is not set up on this server');
      return;
    }
    const state = randomBytes(16).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({
      client_id: this.google.id, redirect_uri: this.googleRedirect(req), response_type: 'code', scope: 'openid profile',
      state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
    });
    res.writeHead(302, {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${q}`,
      'Set-Cookie': [this.cookie(req, `${state}.${verifier}`, 600, 'almia_google')],
    }).end();
  }

  private async googleCallback(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const back = (msg?: string): void => {
      res.writeHead(302, { Location: msg ? `/?signin=${encodeURIComponent(msg)}` : '/', 'Set-Cookie': [this.cookie(req, '', 0, 'almia_google')] }).end();
    };
    if (!this.google) return back('Google sign-in is not set up');
    const [state, verifier] = (parseCookies(req.headers.cookie).almia_google ?? '').split('.');
    if (!state || state !== url.searchParams.get('state') || !verifier) return back('Sign-in expired, try again');
    const code = url.searchParams.get('code');
    if (!code) return back('Sign-in was cancelled');
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: this.google.id, client_secret: this.google.secret, redirect_uri: this.googleRedirect(req), grant_type: 'authorization_code', code_verifier: verifier }),
    });
    if (!r.ok) return back('Google sign-in failed');
    const tok = (await r.json()) as { id_token?: string };
    // Straight from Google's token endpoint over TLS with our secret: its claims can be trusted as is.
    const claims = JSON.parse(Buffer.from((tok.id_token ?? '').split('.')[1] ?? '', 'base64url').toString('utf8') || '{}') as { sub?: string; aud?: string; iss?: string; exp?: number; given_name?: string };
    if (!claims.sub || claims.aud !== this.google.id || !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss ?? '') || (claims.exp ?? 0) * 1000 < Date.now()) {
      return back('Google sign-in failed');
    }
    let u = this.db.prepare('SELECT * FROM users WHERE google_sub = ?').get(claims.sub) as UserRow | undefined;
    if (!u) {
      const base = (cleanName(claims.given_name ?? '') || 'Trainer').replace(/[^A-Za-z0-9_]/g, '').slice(0, 10) || 'Trainer';
      let name = base;
      for (let i = 0; i < 50 && (this.db.prepare('SELECT 1 FROM users WHERE username = ?').get(name) || this.checkUsername(name)); i++) name = `${base}${Math.floor(Math.random() * 9000 + 1000)}`;
      const id = Number(this.db.prepare('INSERT INTO users (username, google_sub, created_at) VALUES (?, ?, ?)').run(name, claims.sub, Date.now()).lastInsertRowid);
      this.db.prepare('INSERT INTO profiles (user_id) VALUES (?)').run(id);
      u = this.user(id) as UserRow;
    }
    if (u.banned) return back('This account is banned');
    res.writeHead(302, { Location: '/', 'Set-Cookie': [this.cookie(req, this.newSession(u.id), SESSION_DAYS * 86400), this.cookie(req, '', 0, 'almia_google')] }).end();
    return;
  }

  // ---------------------------------------------------------------- sessions and limits

  private newSession(userId: number): string {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sha256(token), userId, now, now + SESSION_DAYS * 86400_000);
    return token;
  }

  private cookie(req: IncomingMessage, value: string, maxAge: number, name = COOKIE): string {
    const secure = isHttps(req) ? '; Secure' : '';
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }

  private limited(key: string, max: number, windowMs: number): boolean {
    const f = this.failures.get(key);
    if (!f) return false;
    if (Date.now() - f[1] > windowMs) {
      this.failures.delete(key);
      return false;
    }
    return f[0] >= max;
  }

  private fail(key: string): void {
    const f = this.failures.get(key);
    if (!f || Date.now() - f[1] > 3600_000) this.failures.set(key, [1, Date.now()]);
    else f[0]++;
  }
}

// ---------------------------------------------------------------- helpers

/** Why a password will not do (null: it will). */
export function passwordProblem(password: string, username: string): string | null {
  if (password.length < 8 || password.length > 200) return 'Passwords need at least 8 characters';
  if (password.toLowerCase().includes(username.toLowerCase()) || /^(password|12345678|qwertyui|11111111)/i.test(password)) return 'Pick a harder password';
  return null;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = scryptSync(password, Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: Number(r), p: Number(p) });
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A browser's device id (random, kept in its storage): letters, digits, - and _ only. */
export function cleanDevice(d: string | null | undefined): string | null {
  return d && /^[A-Za-z0-9_-]{16,64}$/.test(d) ? d : null;
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function isHttps(req: IncomingMessage): boolean {
  return req.headers['x-forwarded-proto'] === 'https' || !!(req.socket as { encrypted?: boolean }).encrypted;
}

export function clientIp(req: IncomingMessage): string {
  // Behind Fly's proxy the real address is in Fly-Client-IP.
  return String(req.headers['fly-client-ip'] ?? req.socket.remoteAddress ?? '?');
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 8192) throw new Error('body too large');
  }
  try {
    const v = JSON.parse(body || '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

