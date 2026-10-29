// Online combat, checked with two real browsers against the authoritative server.
//
// Two Chromium windows (A and B) join one online match on a local dev server and fight. Each
// scenario stages the fight through the server's dev probe (server/devProbe.ts: positions, HP,
// moves; only on a dev server with DEV_PROBE=1 ROOM_WORKERS=0), makes it happen (A's moves are cast
// from A's browser, the same command its keys send; B's from B's browser or, where both must act on
// the same step, from the probe), then compares what the server says happened with what each
// browser shows: HP, fainted, positions, the party, the outcome. Nothing here runs on the live game.
//
// Two trainers within duel.startRange (6 tiles) start a one-on-one trainer battle, so the open-field
// scenarios keep the trainers 10 tiles apart (their Pokémon still fight each other there), and the
// battle scenario then brings them together.
//
//   server: PORT=8796 SERVER_KIND=dev ROOM_WORKERS=0 DEV_PROBE=1 MATCH_SIZE=2 MIN_PLAYERS=2 LOBBY_WAIT=3 \
//           [SIM_LATENCY_MS=120] [SIM_JITTER_MS=120] DIST_DIR=dist node dist-server/main.js
//   node tools/online-combat/combat.cjs <base url> <out dir> [label] [admin cookie]
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.argv[2] || 'http://127.0.0.1:8796';
const OUT = process.argv[3] || 'combat-out';
const LABEL = process.argv[4] || 'plain';
const ADMIN = process.argv[5] || '';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const note = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass === true ? 'PASS' : pass === false ? 'FAIL' : 'INFO'} ${name}${detail ? ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
};

async function api(path, body) {
  const r = await fetch(`${BASE}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
let MATCH = null;
const server = async () => { const rs = (await api('/api/dev/state')).rooms; return rs.find((x) => x.id === MATCH) ?? null; };
const sTrainer = (room, id) => room.trainers.find((t) => t.id === id);
const sMon = (room, id) => { for (const t of room.trainers) { const m = t.party.find((q) => q.id === id); if (m) return m; } return null; };
const events = async (since) => (await api(`/api/dev/events?since=${since}`)).rooms.find((x) => x.id === MATCH)?.events ?? [];

async function until(fn, ms, step = 100) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(step);
  }
}

(async () => {
  const browser = await chromium.launch();
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(`${BASE}/`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.showdown && window.showdown.net && window.showdown.net.connected, null, { timeout: 120000 });
    return { name, ctx, p, errs };
  };
  const A = await mk('A');
  const B = await mk('B');
  for (const c of [A, B]) {
    await c.p.evaluate(() => {
      const net = window.showdown.net;
      net.on((m) => {
        if (m.t === 'roll') net.send({ t: 'queue', pick: 0, mode: 'casual' });
        if (m.t === 'start') window.__matchId = m.matchId;
      });
      net.send({ t: 'roll' });
    });
  }
  for (const c of [A, B]) await c.p.waitForFunction(() => window.showdown.match && window.showdown.match.player && window.showdown.match.seat, null, { timeout: 120000 });
  await sleep(2000);
  // Who is who.
  for (const c of [A, B]) Object.assign(c, await c.p.evaluate(() => ({ id: window.showdown.match.player.id, tname: window.showdown.match.player.name, matchId: window.__matchId ?? null })));
  MATCH = A.matchId;
  // Auto-battle off on both screens (each Pokémon acts only when told), and a client-side view reader.
  const view = (c) => c.p.evaluate(() => {
    const m = window.showdown.match;
    return {
      mons: [...m.mons()].map((q) => ({ id: q.id, hp: q.hp, maxHp: q.maxHp, fainted: !!q.fainted, x: q.x, y: q.y, stowed: !!q.stowed, owner: q.owner ? q.owner.id : null })),
      party: m.player.party.map((q) => ({ id: q.id, hp: q.hp, fainted: !!q.fainted, stowed: !!q.stowed })),
      outcome: m.seat?.outcome ?? null,
      alive: m.player.alive,
      connected: window.showdown.net.connected,
    };
  });
  for (const c of [A, B]) await c.p.evaluate(() => {
    window.showdown.match.auto = false;
    // every change of the connection, with the time (a drop and reconnect can be quicker than a poll)
    const net = window.showdown.net; let was = net.connected; window.__conn = [];
    setInterval(() => { if (net.connected !== was) { was = net.connected; window.__conn.push([Math.round(performance.now()), was]); } }, 10);
    // Diagnostics: the last messages, and any Pokémon object the mirror creates without its species
    // (it would crash drawing an event about it).
    window.__msgs = []; window.__partial = [];
    net.on((m) => { window.__msgs.push([Math.round(performance.now()), m.t]); if (window.__msgs.length > 40) window.__msgs.shift(); });
    let lastDec = null;
    setInterval(() => {
      const mir = window.showdown.mirror; if (!mir || mir.dec === lastDec) return;
      lastDec = mir.dec; const dec = mir.dec; const apply = dec.apply.bind(dec);
      dec.apply = (p) => {
        const had = new Set(dec.objects.keys());
        apply(p);
        for (const k of Object.keys(p.set)) {
          const o = dec.objects.get(Number(k));
          if (!had.has(Number(k)) && o && 'cooldowns' in o && !('dex' in o)) window.__partial.push({ at: Math.round(performance.now()), id: Number(k), keys: Object.keys(p.set[k]).slice(0, 12), recent: window.__msgs.slice(-6) });
        }
      };
    }, 5);
  });
  const room0 = await server();
  note('setup', !!room0 && room0.trainers.length === 2, `match ${room0?.id}: ${room0?.trainers.map((t) => `${t.name} at ${Math.round(t.x)},${Math.round(t.y)}${t.duel !== null ? ' (in a trainer battle)' : ''}`).join(' vs ')} (${LABEL})`);
  // B gets three more Pokémon (so a knockout does not end the match), A one more (for switching).
  for (let i = 0; i < 3; i++) await api('/api/dev/give', { trainer: B.tname, dex: '0025', level: 20 });
  await api('/api/dev/give', { trainer: A.tname, dex: '0007', level: 20 });
  // Keep wild Pokémon out of the way.
  await api('/api/dev/clear', { trainer: A.tname, r: 40 });
  // Every Pokémon passive and pinned: it acts only when a scenario says so and stays where it is put.
  const pinAll = async () => {
    const r = await server();
    for (const t of r.trainers) for (let i = 0; i < t.party.length; i++) await api('/api/dev/stage', { trainer: t.name, mon: i, set: { behavior: 'passive', pin: true, cooldowns: 0 } });
  };
  await pinAll();
  if (process.env.COMBAT_DEBUG) { for (let i = 0; i < 4; i++) { console.log('pins', i, JSON.stringify((await server()).trainers.map((t) => [t.mount, t.duel, t.down, t.party.map((q) => [q.id, q.pinned, q.stowed])]))); await sleep(400); } }

  // A spot to stage at: open ground, a wall face, a corner and a one-tile passage near A, read off
  // the map the browser has (the same map file as the server's).
  const spots = await A.p.evaluate(() => {
    const m = window.showdown.match; const g = m.ground; const me = m.player;
    const W = (x, y) => g.walkable(x, y);
    const open = (x, y, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!W(x + dx, y + dy)) return false; return true; };
    let openSpot = null, wall = null, corner = null, narrow = null, thin = null;
    for (let r = 0; r < 90 && !(openSpot && wall && corner && narrow && thin); r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = Math.floor(me.x) + dx, y = Math.floor(me.y) + dy;
        if (!W(x, y)) continue;
        if (!openSpot && open(x, y, 4)) openSpot = { x, y };
        // a wall face: blocked east, open for 4 tiles west and a tile above and below
        if (!wall && !W(x + 1, y) && !W(x + 1, y - 1) && !W(x + 1, y + 1) && W(x - 1, y) && W(x - 2, y) && W(x - 3, y) && W(x - 4, y) && W(x, y - 1) && W(x, y + 1) && W(x - 1, y - 1) && W(x - 1, y + 1)) wall = { x, y };
        // a corner: blocked east and south
        if (!corner && !W(x + 1, y) && !W(x, y + 1) && !W(x + 1, y + 1) && W(x - 1, y) && W(x - 2, y) && W(x - 3, y) && W(x, y - 1) && W(x - 1, y - 1)) corner = { x, y };
        // a one-tile passage running east-west: blocked north and south, open east and west
        if (!narrow && !W(x, y - 1) && !W(x, y + 1) && W(x - 1, y) && W(x - 2, y) && W(x - 3, y) && W(x + 1, y) && !W(x - 1, y - 1) && !W(x - 1, y + 1)) narrow = { x, y };
        // a thin wall (one or two tiles thick) with open ground on both sides; a wall, not water
        // (shots fly over water: battle.ts shotClear)
        const Wall = (x, y) => !W(x, y) && !g.inWater(x, y);
        if (!thin && Wall(x + 1, y) && (W(x + 2, y) || Wall(x + 2, y)) && W(x - 1, y) && W(x - 2, y) && W(x - 3, y) && !W(x + 1, y) && (!W(x + 2, y) ? W(x + 3, y) && W(x + 4, y) : W(x + 2, y) && W(x + 3, y))) thin = { x, y, far: !W(x + 2, y) ? x + 3 : x + 2 };
      }
    }
    return { openSpot, wall, corner, narrow, thin };
  });
  note('map spots found near the players', !!spots.openSpot, spots);

  const lead = (r, c, i = 0) => sTrainer(r, c.id).party[i];
  const place = async (c, i, x, y, extra = {}) => api('/api/dev/stage', { trainer: c.tname, mon: i, set: { x, y, stowed: false, ...extra } });
  const placeTrainer = async (c, x, y) => api('/api/dev/stage', { trainer: c.tname, set: { x, y } });
  // Both trainers stand near the stage, so both browsers are sent the fight (the server sends what is
  // near), but 10 tiles apart, out of each other's battle range.
  const stageAt = async (spot) => {
    const at = await A.p.evaluate(([x, y]) => {
      const g = window.showdown.match.ground;
      const ok = (px, py) => g.walkable(Math.floor(px), Math.floor(py));
      // two standing spots 10 tiles apart, either side of the spot, nearest first; A stays within
      // about 6 tiles of it, so the fight is on A's screen (half a screen is about 10 tiles wide)
      for (let r = 0; r < 12; r++) for (const dy of [r, -r]) for (let dx = 0; dx < 2; dx++) {
        const a = [x - 5 - dx + 0.5, y + dy + 0.5];
        const b = [a[0] + 10, a[1]];
        if (ok(a[0], a[1]) && ok(b[0], b[1])) return { a, b };
      }
      return { a: [x - 5.5, y + 0.5], b: [x + 4.5, y + 0.5] };
    }, [spot.x, spot.y]);
    // A trainer knocked down (wild Pokémon near a spawn can do it before they are cleared) is
    // back on their feet at an outpost in a few seconds: wait for that before staging.
    await until(async () => { const rr = await server(); return rr.trainers.every((t) => t.down === null) || null; }, 20000);
    await placeTrainer(A, at.a[0], at.a[1]);
    await placeTrainer(B, at.b[0], at.b[1]);
    // and keep wild Pokémon out of the staged fight
    await api('/api/dev/clear', { trainer: A.tname, r: 30 });
    await api('/api/dev/clear', { trainer: B.tname, r: 30 });
    await sleep(600);
    // Staged fights are open-field ones: a trainer battle under way would change the rules (leads
    // stowed, one Pokémon each), so say so rather than let the scenario fail for no clear reason.
    const rr = await server();
    const inDuel = rr.trainers.filter((t) => t.duel !== null || t.down !== null).map((t) => `${t.name} ${t.duel !== null ? 'in a trainer battle' : 'down'}`);
    if (inDuel.length) note(`staging at ${spot.x},${spot.y}: no trainer battle under way`, false, inDuel);
  };
  // A move from a browser, as a player makes it: the mouse over the target where that screen shows
  // it, then the move's button (left: the first move, right: the second).
  const castFrom = async (c, slot, targetId) => {
    const at = await c.p.evaluate((targetId) => {
      const m = window.showdown.match; const v = window.showdown.view;
      const t = [...m.mons()].find((q) => q.id === targetId);
      if (!t) return null;
      const k = v.dpr || window.devicePixelRatio || 1;
      const x = v.toScreenX(t.x) / k, y = v.toScreenY(t.y - 0.3) / k;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { off: true, x, y };
      const el = document.elementFromPoint(x, y);
      window.__lastClick = { x, y, el: el ? `${el.tagName}#${el.id}.${el.className}` : null, cam: [v.camX, v.camY], zoom: v.zoom };
      return { x, y };
    }, targetId);
    if (!at) return 'target not on this screen';
    if (at.off) return `target off the edge of this screen (${Math.round(at.x)},${Math.round(at.y)})`;
    await c.p.mouse.move(at.x, at.y);
    await sleep(60);
    await c.p.mouse.click(at.x, at.y, { button: slot === 1 ? 'right' : 'left' });
    return 'clicked';
  };
  const castFromA = (slot, targetId) => castFrom(A, slot, targetId);
  const castFromB = (slot, targetId) => castFrom(B, slot, targetId);
  // Server and both screens agree on a Pokémon: each screen shows what the server has (HP, fainted,
  // position), once its updates have had time to arrive. Polled for up to 4 s after the dust
  // settles; how long the screens took to agree is reported (a screen that never agrees fails).
  const agree = async (id, label, tol = 0.45) => {
    await sleep(800);
    const t0 = Date.now();
    let last = null;
    for (;;) {
      const r = await server();
      const s = sMon(r, id);
      const va = (await view(A)).mons.find((q) => q.id === id);
      const vb = (await view(B)).mons.find((q) => q.id === id);
      const out = { server: s && { hp: s.hp, fainted: s.fainted, x: s.x, y: s.y }, A: va && { hp: va.hp, fainted: va.fainted, x: +va.x.toFixed(2), y: +va.y.toFixed(2) }, B: vb && { hp: vb.hp, fainted: vb.fainted, x: +vb.x.toFixed(2), y: +vb.y.toFixed(2) } };
      const same = (v) => !v || (v.hp === s.hp && v.fainted === s.fainted && (s.fainted || Math.hypot(v.x - s.x, v.y - s.y) < tol));
      // A knocked-out Pokémon leaves the field once its Faint has played: gone from a screen is agreement.
      const seen = !!va || !!vb || (s && s.fainted);
      last = { ok: !!s && same(va) && same(vb) && seen, out: { ...out, agreedAfterMs: Date.now() - t0 + 800 } };
      if (last.ok || Date.now() - t0 > 4000) return last;
      await sleep(150);
    }
  };
  // Everything each screen shows of the fight's Pokémon matches the server (no stale copies left behind).
  const noGhosts = async () => {
    const r = await server();
    const bad = [];
    for (const c of [A, B]) {
      for (const v of (await view(c)).mons) {
        const s = sMon(r, v.id);
        if (!s || !v.owner) continue;
        if (!s.fainted && !s.stowed && !v.stowed && Math.hypot(v.x - s.x, v.y - s.y) > 1.5) bad.push({ screen: c.name, id: v.id, shown: [+v.x.toFixed(1), +v.y.toFixed(1)], server: [s.x, s.y] });
      }
    }
    return bad;
  };

  let r = await server();
  const aLead = () => lead(r, A, 0).id;
  const bMon = (i) => lead(r, B, i).id;
  // B's Pokémon that are out (two at most are, the rest wait in their balls): the k-th, as [party index, id].
  const bOut = (k) => { const ps = sTrainer(r, B.id).party; const out = ps.map((q, i) => [i, q]).filter(([, q]) => !q.fainted && !q.stowed); const e = out[Math.min(k, out.length - 1)]; return e ? [e[0], e[1].id] : [0, ps[0].id]; };
  // The Pokémon a browser's move buttons use (its acting Pokémon), as [party index, id].
  const acting = async (c) => c.p.evaluate(() => { const m = window.showdown.match; const a = m.actingMon; return a ? [m.player.party.indexOf(a), a.id] : null; });

  // ------------------------------------------------------------ 1. a damaging hit causes a faint
  try {
    const s = spots.openSpot;
    await stageAt(s);
    const pa = await place(A, 0, s.x - 1, s.y + 0.5, { moves: ['water-gun', 'tackle'], hp: 999 });
    const pb = await place(B, 0, s.x + 1.5, s.y + 0.5, { hp: 1 });
    await sleep(700);
    if (process.env.COMBAT_DEBUG) console.log('staged', JSON.stringify(pa), JSON.stringify(pb), JSON.stringify((await server()).trainers.map((t) => [t.name, t.x, t.y, t.party.map((q) => [q.id, q.x, q.y])])));
    r = await server();
    const target = bMon(0);
    const ev0 = (await events(0)).length;
    const res = await castFromA(0, target);
    const fainted = await until(async () => sMon(await server(), target)?.fainted, 6000);
    const ag = await agree(target, 'faint');
    const bv = await view(B);
    const row = bv.party.find((q) => q.id === target);
    const evs = (await events(ev0)).filter((e) => e.target === target || e.mon === target);
    // what both sides looked like at the cast, for a failure's sake
    const why = fainted ? undefined : await (async () => {
      const rr = await server();
      const ta = sTrainer(rr, A.id), am = sMon(rr, aLead()), bm = sMon(rr, target);
      const scr = await A.p.evaluate((tid) => { const m = window.showdown.match; const a = m.actingMon; const t = [...m.mons()].find((q) => q.id === tid); return { party: m.player.party.map((q) => [q.id, q.stowed ? 'stowed' : '', q.fainted ? 'fainted' : '', q.captured ? 'captured' : '', q.behavior]), acting: a && a.id, actingAt: a && [a.x, a.y], cooldowns: a && a.cooldowns, status: a && a.status, target: t ? [t.x, t.y] : null, me: [m.player.x, m.player.y], conn: window.__conn }; }, target);
      await A.p.screenshot({ path: `${OUT}/${LABEL}_faint_fail_A.png` });
      const click = await A.p.evaluate(() => window.__lastClick);
      return { click, serverParty: ta.party.map((q) => [q.id, q.stowed ? 'stowed' : '', q.fainted ? 'fainted' : '', q.behavior]), trainerA: { x: ta.x, y: ta.y, duel: ta.duel, down: ta.down, mount: ta.mount }, attacker: am && { id: am.id, x: am.x, y: am.y, casting: am.casting, cooldowns: am.cooldowns, status: am.status, stowed: am.stowed, moves: am.moves }, target: bm && { x: bm.x, y: bm.y }, screenA: scr };
    })();
    note('1 faint: server knocks out the target', !!fainted, { cast: res, events: evs.map((e) => `${e.type}${e.damage ? ` ${e.damage}` : ''}`), why });
    note('1 faint: both screens agree on HP 0 and fainted', ag.ok, ag.out);
    note("1 faint: B's party shows it fainted", !!row && row.fainted && row.hp === 0, row);
    // removed from combat: nothing lands on it afterwards
    const before = (await events(0)).length;
    await castFromA(1, target);
    await sleep(1500);
    const after = (await events(before)).filter((e) => e.type === 'hit' && e.target === target);
    note('1 faint: a fainted Pokémon takes no further hits', after.length === 0, `${after.length} hits after the faint`);
  } catch (e) { note('1 faint', false, String(e)); }

  // ------------------------------------------------------------ 2. knockback: open ground, wall, corner, passage
  for (const [label, s] of [['open ground', spots.openSpot], ['against a wall', spots.wall], ['into a corner', spots.corner], ['in a one-tile passage', spots.narrow]]) {
    if (!s) { note(`2 knockback ${label}`, null, 'no such spot found near the players'); continue; }
    try {
      await stageAt(s);
      r = await server();
      const target = bMon(1);
      // The target on the spot, the attacker a tile west of it: a shove pushes it east (into the wall, the corner, along the passage).
      await place(B, 1, s.x + 0.5, s.y + 0.5, { hp: 999 });
      await place(A, 0, s.x - 0.7, s.y + 0.5, { moves: ['body-slam', 'headbutt'], hp: 999, cooldowns: 0 });
      await sleep(700);
      const p0 = sMon(await server(), target);
      const res = await castFromA(1, target);
      await sleep(2200);
      const p1 = sMon(await server(), target);
      const walk = await A.p.evaluate(([x, y]) => window.showdown.match.ground.walkable(Math.floor(x), Math.floor(y)), [p1.x, p1.y]);
      const ag = await agree(target, 'knock');
      const moved = +Math.hypot(p1.x - p0.x, p1.y - p0.y).toFixed(2);
      note(`2 knockback ${label}: lands on open ground`, walk, { cast: res, from: [p0.x, p0.y], to: [p1.x, p1.y], moved, hp: [p0.hp, p1.hp] });
      if (label === 'open ground') note('2 knockback open ground: the hit pushes it back', p1.hp < p0.hp && moved > 0.1, { moved, hp: [p0.hp, p1.hp] });
      note(`2 knockback ${label}: both screens show it where the server has it`, ag.ok, ag.out);
    } catch (e) { note(`2 knockback ${label}`, false, String(e)); }
  }

  // ------------------------------------------------------------ 3. a lunge at a moving target; a wall in the way
  try {
    const s = spots.openSpot;
    await stageAt(s);
    r = await server();
    const target = bMon(2);
    await place(B, 2, s.x + 2.5, s.y + 0.5, { hp: 999, pin: false, behavior: 'passive' });
    await place(A, 0, s.x - 0.5, s.y + 0.5, { moves: ['quick-attack', 'tackle'], hp: 999, cooldowns: 0 });
    // B walks (real keys in B's browser), so its Pokémon moves with it.
    await B.p.keyboard.down('ArrowDown');
    await sleep(400);
    const ev0 = (await events(0)).length;
    const res = await castFromA(0, target);
    await sleep(1500);
    await B.p.keyboard.up('ArrowDown');
    const evs = (await events(ev0)).filter((e) => e.attacker === aLead());
    const ag = await agree(target, 'lunge', 0.6);
    note('3 lunge at a moving target: server and both screens agree on the outcome', ag.ok, { cast: res, server: evs.map((e) => `${e.type}${e.damage ? ` ${e.damage}` : ''}${e.target ? ` on ${e.target}` : ''}`), ...ag.out });
    await place(B, 2, s.x + 2.5, s.y + 0.5, { pin: true });
  } catch (e) { note('3 lunge at a moving target', false, String(e)); }
  // a wall between: the attacker on one side of the wall face, the target on the other
  if (spots.thin) {
    try {
      const s = spots.thin;
      await stageAt(s);
      r = await server();
      const target = bMon(2);
      const far = { x: s.far, y: s.y };
      if (!far) note('3 lunge through a wall', null, 'no open ground behind this wall');
      else {
        await place(B, 2, far.x + 0.5, far.y + 0.5, { hp: 999 });
        await place(A, 0, s.x + 0.4, s.y + 0.5, { moves: ['quick-attack', 'tackle'], hp: 999, cooldowns: 0 });
        await sleep(700);
        const hp0 = sMon(await server(), target).hp;
        const ev0 = (await events(0)).length;
        const res = await castFromA(0, target);
        await sleep(2000);
        const evs = (await events(ev0)).filter((e) => e.attacker === aLead());
        const hp1 = sMon(await server(), target).hp;
        const ag = await agree(target, 'wall-lunge');
        note('3 lunge with a wall in the way: no hit through the wall', hp1 === hp0, { cast: res, hp: [hp0, hp1], server: evs.map((e) => e.type) });
        note('3 lunge with a wall in the way: screens agree', ag.ok, ag.out);
      }
    } catch (e) { note('3 lunge through a wall', false, String(e)); }
  }

  // ------------------------------------------------------------ 4. projectiles: a miss, and a wall
  try {
    const s = spots.openSpot;
    await stageAt(s);
    r = await server();
    const target = bMon(2);
    await place(B, 2, s.x + 3.5, s.y + 0.5, { hp: 999, pin: false, behavior: 'passive' });
    await place(A, 0, s.x - 2.5, s.y + 0.5, { moves: ['water-gun', 'tackle'], hp: 999, cooldowns: 0 });
    await sleep(500);
    const hp0 = sMon(await server(), target).hp;
    const ev0 = (await events(0)).length;
    // B runs off east, away from A, the moment A fires (north could bring the trainers within
    // battle range of each other, and a trainer battle changes the rules)
    await B.p.keyboard.down('ArrowRight');
    const res = await castFromA(0, target);
    await sleep(1500);
    await B.p.keyboard.up('ArrowRight');
    const evs = (await events(ev0)).filter((e) => e.attacker === aLead());
    const hp1 = sMon(await server(), target).hp;
    const ag = await agree(target, 'shot', 0.6);
    note('4 projectile at a target running off: server and screens agree', ag.ok, { cast: res, hp: [hp0, hp1], server: evs.map((e) => `${e.type}${e.damage ? ` ${e.damage}` : ''}`), ...ag.out });
    await place(B, 2, s.x + 3.5, s.y + 0.5, { pin: true });
  } catch (e) { note('4 projectile miss', false, String(e)); }
  if (spots.thin) {
    try {
      const s = spots.thin;
      await stageAt(s);
      r = await server();
      const target = bMon(2);
      const far = { x: s.far, y: s.y };
      if (!far) note('4 projectile into a wall', null, 'no open ground behind this wall');
      else {
        await place(B, 2, far.x + 0.5, far.y + 0.5, { hp: 999 });
        await place(A, 0, s.x - 2.5, s.y + 0.5, { moves: ['water-gun', 'tackle'], hp: 999, cooldowns: 0 });
        await sleep(600);
        const hp0 = sMon(await server(), target).hp;
        const ev0 = (await events(0)).length;
        const res = await castFromA(0, target);
        await sleep(2000);
        const hp1 = sMon(await server(), target).hp;
        const evs = (await events(ev0)).filter((e) => e.attacker === aLead());
        const ag = await agree(target, 'wall-shot');
        note('4 projectile into a wall: the target behind it is not hit', hp1 === hp0, { cast: res, hp: [hp0, hp1], server: evs.map((e) => e.type) });
        note('4 projectile into a wall: screens agree', ag.ok, ag.out);
      }
    } catch (e) { note('4 projectile into a wall', false, String(e)); }
  }

  // ------------------------------------------------------------ 5. draining moves
  try {
    const s = spots.openSpot;
    await stageAt(s);
    r = await server();
    const [bi, target] = bOut(0);
    const atk = aLead();
    await place(B, bi, s.x + 1.5, s.y + 0.5, { hp: 3, pin: true });
    await place(A, 0, s.x - 1, s.y + 0.5, { moves: ['mega-drain', 'tackle'], hp: 10, cooldowns: 0 });
    await sleep(700);
    const a0 = sMon(await server(), atk).hp;
    const ev0 = (await events(0)).length;
    const res = await castFromA(0, target);
    await until(async () => sMon(await server(), target)?.fainted, 5000);
    await sleep(500);
    const a1 = sMon(await server(), atk).hp;
    const evs = await events(ev0);
    const hit = evs.find((e) => e.type === 'hit' && e.attacker === atk && e.target === target);
    const heal = evs.filter((e) => e.type === 'heal' && e.mon === atk).reduce((n, e) => n + e.amount, 0);
    // A lethal hit took 3 HP (all it had): the heal is half of that (rounded down, at least 1).
    const want = Math.max(1, Math.floor(3 * 0.5));
    note('5 drain on a lethal hit heals from the HP actually taken', heal === want && a1 - a0 === want, { cast: res, damageRolled: hit?.damage, healed: heal, expected: want, attackerHp: [a0, a1] });
    const ag = await agree(atk, 'drain-heal');
    note('5 drain: both screens show the healed HP', ag.ok, ag.out);
  } catch (e) { note('5 drain lethal', false, String(e)); }
  try {
    // the user faints before its draining move lands: B's Pokémon knocks it out first (both in the same moment)
    const s = spots.openSpot;
    await stageAt(s);
    r = await server();
    const atk = aLead();
    const target = bMon(2);
    await place(B, 2, s.x + 2.5, s.y + 0.5, { hp: 999, moves: ['water-gun', 'tackle'], cooldowns: 0 });
    await place(A, 0, s.x - 1.5, s.y + 0.5, { moves: ['giga-drain', 'tackle'], hp: 1, cooldowns: 0 });
    await sleep(700);
    const t0 = sMon(await server(), target).hp;
    const ev0 = (await events(0)).length;
    const [ra] = await Promise.all([castFromA(0, target), api('/api/dev/cast', { trainer: B.tname, mon: 2, slot: 0, target: `${A.tname}#0` })]);
    await sleep(3000);
    const evs = await events(ev0);
    const fainted = sMon(await server(), atk).fainted;
    const heals = evs.filter((e) => e.type === 'heal' && e.mon === atk);
    const dmg = evs.filter((e) => e.type === 'hit' && e.attacker === atk).reduce((n, e) => n + (e.damage ?? 0), 0);
    note('5 drain: a user knocked out before its move lands gets no heal', fainted && heals.length === 0, { castA: ra, userFainted: fainted, damageItDealt: dmg, targetHp: [t0, sMon(await server(), target).hp], heals: heals.length, sequence: evs.filter((e) => e.attacker === atk || e.mon === atk || e.target === atk).map((e) => `${e.type}${e.attacker === atk ? '(by A)' : ''}${e.mon === atk || e.target === atk ? '(on A)' : ''}`) });
    const ag = await agree(atk, 'drain-faint');
    note('5 drain: screens agree the user fainted', ag.ok, ag.out);
    await place(A, 0, s.x - 1.5, s.y + 0.5, { hp: 999 });
  } catch (e) { note('5 drain user faints', false, String(e)); }

  // ------------------------------------------------------------ 6. switching and simultaneous attacks
  try {
    const s = spots.openSpot;
    await stageAt(s);
    r = await server();
    const swap = await A.p.evaluate(() => window.showdown.match.swapLead(1));
    await sleep(1500);
    r = await server();
    const sA = sTrainer(r, A.id);
    const va = await view(A);
    const vb = await view(B);
    const out = (t) => t.party.filter((q) => !q.stowed && !q.fainted).map((q) => q.id);
    note('6 switching: the new lead is out on the server and both screens', swap && sA.party[0].id === va.party[0].id, { server: sA.party.map((q) => `${q.id}${q.stowed ? '(ball)' : ''}`), A: va.party.map((q) => `${q.id}${q.stowed ? '(ball)' : ''}`), Bsees: vb.mons.filter((q) => q.owner === A.id).map((q) => q.id), serverOut: out(sA) });
    // simultaneous: both browsers fire on the same moment
    r = await server();
    const aNow = sTrainer(r, A.id).party[0];
    const [bi, bTarget] = (await acting(B)) ?? bOut(0);
    await place(A, 0, s.x - 1, s.y + 0.5, { moves: ['water-gun', 'tackle'], hp: 999, cooldowns: 0, pin: true });
    await place(B, bi, s.x + 1.5, s.y + 0.5, { moves: ['water-gun', 'tackle'], hp: 999, cooldowns: 0, pin: true });
    await sleep(800);
    const ev0 = (await events(0)).length;
    const [ra, rb] = await Promise.all([castFromA(0, bTarget), castFromB(0, aNow.id)]);
    await sleep(2500);
    const evs = (await events(ev0)).filter((e) => e.type === 'hit');
    const ag1 = await agree(aNow.id, 'simul-A');
    const ag2 = await agree(bTarget, 'simul-B');
    note('6 simultaneous attacks: both land, and server and screens agree on both', evs.length >= 2 && ag1.ok && ag2.ok, { casts: [ra, rb], hits: evs.map((e) => `${e.attacker}->${e.target} ${e.damage}`), A: ag1.out, B: ag2.out });
  } catch (e) { note('6 switching / simultaneous', false, String(e)); }

  // ------------------------------------------------------------ 7. a dropped connection in the middle of combat
  // The line is cut at the server (its TCP socket destroyed, so B's browser sees the connection drop
  // as on a network loss) and B's browser is kept offline for 5 s so it can not reconnect at once;
  // meanwhile A keeps hitting B's Pokémon. (Chromium's offline mode alone leaves an open WebSocket
  // running, so it is used only to hold the reconnect back.)
  try {
    const s = spots.openSpot;
    await stageAt(s);
    r = await server();
    const [bi, target] = bOut(0);
    await place(B, bi, s.x + 1.5, s.y + 0.5, { hp: 999, pin: true });
    await place(A, 0, s.x - 1, s.y + 0.5, { moves: ['water-gun', 'tackle'], cooldowns: 0, pin: true });
    await sleep(600);
    const hp0 = sMon(await server(), target).hp;
    await B.ctx.setOffline(true);
    const dropAt = await B.p.evaluate(() => Math.round(performance.now()));
    await api('/api/dev/drop', { trainer: B.tname });
    const dropped = await until(async () => B.p.evaluate((t0) => window.__conn.some(([at, up]) => !up && at >= t0 - 50), dropAt), 15000, 100);
    const casts = [];
    for (let i = 0; i < 3; i++) {
      await place(A, 0, s.x - 1, s.y + 0.5, { cooldowns: 0 });
      casts.push(await castFromA(0, target));
      await sleep(1000);
    }
    const hpAway = sMon(await server(), target).hp;
    const bAway = (await view(B)).mons.find((q) => q.id === target);
    await sleep(1500);
    await B.ctx.setOffline(false);
    const back = await until(async () => (await view(B)).connected, 30000, 300);
    await sleep(2500);
    const ag = await agree(target, 'reconnect');
    note('7 dropped connection: B sees the line drop', !!dropped, { casts, droppedAt: dropAt, connection: await B.p.evaluate(() => window.__conn) });
    note('7 dropped connection: A fights on meanwhile (the server takes the hits)', hpAway < hp0, { hp: [hp0, hpAway], BshowsWhileAway: bAway && bAway.hp });
    note('7 dropped connection: B reconnects into the running match', !!back);
    note('7 dropped connection: after it, B shows the HP its Pokémon lost while away', ag.ok && ag.out.B && ag.out.B.hp === ag.out.server.hp && ag.out.server.hp <= hpAway, { hpAway, ...ag.out });
    // (a move cast just before B came back can still land after hpAway was read: B must show the
    // server's HP now, which is at most what it was while B was away)
  } catch (e) { note('7 reconnect', false, String(e)); }

  {
    const ghosts = await noGhosts();
    note('screens show no stale copies of the players\' Pokémon', ghosts.length === 0, ghosts.slice(0, 4));
  }

  // ------------------------------------------------------------ 8. a trainer battle to the end: picks, elimination, the winner
  try {
    const s = spots.openSpot;
    await stageAt(s);
    r = await server();
    // B's Pokémon still standing are down to their last HP; then the two trainers walk into battle range.
    const bt = sTrainer(r, B.id);
    for (let i = 0; i < bt.party.length; i++) if (!bt.party[i].fainted) await api('/api/dev/stage', { trainer: B.tname, mon: i, set: { hp: 1, pin: false } });
    for (let i = 0; i < sTrainer(r, A.id).party.length; i++) await api('/api/dev/stage', { trainer: A.tname, mon: i, set: { hp: 999, pin: false, moves: ['water-gun', 'tackle'] } });
    const tA = sTrainer(r, A.id);
    // B steps up to A: open ground 3-4 tiles away with nothing in between (trainers battle in sight)
    const near = await A.p.evaluate(([x, y]) => {
      const g = window.showdown.match.ground;
      const clear = (bx, by) => { for (let i = 1; i <= 8; i++) { const t = i / 8; if (!g.walkable(Math.floor(x + (bx - x) * t), Math.floor(y + (by - y) * t))) return false; } return true; };
      for (const [dx, dy] of [[4, 0], [-4, 0], [0, 4], [0, -4], [3, 2], [-3, 2], [3, -2], [-3, -2], [3, 0], [-3, 0]]) if (clear(x + dx, y + dy)) return [x + dx, y + dy];
      return [x + 4, y];
    }, [tA.x, tA.y]);
    await placeTrainer(B, near[0], near[1]);
    const duel = await until(async () => { const rr = await server(); return rr && sTrainer(rr, A.id).duel !== null && sTrainer(rr, B.id).duel !== null ? sTrainer(rr, A.id).duel : null; }, 10000);
    const seen = await Promise.all([A, B].map((c) => until(() => c.p.evaluate(() => !!window.showdown.match.playerDuel), 5000)));
    note('8 battle: the trainers meet and a one-on-one battle starts (server and both screens)', !!duel && seen[0] && seen[1], { duel, screens: seen });
    let picks = 0;
    for (let n = 0; n < 40; n++) {
      const rr = await server();
      if (!rr || rr.over) break;
      // B picks its next Pokémon when its screen asks (the first that can fight)
      const asked = await B.p.evaluate(() => { const m = window.showdown.match; const d = m.playerDuel; const me = d && (d.a.trainer === m.player ? d.a : d.b); if (!me || !me.awaitingPick) return null; const i = m.player.party.findIndex((q) => !q.fainted && !q.captured); if (i >= 0) m.duelPick(i); return i; });
      if (asked !== null && asked >= 0) picks++;
      const foe = await A.p.evaluate(() => { const m = window.showdown.match; const d = m.playerDuel; const o = d && (d.a.trainer === m.player ? d.b : d.a); return o && o.mon && !o.mon.fainted ? o.mon.id : null; });
      if (foe) {
        await api('/api/dev/stage', { trainer: A.tname, mon: 0, set: { cooldowns: 0 } });
        await castFromA(0, foe);
      }
      await sleep(900);
    }
    note('8 battle: B picks each next Pokémon from its own screen', picks > 0, `${picks} pick${picks === 1 ? '' : 's'}`);
    const over = await until(async () => { const rr = await server(); return !rr ? 'closed' : rr.over ? 'over' : null; }, 10000);
    const outA = await until(async () => (await view(A)).outcome, 10000);
    const outB = await until(async () => (await view(B)).outcome, 10000);
    note('8 elimination: the match ends on the server', !!over, over);
    note('8 winner: A shows the win, B the loss', outA === 'win' && outB === 'loss', { A: outA, B: outB });
    await sleep(2500);
    for (const c of [A, B]) await c.p.screenshot({ path: `${OUT}/${LABEL}_${c.name}_results.png` });
    if (ADMIN) {
      const h = await (await fetch(`${BASE}/api/admin/matches?page=0`, { headers: { cookie: ADMIN } })).json();
      const row = h.matches.find((m) => m.id === room0.id);
      note('8 the match is in the admin history', !!row && row.winner === A.tname && row.humans === 2, row);
      const md = await (await fetch(`${BASE}/api/admin/match?id=${room0.id}`, { headers: { cookie: ADMIN } })).json();
      note('8 admin history: places and outcomes', md.match?.trainers?.some((t) => t.name === A.tname && t.place === 1 && t.outcome === 'win') && md.match.trainers.some((t) => t.name === B.tname && t.place === 2 && t.outcome === 'loss'), md.match?.trainers?.map((t) => `${t.name} #${t.place} ${t.outcome}`));
    }
  } catch (e) { note('8 elimination', false, String(e)); }

  for (const c of [A, B]) {
    // Resource loads this sandbox can not make (fonts and images from other sites, and B's own while
    // it is offline on purpose) are the environment, not the game.
    const envRe = /Failed to load resource|ERR_INTERNET_DISCONNECTED/;
    const env = c.errs.filter((e) => envRe.test(e));
    const game = c.errs.filter((e) => !envRe.test(e));
    if (env.length) note(`${c.name} resource loads failed (environment)`, null, env.slice(0, 3));
    if (game.length) note(`${c.name} browser errors`, false, game.slice(0, 5));
  }
  for (const c of [A, B]) {
    const partial = await c.p.evaluate(() => window.__partial).catch(() => []);
    if (partial && partial.length) note(`${c.name} mirror objects created without their species`, false, partial.slice(0, 3));
  }
  fs.writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify({ label: LABEL, results }, null, 1));
  const failed = results.filter((x) => x.pass === false).length;
  console.log(`${LABEL}: ${results.filter((x) => x.pass === true).length} passed, ${failed} failed, ${results.filter((x) => x.pass === null).length} not run`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
