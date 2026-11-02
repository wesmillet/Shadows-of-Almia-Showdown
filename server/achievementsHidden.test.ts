/** Achievements are hidden for now (ACHIEVEMENTS_ON): kept and still recorded on the server, shown nowhere. */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from './accounts';
import { profilePage } from './profilePage';
import { ACHIEVEMENTS_ON } from '../src/net/progression';

describe('hidden achievements', () => {
  it('are recorded and kept, but not in the profile or its page', () => {
    expect(ACHIEVEMENTS_ON).toBe(false);
    const a = new Accounts(mkdtempSync(join(tmpdir(), 'ach-')), 'dev');
    const id = Number(a.db.prepare("INSERT INTO users (username, pass_hash, created_at) VALUES ('AchTester', 'x', ?)").run(Date.now()).lastInsertRowid);
    a.db.prepare('INSERT OR IGNORE INTO profiles (user_id) VALUES (?)').run(id);
    a.db.prepare('INSERT INTO achievements (user_id, id, at) VALUES (?, ?, ?)').run(id, 'first_win', Date.now());
    // the server still checks and keeps them
    a.checkAchievements(id, null);
    expect(a.earned(id)).toContain('first_win');
    const user = a.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as Parameters<Accounts['publicProfile']>[0];
    const p = a.publicProfile(user);
    expect(p.achievements).toEqual([]);
    const html = profilePage(p, join(import.meta.dirname, '..', 'assets'));
    expect(html).not.toContain('Achievements');
    expect(html).not.toContain('Last One Standing');
  });
});
