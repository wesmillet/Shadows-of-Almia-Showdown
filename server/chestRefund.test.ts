/**
 * A called-off match gives back only what is still unspent from the chest: a voucher used to
 * extract a Pokémon is gone, and the refund lands on the chest as it is saved now.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorld } from './world';
import { Room } from './room';
import { Accounts } from './accounts';

describe('chest refunds when a match is called off', async () => {
  const world = await loadWorld(join(import.meta.dirname, '..', 'assets'));

  it('refunds unspent items only, onto the saved chest', () => {
    const acc = new Accounts(mkdtempSync(join(tmpdir(), 'almia-refund-')), 'live');
    const uid = Number(acc.db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)').run('Refund', 'x', Date.now()).lastInsertRowid);
    acc.db.prepare('INSERT INTO profiles (user_id) VALUES (?)').run(uid);
    acc.saveChest(uid, [{ id: 'extraction-voucher', count: 2 }]);
    const key = `u${uid}`;
    const hooks = {
      rareChest: false,
      chestLoad: () => acc.loadChest(uid),
      chestSave: (_k: string, box: unknown) => acc.saveChest(uid, box as never),
      extracted: (_k: string, mon: unknown, mid: string) => acc.addToPc(uid, mon as never, 'voucher', mid),
    };
    const room = new Room(world, [{ name: 'Refund', starter: '0004', peer: { key, name: 'Refund', send: () => {} } }], 4, 1234, hooks as never, () => {}, { mode: 'casual' });
    const m = room.match;
    const t = m.seats[0]!.trainer;
    const extra = m.makeMon('0025', 10, t, t.x + 1, t.y);
    t.party.push(extra);
    const ch = m.chests[0]!;
    t.x = t.px = ch.x;
    t.y = t.py = ch.y;
    const pc = () => (acc.db.prepare('SELECT COUNT(*) n FROM pc WHERE user_id=?').get(uid) as { n: number }).n;
    room.receive(key, { t: 'cmd', c: 'withdraw', a: [0] });
    expect(acc.loadChest(uid)).toEqual([]);
    // One voucher spent on an extraction, one left unspent in the bag.
    room.receive(key, { t: 'cmd', c: 'extract', a: [t.items.findIndex((e) => e?.id === 'extraction-voucher'), t.party.indexOf(extra)] });
    expect(pc()).toBe(1);
    // Meanwhile the saved chest changed (as another match of this player would change it).
    acc.saveChest(uid, [{ id: 'potion', count: 3 }]);
    room.abort('Server restarting (test)');
    const after = acc.loadChest(uid);
    expect(after.find((e) => e.id === 'extraction-voucher')?.count).toBe(1);
    expect(after.find((e) => e.id === 'potion')?.count).toBe(3);
    expect(pc()).toBe(1);
  });
});
