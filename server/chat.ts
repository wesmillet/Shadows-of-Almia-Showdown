/**
 * Global chat: one room for everyone connected. Messages are length-capped, rate-limited per
 * player, run through the word filter, and kept (the last 50 are shown to anyone who joins).
 * Guests can read; only signed-in players can talk (it makes bans and reports stick). A muted
 * account (muted_until in the future) can read but not talk.
 *
 * Strikes: a filtered word, flooding, or saying the same thing again earns one. STRIKES within
 * STRIKE_WINDOW mutes automatically, longer each time (AUTO_MUTES minutes); the second automatic
 * mute in a week also reports the player to the moderators. Shouting is quietly lower-cased.
 */
import type { ServerMsg } from '../src/net/protocol';
import type { Accounts } from './accounts';
import { censor } from './moderation';

const MAX_LEN = 200;
/** A player may send this many messages per WINDOW seconds. */
const BURST = 5;
const WINDOW = 10;
const HISTORY = 50;
const STRIKES = 3;
const STRIKE_WINDOW = 10 * 60_000;
/** Minutes for the first, second and later automatic mutes in a week. */
const AUTO_MUTES = [10, 60, 24 * 60];

interface Speaker {
  key: string;
  name: string;
  accountId: number | null;
  send(msg: ServerMsg): void;
}

export class Chat {
  private recent: Array<Extract<ServerMsg, { t: 'chat' }>> = [];
  private sent = new Map<string, number[]>();
  private lastSaid = new Map<string, Array<{ text: string; at: number }>>();
  private strikes = new Map<number, number[]>();
  /** Last time a player was told to slow down (a flood counts once per window). */
  private slowed = new Map<string, number>();

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
    const sys = (t: string) => from.send({ t: 'chat', from: 'System', text: t, at: now, system: true });
    const times = (this.sent.get(from.key) ?? []).filter((t) => now - t < WINDOW * 1000);
    if (times.length >= BURST) {
      if (now - (this.slowed.get(from.key) ?? 0) > WINDOW * 1000) {
        this.slowed.set(from.key, now);
        this.strike(from, 'flooding the chat');
      }
      sys('Slow down a little.');
      return;
    }
    // The same thing again within half a minute: not sent, and a strike.
    const norm = text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const mine = (this.lastSaid.get(from.key) ?? []).filter((x) => now - x.at < 30_000);
    if (norm && mine.some((x) => x.text === norm)) {
      this.strike(from, 'repeating messages');
      sys('You just said that.');
      return;
    }
    mine.push({ text: norm, at: now });
    this.lastSaid.set(from.key, mine.slice(-3));
    times.push(now);
    this.sent.set(from.key, times);
    // SHOUTING is lower-cased.
    const letters = text.replace(/[^A-Za-z]/g, '');
    const calm = letters.length >= 12 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7 ? text.toLowerCase() : text;
    const clean = censor(calm);
    if (clean !== calm) this.strike(from, 'language');
    // That strike may just have muted them.
    if ((this.accounts.user(from.accountId)?.muted_until ?? 0) > Date.now()) return;
    const id = Number(this.accounts.db.prepare('INSERT INTO chat (user_id, name, text, at) VALUES (?, ?, ?, ?)').run(from.accountId, from.name, clean, now).lastInsertRowid);
    const msg: Extract<ServerMsg, { t: 'chat' }> = { t: 'chat', id, from: from.name, text: clean, at: now, mod: user.role === 'mod' || user.role === 'admin' || undefined };
    this.recent.push(msg);
    if (this.recent.length > HISTORY) this.recent.shift();
    this.broadcast(msg);
  }

  /** One strike; enough of them close together mute the player for a while. */
  private strike(from: Speaker, why: string): void {
    const id = from.accountId;
    if (id === null) return;
    const now = Date.now();
    const list = (this.strikes.get(id) ?? []).filter((t) => now - t < STRIKE_WINDOW);
    list.push(now);
    this.strikes.set(id, list);
    if (list.length < STRIKES) return;
    this.strikes.set(id, []);
    const before = (this.accounts.db.prepare("SELECT COUNT(*) AS n FROM mod_actions WHERE action = 'auto-mute' AND target = ? AND at > ?").get(from.name, now - 7 * 86400_000) as { n: number }).n;
    const minutes = AUTO_MUTES[Math.min(before, AUTO_MUTES.length - 1)] as number;
    this.accounts.mute(id, minutes);
    this.accounts.logMod({ id: null, name: 'System' }, 'auto-mute', from.name, `${minutes} min for ${why}`);
    if (before >= 1) this.accounts.autoReport(from.name, `Automatic: muted ${before + 1} times this week (last for ${why})`);
    from.send({ t: 'chat', from: 'System', text: `You are muted from chat for ${minutes >= 60 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} minutes`} (${why}).`, at: now, system: true });
  }

  /** A moderator removes a message: gone from the history and from every open chat. */
  remove(id: number): void {
    this.accounts.db.prepare("UPDATE chat SET text = '[removed]' WHERE id = ?").run(id);
    this.recent = this.recent.filter((m) => m.id !== id);
    this.broadcast({ t: 'chatDelete', id });
  }

  /** A message from the server to everyone (an announcement). */
  announce(text: string): void {
    const now = Date.now();
    const id = Number(this.accounts.db.prepare('INSERT INTO chat (user_id, name, text, at) VALUES (NULL, ?, ?, ?)').run('Announcement', text, now).lastInsertRowid);
    const msg: Extract<ServerMsg, { t: 'chat' }> = { t: 'chat', id, from: 'Announcement', text, at: now, system: true, announce: true };
    this.recent.push(msg);
    if (this.recent.length > HISTORY) this.recent.shift();
    this.broadcast(msg);
  }
}
