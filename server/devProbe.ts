/**
 * Testing only: the authoritative match state, and a way to stage a fight, for the online combat
 * checks (tools/online-combat/). Served only by a dev server started with DEV_PROBE=1 and
 * ROOM_WORKERS=0 (matches in the main thread, so their state can be read here): main.ts never
 * routes /api/dev/* otherwise, and never on the live or demo server (SERVER_KIND decides).
 *
 *   GET  /api/dev/state            every running match: trainers, their Pokémon (HP, position,
 *                                  fainted, moves, cooldowns), the outcome so far
 *   POST /api/dev/stage            { trainer, mon?: index, set: {...} } changes one trainer or one
 *                                  of their Pokémon (position, HP, moves, behaviour, level, status)
 *   POST /api/dev/cast             { trainer, mon?: index, slot, at?: {x,y}, target?: name#index }
 *                                  makes a Pokémon use a move now (as the server would for its AI)
 *   POST /api/dev/give             { trainer, dex, level } adds a Pokémon to a trainer's party;
 *                                  { trainer, item, count } puts an item in their bag
 *   POST /api/dev/drop             { trainer } cuts that player's connection (the TCP socket is
 *                                  destroyed: the browser sees the line drop, as on a network loss)
 *   POST /api/dev/clear            { trainer, r } sends the wild Pokémon within r tiles of that
 *                                  trainer far away (so they stay out of a staged fight)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Hub } from './hub';
import type { Room } from './room';
import type { Mon, Trainer } from '../src/sim/entities';
import { MOVES } from '../src/sim/data';

/** Every match's combat events as the server saw them (hits, heals, faints), numbered. */
const logs = new WeakMap<Room, Array<Record<string, unknown>>>();
function eventLog(r: Room): Array<Record<string, unknown>> {
  let log = logs.get(r);
  if (log) return log;
  const list: Array<Record<string, unknown>> = [];
  log = list;
  logs.set(r, list);
  const arr = r.match.battle.events as unknown as { push: (...e: unknown[]) => number };
  const push = arr.push.bind(arr);
  arr.push = (...evs: unknown[]) => {
    for (const e0 of evs) {
      const e = e0 as { type: string; attacker?: Mon; target?: Mon; mon?: Mon; damage?: number; amount?: number; move?: { id: string } };
      if (e.type === 'hit' || e.type === 'heal' || e.type === 'faint' || e.type === 'resolve' || e.type === 'miss' || e.type === 'blocked') {
        list.push({ n: list.length, t: Math.round(r.match.time * 1000) / 1000, type: e.type, attacker: e.attacker?.id, target: e.target?.id, mon: e.mon?.id, damage: e.damage, amount: e.amount, move: e.move?.id });
      }
    }
    return push(...evs);
  };
  return list;
}

export function devProbe(hub: Hub, req: IncomingMessage, res: ServerResponse, path: string): void {
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
  };
  const rooms = [...hub.rooms].filter((r): r is Room & typeof r => 'match' in r) as unknown as Room[];
  const monState = (m: Mon) => ({
    id: m.id, name: m.name, dex: m.dex, level: m.level, hp: m.hp, maxHp: m.maxHp, fainted: m.fainted, x: round(m.x), y: round(m.y),
    stowed: !!m.stowed, status: m.status, moves: [...m.moves], cooldowns: m.cooldowns.map(round), behavior: m.behavior, captured: !!m.captured,
    casting: m.casting ? m.casting.moveId : null, pinned: !!m.steered,
  });
  const trainerState = (t: Trainer) => ({
    id: t.id, name: t.name, human: t.isPlayer || !!(t as Trainer & { human?: boolean }).human, alive: t.alive, x: round(t.x), y: round(t.y), mount: t.mount ? t.mount.mon.id : null, duel: t.duelId ?? null, down: t.downUntil ?? null,
    party: t.party.map(monState),
  });
  const find = (name: unknown): { room: Room; t: Trainer } | null => {
    for (const r of rooms) {
      const t = r.match.allTrainers.find((x) => x.name === name);
      if (t) return { room: r, t };
    }
    return null;
  };
  for (const r of rooms) eventLog(r);
  if (req.method === 'GET' && path === '/api/dev/events') {
    const since = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('since') ?? 0);
    return send(200, { rooms: rooms.map((r) => ({ id: r.id, events: eventLog(r).slice(since) })) });
  }
  if (req.method === 'GET' && path === '/api/dev/state') {
    return send(200, {
      rooms: rooms.map((r) => ({
        id: r.id, time: round(r.match.time), over: r.match.over, outcome: r.match.outcome ?? null,
        trainers: r.match.allTrainers.filter((t) => !t.visitor).map(trainerState),
      })),
    });
  }
  if (req.method !== 'POST') return send(404, { error: 'Not found' });
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let b: Record<string, unknown> = {};
    try {
      b = JSON.parse(body || '{}') as Record<string, unknown>;
    } catch {
      return send(400, { error: 'Bad JSON' });
    }
    if (path === '/api/dev/drop') {
      const c = [...hub.clients.values()].find((x) => x.name === b.trainer) as unknown as { ws?: { terminate(): void } } | undefined;
      if (!c?.ws) return send(404, { error: 'Not connected' });
      c.ws.terminate();
      return send(200, { ok: true });
    }
    const hit = find(b.trainer);
    if (!hit) return send(404, { error: `No trainer ${String(b.trainer)}` });
    const { room, t } = hit;
    if (path === '/api/dev/give' && typeof b.item === 'string') {
      // an item into the bag (or Held & TMs), as if picked up
      const ok = room.match.giveItem(t, b.item, Number(b.count ?? 1));
      return send(200, { ok });
    }
    if (path === '/api/dev/give') {
      const mon = room.match.makeMon(String(b.dex ?? '0025'), Number(b.level ?? 20), t, t.x + 1, t.y + 1);
      t.party.push(mon);
      return send(200, { ok: true, index: t.party.length - 1, mon: monState(mon) });
    }
    if (path === '/api/dev/clear') {
      const r = Number(b.r ?? 20);
      let n = 0;
      for (const w of room.match.wilds) {
        if (Math.hypot(w.x - t.x, w.y - t.y) < r) {
          w.x = w.px = w.homeX = 3;
          w.y = w.py = w.homeY = 3;
          n++;
        }
      }
      return send(200, { ok: true, moved: n });
    }
    const m = typeof b.mon === 'number' ? t.party[b.mon] : undefined;
    if (path === '/api/dev/stage') {
      const set = (b.set ?? {}) as Record<string, unknown>;
      const target: Mon | Trainer = m ?? t;
      if (typeof set.x === 'number') target.x = target.px = set.x;
      if (typeof set.y === 'number') target.y = target.py = set.y;
      if (m) {
        if (typeof set.hp === 'number') {
          m.hp = Math.max(0, Math.min(m.maxHp, set.hp));
          if (m.hp > 0) m.fainted = false;
        }
        if (Array.isArray(set.moves)) {
          const moves = (set.moves as unknown[]).map(String).filter((id) => MOVES.has(id));
          m.moves = moves;
          m.cooldowns = moves.map(() => 0);
        }
        if (typeof set.behavior === 'string') m.behavior = set.behavior as Mon['behavior'];
        if (set.cooldowns === 0) m.cooldowns = m.cooldowns.map(() => 0);
        if (set.status === null) m.status = null;
        // Pinned: it stands where it was put (the party AI leaves a steered Pokémon alone), so a staged
        // spot by a wall stays put until something shoves it.
        if (typeof set.pin === 'boolean') m.steered = set.pin;
        if (set.stowed === false) m.stowed = false;
      }
      return send(200, { ok: true, state: m ? monState(m) : trainerState(t) });
    }
    if (path === '/api/dev/cast') {
      const mon = m ?? t.party.find((x) => !x.fainted && !x.stowed);
      if (!mon) return send(400, { error: 'No Pokémon to act' });
      const slot = Number(b.slot ?? 0);
      let tx = mon.x + 1;
      let ty = mon.y;
      let targetId: number | null = null;
      let target: Mon | null = null;
      if (typeof b.target === 'string') {
        const [tn, ti] = b.target.split('#');
        const other = room.match.allTrainers.find((x) => x.name === tn);
        target = other?.party[Number(ti ?? 0)] ?? null;
        if (target) {
          tx = target.x;
          ty = target.y;
          targetId = target.id;
        }
      }
      const at = b.at as { x?: number; y?: number } | undefined;
      if (at && typeof at.x === 'number' && typeof at.y === 'number') {
        tx = at.x;
        ty = at.y;
      }
      mon.cooldowns[slot] = 0;
      const ok = room.match.battle.tryCast(mon, slot, tx, ty, targetId, target);
      return send(200, { ok, mon: monState(mon) });
    }
    return send(404, { error: 'Not found' });
  });
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
