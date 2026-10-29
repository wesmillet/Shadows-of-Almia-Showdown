/**
 * The administrator's dashboard API: /api/admin/* (server/adminPage.ts is the page at /admin).
 *
 * For accounts whose server-side role is `admin` only: every request looks the signed-in account
 * up from its session cookie and checks `users.role` in the database (never the display name,
 * never anything the browser says). Guests, players and moderators get 403. Read-only except for
 * Mystery Gift codes (making them and switching them off); nothing edits an account, and no
 * grants, bans or deletions (those stay on the moderators' page, /mod).
 * Nothing here returns password hashes, session tokens, Google ids or recovery codes.
 *
 *   GET /api/admin/online           who is connected and what they are doing (live, from the hub)
 *   GET/POST /api/admin/gifts       Mystery Gift codes: list, make; POST /api/admin/gifts/active switches one on or off
 *   GET /api/admin/accounts?q=&page= search registered accounts by username
 *   GET /api/admin/account?id=      one account: profile, progression, chest, PC, recent matches
 *   GET /api/admin/matches?page=&mode=&player=&aborted=1   completed matches, newest first
 *   GET /api/admin/match?id=        one completed match: participants, places, recorded stats
 *   GET /api/admin/live             matches running now
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Accounts } from './accounts';

/** A connected player as the dashboard shows them (hub.ts builds these). */
export interface OnlineEntry {
  name: string;
  /** Registered account id, or null for a guest. */
  accountId: number | null;
  guest: boolean;
  /** hub: on the online menu · lobby: queued, in a party, picking or in a private lobby · match: playing · spectating: watching a match. */
  state: 'hub' | 'lobby' | 'match' | 'spectating';
  /** The match they play in or watch. */
  room: string | null;
  connectedAt: number;
}

export interface LiveMatch {
  id: string;
  mode: string;
  startedAt: number;
  /** Match time in seconds. */
  time: number;
  watchers: number;
  /** Everyone in it: humans (connected or not) and computer trainers. */
  trainers: Array<{ name: string; human: boolean; guest: boolean; accountId: number | null; connected: boolean }>;
}

export interface AdminHooks {
  online(): OnlineEntry[];
  /** Humans who left a running match by losing their connection: their seat waits for them. */
  awaySeats(): Array<{ name: string; accountId: number | null; guest: boolean; room: string }>;
  live(): LiveMatch[];
}

const PAGE = 25;

type Send = (status: number, body: unknown) => void;

export class AdminApi {
  constructor(private readonly acc: Accounts, private readonly hooks: AdminHooks) {}

  /** The signed-in account, if its role in the database is admin (and it is not banned). */
  private admin(req: IncomingMessage): { id: number; username: string } | null {
    const me = this.acc.userFromRequest(req);
    if (!me || me.banned || me.role !== 'admin') return null;
    return { id: me.id, username: me.username };
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string, url: URL): Promise<void> {
    const send: Send = (status, body) => res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(body));
    const me = this.admin(req);
    if (!me) return send(403, { error: 'Administrators only' });
    // Mystery Gift codes: the one part of the dashboard that changes anything (it makes and switches
    // off codes; it never touches an account). Writes need the game's request header (not a form).
    if (path === '/api/admin/gifts' || path === '/api/admin/gifts/active') {
      const gifts = this.acc.gifts;
      if (req.method === 'GET') {
        const code = url.searchParams.get('code');
        if (code) return send(200, { redemptions: gifts.redemptions(code) });
        return send(200, { codes: gifts.list(), looks: gifts.lookOptions() });
      }
      if (req.method !== 'POST') return send(405, { error: 'GET or POST' });
      if (req.headers['x-almia'] !== '1') return send(403, { error: 'Missing header' });
      const body = await readBody(req);
      if (path === '/api/admin/gifts') {
        const r = gifts.create(me.username, body);
        return 'error' in r ? send(400, r) : send(200, r);
      }
      return gifts.setActive(String(body.code ?? ''), body.active === true) ? send(200, { ok: true }) : send(404, { error: 'No such code' });
    }
    // Everything else is read-only: nothing but GET.
    if (req.method !== 'GET') return send(405, { error: 'The admin dashboard is read-only' });
    const db = this.acc.db;
    const page = Math.max(0, Math.floor(Number(url.searchParams.get('page') ?? 0)) || 0);
    try {
      if (path === '/api/admin/online') {
        const list = this.hooks.online();
        const humans = list;
        const by = (s: OnlineEntry['state']) => humans.filter((x) => x.state === s).length;
        const live = this.hooks.live();
        return send(200, {
          you: me.username,
          at: Date.now(),
          counts: {
            humans: humans.length,
            accounts: humans.filter((x) => !x.guest).length,
            guests: humans.filter((x) => x.guest).length,
            hub: by('hub'), lobby: by('lobby'), match: by('match'), spectating: by('spectating'),
            bots: live.reduce((n, m) => n + m.trainers.filter((t) => !t.human).length, 0),
            away: this.hooks.awaySeats().length,
          },
          players: humans.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name)),
          away: this.hooks.awaySeats(),
        });
      }
      if (path === '/api/admin/live') return send(200, { matches: this.hooks.live() });
      if (path === '/api/admin/accounts') {
        const q = String(url.searchParams.get('q') ?? '').slice(0, 32);
        const where = q ? "WHERE u.username LIKE ? ESCAPE '\\'" : '';
        const args = q ? [`%${likeEscape(q)}%`] : [];
        const total = (db.prepare(`SELECT COUNT(*) AS n FROM users u ${where}`).get(...args) as { n: number }).n;
        const rows = db.prepare(`SELECT u.id, u.username, u.role, u.created_at, u.last_seen, u.banned,
            (SELECT COUNT(*) FROM pc WHERE pc.user_id = u.id) AS pc,
            (SELECT MAX(last_seen) FROM devices d WHERE d.user_id = u.id) AS device_seen
          FROM users u ${where} ORDER BY u.username COLLATE NOCASE LIMIT ? OFFSET ?`).all(...args, PAGE, page * PAGE);
        return send(200, { total, page, pageSize: PAGE, accounts: rows });
      }
      if (path === '/api/admin/account') {
        const id = Number(url.searchParams.get('id'));
        const u = db.prepare('SELECT id, username, role, created_at, last_seen, banned, muted_until, google_sub IS NOT NULL AS google, pass_hash IS NOT NULL AS password FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!u) return send(404, { error: 'No such account' });
        const prof = this.acc.profile(id);
        const xp = this.acc.xp(id);
        const pc = (db.prepare('SELECT id, entry, created_at FROM pc WHERE user_id = ? ORDER BY id').all(id) as Array<{ id: number; entry: string; created_at: number }>)
          .map((r) => ({ id: r.id, savedAt: r.created_at, ...safeJson(r.entry) }));
        const deviceSeen = (db.prepare('SELECT MAX(last_seen) AS t FROM devices WHERE user_id = ?').get(id) as { t: number | null }).t;
        const online = this.hooks.online().find((x) => x.accountId === id) ?? null;
        return send(200, {
          account: { ...u, google: !!u.google, password: !!u.password, banned: !!u.banned },
          deviceSeen,
          online,
          progression: { xp, ...this.acc.level(xp), title: this.acc.title(id), achievements: this.acc.earned(id), stats: prof.stats },
          // No currency is saved between matches: Poké Dollars (₽) start fresh every match.
          currencies: null,
          chest: prof.chest,
          pc,
          matches: this.matchesOf(id, 0),
        });
      }
      if (path === '/api/admin/account/matches') {
        const id = Number(url.searchParams.get('id'));
        return send(200, this.matchesOf(id, page));
      }
      if (path === '/api/admin/matches') {
        const mode = String(url.searchParams.get('mode') ?? '');
        const player = String(url.searchParams.get('player') ?? '').slice(0, 32);
        const withAborted = url.searchParams.get('aborted') === '1';
        const cond: string[] = [];
        const args: Array<string | number> = [];
        if (mode) {
          cond.push('mode = ?');
          args.push(mode);
        }
        if (!withAborted) cond.push('aborted IS NULL');
        if (player) {
          cond.push("trainers LIKE ? ESCAPE '\\'");
          args.push(`%"name":${likeEscape(JSON.stringify(player).slice(0, -1))}%`);
        }
        const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
        const total = (db.prepare(`SELECT COUNT(*) AS n FROM match_log ${where}`).get(...args) as { n: number }).n;
        const rows = (db.prepare(`SELECT id, mode, started_at, ended_at, seconds, winner, trainers_n, humans, bots, aborted FROM match_log ${where} ORDER BY ended_at DESC LIMIT ? OFFSET ?`).all(...args, PAGE, page * PAGE));
        const legacy = (db.prepare('SELECT COUNT(*) AS n FROM matches WHERE id NOT IN (SELECT id FROM match_log)').get() as { n: number }).n;
        return send(200, { total, page, pageSize: PAGE, matches: rows, since: this.acc.historySince(), legacy });
      }
      if (path === '/api/admin/match') {
        const id = String(url.searchParams.get('id') ?? '');
        const row = db.prepare('SELECT * FROM match_log WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (row) return send(200, { match: { ...row, trainers: safeJson(String(row.trainers)) }, full: true });
        // Older matches: only what was recorded then (signed-in players' places and stats).
        const old = db.prepare('SELECT id, ended_at, summary, mode FROM matches WHERE id = ?').get(id) as { id: string; ended_at: number; summary: string; mode: string } | undefined;
        if (!old) return send(404, { error: 'No such match' });
        const players = db.prepare('SELECT mp.user_id, u.username, mp.place, mp.outcome, mp.stats, mp.xp FROM match_players mp LEFT JOIN users u ON u.id = mp.user_id WHERE mp.match_id = ? ORDER BY mp.place').all(id) as Array<Record<string, unknown>>;
        return send(200, { match: { id: old.id, ended_at: old.ended_at, mode: old.mode, summary: safeJson(old.summary), players: players.map((p) => ({ ...p, stats: safeJson(String(p.stats)) })) }, full: false });
      }
      return send(404, { error: 'Not found' });
    } catch (e) {
      console.error('admin api error', e);
      return send(500, { error: 'Something went wrong' });
    }
  }

  /** An account's matches: the full log since it began, and older ones from the per-player records. */
  private matchesOf(userId: number, page: number): { page: number; pageSize: number; total: number; matches: unknown[] } {
    const db = this.acc.db;
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM (
        SELECT match_id AS id FROM match_log_players WHERE user_id = ?
        UNION SELECT match_id AS id FROM match_players WHERE user_id = ?)`).get(userId, userId) as { n: number }).n;
    const rows = db.prepare(`SELECT id, ended_at, mode, place, outcome, full FROM (
        SELECT l.id, l.ended_at, l.mode, p.place, p.outcome, 1 AS full FROM match_log_players p JOIN match_log l ON l.id = p.match_id WHERE p.user_id = ?
        UNION ALL
        SELECT m.id, m.ended_at, m.mode, mp.place, mp.outcome, 0 AS full FROM match_players mp JOIN matches m ON m.id = mp.match_id
          WHERE mp.user_id = ? AND mp.match_id NOT IN (SELECT match_id FROM match_log_players WHERE user_id = ?)
      ) ORDER BY ended_at DESC LIMIT ? OFFSET ?`).all(userId, userId, userId, PAGE, page * PAGE);
    return { page, pageSize: PAGE, total, matches: rows };
  }
}

/** Text for a LIKE pattern, its wildcards taken literally (with ESCAPE '\\'). */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : { value: v };
  } catch {
    return { raw: s };
  }
}

/** A small JSON body (the gift form). */
function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 10_000) req.destroy();
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(data || '{}') as unknown;
        resolve(v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}
