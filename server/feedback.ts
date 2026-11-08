/**
 * Feedback: players send a bug report, a suggestion or general feedback from Options (src/ui/
 * feedbackDialog.ts). It lands on the admin dashboard (/admin, Feedback), where the administrator
 * marks each one seen or done and can keep a note on it.
 *
 * Guests may send it too (the demo's players often have no account). Each sender (account, or guest
 * address) may send FEEDBACK_PER_HOUR an hour, and the text is length-capped.
 */
import type { Accounts } from './accounts';

export type FeedbackKind = 'bug' | 'suggestion' | 'feedback';
export type FeedbackStatus = 'new' | 'seen' | 'done';

export const FEEDBACK_KINDS: FeedbackKind[] = ['bug', 'suggestion', 'feedback'];
const STATUSES: FeedbackStatus[] = ['new', 'seen', 'done'];
const MAX_TEXT = 2000;
const FEEDBACK_PER_HOUR = 5;

export interface FeedbackRow {
  id: number;
  user_id: number | null;
  name: string;
  kind: FeedbackKind;
  text: string;
  build: string | null;
  device: string | null;
  at: number;
  status: FeedbackStatus;
  note: string | null;
}

export class Feedback {
  private recent = new Map<string, number[]>();

  constructor(private readonly acc: Accounts) {
    acc.db.exec(`
      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
        build TEXT, device TEXT, ip TEXT, at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'new', note TEXT
      );
    `);
  }

  /** A player (or guest) sends one. `who` is the account, or null for a guest. */
  submit(who: { id: number; username: string } | null, ip: string, b: Record<string, unknown>, now = Date.now()): { ok: true } | { error: string } {
    const kind = FEEDBACK_KINDS.includes(b.kind as FeedbackKind) ? (b.kind as FeedbackKind) : null;
    if (!kind) return { error: 'Pick bug, suggestion or feedback' };
    const text = String(b.text ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, MAX_TEXT);
    if (text.length < 5) return { error: 'Tell us a little more' };
    const key = who ? `u${who.id}` : `ip:${ip}`;
    const times = (this.recent.get(key) ?? []).filter((t) => now - t < 3600_000);
    if (times.length >= FEEDBACK_PER_HOUR) return { error: 'Thanks! That is plenty for this hour. Try again later' };
    times.push(now);
    this.recent.set(key, times);
    const name = who ? who.username : 'Guest';
    const build = typeof b.build === 'string' ? b.build.slice(0, 40) : null;
    const device = typeof b.device === 'string' ? b.device.slice(0, 200) : null;
    this.acc.db.prepare('INSERT INTO feedback (user_id, name, kind, text, build, device, ip, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(who?.id ?? null, name, kind, text, build, device, ip, now);
    return { ok: true };
  }

  /** The dashboard's list, newest first (filtered by kind and status). Never returns addresses. */
  list(kind = '', status = ''): { items: FeedbackRow[]; counts: Record<string, number> } {
    const cond: string[] = [];
    const args: string[] = [];
    if (FEEDBACK_KINDS.includes(kind as FeedbackKind)) {
      cond.push('kind = ?');
      args.push(kind);
    }
    if (STATUSES.includes(status as FeedbackStatus)) {
      cond.push('status = ?');
      args.push(status);
    }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const items = this.acc.db.prepare(`SELECT id, user_id, name, kind, text, build, device, at, status, note FROM feedback ${where} ORDER BY id DESC LIMIT 500`).all(...args) as unknown as FeedbackRow[];
    const counts: Record<string, number> = {};
    for (const r of this.acc.db.prepare('SELECT status, COUNT(*) AS n FROM feedback GROUP BY status').all() as Array<{ status: string; n: number }>) counts[r.status] = r.n;
    return { items, counts };
  }

  /** Marks one new, seen or done, with an optional note. */
  update(id: number, b: Record<string, unknown>): boolean {
    const status = STATUSES.includes(b.status as FeedbackStatus) ? (b.status as FeedbackStatus) : null;
    const note = typeof b.note === 'string' ? b.note.slice(0, 500) : null;
    if (!status && note === null) return false;
    const r = status && note !== null
      ? this.acc.db.prepare('UPDATE feedback SET status = ?, note = ? WHERE id = ?').run(status, note, id)
      : status
        ? this.acc.db.prepare('UPDATE feedback SET status = ? WHERE id = ?').run(status, id)
        : this.acc.db.prepare('UPDATE feedback SET note = ? WHERE id = ?').run(note, id);
    return Number(r.changes) === 1;
  }

  /** How many are still new (the dashboard's tab badge). */
  newCount(): number {
    return (this.acc.db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE status = 'new'").get() as { n: number }).n;
  }
}
