/** The daily Egg: ready again 24 hours after it hatched, into the PC, rolled by the starter tiers' weights. */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts, EGG_RECHARGE_MS } from './accounts';
import { rollEgg, STARTER_TIERS, starterChoices, BASE_TIERS } from '../src/sim/starters';
import { Rng } from '../src/core/rng';

describe('daily Egg', () => {
  it('hatches into the PC, then is ready again 24 hours after the hatch', () => {
    const a = new Accounts(mkdtempSync(join(tmpdir(), 'egg-')), 'dev');
    const id = Number(a.db.prepare("INSERT INTO users (username, pass_hash, created_at) VALUES ('EggTester', 'x', ?)").run(Date.now()).lastInsertRowid);
    const t0 = Date.UTC(2026, 9, 29, 15, 0);
    const before = a.eggState(id, t0);
    expect(before.ready).toBe(true);
    // the Egg is rolled when first asked about: its tier shows before it hatches, the Pokémon does not
    expect(before.today).toBe(null);
    expect(a.eggState(id, t0 + 1000).tier).toBe(before.tier);
    const r = a.hatchEgg(id, t0);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.nextAt).toBe(t0 + EGG_RECHARGE_MS);
    expect(a.pcDexes(id)).toEqual([r.dex]);
    expect(STARTER_TIERS.find((t) => t.id === r.tier)?.dex).toContain(r.dex);
    expect(r.tier).toBe(before.tier);
    // an hour later, and past midnight UTC: no second Egg
    const again = a.hatchEgg(id, t0 + 3600_000);
    expect('error' in again).toBe(true);
    expect(a.hatchEgg(id, Date.UTC(2026, 9, 30, 0, 5))).toMatchObject({ nextAt: t0 + EGG_RECHARGE_MS });
    expect(a.pcDexes(id)).toHaveLength(1);
    const waiting = a.eggState(id, t0 + EGG_RECHARGE_MS - 1);
    expect(waiting.ready).toBe(false);
    expect(waiting.nextAt).toBe(t0 + EGG_RECHARGE_MS);
    expect(waiting.today?.dex).toBe(r.dex);
    // exactly 24 hours after the hatch: another
    expect(a.eggState(id, t0 + EGG_RECHARGE_MS).ready).toBe(true);
    const t1 = t0 + EGG_RECHARGE_MS + 5 * 3600_000;
    expect('error' in a.hatchEgg(id, t1)).toBe(false);
    expect(a.pcDexes(id)).toHaveLength(2);
    // the clock starts again from that hatch
    expect(a.eggState(id, t1 + 1000).nextAt).toBe(t1 + EGG_RECHARGE_MS);
    const pc = a.db.prepare('SELECT entry FROM pc WHERE user_id = ?').all(id) as Array<{ entry: string }>;
    expect(pc.map((p) => JSON.parse(p.entry).via)).toEqual(['egg', 'egg']);
    expect(JSON.parse(pc[0]!.entry).level).toBe(5);
  });

  it('keeps Eggs from the once-a-day rule: older than 24 hours is ready, newer waits out the 24 hours', () => {
    const dir = mkdtempSync(join(tmpdir(), 'egg-'));
    const a = new Accounts(dir, 'dev');
    const mk = (n: string) => Number(a.db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)').run(n, 'x', Date.now()).lastInsertRowid);
    const old = mk('OldEgg');
    const recent = mk('RecentEgg');
    const unhatched = mk('WaitingEgg');
    const hatchedAt = Date.UTC(2026, 10, 1, 9, 0);
    // rows as the old code wrote them: keyed by UTC day, no hatched_at
    const put = (u: number, day: string, at: number, pcAt: number | null) => {
      const pc = pcAt === null ? null : Number(a.db.prepare('INSERT INTO pc (user_id, entry, created_at) VALUES (?, ?, ?)').run(u, JSON.stringify({ dex: '0001', via: 'egg' }), pcAt).lastInsertRowid);
      a.db.prepare('INSERT INTO daily_eggs (user_id, day, dex, shiny, tier, at, pc_id) VALUES (?, ?, ?, 0, ?, ?, ?)').run(u, day, '0001', 'common', at, pc);
    };
    put(old, '2026-10-30', Date.UTC(2026, 9, 30, 8), Date.UTC(2026, 9, 30, 8, 1));
    put(recent, '2026-11-01', hatchedAt - 60_000, hatchedAt);
    put(unhatched, '2026-11-01', hatchedAt, null);
    a.db.exec('UPDATE daily_eggs SET hatched_at = NULL');
    // reopening the database fills hatched_at from the PC entries
    const b = new Accounts(dir, 'dev');
    const now = Date.UTC(2026, 10, 2, 7, 0);
    expect(b.eggState(old, now).ready).toBe(true);
    const r = b.eggState(recent, now);
    expect(r.ready).toBe(false);
    expect(r.nextAt).toBe(hatchedAt + EGG_RECHARGE_MS);
    expect(b.eggState(recent, hatchedAt + EGG_RECHARGE_MS).ready).toBe(true);
    // an Egg rolled under the old rule and never hatched is still there to hatch
    const w = b.eggState(unhatched, now);
    expect(w.ready).toBe(true);
    expect(w.tier).toBe('common');
    // nothing was deleted: the three old rows stay, beside the two new Eggs rolled above
    expect((b.db.prepare("SELECT COUNT(*) AS n FROM daily_eggs WHERE day IN ('2026-10-30', '2026-11-01')").get() as { n: number }).n).toBe(3);
    expect((b.db.prepare('SELECT COUNT(*) AS n FROM daily_eggs').get() as { n: number }).n).toBe(5);
  });

  it('rolls the tiers by their weights', () => {
    const rng = new Rng(11);
    const n = 20000;
    const count = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const t = rollEgg(rng).tier.id;
      count.set(t, (count.get(t) ?? 0) + 1);
    }
    // Uncommon or better: never a Common, the rest by their weights.
    const tiers = STARTER_TIERS.filter((t) => t.id !== 'common');
    const total = tiers.reduce((s, t) => s + t.weight, 0);
    expect(count.get('common') ?? 0).toBe(0);
    for (const t of tiers) expect(Math.abs((count.get(t.id) ?? 0) / n - t.weight / total)).toBeLessThan(0.015);
  });

  it('a new account starts from Common only', () => {
    expect(BASE_TIERS).toEqual(['common']);
    const common = STARTER_TIERS.find((t) => t.id === 'common')!.dex;
    for (let s = 1; s < 200; s++) for (const d of starterChoices(s, [])) expect(common).toContain(d);
  });
});
