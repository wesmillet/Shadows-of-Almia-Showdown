/**
 * Direct messages between friends. Only signed-in players who are friends with each other can
 * message (removing a friend ends it, so there is no stranger spam); a banned or chat-muted account
 * can not send. Every message goes through the chat word filter, sending is rate-limited, and the
 * last month is kept. Either side can report a message (it reaches the moderators with its text).
 */
import type { DatabaseSync } from 'node:sqlite';
import { censor } from './moderation';

const MAX_LEN = 300;
/** Messages a player may send per WINDOW_MS (to everyone together). */
const BURST = 8;
const WINDOW_MS = 10_000;
/** How long messages are kept. */
const KEEP_MS = 30 * 86400_000;
/** Messages a conversation shows (the newest). */
const PAGE = 80;

export interface DmMsg {
  id: number;
  from: string;
  to: string;
  text: string;
  at: number;
}

export interface DmHost {
  readonly db: DatabaseSync;
  user(id: number): { id: number; username: string; banned: number; muted_until: number } | undefined;
  userByName(name: string): { id: number; username: string; banned: number } | undefined;
  areFriends(a: number, b: number): boolean;
}

export class Dms {
  private sent = new Map<number, number[]>();

  constructor(private readonly host: DmHost) {
    const db = host.db;
    db.exec(`CREATE TABLE IF NOT EXISTS dms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id INTEGER NOT NULL, to_id INTEGER NOT NULL,
      text TEXT NOT NULL, at INTEGER NOT NULL, read_at INTEGER
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS dms_pair ON dms (from_id, to_id, at)');
    db.exec('CREATE INDEX IF NOT EXISTS dms_unread ON dms (to_id, read_at)');
    db.prepare('DELETE FROM dms WHERE at < ?').run(Date.now() - KEEP_MS);
    // Reports can point at a direct message.
    const cols = db.prepare('PRAGMA table_info(reports)').all() as Array<{ name: string }>;
    if (cols.length && !cols.some((c) => c.name === 'dm_id')) db.exec('ALTER TABLE reports ADD COLUMN dm_id INTEGER');
  }

  /** Sends `raw` from one player to a friend by name: the stored message, or why it was not sent. */
  send(fromId: number, toName: unknown, raw: unknown): { msg: DmMsg; toId: number } | { error: string } {
    const me = this.host.user(fromId);
    if (!me || me.banned) return { error: 'Sign in to send messages' };
    if (me.muted_until > Date.now()) return { error: 'You are muted for now, so you can not send messages' };
    const to = typeof toName === 'string' ? this.host.userByName(toName.slice(0, 32)) : undefined;
    if (!to || to.banned) return { error: 'No such player' };
    if (to.id === fromId) return { error: 'That is you' };
    if (!this.host.areFriends(fromId, to.id)) return { error: `You can only message friends. Add ${to.username} first` };
    if (typeof raw !== 'string') return { error: 'Type a message' };
    const text = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
    if (!text) return { error: 'Type a message' };
    const now = Date.now();
    const times = (this.sent.get(fromId) ?? []).filter((t) => now - t < WINDOW_MS);
    if (times.length >= BURST) return { error: 'Slow down a little' };
    times.push(now);
    this.sent.set(fromId, times);
    const clean = censor(text);
    const id = Number(this.host.db.prepare('INSERT INTO dms (from_id, to_id, text, at) VALUES (?, ?, ?, ?)').run(fromId, to.id, clean, now).lastInsertRowid);
    return { msg: { id, from: me.username, to: to.username, text: clean, at: now }, toId: to.id };
  }

  /** A conversation with one other player (the newest PAGE messages, oldest first); marks theirs read. */
  history(meId: number, withName: string): { with: string; messages: DmMsg[] } | { error: string } {
    const other = this.host.userByName(withName.slice(0, 32));
    if (!other) return { error: 'No such player' };
    const rows = this.host.db.prepare(`SELECT d.id, d.from_id, d.text, d.at FROM dms d
      WHERE (d.from_id = ? AND d.to_id = ?) OR (d.from_id = ? AND d.to_id = ?) ORDER BY d.id DESC LIMIT ?`).all(meId, other.id, other.id, meId, PAGE) as Array<{ id: number; from_id: number; text: string; at: number }>;
    const me = this.host.user(meId);
    this.markRead(meId, other.id);
    return {
      with: other.username,
      messages: rows.reverse().map((r) => ({ id: Number(r.id), from: r.from_id === meId ? me?.username ?? '' : other.username, to: r.from_id === meId ? other.username : me?.username ?? '', text: r.text, at: Number(r.at) })),
    };
  }

  /** Unread messages per sender's name. */
  unread(meId: number): Record<string, number> {
    const rows = this.host.db.prepare(`SELECT u.username AS name, COUNT(*) AS n FROM dms d JOIN users u ON u.id = d.from_id
      WHERE d.to_id = ? AND d.read_at IS NULL GROUP BY d.from_id`).all(meId) as Array<{ name: string; n: number }>;
    const out: Record<string, number> = {};
    for (const r of rows) out[r.name] = Number(r.n);
    return out;
  }

  /** Everything from `otherId` to `meId` read now. */
  markRead(meId: number, otherId: number): void {
    this.host.db.prepare('UPDATE dms SET read_at = ? WHERE to_id = ? AND from_id = ? AND read_at IS NULL').run(Date.now(), meId, otherId);
  }

  /** A message the reporter sent or received, for a report (its id, and who wrote it). */
  forReport(meId: number, dmId: number): { id: number; author: string } | null {
    const r = this.host.db.prepare('SELECT d.id, u.username AS author FROM dms d JOIN users u ON u.id = d.from_id WHERE d.id = ? AND (d.to_id = ? OR d.from_id = ?)').get(dmId, meId, meId) as { id: number; author: string } | undefined;
    return r ? { id: Number(r.id), author: r.author } : null;
  }
}
