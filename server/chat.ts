/**
 * Global chat: one room for everyone connected. Messages are length-capped, rate-limited per
 * player, run through the word filter, and kept (the last 50 are shown to anyone who joins).
 * Guests can read; only signed-in players can talk (it makes bans and reports stick). A muted
 * account (muted_until in the future) can read but not talk.
 */
import type { ServerMsg } from '../src/net/protocol';
import type { Accounts } from './accounts';
import { censor } from './moderation';

const MAX_LEN = 200;
/** A player may send this many messages per WINDOW seconds. */
const BURST = 5;
const WINDOW = 10;
const HISTORY = 50;

interface Speaker {
  key: string;
  name: string;
  accountId: number | null;
  send(msg: ServerMsg): void;
}

export class Chat {
  private recent: Array<Extract<ServerMsg, { t: 'chat' }>> = [];
  private sent = new Map<string, number[]>();

  constructor(private readonly broadcast: (msg: ServerMsg) => void, private readonly accounts: Accounts) {
    const rows = accounts.db.prepare('SELECT id, name, text, at FROM chat ORDER BY id DESC LIMIT ?').all(HISTORY) as Array<{ id: number; name: string; text: string; at: number }>;
    this.recent = rows.reverse().map((r) => ({ t: 'chat', id: r.id, from: r.name, text: r.text, at: r.at }));
  }

  history(to: Speaker): void {
    for (const m of this.recent) to.send(m);
  }

  say(from: Speaker, raw: unknown): void {
    if (typeof raw !== 'string') return;
    const text = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
    if (!text) return;
    if (from.accountId === null) {
      from.send({ t: 'chat', from: 'System', text: 'Sign in to chat (guests can read).', at: Date.now(), system: true });
      return;
    }
    const user = this.accounts.user(from.accountId);
    if (!user || user.banned) return;
    if (user.muted_until > Date.now()) {
      from.send({ t: 'chat', from: 'System', text: 'You are muted from chat for now.', at: Date.now(), system: true });
      return;
    }
    const now = Date.now();
    const times = (this.sent.get(from.key) ?? []).filter((t) => now - t < WINDOW * 1000);
    if (times.length >= BURST) {
      from.send({ t: 'chat', from: 'System', text: 'Slow down a little.', at: now, system: true });
      return;
    }
    times.push(now);
    this.sent.set(from.key, times);
    const clean = censor(text);
    const id = Number(this.accounts.db.prepare('INSERT INTO chat (user_id, name, text, at) VALUES (?, ?, ?, ?)').run(from.accountId, from.name, clean, now).lastInsertRowid);
    const msg: Extract<ServerMsg, { t: 'chat' }> = { t: 'chat', id, from: from.name, text: clean, at: now };
    this.recent.push(msg);
    if (this.recent.length > HISTORY) this.recent.shift();
    this.broadcast(msg);
  }
}
