/**
 * The moderators' side of the server: /api/mod/* (for accounts whose role is mod or admin) behind
 * the dashboard at /mod (server/modPage.ts). Every action is written to the moderators' log.
 *
 *   overview   who is online, matches, open reports, flags today, bans
 *   reports    open reports (players' and the server's own), resolve
 *   player     an account: stats, reports, flags, chat, devices, history; mute, ban (with its
 *              devices), unban, kick, role (admin), delete (admin)
 *   chat       recent messages; remove one
 *   flags      players the anti-cheat flagged lately
 *   matches    live matches (with a link to watch)
 *   announce   a message to everyone
 *   log        what the moderators (and the server) did
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Accounts, UserRow } from './accounts';
import type { Events } from './events';

export interface ModHooks {
  /** The Server tab: samples, counters, errors, backups. */
  server(): Record<string, unknown>;
  drain(on: boolean): void;
  backupNow(): Promise<unknown>;
  clearError(key: string): void;
  events: Events;
  /** Live matches, for the dashboard. */
  matches(): Array<{ id: string; mode: string; time: number; players: string[]; watchers: number }>;
  online(): number;
  /** Disconnects a player (after a ban, or a kick). */
  kick(userId: number, reason: string): void;
  removeChat(id: number): void;
  announce(text: string): void;
}

type Send = (status: number, body: unknown) => void;

export class ModApi {
  constructor(private readonly acc: Accounts, private readonly hooks: ModHooks) {}

  async handle(req: IncomingMessage, res: ServerResponse, path: string, url: URL): Promise<void> {
    const send: Send = (status, body) => res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
    if (req.method === 'POST' && req.headers['x-almia'] !== '1') return send(403, { error: 'Missing header' });
    const me = this.acc.userFromRequest(req);
    if (!me || me.banned || (me.role !== 'mod' && me.role !== 'admin')) return send(403, { error: 'Moderators only' });
    const admin = me.role === 'admin';
    const db = this.acc.db;
    const by = { id: me.id, name: me.username };
    const user = (name: unknown): UserRow | null => (db.prepare('SELECT * FROM users WHERE username = ?').get(String(name ?? '')) as UserRow | undefined) ?? null;
    try {
      if (req.method === 'GET' && path === '/api/mod/overview') {
        const day = Date.now() - 86400_000;
        const n = (sql: string, ...a: Array<string | number>) => (db.prepare(sql).get(...a) as { n: number }).n;
        return send(200, {
          you: { name: me.username, role: me.role },
          online: this.hooks.online(), matches: this.hooks.matches().length,
          openReports: n('SELECT COUNT(*) AS n FROM reports WHERE resolved = 0'),
          flagsToday: n('SELECT COUNT(DISTINCT player_key) AS n FROM flags WHERE at > ?', day),
          accounts: n('SELECT COUNT(*) AS n FROM users'), newToday: n('SELECT COUNT(*) AS n FROM users WHERE created_at > ?', day),
          banned: n('SELECT COUNT(*) AS n FROM users WHERE banned = 1'), muted: n('SELECT COUNT(*) AS n FROM users WHERE muted_until > ?', Date.now()),
          chatToday: n('SELECT COUNT(*) AS n FROM chat WHERE at > ?', day), matchesToday: n('SELECT COUNT(*) AS n FROM matches WHERE ended_at > ?', day),
        });
      }
      if (req.method === 'GET' && path === '/api/mod/reports') {
        const open = url.searchParams.get('all') ? '' : 'WHERE r.resolved = 0';
        const rows = db.prepare(`SELECT r.id, r.target, r.reason, r.at, r.resolved, r.reporter_key, u.username AS by, c.text AS chat FROM reports r
          LEFT JOIN users u ON u.id = r.reporter_id LEFT JOIN chat c ON c.id = r.chat_id ${open} ORDER BY r.id DESC LIMIT 100`).all();
        return send(200, { reports: rows });
      }
      if (req.method === 'POST' && path === '/api/mod/resolve') {
        const b = await readJson(req);
        db.prepare('UPDATE reports SET resolved = 1 WHERE id = ?').run(Number(b.id));
        this.acc.logMod(by, 'resolve', `report #${Number(b.id)}`, String(b.note ?? ''));
        return send(200, { ok: true });
      }
      if (req.method === 'GET' && path === '/api/mod/player') {
        const u = user(url.searchParams.get('name'));
        if (!u) {
          const like = db.prepare('SELECT username FROM users WHERE username LIKE ? ORDER BY username LIMIT 20').all(`%${String(url.searchParams.get('name') ?? '').replace(/[%_]/g, '')}%`) as Array<{ username: string }>;
          return send(404, { error: 'No such account', matches: like.map((r) => r.username) });
        }
        const prof = this.acc.publicProfile(u);
        return send(200, {
          id: u.id, name: u.username, role: u.role, banned: !!u.banned, mutedUntil: u.muted_until > Date.now() ? u.muted_until : null, joined: u.created_at,
          google: !!u.google_sub, profile: prof,
          reports: db.prepare('SELECT r.id, r.reason, r.at, r.resolved, u.username AS by, r.reporter_key FROM reports r LEFT JOIN users u ON u.id = r.reporter_id WHERE r.target = ? ORDER BY r.id DESC LIMIT 30').all(u.username),
          flags: db.prepare('SELECT match_id, kind, count, detail, at FROM flags WHERE user_id = ? ORDER BY at DESC LIMIT 50').all(u.id),
          chat: db.prepare('SELECT id, text, at FROM chat WHERE user_id = ? ORDER BY id DESC LIMIT 40').all(u.id),
          devices: db.prepare(`SELECT d.device_id, d.ip, d.first_seen, d.last_seen,
            (SELECT COUNT(DISTINCT user_id) FROM devices x WHERE x.device_id = d.device_id AND x.user_id != 0) AS accounts,
            (SELECT 1 FROM bans b WHERE b.kind = 'device' AND b.value = d.device_id) AS banned FROM devices d WHERE d.user_id = ? ORDER BY d.last_seen DESC LIMIT 20`).all(u.id),
          // Other accounts seen on the same devices (alts).
          alts: (db.prepare(`SELECT DISTINCT u2.username, u2.banned FROM devices d JOIN devices d2 ON d2.device_id = d.device_id AND d2.user_id != d.user_id AND d2.user_id != 0
            JOIN users u2 ON u2.id = d2.user_id WHERE d.user_id = ? LIMIT 20`).all(u.id) as Array<{ username: string; banned: number }>),
          history: db.prepare('SELECT by_name, action, detail, at FROM mod_actions WHERE target = ? ORDER BY id DESC LIMIT 30').all(u.username),
        });
      }
      if (req.method === 'POST' && path === '/api/mod/action') {
        const b = await readJson(req);
        const u = user(b.name);
        if (!u) return send(404, { error: 'No such account' });
        if ((u.role === 'admin' || (u.role === 'mod' && !admin)) && u.id !== me.id) return send(403, { error: 'Only an admin can act on a moderator' });
        const reason = String(b.reason ?? '').slice(0, 200) || 'No reason given';
        switch (String(b.action)) {
          case 'mute': {
            const minutes = Math.max(0, Math.min(60 * 24 * 365, Number(b.minutes) || 0));
            this.acc.mute(u.id, minutes);
            this.acc.logMod(by, minutes ? 'mute' : 'unmute', u.username, minutes ? `${minutes} min: ${reason}` : reason);
            return send(200, { ok: true });
          }
          case 'ban': {
            const r = this.acc.ban(u.id, reason, me.id, !!b.devices);
            this.hooks.kick(u.id, 'This account is banned');
            this.acc.logMod(by, 'ban', u.username, `${reason}${b.devices ? ` (+${r.devices} device${r.devices === 1 ? '' : 's'}, ${r.ips} address${r.ips === 1 ? '' : 'es'} for a week)` : ''}`);
            return send(200, { ok: true, ...r });
          }
          case 'unban':
            this.acc.unban(u.id);
            this.acc.logMod(by, 'unban', u.username, reason);
            return send(200, { ok: true });
          case 'kick':
            this.hooks.kick(u.id, 'A moderator disconnected you');
            this.acc.logMod(by, 'kick', u.username, reason);
            return send(200, { ok: true });
          case 'role': {
            if (!admin) return send(403, { error: 'Admins only' });
            const role = b.role === 'mod' || b.role === 'admin' ? b.role : 'player';
            db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, u.id);
            this.acc.logMod(by, 'role', u.username, role);
            return send(200, { ok: true });
          }
          case 'delete': {
            if (!admin) return send(403, { error: 'Admins only' });
            this.hooks.kick(u.id, 'This account was deleted');
            db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
            db.prepare("UPDATE chat SET name = '[deleted]', text = '[deleted]' WHERE user_id = ?").run(u.id);
            this.acc.logMod(by, 'delete', u.username, reason);
            return send(200, { ok: true });
          }
          default:
            return send(400, { error: 'Unknown action' });
        }
      }
      if (req.method === 'GET' && path === '/api/mod/chat') {
        const q = String(url.searchParams.get('q') ?? '').slice(0, 50);
        const rows = q
          ? db.prepare('SELECT id, name, text, at FROM chat WHERE text LIKE ? OR name LIKE ? ORDER BY id DESC LIMIT 200').all(`%${q}%`, `%${q}%`)
          : db.prepare('SELECT id, name, text, at FROM chat ORDER BY id DESC LIMIT 200').all();
        return send(200, { chat: rows });
      }
      if (req.method === 'POST' && path === '/api/mod/chat/remove') {
        const b = await readJson(req);
        const row = db.prepare('SELECT name, text FROM chat WHERE id = ?').get(Number(b.id)) as { name: string; text: string } | undefined;
        if (!row) return send(404, { error: 'No such message' });
        this.hooks.removeChat(Number(b.id));
        this.acc.logMod(by, 'remove-chat', row.name, row.text);
        return send(200, { ok: true });
      }
      if (req.method === 'GET' && path === '/api/mod/flags') {
        const rows = db.prepare(`SELECT name, player_key, user_id, COUNT(DISTINCT match_id) AS matches, SUM(count) AS total, GROUP_CONCAT(DISTINCT kind) AS kinds, MAX(at) AS last
          FROM flags WHERE at > ? GROUP BY player_key ORDER BY total DESC LIMIT 100`).all(Date.now() - 14 * 86400_000);
        return send(200, { flags: rows });
      }
      if (req.method === 'GET' && path === '/api/mod/matches') return send(200, { matches: this.hooks.matches() });
      if (req.method === 'POST' && path === '/api/mod/announce') {
        const b = await readJson(req);
        const text = String(b.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
        if (!text) return send(400, { error: 'Say something' });
        this.hooks.announce(text);
        this.acc.logMod(by, 'announce', 'everyone', text);
        return send(200, { ok: true });
      }
      if (req.method === 'GET' && path === '/api/mod/server') return send(200, this.hooks.server());
      if (req.method === 'POST' && path === '/api/mod/drain') {
        if (!admin) return send(403, { error: 'Admins only' });
        const b = await readJson(req);
        this.hooks.drain(!!b.on);
        this.acc.logMod(by, b.on ? 'drain' : 'undrain', 'server');
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/mod/backup') {
        if (!admin) return send(403, { error: 'Admins only' });
        const r = await this.hooks.backupNow();
        this.acc.logMod(by, 'backup', 'server');
        return send(200, { ok: !!r, backup: r });
      }
      if (req.method === 'POST' && path === '/api/mod/errors/clear') {
        const b = await readJson(req);
        this.hooks.clearError(String(b.key ?? ''));
        return send(200, { ok: true });
      }
      if (req.method === 'GET' && path === '/api/mod/events') return send(200, { events: this.hooks.events.list(), now: Date.now() });
      if (req.method === 'POST' && path === '/api/mod/events') {
        const b = await readJson(req);
        const err = this.hooks.events.create({ kind: b.kind, name: b.name, startsAt: b.startsAt, hours: b.hours, value: b.value }, me.username);
        if (err) return send(400, { error: err });
        this.acc.logMod(by, 'event', 'everyone', `${String(b.kind)}: ${String(b.name)} (${String(b.hours ?? 0)} h, x${String(b.value ?? '')})`);
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/mod/events/delete') {
        const b = await readJson(req);
        this.hooks.events.remove(Number(b.id));
        this.acc.logMod(by, 'event-delete', 'everyone', `#${Number(b.id)}`);
        return send(200, { ok: true });
      }
      if (req.method === 'GET' && path === '/api/mod/log') {
        return send(200, { log: db.prepare('SELECT by_name, action, target, detail, at FROM mod_actions ORDER BY id DESC LIMIT 200').all() });
      }
      return send(404, { error: 'Not found' });
    } catch (e) {
      console.error('mod api error', e);
      return send(500, { error: 'Something went wrong' });
    }
  }
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
