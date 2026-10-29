/** Mystery Gift codes: made on the dashboard, redeemed once per account, limits and expiry kept. */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from './accounts';

function setup() {
  const a = new Accounts(mkdtempSync(join(tmpdir(), 'gift-')), 'dev');
  const user = (name: string) => Number(a.db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)').run(name, 'x', Date.now()).lastInsertRowid);
  return { a, g: a.gifts, user };
}

describe('Mystery Gift', () => {
  it('a Pokémon code: once per account, up to its uses, into the PC', () => {
    const { a, g, user } = setup();
    const made = g.create('Wes', { code: 'pika-party', kind: 'pokemon', dex: 'Pikachu', level: 12, shiny: true, maxUses: 2 });
    expect(made).toEqual({ code: 'PIKA-PARTY' });
    const [u1, u2, u3] = [user('A1'), user('A2'), user('A3')];
    expect(g.redeem(u1, ' pika-party ')).toEqual({ kind: 'pokemon', dex: '0025', name: 'Pikachu', level: 12, shiny: true });
    expect(a.pcDexes(u1)).toEqual(['0025']);
    expect(g.redeem(u1, 'PIKA-PARTY')).toEqual({ error: 'You already used this code' });
    expect('error' in g.redeem(u2, 'PIKA-PARTY')).toBe(false);
    expect(g.redeem(u3, 'PIKA-PARTY')).toEqual({ error: 'That code has been used up' });
    expect(a.pcDexes(u3)).toEqual([]);
    const entry = JSON.parse((a.db.prepare('SELECT entry FROM pc WHERE user_id = ?').get(u1) as { entry: string }).entry);
    expect(entry.via).toBe('gift');
    expect(g.redemptions('pika-party').map((r) => r.username).sort()).toEqual(['A1', 'A2']);
  });

  it('a look code unlocks the look for that account', () => {
    const { a, g, user } = setup();
    const look = g.lookIds().find((l) => l.startsWith('civ_')) as string;
    const r = g.create('Wes', { kind: 'look', look });
    expect('code' in r).toBe(true);
    const code = (r as { code: string }).code;
    expect(code).toMatch(/^GIFT-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const u = user('B1');
    expect(a.canWear(u, look)).toBe(false);
    expect(g.redeem(u, code)).toMatchObject({ kind: 'look', look });
    expect(a.canWear(u, look)).toBe(true);
    expect(a.canWear(user('B2'), look)).toBe(false);
  });

  it('switched off, expired, wrong codes; bad input refused when making one', () => {
    const { g, user } = setup();
    const u = user('C1');
    g.create('Wes', { code: 'OFFCODE', kind: 'pokemon', dex: 25 });
    g.setActive('offcode', false);
    expect(g.redeem(u, 'OFFCODE')).toEqual({ error: 'That code is no longer active' });
    g.create('Wes', { code: 'SOON', kind: 'pokemon', dex: 25, expiresAt: Date.now() + 1000 });
    expect(g.redeem(u, 'SOON', Date.now() + 5000)).toEqual({ error: 'That code has expired' });
    expect(g.create('Wes', { code: 'X', kind: 'pokemon', dex: 25 })).toHaveProperty('error');
    expect(g.create('Wes', { kind: 'pokemon', dex: 'Notamon' })).toHaveProperty('error');
    expect(g.create('Wes', { kind: 'look', look: 'union_00' })).toHaveProperty('error');
    expect(g.create('Wes', { code: 'OFFCODE', kind: 'pokemon', dex: 25 })).toEqual({ error: 'That code already exists' });
    // guessing is limited
    const v = user('C2');
    for (let i = 0; i < 10; i++) expect(g.redeem(v, `NOPE${i}`)).toEqual({ error: 'That code is not valid' });
    expect(g.redeem(v, 'NOPE99')).toEqual({ error: 'Too many wrong codes. Try again in a while' });
  });
});
