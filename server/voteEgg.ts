/**
 * The Vote Egg: a bonus Egg, on top of the daily one, for voting for the game on VibeTopList.
 *
 * The home page's Vote Egg card opens https://vibetoplist.com/vote/<VTL_SLUG>?ref=<username>. After
 * each vote VibeTopList calls /api/vote-callback (both a POST and a GET) with:
 *   secret   our callback secret (VTL_SECRET), checked before anything else
 *   voted    1 for a vote that counted, 0 for one rejected after validation
 *   userid   the ref the link carried: the voter's username
 *   vote_id  VibeTopList's id for the vote (the same on the POST and the GET, and on any retry)
 * A counted vote from a known, unbanned account gives one Vote Egg a UTC day, rolled like the daily
 * Egg (tier by the starter tiers' weights, shiny at the wild odds). Each vote_id is acted on once, so
 * the POST, the GET and retries never give two. An Egg not hatched the day it was earned waits.
 * VibeTopList lets an IP vote every 12 hours; the day limit keeps it to one Egg a day either way.
 *
 * Without VTL_SECRET the callback refuses every request; without VTL_SLUG the card stays hidden.
 * The secret arrives in the query string on the GET: it is never logged.
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { Accounts } from './accounts';
import { CONFIG, SPECIES, movesAt } from '../src/sim/data';
import { rollEgg, STARTER_TIERS } from '../src/sim/starters';
import { Rng } from '../src/core/rng';
import { SpriteRegistry } from '../src/sprites/pokemonSprite';

export const VOTE_EGG_SQL = `
  CREATE TABLE IF NOT EXISTS vote_eggs (
    user_id INTEGER NOT NULL, day TEXT NOT NULL, dex TEXT NOT NULL, shiny INTEGER NOT NULL, tier TEXT NOT NULL,
    vote_id TEXT, pc_id INTEGER, hatched_at INTEGER, at INTEGER NOT NULL,
    PRIMARY KEY (user_id, day)
  );
  CREATE TABLE IF NOT EXISTS vote_log (
    vote_id TEXT PRIMARY KEY, username TEXT, user_id INTEGER, voted INTEGER NOT NULL, outcome TEXT NOT NULL, at INTEGER NOT NULL
  );
`;

export type VoteOutcome = 'egg' | 'already-today' | 'not-counted' | 'unknown-user' | 'duplicate';

export interface VoteEggState {
  /** Voting is set up on this server (a slug and a secret). */
  on: boolean;
  /** The vote page for this player (null when voting is not set up). */
  voteUrl: string | null;
  /** A Vote Egg is waiting to hatch. */
  ready: boolean;
  tier: string | null;
  tierName: string | null;
  color: string | null;
  /** This UTC day's Vote Egg has been earned (hatched or not). */
  votedToday: boolean;
  /** When the next one can be earned: the next UTC midnight. */
  nextAt: number;
  now: number;
  /** What hatched from today's Vote Egg, once it has. */
  today: { dex: string; name: string; shiny: boolean } | null;
}

type Row = { day: string; dex: string; shiny: number; tier: string; pc_id: number | null; hatched_at: number | null };

/** The UTC date of a moment, the key of that day's Vote Egg. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function nextUtcMidnight(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

function sameSecret(a: string, b: string): boolean {
  const h = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(a), h(b));
}

export class VoteEggs {
  constructor(
    private readonly acc: Accounts,
    private readonly secret: string | null = process.env.VTL_SECRET || null,
    private readonly slug: string | null = process.env.VTL_SLUG || null,
  ) {
    acc.db.exec(VOTE_EGG_SQL);
  }

  get on(): boolean {
    return !!this.secret && !!this.slug;
  }

  voteUrl(username: string): string | null {
    if (!this.on) return null;
    return `https://vibetoplist.com/vote/${encodeURIComponent(this.slug as string)}?ref=${encodeURIComponent(username)}`;
  }

  /**
   * One callback from VibeTopList (query and body merged). `status` is the HTTP answer: 403 for a
   * wrong or missing secret, 503 when this server has no secret, 400 for a request without a vote id,
   * otherwise 200 (any 2xx tells VibeTopList it arrived; it does not read the body).
   */
  record(p: Record<string, unknown>, now = Date.now()): { status: number; outcome?: VoteOutcome } {
    if (!this.secret) return { status: 503 };
    const secret = typeof p.secret === 'string' ? p.secret : '';
    if (!secret || !sameSecret(secret, this.secret)) return { status: 403 };
    const voteId = String(p.vote_id ?? '').trim().slice(0, 120);
    if (!voteId) return { status: 400 };
    const username = String(p.userid ?? '').trim().slice(0, 40);
    const voted = String(p.voted ?? '') === '1';
    const db = this.acc.db;
    const outcome = this.acc.unit((): VoteOutcome => {
      const fresh = db.prepare('INSERT OR IGNORE INTO vote_log (vote_id, username, voted, outcome, at) VALUES (?, ?, ?, ?, ?)').run(voteId, username, voted ? 1 : 0, 'pending', now);
      if (Number(fresh.changes) !== 1) return 'duplicate';
      const done = (o: VoteOutcome, userId: number | null = null): VoteOutcome => {
        db.prepare('UPDATE vote_log SET outcome = ?, user_id = ? WHERE vote_id = ?').run(o, userId, voteId);
        return o;
      };
      if (!voted) return done('not-counted');
      const u = username ? (db.prepare('SELECT id, banned FROM users WHERE username = ? COLLATE NOCASE').get(username) as { id: number; banned: number } | undefined) : undefined;
      if (!u || u.banned) return done('unknown-user');
      const rng = new Rng(randomInt(1, 2 ** 31));
      const { tier, dex } = rollEgg(rng);
      const shiny = SpriteRegistry.hasShiny(dex) && rng.chance(CONFIG.wild.shinyChance);
      const r = db.prepare('INSERT OR IGNORE INTO vote_eggs (user_id, day, dex, shiny, tier, vote_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(u.id, utcDay(now), dex, shiny ? 1 : 0, tier.id, voteId, now);
      return done(Number(r.changes) === 1 ? 'egg' : 'already-today', u.id);
    });
    return { status: 200, outcome };
  }

  /** The oldest Vote Egg still waiting to hatch. */
  private waiting(userId: number): Row | undefined {
    return this.acc.db.prepare('SELECT day, dex, shiny, tier, pc_id, hatched_at FROM vote_eggs WHERE user_id = ? AND pc_id IS NULL ORDER BY day LIMIT 1').get(userId) as Row | undefined;
  }

  state(userId: number, username: string, now = Date.now()): VoteEggState {
    const egg = this.waiting(userId);
    const today = this.acc.db.prepare('SELECT day, dex, shiny, tier, pc_id, hatched_at FROM vote_eggs WHERE user_id = ? AND day = ?').get(userId, utcDay(now)) as Row | undefined;
    const t = egg ? STARTER_TIERS.find((x) => x.id === egg.tier) : undefined;
    return {
      on: this.on, voteUrl: this.voteUrl(username), ready: !!egg,
      tier: egg?.tier ?? null, tierName: egg ? (t?.name ?? egg.tier) : null, color: egg ? (t?.color ?? '#b8b8c8') : null,
      votedToday: !!today, nextAt: nextUtcMidnight(now), now,
      today: today && today.pc_id !== null ? { dex: today.dex, name: SPECIES.get(today.dex)?.name ?? today.dex, shiny: !!today.shiny } : null,
    };
  }

  /**
   * Hatches the oldest waiting Vote Egg into the PC (level 5), marked hatched in the same unit as the
   * PC insert and only if it was not already, so two requests at once give one Pokémon.
   */
  hatch(userId: number, now = Date.now()): { dex: string; name: string; shiny: boolean; tier: string; tierName: string; color: string; pcId: number; nextAt: number; now: number } | { error: string } {
    const egg = this.waiting(userId);
    if (!egg) return { error: 'No Vote Egg to hatch. Vote for the game to earn one each day' };
    // One of each legendary: one they already own hatches as another.
    const dex = this.acc.eggDex(userId, egg.dex, egg.tier);
    if (dex !== egg.dex) {
      this.acc.db.prepare('UPDATE vote_eggs SET dex = ? WHERE user_id = ? AND day = ? AND pc_id IS NULL').run(dex, userId, egg.day);
      egg.dex = dex;
    }
    const sp = SPECIES.get(egg.dex);
    if (!sp) return { error: 'The Egg would not hatch, try again' };
    const t = STARTER_TIERS.find((x) => x.id === egg.tier);
    try {
      const pcId = this.acc.unit(() => {
        const id = this.acc.addToPc(userId, { dex: egg.dex, name: sp.name, level: 5, shiny: !!egg.shiny, moves: movesAt(sp, 5) }, 'vote', `vote-egg:${egg.day}`);
        const r = this.acc.db.prepare('UPDATE vote_eggs SET pc_id = ?, hatched_at = ? WHERE user_id = ? AND day = ? AND pc_id IS NULL').run(id, now, userId, egg.day);
        if (Number(r.changes) !== 1) throw new Error('already hatched');
        return id;
      });
      return { dex: egg.dex, name: sp.name, shiny: !!egg.shiny, tier: egg.tier, tierName: t?.name ?? egg.tier, color: t?.color ?? '#b8b8c8', pcId, nextAt: nextUtcMidnight(now), now };
    } catch {
      return { error: 'That Egg has already hatched' };
    }
  }
}
