/** Direct messages: friends only, filtered, rate-limited, unread counts, reports. */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from './accounts';

describe('direct messages', () => {
  const setup = () => {
    const a = new Accounts(mkdtempSync(join(tmpdir(), 'dms-')), 'dev');
    const user = (name: string) => {
      const id = Number(a.db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)').run(name, 'x', Date.now()).lastInsertRowid);
      a.db.prepare('INSERT OR IGNORE INTO profiles (user_id) VALUES (?)').run(id);
      return id;
    };
    return { a, ann: user('Ann'), bo: user('Bo'), cy: user('Cy') };
  };

  it('only friends can message, and messages are filtered', () => {
    const { a, ann, bo } = setup();
    expect(a.dms.send(ann, 'Bo', 'hi')).toEqual({ error: expect.stringMatching(/only message friends/) });
    a.addFriend(ann, 'Bo');
    // A request is not a friendship yet.
    expect('error' in a.dms.send(ann, 'Bo', 'hi')).toBe(true);
    a.addFriend(bo, 'Ann');
    const r = a.dms.send(ann, 'bo', 'you ass, gg');
    expect('msg' in r && r.msg.text).toBe('you ***, gg');
    expect('toId' in r && r.toId).toBe(bo);
    expect(a.dms.send(ann, 'Bo', '   ')).toEqual({ error: 'Type a message' });
    expect(a.dms.send(ann, 'Ann', 'me')).toEqual({ error: 'That is you' });
  });

  it('counts unread until the conversation is opened', () => {
    const { a, ann, bo } = setup();
    a.addFriend(ann, 'Bo');
    a.addFriend(bo, 'Ann');
    a.dms.send(ann, 'Bo', 'one');
    a.dms.send(ann, 'Bo', 'two');
    a.dms.send(bo, 'Ann', 'back');
    expect(a.dms.unread(bo)).toEqual({ Ann: 2 });
    expect(a.dms.unread(ann)).toEqual({ Bo: 1 });
    const h = a.dms.history(bo, 'ann');
    expect('messages' in h && h.messages.map((m) => `${m.from}:${m.text}`)).toEqual(['Ann:one', 'Ann:two', 'Bo:back']);
    expect(a.dms.unread(bo)).toEqual({});
    expect(a.dms.unread(ann)).toEqual({ Bo: 1 });
  });

  it('a muted player can not send, and flooding is slowed', () => {
    const { a, ann, bo } = setup();
    a.addFriend(ann, 'Bo');
    a.addFriend(bo, 'Ann');
    for (let i = 0; i < 8; i++) expect('msg' in a.dms.send(ann, 'Bo', `m${i}`)).toBe(true);
    expect(a.dms.send(ann, 'Bo', 'more')).toEqual({ error: 'Slow down a little' });
    a.mute(bo, 10);
    expect(a.dms.send(bo, 'Ann', 'hey')).toEqual({ error: expect.stringMatching(/muted/) });
  });

  it('a message can be reported by someone in the conversation only', () => {
    const { a, ann, bo, cy } = setup();
    a.addFriend(ann, 'Bo');
    a.addFriend(bo, 'Ann');
    const r = a.dms.send(ann, 'Bo', 'rude');
    const id = 'msg' in r ? r.msg.id : -1;
    expect(a.dms.forReport(bo, id)).toEqual({ id, author: 'Ann' });
    expect(a.dms.forReport(cy, id)).toBeNull();
  });
});
