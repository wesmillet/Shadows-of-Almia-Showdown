/** Feedback reaches the admin list; a gift sent to a player is claimed once, into the PC or the chest. */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from './accounts';
import { ADMIN_PAGE } from './adminPage';
import { MOD_PAGE } from './modPage';

const fresh = () => {
  const acc = new Accounts(mkdtempSync(join(tmpdir(), 'almia-fb-')), 'live');
  const uid = Number(acc.db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)').run('Ash', 'x', Date.now()).lastInsertRowid);
  acc.db.prepare('INSERT INTO profiles (user_id) VALUES (?)').run(uid);
  return { acc, uid };
};

describe('feedback', () => {
  it('is saved, listed, rate-limited and marked done', () => {
    const { acc, uid } = fresh();
    expect(acc.feedback.submit(null, '1.2.3.4', { kind: 'bug', text: 'Pokémon stuck on a rock' })).toEqual({ ok: true });
    expect(acc.feedback.submit({ id: uid, username: 'Ash' }, '5.6.7.8', { kind: 'suggestion', text: 'Faster switching please' })).toEqual({ ok: true });
    expect(acc.feedback.submit(null, '1.2.3.4', { kind: 'nope', text: 'hello there' })).toHaveProperty('error');
    expect(acc.feedback.submit(null, '1.2.3.4', { kind: 'bug', text: 'hi' })).toHaveProperty('error');
    for (let i = 0; i < 5; i++) acc.feedback.submit(null, '9.9.9.9', { kind: 'feedback', text: `message ${i} here` });
    expect(acc.feedback.submit(null, '9.9.9.9', { kind: 'feedback', text: 'one too many now' })).toHaveProperty('error');
    const all = acc.feedback.list();
    expect(all.items.length).toBe(7);
    expect(all.items.some((f) => 'ip' in f)).toBe(false);
    expect(acc.feedback.list('suggestion').items[0]?.name).toBe('Ash');
    const id = all.items.find((f) => f.kind === 'bug')!.id;
    expect(acc.feedback.update(id, { status: 'done', note: 'fixed' })).toBe(true);
    expect(acc.feedback.list('', 'done').items[0]?.note).toBe('fixed');
    expect(acc.feedback.newCount()).toBe(6);
  });
});

describe('gifts to one player', () => {
  it('a Pokémon goes to the PC once; items go to the chest; a message alone just clears', () => {
    const { acc, uid } = fresh();
    expect(acc.gifts.send('wes', uid, { message: '' })).toHaveProperty('error');
    expect(acc.gifts.send('wes', uid, { kind: 'pokemon', dex: 'Pikachu', level: 30, shiny: false, message: 'Thanks!' })).toHaveProperty('id');
    expect(acc.gifts.send('wes', uid, { kind: 'item', item: 'Rare Candy', count: 5, message: '' })).toHaveProperty('id');
    expect(acc.gifts.send('wes', uid, { message: 'Hello trainer' })).toHaveProperty('id');
    expect(acc.gifts.send('wes', uid, { kind: 'item', item: 'not-an-item' })).toHaveProperty('error');
    const box = acc.gifts.inbox(uid);
    expect(box.map((g) => g.gift?.kind ?? 'message')).toEqual(['pokemon', 'item', 'message']);
    const pc = () => (acc.db.prepare('SELECT COUNT(*) n FROM pc WHERE user_id=?').get(uid) as { n: number }).n;
    expect(acc.gifts.claim(uid, box[0]!.id)).toMatchObject({ ok: true });
    expect(acc.gifts.claim(uid, box[0]!.id)).toHaveProperty('error');
    expect(pc()).toBe(1);
    acc.saveChest(uid, [{ id: 'potion', count: 2 }]);
    expect(acc.gifts.claim(uid, box[1]!.id)).toMatchObject({ ok: true });
    expect(acc.loadChest(uid)).toEqual([{ id: 'potion', count: 2 }, { id: 'rare-candy', count: 5 }]);
    expect(acc.gifts.claim(uid, box[2]!.id)).toMatchObject({ ok: true, gift: null });
    expect(acc.gifts.inbox(uid)).toEqual([]);
    expect(acc.gifts.sent(uid).every((g) => g.claimedAt)).toBe(true);
    // Another player can not claim it.
    const other = acc.gifts.send('wes', uid, { message: 'x2' }) as { id: number };
    expect(acc.gifts.claim(uid + 99, other.id)).toHaveProperty('error');
  });
});

describe('dashboard pages', () => {
  it('their scripts parse (a bad escape once broke the whole moderation page)', () => {
    for (const page of [ADMIN_PAGE, MOD_PAGE]) {
      const js = page.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? '';
      expect(() => new Function(js)).not.toThrow();
    }
  });
});
