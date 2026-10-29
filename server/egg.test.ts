/** The daily Egg: one a UTC day, into the PC, rolled by the starter tiers' weights. */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from './accounts';
import { rollEgg, STARTER_TIERS, starterChoices, BASE_TIERS } from '../src/sim/starters';
import { Rng } from '../src/core/rng';

describe('daily Egg', () => {
  it('hatches once a day into the PC', () => {
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
    expect(a.pcDexes(id)).toEqual([r.dex]);
    expect(STARTER_TIERS.find((t) => t.id === r.tier)?.dex).toContain(r.dex);
    expect(r.tier).toBe(before.tier);
    // the same day: no second Egg
    const again = a.hatchEgg(id, t0 + 3600_000);
    expect('error' in again).toBe(true);
    expect(a.pcDexes(id)).toHaveLength(1);
    expect(a.eggState(id, t0).nextAt).toBe(Date.UTC(2026, 9, 30));
    // the next UTC day: another
    expect('error' in a.hatchEgg(id, Date.UTC(2026, 9, 30, 0, 5))).toBe(false);
    expect(a.pcDexes(id)).toHaveLength(2);
    const pc = a.db.prepare('SELECT entry FROM pc WHERE user_id = ?').all(id) as Array<{ entry: string }>;
    expect(pc.map((p) => JSON.parse(p.entry).via)).toEqual(['egg', 'egg']);
    expect(JSON.parse(pc[0]!.entry).level).toBe(5);
  });

  it('rolls the tiers by their weights', () => {
    const rng = new Rng(11);
    const n = 20000;
    const count = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const t = rollEgg(rng).tier.id;
      count.set(t, (count.get(t) ?? 0) + 1);
    }
    const total = STARTER_TIERS.reduce((s, t) => s + t.weight, 0);
    for (const t of STARTER_TIERS) expect(Math.abs((count.get(t.id) ?? 0) / n - t.weight / total)).toBeLessThan(0.015);
  });

  it('a new account starts from Common only', () => {
    expect(BASE_TIERS).toEqual(['common']);
    const common = STARTER_TIERS.find((t) => t.id === 'common')!.dex;
    for (let s = 1; s < 200; s++) for (const d of starterChoices(s, [])) expect(common).toContain(d);
  });
});
