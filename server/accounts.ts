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

interface Stats {
  matches: number;
  wins: number;
  catches: number;
  knockouts: number;
  damage: number;
  bestPlace: number | null;
}

const EMPTY_STATS: Stats = { matches: 0, wins: 0, catches: 0, knockouts: 0, damage: 0, bestPlace: null };

export class Accounts {
  readonly db: DatabaseSync;
  /** Failed sign-ins per IP and per username: [count, window start]. */
  private failures = new Map<string, [number, number]>();
  private readonly google: { id: string; secret: string } | null;
  private readonly publicUrl: string | null;

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
      CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, ended_at INTEGER NOT NULL, summary TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS match_players (
        match_id TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, place INTEGER NOT NULL,
        outcome TEXT NOT NULL, stats TEXT NOT NULL, party TEXT NOT NULL, picks_left INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (match_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY, reporter_id INTEGER, reporter_key TEXT NOT NULL, target TEXT NOT NULL, reason TEXT NOT NULL,
        chat_id INTEGER, at INTEGER NOT NULL, resolved INTEGER NOT NULL DEFAULT 0
      );
    `);
    const gid = process.env.GOOGLE_CLIENT_ID;
    const gsecret = process.env.GOOGLE_CLIENT_SECRET;
    this.google = gid && gsecret ? { id: gid, secret: gsecret } : null;
    this.publicUrl = process.env.PUBLIC_URL?.replace(/\/$/, '') ?? null;
    // Expired sessions go once an hour.
    setInterval(() => this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600_000).unref();
  }

  // ---------------------------------------------------------------- identity

  /** Who a connecting browser is: their account from the session cookie, else a guest (by the key the browser keeps). */
  async identify(req: IncomingMessage): Promise<Identity> {
    const user = this.userFromRequest(req);
    if (user && !user.banned) {
      const prof = this.profile(user.id);
      return { key: `u${user.id}`, name: user.username, accountId: user.id, look: prof.look ?? undefined };
    }
    const url = new URL(req.url ?? '/', 'http://x');
    const g = url.searchParams.get('guest') ?? '';
    const key = /^[A-Za-z0-9_-]{16,64}$/.test(g) ? g : randomBytes(12).toString('base64url');
    const n = parseInt(createHash('sha256').update(key).digest('hex').slice(0, 6), 16) % 10000;
    const look = url.searchParams.get('look');
    return { key: `g${key}`, name: `Guest${String(n).padStart(4, '0')}`, accountId: null, look: look && /^[A-Za-z0-9_-]{1,48}$/.test(look) ? look : undefined };
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

  /** What a Pokémon in a match goes home as (a Mega as its base form). */
  static pcFields(m: Mon): { dex: string; name: string; level: number; shiny: boolean; alpha: boolean; legend: boolean; shadow: boolean; moves: string[]; heldItem: string | null } {
    return {
      dex: m.megaFrom?.dex ?? m.dex, name: (m.megaFrom?.name ?? m.name).replace(/^Shadow /, ''), level: m.level, shiny: !!m.shiny, alpha: !!m.alpha,
      legend: !!m.legend, shadow: !!m.shadow, moves: [...m.moves], heldItem: m.heldItem ?? null,
    };
  }

  /** A finished match: stats for every signed-in player, and extraction picks for winners (and vouchers). */
  recordMatch(matchId: string, results: RoomResult[]): void {
    this.db.prepare('INSERT OR IGNORE INTO matches (id, ended_at, summary) VALUES (?, ?, ?)').run(matchId, Date.now(), JSON.stringify(results.map((r) => ({ name: r.name, place: r.place, outcome: r.outcome }))));
    for (const r of results) {
      if (!r.key.startsWith('u')) continue;
      const userId = Number(r.key.slice(1));
      const picks = (r.outcome === 'win' ? 1 : 0) + r.vouchers;
      this.db.prepare('INSERT OR REPLACE INTO match_players (match_id, user_id, place, outcome, stats, party, picks_left) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(matchId, userId, r.place, r.outcome, JSON.stringify(r.stats), JSON.stringify(r.party), picks);
      const p = this.profile(userId);
      const s = p.stats;
      s.matches++;
      if (r.outcome === 'win') s.wins++;
      s.catches += r.stats.catches;
      s.knockouts += r.stats.knockouts;
      s.damage += Math.round(r.stats.damage);
      s.bestPlace = s.bestPlace === null ? r.place : Math.min(s.bestPlace, r.place);
      this.db.prepare('UPDATE profiles SET stats = ? WHERE user_id = ?').run(JSON.stringify(s), userId);
    }
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
        return send(200, { signedIn: true, google: !!this.google, user: { id: me.id, username: me.username, role: me.role, google: !!me.google_sub }, look: prof.look, stats: prof.stats });
      }
      if (req.method === 'POST' && path === '/api/register') return this.register(req, res, send);
      if (req.method === 'POST' && path === '/api/login') return this.login(req, res, send);
      if (req.method === 'POST' && path === '/api/logout') {
        const token = parseCookies(req.headers.cookie)[COOKIE];
        if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
        return send(200, { ok: true }, { 'Set-Cookie': this.cookie(req, '', 0) });
      }
      if (req.method === 'GET' && path === '/api/auth/google') return this.googleStart(req, res);
      if (req.method === 'GET' && path === '/api/auth/google/callback') return this.googleCallback(req, res, url);
      if (req.method === 'GET' && path === '/api/leaderboard') {
        const rows = this.db.prepare("SELECT u.username, p.stats FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.banned = 0 AND json_extract(p.stats, '$.wins') > 0 ORDER BY json_extract(p.stats, '$.wins') DESC LIMIT 50").all() as Array<{ username: string; stats: string }>;
        return send(200, { players: rows.map((r) => ({ name: r.username, ...JSON.parse(r.stats) })) });
      }
      if (req.method === 'GET' && path.startsWith('/api/profile/')) {
        const name = decodeURIComponent(path.slice('/api/profile/'.length));
        const u = this.db.prepare('SELECT * FROM users WHERE username = ?').get(name) as UserRow | undefined;
        if (!u || u.banned) return send(404, { error: 'No such player' });
        const prof = this.profile(u.id);
        const recent = this.db.prepare('SELECT m.match_id, m.place, m.outcome, x.ended_at FROM match_players m JOIN matches x ON x.id = m.match_id WHERE m.user_id = ? ORDER BY x.ended_at DESC LIMIT 10').all(u.id);
        const pcCount = (this.db.prepare('SELECT COUNT(*) AS n FROM pc WHERE user_id = ?').get(u.id) as { n: number }).n;
        return send(200, { name: u.username, joined: u.created_at, look: prof.look, stats: prof.stats, recent, pc: pcCount });
      }
      if (!me) return send(401, { error: 'Sign in first' });
      if (me.banned) return send(403, { error: 'This account is banned' });
      if (req.method === 'GET' && path === '/api/pc') {
        const rows = this.db.prepare('SELECT entry FROM pc WHERE user_id = ? ORDER BY id').all(me.id) as Array<{ entry: string }>;
        return send(200, { pc: rows.map((r) => JSON.parse(r.entry)) });
      }
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
        return send(200, { ok: true, name: pick.name });
      }
      if (req.method === 'POST' && path === '/api/look') {
        const b = await readJson(req);
        const look = typeof b.look === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(b.look) ? b.look : null;
        if (!look) return send(400, { error: 'Pick a look' });
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
    if (this.limited(`reg:${ip}`, 5, 3600_000)) return send(429, { error: 'Too many new accounts from here. Try again later' });
    const b = await readJson(req);
    const username = String(b.username ?? '');
    const password = String(b.password ?? '');
    const err = this.checkUsername(username);
    if (err) return send(400, { error: err });
    if (password.length < 8 || password.length > 200) return send(400, { error: 'Passwords need at least 8 characters' });
    if (password.toLowerCase().includes(username.toLowerCase()) || /^(password|12345678|qwertyui|11111111)/i.test(password)) return send(400, { error: 'Pick a harder password' });
    let id: number;
    try {
      id = Number(this.db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)').run(username, hashPassword(password), Date.now()).lastInsertRowid);
    } catch {
      return send(409, { error: 'That name is taken' });
    }
    this.fail(`reg:${ip}`);
    this.db.prepare('INSERT INTO profiles (user_id) VALUES (?)').run(id);
    return send(200, { ok: true, username }, { 'Set-Cookie': this.cookie(req, this.newSession(id), SESSION_DAYS * 86400) });
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
    return send(200, { ok: true, username: u.username }, { 'Set-Cookie': this.cookie(req, this.newSession(u.id), SESSION_DAYS * 86400) });
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

