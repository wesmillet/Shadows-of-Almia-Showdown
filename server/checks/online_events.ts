/**
 * Check: the new interactions as an online match plays them. A real Room (the server's match
 * wrapper: command validation, the per-player view, the sync encoder) with two players whose
 * messages are decoded by the browser's SyncDecoder, so what is checked is what a browser would
 * have. Covers the disguised Zoroark (revealed once, synced, no second reveal for anyone, nothing
 * duplicated after a reconnect), the Breeder's Egg (in a party slot on the player's screen, what it
 * holds never sent, hatched only by walking the server lets them walk), and private-match rules.
 *   npx tsx server/checks/online_events.ts
 */
import { join } from 'node:path';
import { SPAWNS, CONFIG } from '../../src/sim/data';
import { SyncDecoder } from '../../src/net/sync';
import type { ClientMsg, ServerMsg } from '../../src/net/protocol';
import { partySize } from '../../src/sim/entities';
import { loadWorld } from '../world';
import { Room, STEP, type Peer, type RoomHooks } from '../room';

const world = await loadWorld(join(import.meta.dirname, '..', '..', 'assets'));
let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};

interface Client {
  peer: Peer;
  dec: SyncDecoder;
  raw: string[];
  replies: string[];
}
const client = (key: string): Client => {
  const c: Client = { peer: null as unknown as Peer, dec: new SyncDecoder(), raw: [], replies: [] };
  c.peer = {
    key, name: key,
    send: (msg: ServerMsg) => {
      const s = JSON.stringify(msg);
      c.raw.push(s);
      if (msg.t === 's') c.dec.apply(msg.p);
      if (msg.t === 'reply') c.replies.push(msg.text);
    },
  } as Peer;
  return c;
};
const hooks: RoomHooks = {
  chestLoad: () => [], chestSave: () => {}, extracted: () => {}, rareChest: false,
} as unknown as RoomHooks;
const view = (c: Client) => c.dec.root as Record<string, unknown> & { npcs: Array<Record<string, unknown>>; wilds: Array<Record<string, unknown>>; seat: { trainer: Record<string, unknown> } };

// The stranger in every match for this check; find a match that also has the Breeder.
const z = (SPAWNS as unknown as { events: { zoroark: { chance: number } } }).events.zoroark;
z.chance = 1;
let room: Room | null = null;
let A = client('uA');
let B = client('uB');
for (let seed = 1; seed < 200; seed++) {
  A = client('uA');
  B = client('uB');
  const r = new Room(world, [{ name: 'A', starter: '0025', peer: A.peer }, { name: 'B', starter: '0004', peer: B.peer }], 4, seed, hooks, () => {}, { mode: 'casual' });
  if (r.match.visitors.folk?.breeder && r.match.visitors.folk.disguise) {
    room = r;
    break;
  }
}
if (!room) throw new Error('no seed with both the Breeder and the stranger');
const m = room.match;
const crew = m.visitors.folk!;
const step = (n: number) => {
  for (let i = 0; i < n; i++) room!.step();
};
const cmd = (c: Client, name: string, a: Array<number | string> = []) => room!.receive(c.peer.key, { t: 'cmd', c: name, a, n: 1 } as ClientMsg);
const seatA = m.seats[0]!;
const seatB = m.seats[1]!;
// These two meet a lot in this check: no trainer battles between them.
seatA.trainer.duelReadyAt = seatB.trainer.duelReadyAt = 1e9;
step(10);

// ---------------------------------------------------------------- what an opponent's browser knows
{
  // Far apart: neither browser has the other trainer, nor any radar dot for them; the count of
  // trainers left still arrives.
  const a = seatA.trainer;
  const b = seatB.trainer;
  const keepB = { x: b.x, y: b.y };
  b.x = b.px = a.x + 60 > m.ground.cols - 5 ? a.x - 60 : a.x + 60;
  step(6);
  const vA = view(A) as unknown as Record<string, unknown> & { trainers: Array<Record<string, unknown>>; radar: Array<Record<string, unknown>>; trainersLeft: number };
  const bId = b.id;
  check(!vA.trainers.some((t) => t.id === bId), "a far-off opponent is not in the other player's view");
  check(!(vA.radar ?? []).some((d) => d.id === bId) && (vA.radar ?? []).length === 0, `the minimap radar carries no opponents (${(vA.radar ?? []).length} dots)`);
  const alive = m.allTrainers.filter((t) => t.alive && !t.visitor && !t.hidden && !t.challenger).length;
  check(vA.trainersLeft === alive, `the count of trainers left still arrives (${vA.trainersLeft} of ${alive})`);
  // Close by: the opponent is in the world again.
  b.x = b.px = a.x + 5;
  b.y = b.py = a.y;
  step(6);
  check((view(A) as unknown as { trainers: Array<Record<string, unknown>> }).trainers.some((t) => t.id === bId), 'an opponent nearby is in the world');
  b.x = b.px = keepB.x;
  b.y = b.py = keepB.y;
  step(3);
}

// ---------------------------------------------------------------- Zoroark, online
{
  const w = crew.disguise!;
  check(view(A).npcs.some((n) => n.name === w.npc.name && n.role === 'disguise'), 'the browser sees the stranger as a townsperson');
  check(!A.raw.some((s) => s.includes('"0571"')), 'nothing sent so far names Zoroark');
  seatA.trainer.x = seatA.trainer.px = w.npc.x + 1;
  seatA.trainer.y = seatA.trainer.py = w.npc.y;
  seatB.trainer.x = seatB.trainer.px = w.npc.x - 1;
  seatB.trainer.y = seatB.trainer.py = w.npc.y;
  // Both press Space in the same step: one reveal. (A wild Zorua may already have grown into a
  // Zoroark somewhere on the island: only new ones count.)
  const earlier = new Set(m.wilds.filter((x) => x.dex === '0571'));
  const revealed = () => m.wilds.filter((x) => x.dex === '0571' && !earlier.has(x));
  cmd(A, 'interact');
  cmd(B, 'interact');
  step(6);
  const zs = revealed();
  check(zs.length === 1, `two players pressing Space at once reveal one Zoroark (${zs.length}; ${earlier.size} grown wild elsewhere)`);
  check(view(A).wilds.filter((x) => x.dex === '0571').length === 1 && view(B).wilds.filter((x) => x.dex === '0571').length === 1, 'both browsers see it');
  check(!view(A).npcs.some((n) => n.role === 'disguise'), 'the stranger is gone from the browser');
  cmd(A, 'interact');
  step(6);
  check(revealed().length === 1, 'a later Space reveals nothing more');
  // Reconnect: a fresh browser gets the same world, nothing doubled.
  room.disconnect('uA');
  step(3);
  const A2 = client('uA');
  room.rejoin(A2.peer);
  step(6);
  check(view(A2).wilds.filter((x) => x.dex === '0571').length === 1 && !view(A2).npcs.some((n) => n.role === 'disguise'), 'after a reconnect: one Zoroark, no stranger');
  A = A2;
}

// ---------------------------------------------------------------- the Egg, online
{
  const breeder = crew.breeder!;
  const p = seatB.trainer;
  const home = { x: p.x, y: p.y };
  // (Zoroark may have knocked B's team about: a fresh start.)
  for (const x of p.party) {
    x.fainted = false;
    x.hp = x.maxHp;
  }
  m.wilds = m.wilds.filter((x) => x.dex !== '0571');
  p.downUntil = null;
  const wanted = m.makeMon(crew.want, 10, p, p.x, p.y);
  p.party.push(wanted);
  p.x = p.px = breeder.npc.x + 1;
  p.y = p.py = breeder.npc.y;
  const size = partySize(p);
  cmd(B, 'interact');
  step(6);
  console.log(`     (the Breeder says: ${B.replies.at(-1) ?? '-'})`);
  const mine = view(B).seat.trainer as { eggs?: Array<Record<string, unknown>>; party: unknown[] };
  check((mine.eggs?.length ?? 0) === 1, "the Egg shows in the player's party on their screen");
  check(Object.keys(mine.eggs?.[0] ?? {}).sort().join(',') === 'id,need,steps', 'the browser gets its progress only, never what is inside');
  check(partySize(p) === size, 'one for one, as offline');
  cmd(B, 'interact');
  step(6);
  check((p.eggs?.length ?? 0) === 1, 'a second Space gives no second Egg');
  // Back to open ground to walk about (beside the Breeder's stall may be a corner).
  for (let r = 0; r < 30; r++) {
    const tx = Math.floor(home.x) + r;
    if (m.ground.walkable(tx, Math.floor(home.y)) && m.ground.walkable(tx + 4, Math.floor(home.y)) && m.ground.walkable(tx - 4, Math.floor(home.y))) {
      p.x = p.px = tx + 0.5;
      p.y = p.py = Math.floor(home.y) + 0.5;
      break;
    }
  }
  // Nothing to interrupt the walk: no wild Pokémon close by, a healthy team, on its feet.
  m.wilds = m.wilds.filter((w) => Math.hypot(w.x - p.x, w.y - p.y) > 25);
  for (const x of p.party) {
    x.fainted = false;
    x.hp = x.maxHp;
  }
  p.downUntil = null;
  // Honest walking first: frames with real keys move the trainer and count.
  const egg = p.eggs![0]!;
  let n = 1000;
  const sA = egg.steps;
  const x0 = p.x;
  for (let k = 0; k < 40; k++) {
    room.receive('uB', { t: 'in', f: [[n++, k % 20 < 10 ? 1 : -1, 0], [n++, k % 20 < 10 ? 1 : -1, 0], [n++, k % 20 < 10 ? 1 : -1, 0]] } as ClientMsg);
    step(3);
  }
  console.log(`     (B: alive ${p.alive}, duel ${p.duelId}, steering ${!!seatB.controlled}, mount ${!!p.mount}, ack ${seatB.ack}, queued ${seatB.inputs.length}, down ${p.downUntil})`);
  check(egg.steps - sA > 5, `walking with real keys counts (${(egg.steps - sA).toFixed(1)} steps, moved from x ${x0.toFixed(1)} to ${p.x.toFixed(1)})`);
  // Fake movement: frames with oversized keys move no faster than walking.
  const s0 = egg.steps;
  for (let k = 0; k < 60; k++) {
    room.receive('uB', { t: 'in', f: [[n++, k % 20 < 10 ? 50 : -50, 0], [n++, k % 20 < 10 ? 50 : -50, 0], [n++, k % 20 < 10 ? 50 : -50, 0]] } as ClientMsg);
    step(3);
  }
  const walked = egg.steps - s0;
  check(walked > 1 && walked <= CONFIG.player.speedTilesPerSec * (180 * STEP) * 1.06 + 0.01, `oversized keys walk no faster than walking (${walked.toFixed(1)} steps in ${(180 * STEP).toFixed(1)} s)`);
  // Lots of frames in one message: still one per step.
  const s1 = egg.steps;
  room.receive('uB', { t: 'in', f: Array.from({ length: 40 }, () => [n++, 0, 1]) } as ClientMsg);
  step(1);
  check(egg.steps - s1 <= CONFIG.player.speedTilesPerSec * STEP * 1.06 + 0.01, 'a burst of frames moves one step per step');
  // Standing still: nothing (once the burst's queued frames, which are real keys, have played out).
  room.receive('uB', { t: 'in', f: [[n++, 0, 0]] } as ClientMsg);
  for (let k = 0; k < 120 && seatB.inputs.length; k++) step(1);
  step(2);
  const s2 = egg.steps;
  step(120);
  check(egg.steps === s2, `standing still adds nothing (${(egg.steps - s2).toFixed(6)} steps)`);
}

// ---------------------------------------------------------------- private rules
{
  const P = client('uP');
  const Q = client('uQ');
  let extracted = 0;
  let saved = 0;
  const h = { ...hooks, extracted: () => extracted++, chestSave: () => saved++, chestLoad: () => [{ id: 'potion', count: 2 }] } as unknown as RoomHooks;
  const pr = new Room(world, [{ name: 'P', starter: '0025', peer: P.peer }, { name: 'Q', starter: '0004', peer: Q.peer }], 4, 77, h, () => {}, { mode: 'private', rareChest: true });
  for (let i = 0; i < 5; i++) pr.step();
  const t = pr.match.seats[0]!.trainer;
  t.items[0] = { id: 'extraction-voucher', count: 1 };
  t.party.push(pr.match.makeMon('0396', 9, t, t.x, t.y));
  pr.receive('uP', { t: 'cmd', c: 'extract', a: [0, 1], n: 2 } as ClientMsg);
  for (let i = 0; i < 3; i++) pr.step();
  pr.match.withdraw(t, 0);
  check(extracted === 0 && t.party.length === 2, 'a private match sends nothing to the PC');
  check(saved === 0, 'a private match (rare chest on) saves no chest');
}

console.log(failed ? `${failed} online check(s) failed` : 'All online event checks passed');
process.exit(failed ? 1 : 0);
