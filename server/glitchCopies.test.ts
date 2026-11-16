/** The one-time cleanup of the PC-starter glitch copies: only the listed, unchanged shiny entries of that one player go. */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from './accounts';

describe('glitch copies cleanup', () => {
  it('removes listed shiny copies once, logged; skips changed, traded or other players’ entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'glitch-'));
    let a = new Accounts(dir, 'dev');
    const user = (name: string) => Number(a.db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)').run(name, 'x', Date.now()).lastInsertRowid);
    const off = user('Offdwight');
    const other = user('SomeoneElse');
    const put = (id: number, owner: number, dex: string, shiny: boolean) =>
      a.db.prepare('INSERT INTO pc (id, user_id, entry, created_at) VALUES (?, ?, ?, ?)').run(id, owner, JSON.stringify({ dex, name: dex, level: 50, shiny: shiny || undefined, moves: [] }), Date.now());
    put(2650, off, '0007', true); // listed, unchanged: removed
    put(2672, off, '0007', false); // listed but not shiny any more: kept
    put(2488, other, '0246', true); // listed id, but someone else has it now (traded): kept
    put(1932, off, '0007', true); // the original, not listed: kept
    a.db.prepare("DELETE FROM meta WHERE key = 'glitch_copies_offdwight_v1'").run();
    a = new Accounts(dir, 'dev');
    const ids = (a.db.prepare('SELECT id FROM pc ORDER BY id').all() as Array<{ id: number }>).map((r) => r.id);
    expect(ids).toEqual([1932, 2488, 2672]);
    const log = a.db.prepare("SELECT pc_id FROM collection_log WHERE action = 'remove:glitch-copy'").all() as Array<{ pc_id: number }>;
    expect(log.map((r) => r.pc_id)).toEqual([2650]);
    // Runs once: a new copy under a listed id is not touched again.
    put(2676, off, '0007', true);
    a = new Accounts(dir, 'dev');
    expect((a.db.prepare('SELECT COUNT(*) AS n FROM pc WHERE id = 2676').get() as { n: number }).n).toBe(1);
  });
});

describe('glitch copies sweep', () => {
  it('removes the swept players’ listed copies, case-insensitive names, once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'glitch2-'));
    let a = new Accounts(dir, 'dev');
    const user = (name: string) => Number(a.db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)').run(name, 'x', Date.now()).lastInsertRowid);
    const q = user('Qzarny');
    const put = (id: number, owner: number, dex: string) =>
      a.db.prepare('INSERT INTO pc (id, user_id, entry, created_at) VALUES (?, ?, ?, ?)').run(id, owner, JSON.stringify({ dex, name: dex, level: 50, shiny: true, moves: [] }), Date.now());
    put(2172, q, '0004');
    put(2442, q, '0215');
    put(9999, q, '0004');
    a.db.prepare("DELETE FROM meta WHERE key = 'glitch_copies_sweep_v1'").run();
    a = new Accounts(dir, 'dev');
    const ids = (a.db.prepare('SELECT id FROM pc ORDER BY id').all() as Array<{ id: number }>).map((r) => r.id);
    expect(ids).toEqual([9999]);
  });
});

describe('release dupes cleanup', () => {
  it('removes the listed shiny copies at the listed level only, once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'glitch3-'));
    let a = new Accounts(dir, 'dev');
    const user = (name: string) => Number(a.db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)').run(name, 'x', Date.now()).lastInsertRowid);
    const c = user('Clein');
    const put = (id: number, dex: string, level: number) =>
      a.db.prepare('INSERT INTO pc (id, user_id, entry, created_at) VALUES (?, ?, ?, ?)').run(id, c, JSON.stringify({ dex, name: dex, level, shiny: dex === '0633' || undefined, moves: [] }), Date.now());
    put(3338, '0633', 81); // the original: kept
    put(4052, '0633', 81); // listed copy: removed
    put(4294, '0249', 60); // a non-shiny repeat, not listed: kept
    a.db.prepare("DELETE FROM meta WHERE key = 'release_dupes_shiny_v1'").run();
    a = new Accounts(dir, 'dev');
    const ids = (a.db.prepare('SELECT id FROM pc ORDER BY id').all() as Array<{ id: number }>).map((r) => r.id);
    expect(ids).toEqual([3338, 4294]);
    const log = a.db.prepare("SELECT ref FROM collection_log WHERE action = 'remove:glitch-copy'").all() as Array<{ ref: string }>;
    expect(log.map((r) => r.ref)).toEqual(['admin:release-dupe']);
  });
});

describe('snag copies cleanup', () => {
  it('removes the listed non-shiny snag copies, keeps the original', () => {
    const dir = mkdtempSync(join(tmpdir(), 'glitch4-'));
    let a = new Accounts(dir, 'dev');
    const user = (name: string) => Number(a.db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)').run(name, 'x', Date.now()).lastInsertRowid);
    const c = user('clein');
    const d = user('Drac');
    const put = (id: number, owner: number, dex: string, level: number) =>
      a.db.prepare('INSERT INTO pc (id, user_id, entry, created_at) VALUES (?, ?, ?, ?)').run(id, owner, JSON.stringify({ dex, name: dex, level, moves: [] }), Date.now());
    put(4279, c, '0384', 60);
    put(4513, d, '0384', 94);
    a.db.prepare("DELETE FROM meta WHERE key = 'snag_copies_v1'").run();
    a = new Accounts(dir, 'dev');
    const ids = (a.db.prepare('SELECT id FROM pc ORDER BY id').all() as Array<{ id: number }>).map((r) => r.id);
    expect(ids).toEqual([4279]);
  });
});
