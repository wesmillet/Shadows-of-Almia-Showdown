/**
 * Mystery Gift: codes an administrator makes on the dashboard (/admin, Mystery Gift) that players
 * redeem on the home page for a Pokémon (straight into their PC) or a trainer look (a skin).
 *
 * A code can be used once per account; it can have a limit on how many accounts use it, an expiry
 * date, and be switched off. Redeeming, the use count and the gift itself happen as one unit, so a
 * code with one use left can not be spent twice. Wrong guesses are limited per account.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Accounts } from './accounts';
import { SPECIES, movesAt } from '../src/sim/data';
import { SpriteRegistry } from '../src/sprites/pokemonSprite';
import { isFreeLook } from '../src/net/progression';

export interface GiftCode {
  code: string;
  kind: 'pokemon' | 'look';
  /** pokemon: { dex, level, shiny }; look: { look } */
  payload: { dex?: string; level?: number; shiny?: boolean; name?: string; look?: string };
  max_uses: number | null;
  uses: number;
  expires_at: number | null;
  active: number;
  note: string | null;
  created_by: string;
  created_at: number;
}

export type GiftResult =
  | { kind: 'pokemon'; dex: string; name: string; level: number; shiny: boolean }
  | { kind: 'look'; look: string; name: string };

/** Code letters: no 0/O or 1/I, so a code read aloud or copied by hand comes out right. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-Z0-9-]{4,24}$/;
/** Wrong codes an account may try in an hour. */
const TRIES_PER_HOUR = 10;

/** A look's name as the Trainer screen shows it: "Ranger 3" (Union) or "Local 7" (townsfolk). */
export function lookLabel(look: string): string {
  const [kind, n] = look.split('_');
  return `${kind === 'union' ? 'Ranger' : 'Local'} ${Number(n) + 1}`;
}

export function normalizeCode(s: unknown): string {
  return String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

export class Gifts {
  private looks: Record<string, { name?: string }> = {};
  private misses = new Map<number, number[]>();

  constructor(private readonly acc: Accounts, assetsDir?: string) {
    acc.db.exec(`
      CREATE TABLE IF NOT EXISTS gift_codes (
        code TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER, active INTEGER NOT NULL DEFAULT 1, note TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gift_redemptions (
        code TEXT NOT NULL, user_id INTEGER NOT NULL, at INTEGER NOT NULL, pc_id INTEGER, PRIMARY KEY (code, user_id)
      );
      CREATE TABLE IF NOT EXISTS user_looks (
        user_id INTEGER NOT NULL, look TEXT NOT NULL, via TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, look)
      );
    `);
    // The looks there are (the trainer sprites' manifest), for checking a gift's look.
    try {
      const dir = assetsDir ?? join(import.meta.dirname, '..', 'assets');
      this.looks = (JSON.parse(readFileSync(join(dir, 'rangers', 'manifest.json'), 'utf8')) as { characters: Record<string, { name?: string }> }).characters;
    } catch {
      this.looks = {};
    }
  }

  /** The looks a gift can give (every trainer sprite but the free one). */
  /** The looks with their names (for the dashboard's list). */
  lookOptions(): Array<{ id: string; name: string }> {
    return this.lookIds().map((id) => ({ id, name: lookLabel(id) }));
  }

  lookIds(): string[] {
    return Object.keys(this.looks).filter((k) => !isFreeLook(k)).sort();
  }

  /** Looks this account was given (by a gift code). */
  ownedLooks(userId: number): string[] {
    return (this.acc.db.prepare('SELECT look FROM user_looks WHERE user_id = ? ORDER BY at').all(userId) as Array<{ look: string }>).map((r) => r.look);
  }

  // ---------------------------------------------------------------- the dashboard

  list(): Array<GiftCode & { redeemed: number }> {
    const rows = this.acc.db.prepare('SELECT * FROM gift_codes ORDER BY created_at DESC').all() as Array<Omit<GiftCode, 'payload'> & { payload: string }>;
    return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) as GiftCode['payload'], redeemed: r.uses }));
  }

  /** Who used a code, newest first. */
  redemptions(code: string): Array<{ username: string; at: number }> {
    return this.acc.db.prepare('SELECT u.username, g.at FROM gift_redemptions g JOIN users u ON u.id = g.user_id WHERE g.code = ? ORDER BY g.at DESC LIMIT 200').all(normalizeCode(code)) as Array<{ username: string; at: number }>;
  }

  create(by: string, b: Record<string, unknown>): { code: string } | { error: string } {
    let code = normalizeCode(b.code);
    if (!code) code = `GIFT-${this.randomPart()}`;
    if (!CODE_RE.test(code)) return { error: 'A code is 4 to 24 letters, numbers or dashes' };
    if (this.acc.db.prepare('SELECT 1 FROM gift_codes WHERE code = ?').get(code)) return { error: 'That code already exists' };
    const kind = b.kind === 'look' ? 'look' : b.kind === 'pokemon' ? 'pokemon' : null;
    if (!kind) return { error: 'Pick what the code gives: a Pokémon or a look' };
    let payload: GiftCode['payload'];
    if (kind === 'pokemon') {
      const dex = this.dexOf(b.dex);
      if (!dex) return { error: 'No such Pokémon (use its number, like 25 or 0025, or its name)' };
      const level = Math.round(Number(b.level ?? 5));
      if (!(level >= 1 && level <= 100)) return { error: 'Level 1 to 100' };
      const shiny = b.shiny === true;
      if (shiny && !SpriteRegistry.hasShiny(dex)) return { error: `${SPECIES.get(dex)?.name} has no shiny colours in the game` };
      payload = { dex, level, shiny, name: SPECIES.get(dex)?.name };
    } else {
      const look = String(b.look ?? '');
      if (!this.lookIds().includes(look)) return { error: 'No such look' };
      payload = { look };
    }
    const max = b.maxUses === null || b.maxUses === undefined || b.maxUses === '' ? null : Math.round(Number(b.maxUses));
    if (max !== null && !(max >= 1)) return { error: 'Uses: 1 or more, or empty for no limit' };
    const exp = b.expiresAt === null || b.expiresAt === undefined || b.expiresAt === '' ? null : Number(b.expiresAt);
    if (exp !== null && !(exp > Date.now())) return { error: 'The expiry must be in the future' };
    const note = typeof b.note === 'string' ? b.note.slice(0, 200) : null;
    this.acc.db.prepare('INSERT INTO gift_codes (code, kind, payload, max_uses, expires_at, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(code, kind, JSON.stringify(payload), max, exp, note, by, Date.now());
    return { code };
  }

  setActive(code: string, active: boolean): boolean {
    return Number(this.acc.db.prepare('UPDATE gift_codes SET active = ? WHERE code = ?').run(active ? 1 : 0, normalizeCode(code)).changes) === 1;
  }

  // ---------------------------------------------------------------- players

  redeem(userId: number, raw: unknown, now = Date.now()): GiftResult | { error: string } {
    const recent = (this.misses.get(userId) ?? []).filter((t) => now - t < 3600_000);
    this.misses.set(userId, recent);
    if (recent.length >= TRIES_PER_HOUR) return { error: 'Too many wrong codes. Try again in a while' };
    const miss = (error: string) => {
      recent.push(now);
      return { error };
    };
    const code = normalizeCode(raw);
    const row = CODE_RE.test(code) ? (this.acc.db.prepare('SELECT * FROM gift_codes WHERE code = ?').get(code) as (Omit<GiftCode, 'payload'> & { payload: string }) | undefined) : undefined;
    if (!row) return miss('That code is not valid');
    if (!row.active) return { error: 'That code is no longer active' };
    if (row.expires_at !== null && row.expires_at <= now) return { error: 'That code has expired' };
    if (this.acc.db.prepare('SELECT 1 FROM gift_redemptions WHERE code = ? AND user_id = ?').get(code, userId)) return { error: 'You already used this code' };
    if (row.max_uses !== null && row.uses >= row.max_uses) return { error: 'That code has been used up' };
    const p = JSON.parse(row.payload) as GiftCode['payload'];
    if (row.kind === 'look' && p.look && this.ownedLooks(userId).includes(p.look)) return { error: 'You already have that look' };
    try {
      return this.acc.unit(() => {
        // Counted only while uses remain (two players on the last use: one gets it).
        const took = this.acc.db.prepare('UPDATE gift_codes SET uses = uses + 1 WHERE code = ? AND (max_uses IS NULL OR uses < max_uses)').run(code);
        if (Number(took.changes) !== 1) throw new Error('used up');
        this.acc.db.prepare('INSERT INTO gift_redemptions (code, user_id, at) VALUES (?, ?, ?)').run(code, userId, now);
        if (row.kind === 'pokemon') {
          const dex = p.dex as string;
          const sp = SPECIES.get(dex);
          if (!sp) throw new Error('no species');
          const level = p.level ?? 5;
          const pcId = this.acc.addToPc(userId, { dex, name: sp.name, level, shiny: !!p.shiny, moves: movesAt(sp, level) }, 'gift', `gift:${code}`);
          this.acc.db.prepare('UPDATE gift_redemptions SET pc_id = ? WHERE code = ? AND user_id = ?').run(pcId, code, userId);
          return { kind: 'pokemon' as const, dex, name: sp.name, level, shiny: !!p.shiny };
        }
        const look = p.look as string;
        this.acc.db.prepare('INSERT OR IGNORE INTO user_looks (user_id, look, via, at) VALUES (?, ?, ?, ?)').run(userId, look, `gift:${code}`, now);
        this.acc.logCollection(userId, 'add:look', { ref: `gift:${code}`, detail: { look } });
        return { kind: 'look' as const, look, name: lookLabel(look) };
      });
    } catch (e) {
      return { error: String((e as Error).message) === 'used up' ? 'That code has been used up' : 'That code could not be used right now' };
    }
  }

  private randomPart(): string {
    const b = randomBytes(8);
    let s = '';
    for (let i = 0; i < 8; i++) s += ALPHABET[(b[i] as number) % ALPHABET.length];
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  }

  /** A species from its number (25, 0025) or its name (Pikachu). */
  private dexOf(v: unknown): string | null {
    const s = String(v ?? '').trim();
    if (!s) return null;
    if (/^\d{1,4}$/.test(s)) {
      const d = s.padStart(4, '0');
      return SPECIES.has(d) ? d : null;
    }
    if (SPECIES.has(s)) return s;
    const lower = s.toLowerCase();
    for (const [dex, sp] of SPECIES) if (sp.name.toLowerCase() === lower) return dex;
    return null;
  }
}
