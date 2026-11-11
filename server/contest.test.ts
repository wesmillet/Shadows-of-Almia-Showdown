/** A most-wins contest (events kind 'wins'): counts public wins in its window and settles once. */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from './accounts';
import { Events, type ContestPlace, type GameEvent } from './events';

describe('wins contest', () => {
  it('ranks public wins inside the window and settles exactly once', () => {
    const a = new Accounts(mkdtempSync(join(tmpdir(), 'contest-')), 'dev');
    const user = (name: string) => Number(a.db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)').run(name, 'x', Date.now()).lastInsertRowid);
    const ids = { ann: user('Ann'), bo: user('Bo'), cy: user('Cy') };
    const settled: Array<[GameEvent, ContestPlace[]]> = [];
    const said: string[] = [];
    const ev = new Events(a.db, () => {}, (t) => said.push(t), (e, p) => settled.push([e, p]));
    const start = Date.now() - 1000;
    expect(ev.create({ kind: 'wins', name: 'Win Rush', startsAt: start, hours: 1, value: 0 }, 'mod')).toBeNull();
    const c = ev.contest();
    expect(c?.kind).toBe('wins');
    expect(ev.boost('xp')).toBe(1);
    let n = 0;
    const match = (mode: string, at: number, results: Array<[number, 'win' | 'loss']>) => {
      const id = `m${n++}`;
      a.db.prepare("INSERT INTO match_log (id, mode, started_at, ended_at, seconds, winner, trainers_n, humans, bots, aborted, trainers) VALUES (?, ?, ?, ?, 60, NULL, 2, 2, 0, NULL, '[]')").run(id, mode, at - 60000, at);
      for (const [uid, out] of results) a.db.prepare('INSERT INTO match_log_players (match_id, user_id, place, outcome) VALUES (?, ?, 1, ?)').run(id, uid, out);
    };
    const now = Date.now();
    match('solo', now, [[ids.bo, 'win'], [ids.ann, 'loss']]);
    match('solo', now, [[ids.bo, 'win'], [ids.cy, 'loss']]);
    match('solo', now, [[ids.ann, 'win'], [ids.cy, 'loss']]);
    match('private', now, [[ids.cy, 'win']]); // private: not counted
    match('solo', start - 5000, [[ids.cy, 'win']]); // before the contest: not counted
    const board = ev.standings(c as GameEvent);
    expect(board.map((p) => [p.name, p.wins])).toEqual([['Bo', 2], ['Ann', 1]]);
    // Not over yet: nothing settled.
    ev.tick(now);
    expect(settled).toHaveLength(0);
    // Over: settled once, with the final places.
    const after = (c as GameEvent).endsAt + 1;
    ev.tick(after);
    ev.tick(after + 5000);
    expect(settled).toHaveLength(1);
    expect(settled[0]?.[1].map((p) => p.name)).toEqual(['Bo', 'Ann']);
    // A restarted server does not settle it again.
    const again: unknown[] = [];
    new Events(a.db, () => {}, () => {}, (e) => again.push(e)).tick(after + 10000);
    expect(again).toHaveLength(0);
    // The prizes can be sent: Pikachu Libre, shiny for 1st.
    expect(a.gifts.send('Events', ids.bo, { kind: 'pokemon', dex: '0025-libre', level: 25, shiny: true })).not.toHaveProperty('error');
    expect(a.gifts.send('Events', ids.ann, { kind: 'pokemon', dex: '0025-libre', level: 25, shiny: false })).not.toHaveProperty('error');
    expect(a.gifts.send('Admin', ids.ann, { kind: 'pokemon', dex: '0493-beta', level: 50 })).not.toHaveProperty('error');
  });

  it('needs no amount', () => {
    const a = new Accounts(mkdtempSync(join(tmpdir(), 'contest2-')), 'dev');
    const ev = new Events(a.db, () => {}, () => {});
    expect(ev.create({ kind: 'wins', name: 'Most Wins', startsAt: Date.now() + 3600_000, hours: 72, value: 'x' }, 'mod')).toBeNull();
    expect(ev.list()[0]?.value).toBe(0);
  });
});
