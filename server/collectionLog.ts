/**
 * The collection log's table (append-only, no foreign keys, so its rows outlive the accounts they
 * name) and what is kept of an account before it is deleted: its PC and its trade and Wonder Trade
 * history, which the database would otherwise delete with it (and, through the trades table, from
 * the other trainers' history too). Shared by the server (accounts.ts, modApi.ts) and the admin CLI.
 */
import type { DatabaseSync } from 'node:sqlite';

export const COLLECTION_LOG_SQL = `
  CREATE TABLE IF NOT EXISTS collection_log (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, username TEXT, action TEXT NOT NULL, pc_id INTEGER,
    other_user INTEGER, other_name TEXT, ref TEXT, detail TEXT, at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS collection_log_user ON collection_log(user_id, at);
  CREATE INDEX IF NOT EXISTS collection_log_pc ON collection_log(pc_id);
`;

/** Writes the deleted account's PC and trading history into the collection log (call before the DELETE). */
export function archiveAccount(db: DatabaseSync, userId: number, by: string): void {
  db.exec(COLLECTION_LOG_SQL);
  const name = (db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as { username: string } | undefined)?.username ?? null;
  const at = Date.now();
  const add = db.prepare('INSERT INTO collection_log (user_id, username, action, pc_id, other_user, other_name, ref, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const p of db.prepare('SELECT id, entry FROM pc WHERE user_id = ?').all(userId) as Array<{ id: number; entry: string }>) {
    add.run(userId, name, 'deleted-with-account', p.id, null, null, `by:${by}`, p.entry, at);
  }
  const trades = db.prepare('SELECT * FROM trades WHERE from_user = ? OR to_user = ?').all(userId, userId);
  const wonder = db.prepare('SELECT * FROM wonder WHERE user_id = ?').all(userId);
  add.run(userId, name, 'account-deleted', null, null, null, `by:${by}`, JSON.stringify({ trades, wonder }), at);
}
