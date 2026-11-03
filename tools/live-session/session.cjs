// A focused live session against a running server, with real browsers (Playwright):
//   prepare  a test account (name and password from the environment) is created or signed in, and
//            gets today's Egg into its PC; nothing else.
//   play     the test account and four guests (five, the live minimum for bots to fill) queue and
//            play one match to its end: bot fill, a dropped connection that comes back, every
//            player's results, watching the rest after being knocked out, the test account keeping a
//            Pokémon, then back to the hub and into the queue again. Before and after, the test
//            account's PC and stats are read back after signing out and in.
// Only the test account and guests are used; nobody else's data is touched. It never prints the
// password. Exit code 1 if any check fails.
//   LIVE_USER=... LIVE_PASS=... node tools/live-session/session.cjs <base url> <prepare|play> [out dir]
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.argv[2];
const MODE = process.argv[3];
const OUT = process.argv[4] || 'live-session-out';
const USER = process.env.LIVE_USER;
const PASS = process.env.LIVE_PASS;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const results = [];
const note = (name, pass, detail) => {
  results.push({ name, pass, detail });
  const d = detail === undefined ? '' : ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s ${name}${d}`);
};
async function until(fn, ms, step = 500) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(step);
  }
}

(async () => {
  if (!USER || !PASS) throw new Error('LIVE_USER and LIVE_PASS are needed');
  const browser = await chromium.launch();
  const open = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    // (/api/admin refused to a player is one of the checks, not an error.)
    p.on('response', (r) => { if (r.status() >= 400 && !/\/api\/(me|pc|admin\/)/.test(r.url())) errs.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    await p.goto(`${BASE}/`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.showdown && window.showdown.net && window.showdown.net.connected, null, { timeout: 120000 });
    return { name, ctx, p, errs };
  };
  // The page's own API calls, with the header the server asks for and the page's cookie.
  const api = (c, path, body) => c.p.evaluate(async ([path, body]) => {
    const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-almia': '1' }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, j };
  }, [path, body]);
  const readAccount = async (c) => {
    const me = await api(c, '/api/me');
    const pc = await api(c, '/api/pc');
    return { signedIn: !!me.j?.signedIn, name: me.j?.user?.username, role: me.j?.user?.role, matches: me.j?.stats?.matches ?? null, xp: me.j?.progress?.xp ?? null, pc: (pc.j?.pc ?? []).map((m) => m.uid) };
  };
  const signIn = async (c) => {
    let r = await api(c, '/api/login', { username: USER, password: PASS });
    if (r.status !== 200) r = await api(c, '/api/register', { username: USER, password: PASS });
    return r.status;
  };

  const A = await open('A');
  if (MODE === 'prepare') {
    const st = await signIn(A);
    note('test account signed in (or created)', st === 200, { status: st });
    const egg = await api(A, '/api/egg/hatch', {});
    note("today's Egg hatched into the test account's PC (or already had)", egg.status === 200 || egg.status === 409, { status: egg.status, got: egg.j?.name ?? egg.j?.error });
    const acc = await readAccount(A);
    note('the account and its PC read back', acc.signedIn && acc.pc.length > 0, { role: acc.role, pc: acc.pc.length, matches: acc.matches });
    fs.writeFileSync(`${OUT}/account-before.json`, JSON.stringify(acc));
    await browser.close();
    process.exit(results.every((r) => r.pass) ? 0 : 1);
  }

  // ---- play
  const st = await signIn(A);
  note('test account signs in after the server restarted', st === 200, { status: st });
  let before = await readAccount(A);
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(`${OUT}/account-before.json`, 'utf8')); } catch {}
  if (prev) note('its PC survived the restart (every Pokémon from before is still there)', prev.pc.every((u) => before.pc.includes(u)), { before: prev.pc.length, now: before.pc.length });
  note('the test account is an ordinary player (not admin)', before.role === 'player', { role: before.role });
  const adm = await api(A, '/api/admin/online');
  note('an ordinary player is refused the admin API', adm.status === 403, { status: adm.status });
  // Sign out and in again: the same account, the same PC.
  await api(A, '/api/logout', {});
  const out = await readAccount(A);
  await signIn(A);
  const back = await readAccount(A);
  note('signing out ends the session; signing in brings back the same PC', !out.signedIn && back.signedIn && JSON.stringify(back.pc) === JSON.stringify(before.pc), { pc: back.pc.length });
  await A.p.reload({ waitUntil: 'load' });
  await A.p.waitForFunction(() => window.showdown && window.showdown.net && window.showdown.net.connected, null, { timeout: 120000 });
  const guests = [];
  for (const n of ['B', 'C', 'D', 'E']) guests.push(await open(n));
  const all = [A, ...guests];

  // Everyone finds a match: roll, take the first starter, queue (what the hub's buttons send).
  for (const c of all) {
    await c.p.evaluate(() => {
      const net = window.showdown.net;
      net.on((m) => { if (m.t === 'roll') net.send({ t: 'queue', pick: 0, mode: 'casual' }); if (m.t === 'start') window.__matchId = m.matchId; });
      net.send({ t: 'roll' });
    });
  }
  const started = await until(async () => { for (const c of all) if (!(await c.p.evaluate(() => !!(window.showdown.match && window.showdown.match.player && window.showdown.match.seat)))) return null; return true; }, 240000);
  note('five players queue and a match starts', !!started);
  if (!started) { await done(); return; }
  await sleep(2000);
  // A match is known by its roster (every trainer's name, in seat order).
  const rosterOf = (c) => c.p.evaluate(() => (window.showdown.mirror?.roster ?? []).map((r) => r.name).join(','));
  const info = await Promise.all(all.map(async (c) => { const r = await rosterOf(c); return { id: r, trainers: r ? r.split(',').length : 0 }; }));
  note('all five are in the same ten-trainer match (computer trainers fill the rest)', new Set(info.map((i) => i.id)).size === 1 && info.every((i) => i.trainers === 10), info.map((i) => i.trainers));
  for (const c of all) c.howShown = await c.p.evaluate(() => !!document.querySelector('.almia-how'));
  note('no how-to-play card pops up at the start (it is in Options)', all.every((c) => !c.howShown));
  await all[0].p.screenshot({ path: `${OUT}/1_match.png` });

  // Walking about, as players start out (auto-battle on).
  const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  const walk = async (c, secs) => {
    const end = Date.now() + secs * 1000;
    while (Date.now() < end) {
      const k = keys[Math.floor(Math.random() * 4)];
      await c.p.keyboard.down(k).catch(() => {}); await sleep(500 + Math.random() * 900); await c.p.keyboard.up(k).catch(() => {});
      await sleep(150);
    }
  };
  await Promise.all(all.map((c) => walk(c, 60)));
  // A dropped connection: C's socket is cut (as a lost network would: the server sees it go) and the
  // browser reconnects on its own. Every change of the connection is logged as it happens.
  const C = all[2];
  await C.p.evaluate(() => { const net = window.showdown.net; let was = net.connected; window.__conn = []; setInterval(() => { if (net.connected !== was) { was = net.connected; window.__conn.push(was ? 'up' : 'down'); } }, 5); });
  const tBefore = await C.p.evaluate(() => window.showdown.match.time);
  await C.p.evaluate(() => window.showdown.net.ws?.close(4999));
  const rejoined = await until(() => C.p.evaluate((tb) => window.__conn.includes('down') && window.showdown.net.connected && window.showdown.match && window.showdown.match.time > tb + 5 && (window.showdown.mirror?.roster ?? []).map((r) => r.name).join(','), tBefore), 60000);
  const seen = await C.p.evaluate((tb) => ({ log: window.__conn.join(' '), connected: window.showdown.net.connected, screen: window.showdown.screen?.constructor?.name ?? null, inMatch: !!window.showdown.match?.seat, advanced: Math.round((window.showdown.match?.time ?? 0) - tb), outcome: window.showdown.match?.seat?.outcome ?? null, roster: (window.showdown.mirror?.roster ?? []).map((r) => r.name).join(',') }), tBefore);
  note('a dropped connection comes back into the same match', !!rejoined && rejoined === info[2].id, { connection: seen.log, connected: seen.connected, inMatch: seen.inMatch, advanced: seen.advanced, outcome: seen.outcome, sameRoster: seen.roster === info[2].id, roster: seen.roster === info[2].id ? undefined : [info[2].id, seen.roster] });

  // Play on until everyone has a result (knocked out, or the winner).
  const outcome = (c) => c.p.evaluate(() => window.showdown.match?.seat?.outcome ?? null).catch(() => null);
  const screenName = (c) => c.p.evaluate(() => window.showdown.screen?.constructor?.name ?? null).catch(() => null);
  const finished = new Map();
  const deadline = Date.now() + 28 * 60 * 1000;
  while (finished.size < all.length && Date.now() < deadline) {
    await Promise.all(all.filter((c) => !finished.has(c)).map((c) => walk(c, 10)));
    for (const c of all) {
      if (finished.has(c)) continue;
      const o = await outcome(c);
      if (o) finished.set(c, { outcome: o, at: Math.round((Date.now() - t0) / 1000) });
    }
  }
  note('every player reached a result', finished.size === all.length, [...finished.values()].map((f) => f.outcome));
  // The results screen: the test account keeps a Pokémon; a knocked-out guest watches the rest.
  await sleep(4000);
  const ends = await Promise.all(all.map((c) => c.p.evaluate(() => { const s = window.showdown.screen; return { has: !!s && typeof s.doneRect === 'function', screen: s?.constructor?.name ?? null, watch: !!(s && s.onWatch), picks: s?.info?.picks ?? null }; }).catch(() => null)));
  note('each player sees the results screen', ends.every((e) => e && e.has), ends);
  await A.p.screenshot({ path: `${OUT}/2_results_A.png` });
  const aPick = await A.p.evaluate(async () => {
    const s = window.showdown.screen;
    for (let i = 0; i < 50 && !(s.info && s.info.party); i++) await new Promise((r) => setTimeout(r, 200));
    if (!s.info?.picks || !s.info?.party?.length) return { picks: s.info?.picks ?? 0 };
    const r = s.pickRects()[0];
    return { picks: s.info.picks, at: { x: r.x + r.w / 2, y: r.y + r.h / 2 } };
  });
  if (aPick.at) {
    await A.p.mouse.click(aPick.at.x, aPick.at.y);
    await sleep(3000);
  }
  // (Watching the rest after being knocked out is switched off on the online build for now.)
  note('watching the rest is not offered (off in this build)', ends.every((e) => e && !e.watch));
  // The test account's earned results, read back after signing out and in.
  // (A match is counted when it ends for everyone: the computer trainers may still be fighting.)
  const after = (await until(async () => { const a = await readAccount(A); return a.matches === (before.matches ?? 0) + 1 ? a : null; }, 20 * 60 * 1000, 10000)) ?? (await readAccount(A));
  await api(A, '/api/logout', {});
  await signIn(A);
  const after2 = await readAccount(A);
  note('the match counted for the test account', after.matches === (before.matches ?? 0) + 1, { matches: [before.matches, after.matches], xp: [before.xp, after.xp] });
  if (aPick.at) note('the Pokémon it kept is in its PC, and still there after signing out and in', after.pc.length === before.pc.length + 1 && JSON.stringify(after2.pc) === JSON.stringify(after.pc), { pc: [before.pc.length, after.pc.length, after2.pc.length] });
  else note('no Pokémon to keep (only a winner, or a voucher, keeps one)', true, aPick);
  // Back to the hub and into another match.
  const B = all[1];
  if (!(await B.p.evaluate(() => !!window.showdown.screen?.doneRect))) await B.p.reload({ waitUntil: 'load' });
  else { await B.p.keyboard.press('Escape'); await sleep(2500); }
  await B.p.waitForFunction(() => window.showdown && window.showdown.net && window.showdown.net.connected, null, { timeout: 60000 });
  const again = await B.p.evaluate(async () => {
    const net = window.showdown.net;
    let got = null;
    net.on((m) => { if (m.t === 'roll') net.send({ t: 'queue', pick: 0, mode: 'casual' }); if (m.t === 'queue' || m.t === 'lobby') got = m.t; });
    net.send({ t: 'roll' });
    for (let i = 0; i < 40 && !got; i++) await new Promise((r) => setTimeout(r, 250));
    net.send({ t: 'leaveQueue' });
    return got;
  });
  note('back at the hub, a player can queue for another match', !!again, { got: again });
  await done();

  async function done() {
    const errs = all.flatMap((c) => c.errs.filter((e) => !/gc\.zgo\.at|goatcounter/i.test(e)).map((e) => `${c.name}: ${e}`));
    note('no page errors in any browser', errs.length === 0, errs.slice(0, 8));
    fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
    await browser.close();
    process.exit(results.every((r) => r.pass) ? 0 : 1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
