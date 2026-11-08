/** One PC Pokémon a day can be picked as a fourth starter choice. */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from './accounts';
import { starterDay } from '../src/sim/starterAchievements';

function account(): { acc: Accounts; uid: number } {
  const acc = new Accounts(mkdtempSync(join(tmpdir(), 'almia-daily-')), 'live');
  const uid = Number(acc.db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)').run('Picker', 'x', Date.now()).lastInsertRowid);
  acc.db.prepare('INSERT INTO profiles (user_id) VALUES (?)').run(uid);
  return { acc, uid };
}

describe('daily starter pick', () => {
  it('takes one PC Pokémon a day, only your own, and resets at midnight UTC', () => {
    const { acc, uid } = account();
    const a = acc.addToPc(uid, { dex: '0060-rad', name: 'Poliwag', level: 5, moves: [] }, 'gift', 'test');
    const b = acc.addToPc(uid, { dex: '0004', name: 'Charmander', level: 5, moves: [] }, 'gift', 'test');
    const other = Number(acc.db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)').run('Other', 'x', Date.now()).lastInsertRowid);
    expect(acc.starters.daily(uid)).toBeNull();
    expect(acc.starters.pickDaily(uid, 999999)).toMatch('not in your PC');
    expect(acc.starters.pickDaily(other, a)).toMatch('not in your PC');
    const now = Date.UTC(2026, 10, 8, 15);
    expect(acc.starters.pickDaily(uid, a, now)).toBeNull();
    expect(acc.starters.daily(uid, now)?.dex).toBe('0060-rad');
    // Once a day.
    expect(acc.starters.pickDaily(uid, b, now)).toMatch('already picked');
    // The next day it can change.
    const tomorrow = starterDay(now).resetAt + 1000;
    expect(acc.starters.daily(uid, tomorrow)).toBeNull();
    expect(acc.starters.pickDaily(uid, b, tomorrow)).toBeNull();
    expect(acc.starters.daily(uid, tomorrow)?.dex).toBe('0004');
  });
});
