/** The Vote Egg (server/voteEgg.ts): VibeTopList's callback, one Egg a UTC day, each vote acted on once. */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from './accounts';
import { VoteEggs, utcDay } from './voteEgg';

const SECRET = 'test-secret-1234';

function setup(secret: string | null = SECRET, slug: string | null = 'shadows-of-almia') {
  const a = new Accounts(mkdtempSync(join(tmpdir(), 'vote-')), 'dev');
  const v = new VoteEggs(a, secret, slug);
  const user = (name: string, banned = 0) => Number(a.db.prepare('INSERT INTO users (username, pass_hash, created_at, banned) VALUES (?, ?, ?, ?)').run(name, 'x', Date.now(), banned).lastInsertRowid);
  const pc = (id: number) => (a.db.prepare('SELECT COUNT(*) AS n FROM pc WHERE user_id = ?').get(id) as { n: number }).n;
  return { a, v, user, pc };
}

const DAY1 = Date.UTC(2026, 10, 16, 15, 0);
const DAY2 = Date.UTC(2026, 10, 17, 9, 0);

describe('vote callback', () => {
  it('refuses a missing or wrong secret, and everything when no secret is set', () => {
    const { v, user } = setup();
    user('Ash');
    expect(v.record({ voted: '1', userid: 'Ash', vote_id: 'a' }).status).toBe(403);
    expect(v.record({ secret: 'nope', voted: '1', userid: 'Ash', vote_id: 'a' }).status).toBe(403);
    expect(setup(null).v.record({ secret: SECRET, voted: '1', userid: 'Ash', vote_id: 'a' }).status).toBe(503);
  });

  it('gives one Egg for a counted vote, and the POST, the GET and retries of it give nothing more', () => {
    const { v, user } = setup();
    const id = user('Ash');
    expect(v.record({ secret: SECRET, voted: '1', userid: 'ash', vote_id: 'v1' }, DAY1)).toEqual({ status: 200, outcome: 'egg' });
    expect(v.record({ secret: SECRET, voted: '1', userid: 'ash', vote_id: 'v1' }, DAY1)).toEqual({ status: 200, outcome: 'duplicate' });
    expect(v.state(id, 'Ash', DAY1)).toMatchObject({ ready: true, votedToday: true });
  });

  it('gives at most one Egg a UTC day, and another the next day', () => {
    const { v, user } = setup();
    const id = user('Misty');
    expect(v.record({ secret: SECRET, voted: '1', userid: 'Misty', vote_id: 'm1' }, DAY1).outcome).toBe('egg');
    expect(v.record({ secret: SECRET, voted: '1', userid: 'Misty', vote_id: 'm2' }, DAY1 + 8 * 3600_000).outcome).toBe('already-today');
    expect(v.record({ secret: SECRET, voted: '1', userid: 'Misty', vote_id: 'm3' }, DAY2).outcome).toBe('egg');
    // Both wait: the older one hatches first.
    expect(v.state(id, 'Misty', DAY2).ready).toBe(true);
  });

  it('gives nothing for a rejected vote, an unknown name or a banned account', () => {
    const { v, user } = setup();
    user('Brock', 1);
    expect(v.record({ secret: SECRET, voted: '0', userid: 'Brock', vote_id: 'b1' }, DAY1).outcome).toBe('not-counted');
    expect(v.record({ secret: SECRET, voted: '1', userid: 'Nobody', vote_id: 'b2' }, DAY1).outcome).toBe('unknown-user');
    expect(v.record({ secret: SECRET, voted: '1', userid: 'Brock', vote_id: 'b3' }, DAY1).outcome).toBe('unknown-user');
    expect(v.record({ secret: SECRET, voted: '1', userid: 'Brock' }, DAY1).status).toBe(400);
  });
});

describe('Vote Egg tier', () => {
  it('is always Rare or better', () => {
    const { a, v, user } = setup();
    for (let i = 0; i < 60; i++) {
      user(`P${i}`);
      v.record({ secret: SECRET, voted: '1', userid: `P${i}`, vote_id: `t${i}` }, DAY1);
    }
    const tiers = (a.db.prepare('SELECT tier FROM vote_eggs').all() as { tier: string }[]).map((r) => r.tier);
    expect(tiers).toHaveLength(60);
    for (const t of tiers) expect(['rare', 'epic', 'mythic']).toContain(t);
  });
});

describe('hatching the Vote Egg', () => {
  it('puts one level 5 Pokémon in the PC, once, oldest Egg first', () => {
    const { v, user, pc } = setup();
    const id = user('Dawn');
    expect('error' in v.hatch(id, DAY1)).toBe(true);
    v.record({ secret: SECRET, voted: '1', userid: 'Dawn', vote_id: 'd1' }, DAY1);
    v.record({ secret: SECRET, voted: '1', userid: 'Dawn', vote_id: 'd2' }, DAY2);
    const first = v.hatch(id, DAY2);
    expect('error' in first).toBe(false);
    expect(pc(id)).toBe(1);
    expect(v.state(id, 'Dawn', DAY2)).toMatchObject({ ready: true, votedToday: true, today: null });
    v.hatch(id, DAY2);
    expect(pc(id)).toBe(2);
    expect(v.state(id, 'Dawn', DAY2)).toMatchObject({ ready: false, votedToday: true });
    expect(v.state(id, 'Dawn', DAY2).today).not.toBeNull();
    expect('error' in v.hatch(id, DAY2)).toBe(true);
    expect(pc(id)).toBe(2);
  });

  it('builds the vote link with the player name, and hides voting when not set up', () => {
    const { v, user } = setup();
    const id = user('Red');
    expect(v.state(id, 'Red Z', DAY1).voteUrl).toBe('https://vibetoplist.com/vote/shadows-of-almia?ref=Red%20Z');
    expect(setup(SECRET, null).v.state(id, 'Red', DAY1)).toMatchObject({ on: false, voteUrl: null });
    expect(utcDay(DAY1)).toBe('2026-11-16');
  });
});
