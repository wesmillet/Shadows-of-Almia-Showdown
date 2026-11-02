/** Trainer looks: only the male and female Ranger are on offer; hidden picks stay saved but show as the Ranger. */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from './accounts';

describe('trainer looks', () => {
  it('both Rangers for everyone; a saved hidden look is kept and shows as the male Ranger', () => {
    const a = new Accounts(mkdtempSync(join(tmpdir(), 'looks-')), 'dev');
    const id = Number(a.db.prepare("INSERT INTO users (username, pass_hash, created_at) VALUES ('LookTester', 'x', ?)").run(Date.now()).lastInsertRowid);
    a.db.prepare('INSERT OR IGNORE INTO profiles (user_id) VALUES (?)').run(id);
    expect(a.canWear(id, 'union_00')).toBe(true);
    expect(a.canWear(id, 'union_03')).toBe(true);
    for (const hidden of ['union_01', 'union_05', 'union_09', 'civ_04', 'civ_13']) expect(a.canWear(id, hidden)).toBe(false);
    // a look saved before it was hidden
    a.db.prepare('UPDATE profiles SET look = ? WHERE user_id = ?').run(JSON.stringify('civ_04'), id);
    expect(a.profile(id).look).toBe('civ_04');
    expect(a.wornLook(id, a.profile(id).look)).toBe('union_00');
    expect(a.wornLook(id, 'union_03')).toBe('union_03');
    expect(a.wornLook(id, null)).toBe(null);
  });
});
