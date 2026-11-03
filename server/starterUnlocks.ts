/**
 * The account side of the starter achievements (src/sim/starterAchievements.ts) and the third-slot
 * nominations (src/sim/starters.ts): progress, unlocks, the choices made and the saved nominations.
 * Progress counts from what the server already keeps, so players who played before this get their
 * credit: lifetime catches and matches (profile stats), placings (match_players), and the species
 * caught in each recorded match plus the species in their PC.
 */
import type { DatabaseSync } from 'node:sqlite';
import { randomInt } from 'node:crypto';
import { STARTER_ACHIEVEMENTS, type StarterStat, type StartersInfo } from '../src/sim/starterAchievements';
import { eligibleNominations, NOMINATION_BUDGET, NOMINATION_SLOTS, nominationProblem, SLOT3_WEIGHT, STARTER_TIERS, TIER_COST, tierOf, usableNominations } from '../src/sim/starters';

export const STARTER_SQL = `
  CREATE TABLE IF NOT EXISTS starter_unlocks (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL, dex TEXT, at INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  );
  CREATE TABLE IF NOT EXISTS starter_nominations (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, dexes TEXT NOT NULL, at INTEGER NOT NULL
  );
`;

export class StarterUnlocks {
  constructor(
    private readonly db: DatabaseSync,
    /** Lifetime catches and matches (the profile's stats). */
    private readonly lifetime: (userId: number) => { catches: number; matches: number },
    private readonly pcDexes: (userId: number) => string[],
    /** Puts a reward's Pokémon in the PC; returns its PC id. */
    private readonly toPc: (userId: number, dex: string) => number,
  ) {
    // Rewards go to the PC: which unlock row's Pokémon has been delivered there.
    const cols = this.db.prepare('PRAGMA table_info(starter_unlocks)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'pc_id')) this.db.exec('ALTER TABLE starter_unlocks ADD COLUMN pc_id INTEGER');
  }

  /** Every unlocked Pokémon not yet in the PC goes there (once). */
  private deliver(userId: number): void {
    const rows = this.db.prepare('SELECT id, dex FROM starter_unlocks WHERE user_id = ? AND dex IS NOT NULL AND pc_id IS NULL').all(userId) as Array<{ id: string; dex: string }>;
    for (const r of rows) {
      const pcId = this.toPc(userId, r.dex);
      this.db.prepare('UPDATE starter_unlocks SET pc_id = ? WHERE user_id = ? AND id = ?').run(pcId, userId, r.id);
    }
  }

  progress(userId: number): Record<StarterStat, number> {
    const life = this.lifetime(userId);
    const rows = this.db.prepare('SELECT place, stats FROM match_players WHERE user_id = ?').all(userId) as Array<{ place: number; stats: string }>;
    // Species they caught: kept from a match (a win's pick or a voucher, not an Egg, gift or reward),
    // as they were caught (before going back to a first form), and every recorded match's catches.
    const kept = this.db.prepare("SELECT COALESCE(json_extract(entry, '$.evolvedFrom'), json_extract(entry, '$.dex')) AS dex FROM pc WHERE user_id = ? AND json_extract(entry, '$.via') IN ('win', 'voucher')").all(userId) as Array<{ dex: string | null }>;
    const species = new Set(kept.filter((r) => typeof r.dex === 'string').map((r) => (r.dex as string).split('-')[0] as string));
    let top3 = 0;
    for (const r of rows) {
      if (r.place >= 1 && r.place <= 3) top3++;
      try {
        for (const d of (JSON.parse(r.stats) as { species?: string[] }).species ?? []) species.add(d.split('-')[0] as string);
      } catch {
        /* an old row */
      }
    }
    return { catches: life.catches, matches: life.matches, species: species.size, top3 };
  }

  /** Unlocks every achievement newly reached (a random reward is rolled once, here). */
  update(userId: number): void {
    const p = this.progress(userId);
    const have = new Set((this.db.prepare('SELECT id FROM starter_unlocks WHERE user_id = ?').all(userId) as Array<{ id: string }>).map((r) => r.id));
    for (const a of STARTER_ACHIEVEMENTS) {
      if (have.has(a.id) || p[a.stat] < a.goal) continue;
      let dex: string | null = null;
      if (a.reward.kind === 'random') {
        const id = a.reward.tier;
        const list = STARTER_TIERS.find((t) => t.id === id)?.dex ?? [];
        dex = list.length ? (list[randomInt(0, list.length)] as string) : null;
      }
      this.db.prepare('INSERT OR IGNORE INTO starter_unlocks (user_id, id, dex, at) VALUES (?, ?, ?, ?)').run(userId, a.id, dex, Date.now());
    }
    this.deliver(userId);
  }

  private unlockRows(userId: number): Map<string, string | null> {
    return new Map((this.db.prepare('SELECT id, dex FROM starter_unlocks WHERE user_id = ?').all(userId) as Array<{ id: string; dex: string | null }>).map((r) => [r.id, r.dex]));
  }

  /** The Pokémon this account's unlocks give (choices made). */
  unlockedDexes(userId: number): string[] {
    return [...this.unlockRows(userId).values()].filter((d): d is string => !!d);
  }

  eligible(userId: number): string[] {
    return eligibleNominations(this.pcDexes(userId), this.unlockedDexes(userId));
  }

  saved(userId: number): string[] {
    const r = this.db.prepare('SELECT dexes FROM starter_nominations WHERE user_id = ?').get(userId) as { dexes: string } | undefined;
    try {
      const v = r ? (JSON.parse(r.dexes) as unknown) : [];
      return Array.isArray(v) ? v.filter((d): d is string => typeof d === 'string') : [];
    } catch {
      return [];
    }
  }

  /** The nominations a roll uses now (anything no longer owned, or over the budget, left out). */
  forRoll(userId: number): string[] {
    return usableNominations(this.saved(userId), this.eligible(userId));
  }

  info(userId: number): StartersInfo {
    this.update(userId);
    const p = this.progress(userId);
    const rows = this.unlockRows(userId);
    const eligible = this.eligible(userId);
    return {
      achievements: STARTER_ACHIEVEMENTS.map((a) => ({
        id: a.id, name: a.name, desc: a.desc, goal: a.goal, progress: Math.min(a.goal, p[a.stat]), done: rows.has(a.id), reward: a.reward, dex: rows.get(a.id) ?? null,
      })),
      eligible: eligible.map((d) => ({ dex: d, tier: tierOf(d), cost: TIER_COST[tierOf(d)] ?? 1 })),
      nominations: usableNominations(this.saved(userId), eligible),
      budget: NOMINATION_BUDGET,
      slots: NOMINATION_SLOTS,
      costs: TIER_COST,
      weights: SLOT3_WEIGHT,
    };
  }

  /** A choice reward taken (final). Returns an error, or null. */
  choose(userId: number, id: string, dex: string): string | null {
    this.update(userId);
    const a = STARTER_ACHIEVEMENTS.find((x) => x.id === id);
    if (!a || a.reward.kind !== 'choice') return 'No such reward';
    if (!a.reward.options.includes(dex)) return 'Pick one of the three';
    const r = this.db.prepare("UPDATE starter_unlocks SET dex = ? WHERE user_id = ? AND id = ? AND dex IS NULL").run(dex, userId, id);
    if (!r.changes) return this.unlockRows(userId).has(id) ? 'You already chose' : 'Not unlocked yet';
    this.deliver(userId);
    return null;
  }

  nominate(userId: number, dexes: unknown): string | null {
    if (!Array.isArray(dexes) || dexes.some((d) => typeof d !== 'string')) return 'Send a list of Pokémon';
    const list = dexes as string[];
    const problem = nominationProblem(list, this.eligible(userId));
    if (problem) return problem;
    this.db.prepare('INSERT OR REPLACE INTO starter_nominations (user_id, dexes, at) VALUES (?, ?, ?)').run(userId, JSON.stringify(list), Date.now());
    return null;
  }
}
