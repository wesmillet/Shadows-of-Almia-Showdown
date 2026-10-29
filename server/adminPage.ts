/**
 * The administrator's dashboard (/admin): one page over /api/admin/* (server/adminApi.ts). Sign in
 * to the game with an admin account first; the server checks the account's role on every request.
 * Read-only: it shows who is online, accounts and their PCs, and match history.
 */
export const ADMIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin · Shadows of Almia Showdown</title>
<style>
@font-face { font-family: BoldPixels; src: url('/assets/fonts/BoldPixels.ttf'); }
:root { --cream: #f4ecdc; --ink: #4a3424; --dim: #8a6a4a; --accent: #c2611a; --bad: #b0302a; --good: #2e7d32; --blue: #1f5aa0; }
* { box-sizing: border-box; }
body { margin: 0; background: #17112a; color: var(--ink); font-family: system-ui, sans-serif; font-size: 14px; }
header { background: var(--ink); color: var(--cream); padding: 10px 16px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; position: sticky; top: 0; z-index: 2; }
header h1 { font-family: BoldPixels, system-ui; font-weight: normal; font-size: 18px; margin: 0 14px 0 0; }
header button { font: inherit; background: transparent; color: var(--cream); border: 2px solid transparent; padding: 4px 10px; cursor: pointer; }
header button.on { border-color: var(--cream); }
header .who { margin-left: auto; opacity: 0.8; }
header a { color: var(--cream); opacity: 0.8; }
main { max-width: 1100px; margin: 16px auto; padding: 0 16px; }
.panel { background: var(--cream); border: 3px solid var(--ink); box-shadow: 0 4px 0 #2a1d14; padding: 14px 16px; margin-bottom: 14px; overflow-x: auto; }
h2 { font-family: BoldPixels, system-ui; font-weight: normal; margin: 0 0 10px; font-size: 18px; }
h3 { margin: 14px 0 6px; font-size: 15px; }
table { width: 100%; border-collapse: collapse; }
td, th { text-align: left; padding: 5px 6px; border-bottom: 1px dashed #d8c7a6; vertical-align: top; }
th { color: var(--dim); font-weight: normal; font-size: 12px; text-transform: uppercase; }
tr.click { cursor: pointer; } tr.click:hover { background: #fffaf0; }
.dim { color: var(--dim); } .bad { color: var(--bad); } .good { color: var(--good); }
input, select { font: inherit; border: 2px solid var(--ink); background: #fffaf0; color: var(--ink); padding: 5px 7px; }
button.act { font: inherit; background: var(--accent); color: #fff; border: 0; padding: 5px 10px; cursor: pointer; }
button.act.alt { background: #e9dcc2; color: var(--ink); }
button.act:disabled { opacity: 0.4; cursor: default; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
.stat { background: #fffaf0; border: 2px solid var(--ink); padding: 10px; }
.stat b { display: block; font-size: 24px; font-family: system-ui, sans-serif; font-weight: 800; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 6px 0; }
.tag { display: inline-block; padding: 0 5px; border: 1px solid var(--dim); font-size: 12px; margin-right: 3px; white-space: nowrap; }
.tag.guest { border-color: var(--accent); color: var(--accent); }
.tag.bot { border-color: var(--dim); color: var(--dim); }
.tag.human { border-color: var(--blue); color: var(--blue); }
.note { background: #fffaf0; border-left: 4px solid var(--accent); padding: 6px 10px; margin: 8px 0; }
a { color: var(--accent); }
.err { color: var(--bad); }
</style></head><body>
<header><h1>Admin</h1><span id="tabs"></span><span class="who" id="who"></span><a href="/mod">Moderation</a></header>
<main id="main"><div class="panel">Loading...</div></main>
<script>
const TABS = [['online', 'Online'], ['live', 'Live matches'], ['history', 'Match history'], ['accounts', 'Accounts']];
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const when = (t) => t ? new Date(t).toLocaleString() : '-';
const ago = (t) => { if (!t) return '-'; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? s + ' s ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };
const dur = (s) => s == null ? '-' : Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
const who = (p) => p.guest ? '<span class="tag guest">guest</span>' : p.human === false || p.bot ? '<span class="tag bot">bot</span>' : '<span class="tag human">account</span>';
const api = async (path) => {
  let r;
  try { r = await fetch(path, { credentials: 'include' }); } catch { return { error: 'Could not reach the server' }; }
  const j = await r.json().catch(() => ({ error: 'Bad reply (HTTP ' + r.status + ')' }));
  if (!r.ok && !j.error) j.error = 'HTTP ' + r.status;
  return j;
};
let tab = (location.hash.slice(1).split('/')[0]) || 'online';
let timer = null;
function tabs() {
  $('#tabs').innerHTML = TABS.map(([k, l]) => '<button class="' + (k === tab ? 'on' : '') + '" data-t="' + k + '">' + l + '</button>').join('');
  for (const b of document.querySelectorAll('#tabs button')) b.onclick = () => go(b.dataset.t);
}
function go(t, arg) {
  tab = t;
  location.hash = arg !== undefined ? t + '/' + arg : t;
  tabs();
  if (timer) { clearInterval(timer); timer = null; }
  show(t, arg);
}
function fail(e) {
  $('#main').innerHTML = '<div class="panel"><h2>Can not show this</h2><p class="err">' + esc(e) + '</p>' +
    (/Administrators only/.test(e) ? '<p>Sign in to the game in this browser with an administrator account, then reload this page.</p>' : '') + '</div>';
}
async function show(t, arg) {
  if (t === 'online') return online();
  if (t === 'live') return live();
  if (t === 'history') return arg ? match(arg) : history(0);
  if (t === 'accounts') return arg ? account(Number(arg)) : accounts('', 0);
}

// ---------------------------------------------------------------- online
async function online() {
  const draw = async () => {
    const j = await api('/api/admin/online');
    if (j.error) { if (timer) clearInterval(timer); return fail(j.error); }
    $('#who').textContent = 'Signed in as ' + j.you;
    const c = j.counts;
    const st = (n, l) => '<div class="stat"><div class="dim">' + l + '</div><b>' + n + '</b></div>';
    $('#main').innerHTML = '<div class="panel"><h2>Online now</h2><div class="grid">' +
      st(c.humans, 'Players connected') + st(c.accounts, 'Signed in') + st(c.guests, 'Guests') + st(c.bots, 'Computer trainers in matches') + '</div>' +
      '<div class="grid" style="margin-top:10px">' + st(c.hub, 'On the online menu') + st(c.lobby, 'In a lobby, queue or party') + st(c.match, 'Playing a match') + st(c.spectating, 'Spectating') + st(c.away, 'Disconnected, seat held') + '</div>' +
      '<p class="dim">Updated ' + new Date(j.at).toLocaleTimeString() + ' · refreshes every 10 s while this tab is open.</p>' +
      '<div class="note">How players are counted: one entry per player, not per connection. A signed-in account is one player however many tabs or devices it opens (a new tab takes over and the older one is closed). A guest is identified by the guest id its browser keeps, so a guest is one player per browser: two browsers or a private window count as two guests. Computer trainers are counted separately and never as players. A dropped connection leaves the list when the server notices (a closed tab at once, a dead network within about 30 s); a player who drops out of a running match is listed below while the match keeps their seat.</div></div>' +
      '<div class="panel"><h2>Players</h2>' + (j.players.length ? '<table><tr><th>Name</th><th>Kind</th><th>Where</th><th>Match</th><th>Connected</th></tr>' +
        j.players.map((p) => '<tr' + (p.accountId ? ' class="click" data-id="' + p.accountId + '"' : '') + '><td>' + esc(p.name) + '</td><td>' + who(p) + '</td><td>' + esc({ hub: 'Online menu', lobby: 'Lobby / queue / party', match: 'Playing', spectating: 'Spectating' }[p.state]) + '</td><td>' + esc(p.room || '') + '</td><td>' + ago(p.connectedAt) + '</td></tr>').join('') + '</table>' : '<p class="dim">Nobody is connected.</p>') +
      (j.away.length ? '<h3>Disconnected from a running match (seat held for a reconnect)</h3><table><tr><th>Name</th><th>Kind</th><th>Match</th></tr>' + j.away.map((p) => '<tr><td>' + esc(p.name) + '</td><td>' + who(p) + '</td><td>' + esc(p.room) + '</td></tr>').join('') + '</table>' : '') + '</div>';
    for (const r of document.querySelectorAll('tr.click')) r.onclick = () => go('accounts', r.dataset.id);
  };
  await draw();
  timer = setInterval(() => { if (document.visibilityState === 'visible' && tab === 'online') draw(); }, 10000);
}

// ---------------------------------------------------------------- live matches
async function live() {
  const draw = async () => {
    const j = await api('/api/admin/live');
    if (j.error) { if (timer) clearInterval(timer); return fail(j.error); }
    $('#main').innerHTML = '<div class="panel"><h2>Live matches</h2>' + (j.matches.length ? j.matches.map((m) =>
      '<h3>' + esc(m.id) + ' <span class="dim">· ' + esc(m.mode) + ' · ' + dur(m.time) + ' in · started ' + when(m.startedAt) + ' · ' + m.watchers + ' watching</span></h3>' +
      '<table><tr><th>Trainer</th><th>Kind</th><th>Status</th></tr>' + m.trainers.map((t) => '<tr><td>' + esc(t.name) + '</td><td>' + who(t) + '</td><td>' + (t.human ? (t.connected ? 'connected' : '<span class="bad">disconnected (seat held)</span>') : '') + '</td></tr>').join('') + '</table>').join('') : '<p class="dim">No match is running.</p>') +
      '<p class="dim">Refreshes every 10 s while this tab is open. Finished matches move to Match history.</p></div>';
  };
  await draw();
  timer = setInterval(() => { if (document.visibilityState === 'visible' && tab === 'live') draw(); }, 10000);
}

// ---------------------------------------------------------------- history
let hf = { mode: '', player: '', aborted: false };
async function history(page) {
  $('#main').innerHTML = '<div class="panel">Loading matches...</div>';
  const q = new URLSearchParams({ page: String(page) });
  if (hf.mode) q.set('mode', hf.mode);
  if (hf.player) q.set('player', hf.player);
  if (hf.aborted) q.set('aborted', '1');
  const j = await api('/api/admin/matches?' + q);
  if (j.error) return fail(j.error);
  const pages = Math.max(1, Math.ceil(j.total / j.pageSize));
  $('#main').innerHTML = '<div class="panel"><h2>Match history</h2>' +
    '<div class="note">Full match records (duration, every trainer with bots marked, places, stats) start ' + (j.since ? when(j.since) : 'with this release') + '. Matches before that were recorded only for signed-in players (their place, outcome and stats): ' + j.legacy + ' such match' + (j.legacy === 1 ? '' : 'es') + ' can be opened from an account\\'s page.</div>' +
    '<div class="row"><select id="fm"><option value="">Any mode</option><option value="casual">Public</option><option value="private">Private</option></select>' +
    '<input id="fp" placeholder="Trainer name" value="' + esc(hf.player) + '"><label><input type="checkbox" id="fa"' + (hf.aborted ? ' checked' : '') + '> include called-off matches</label><button class="act" id="fgo">Filter</button></div>' +
    (j.matches.length ? '<table><tr><th>Ended</th><th>Mode</th><th>Duration</th><th>Winner</th><th>Trainers</th><th>Humans</th><th>Bots</th></tr>' +
      j.matches.map((m) => '<tr class="click" data-id="' + esc(m.id) + '"><td>' + when(m.ended_at) + '</td><td>' + esc(m.mode) + (m.aborted ? ' <span class="tag">called off</span>' : '') + '</td><td>' + dur(m.seconds) + '</td><td>' + esc(m.winner || '-') + '</td><td>' + m.trainers_n + '</td><td>' + m.humans + '</td><td>' + m.bots + '</td></tr>').join('') + '</table>'
      : '<p class="dim">No completed matches recorded' + (hf.mode || hf.player ? ' for this filter' : ' yet') + '.</p>') +
    '<div class="row"><button class="act alt" id="prev"' + (page <= 0 ? ' disabled' : '') + '>Newer</button><span class="dim">Page ' + (page + 1) + ' of ' + pages + ' · ' + j.total + ' match' + (j.total === 1 ? '' : 'es') + '</span><button class="act alt" id="next"' + (page + 1 >= pages ? ' disabled' : '') + '>Older</button></div></div>';
  $('#fm').value = hf.mode;
  $('#fgo').onclick = () => { hf = { mode: $('#fm').value, player: $('#fp').value.trim(), aborted: $('#fa').checked }; history(0); };
  $('#prev').onclick = () => history(page - 1);
  $('#next').onclick = () => history(page + 1);
  for (const r of document.querySelectorAll('tr.click')) r.onclick = () => go('history', r.dataset.id);
}
async function match(id) {
  $('#main').innerHTML = '<div class="panel">Loading the match...</div>';
  const j = await api('/api/admin/match?id=' + encodeURIComponent(id));
  if (j.error) return fail(j.error);
  const m = j.match;
  if (!j.full) {
    $('#main').innerHTML = '<div class="panel"><h2>Match ' + esc(m.id) + '</h2><p>' + esc(m.mode) + ' · ended ' + when(m.ended_at) + '</p>' +
      '<div class="note">Recorded before full match logging began: only the signed-in players\\' results were kept. Duration, computer trainers and guests were not recorded.</div>' +
      '<table><tr><th>Place</th><th>Trainer</th><th>Outcome</th><th>Catches</th><th>KOs</th><th>Eliminations</th><th>Damage</th><th>Survived</th></tr>' +
      m.players.map((p) => '<tr><td>' + p.place + '</td><td><a href="#accounts/' + p.user_id + '">' + esc(p.username || '(deleted)') + '</a></td><td>' + esc(p.outcome) + '</td><td>' + (p.stats.catches ?? '-') + '</td><td>' + (p.stats.knockouts ?? '-') + '</td><td>' + (p.stats.eliminations ?? '-') + '</td><td>' + Math.round(p.stats.damage ?? 0) + '</td><td>' + dur(p.stats.timeSurvived) + '</td></tr>').join('') + '</table>' +
      '<p><a href="#history">Back to the list</a></p></div>';
    return;
  }
  const ts = Array.isArray(m.trainers) ? m.trainers : Object.values(m.trainers || {});
  $('#main').innerHTML = '<div class="panel"><h2>Match ' + esc(m.id) + '</h2>' +
    '<p>' + esc(m.mode) + ' · started ' + when(m.started_at) + ' · ended ' + when(m.ended_at) + ' · ' + dur(m.seconds) + ' of play · winner: <b>' + esc(m.winner || '-') + '</b>' + (m.aborted ? ' · <span class="bad">called off: ' + esc(m.aborted) + '</span>' : '') + '</p>' +
    '<table><tr><th>Place</th><th>Trainer</th><th>Kind</th><th>Outcome</th><th>Catches</th><th>KOs</th><th>Eliminations</th><th>Damage</th><th>Survived</th></tr>' +
    ts.sort((a, b) => (a.place || 99) - (b.place || 99)).map((t) => '<tr><td>' + (t.place || '-') + '</td><td>' + (t.accountId ? '<a href="#accounts/' + t.accountId + '">' + esc(t.name) + '</a>' : esc(t.name)) + '</td><td>' + who(t) + '</td><td>' + esc(t.outcome || '') + '</td>' +
      (t.stats ? '<td>' + t.stats.catches + '</td><td>' + t.stats.knockouts + '</td><td>' + (t.stats.eliminations ?? 0) + '</td><td>' + Math.round(t.stats.damage) + '</td><td>' + dur(t.stats.timeSurvived) + '</td>' : '<td colspan="5" class="dim">not recorded</td>') + '</tr>').join('') + '</table>' +
    '<p><a href="#history">Back to the list</a></p></div>';
}

// ---------------------------------------------------------------- accounts
async function accounts(q, page) {
  $('#main').innerHTML = '<div class="panel"><h2>Accounts</h2><div class="row"><input id="q" placeholder="Search by username" value="' + esc(q) + '" autofocus><button class="act" id="go">Search</button></div><div id="res" class="dim">Loading...</div></div>';
  const run = async (q, page) => {
    const j = await api('/api/admin/accounts?' + new URLSearchParams({ q, page: String(page) }));
    if (j.error) return fail(j.error);
    const pages = Math.max(1, Math.ceil(j.total / j.pageSize));
    $('#res').className = '';
    $('#res').innerHTML = j.accounts.length ? '<table><tr><th>Username</th><th>Role</th><th>Created</th><th>Last seen</th><th>PC</th></tr>' +
      j.accounts.map((a) => '<tr class="click" data-id="' + a.id + '"><td>' + esc(a.username) + (a.banned ? ' <span class="tag">banned</span>' : '') + '</td><td>' + esc(a.role) + '</td><td>' + when(a.created_at) + '</td><td>' + (a.last_seen ? ago(a.last_seen) : a.device_seen ? ago(a.device_seen) + ' <span class="dim">(device log)</span>' : '-') + '</td><td>' + a.pc + '</td></tr>').join('') + '</table>' +
      '<div class="row"><button class="act alt" id="prev"' + (page <= 0 ? ' disabled' : '') + '>Previous</button><span class="dim">Page ' + (page + 1) + ' of ' + pages + ' · ' + j.total + ' account' + (j.total === 1 ? '' : 's') + '</span><button class="act alt" id="next"' + (page + 1 >= pages ? ' disabled' : '') + '>Next</button></div>'
      : '<p class="dim">No account matches "' + esc(q) + '".</p>';
    for (const r of document.querySelectorAll('tr.click')) r.onclick = () => go('accounts', r.dataset.id);
    const p = $('#prev'), n = $('#next');
    if (p) p.onclick = () => run(q, page - 1);
    if (n) n.onclick = () => run(q, page + 1);
  };
  $('#go').onclick = () => run($('#q').value.trim(), 0);
  $('#q').onkeydown = (e) => { if (e.key === 'Enter') run($('#q').value.trim(), 0); };
  run(q, page);
}
async function account(id) {
  $('#main').innerHTML = '<div class="panel">Loading the account...</div>';
  const j = await api('/api/admin/account?id=' + id);
  if (j.error) return fail(j.error);
  const a = j.account, p = j.progression, s = p.stats || {};
  const pc = j.pc;
  const kv = (k, v) => '<tr><th>' + k + '</th><td>' + v + '</td></tr>';
  $('#main').innerHTML = '<div class="panel"><h2>' + esc(a.username) + '</h2>' +
    '<h3>Saved account</h3><table>' +
    kv('Account id', a.id) + kv('Created', when(a.created_at)) +
    kv('Last seen', j.online ? '<span class="good">online now</span> (' + esc({ hub: 'online menu', lobby: 'lobby / queue / party', match: 'playing match ' + (j.online.room || ''), spectating: 'spectating ' + (j.online.room || '') }[j.online.state]) + ')' : a.last_seen ? when(a.last_seen) + ' (' + ago(a.last_seen) + ')' : j.deviceSeen ? when(j.deviceSeen) + ' <span class="dim">(from the device log; last-seen tracking starts with this release)</span>' : '-') +
    kv('Role', esc(a.role)) + kv('Sign-in', (a.password ? 'password' : '') + (a.password && a.google ? ' + ' : '') + (a.google ? 'Google' : '')) +
    kv('Status', a.banned ? '<span class="bad">banned</span>' : a.muted_until > Date.now() ? 'muted until ' + when(a.muted_until) : 'in good standing') +
    kv('Progression', 'XP ' + p.xp + ' (level ' + p.level + ', trainer levels are hidden in the game)' + (p.title ? ' · title: ' + esc(p.title) : '')) +
    kv('Achievements', p.achievements.length ? p.achievements.map((x) => '<span class="tag">' + esc(x) + '</span>').join('') : '<span class="dim">none</span>') +
    kv('Career stats', (s.matches || 0) + ' matches · ' + (s.wins || 0) + ' wins · ' + (s.catches || 0) + ' catches · ' + (s.knockouts || 0) + ' KOs · ' + (s.eliminations || 0) + ' eliminations · ' + Math.round(s.damage || 0) + ' damage · best place ' + (s.bestPlace ?? '-')) +
    kv('Currencies', '<span class="dim">None saved: Poké Dollars start fresh every match.</span>') +
    kv('Storage chest', j.chest.filter(Boolean).length ? j.chest.filter(Boolean).map((e) => '<span class="tag">' + esc(e.id) + (e.count > 1 ? ' x' + e.count : '') + '</span>').join('') : '<span class="dim">empty</span>') +
    '</table>' +
    '<h3>PC (' + pc.length + ' saved Pokémon)</h3><p class="dim">Saved account data: what this account keeps between matches. A match\\'s party is temporary and is not shown here; only Pokémon extracted at the end of a match are saved.</p>' + (pc.length ? '<table><tr><th>#</th><th>Pokémon</th><th>Dex</th><th>Lv</th><th>Shiny</th><th>Other</th><th>Moves</th><th>Held</th><th>Saved</th></tr>' +
      pc.map((m) => '<tr><td>' + m.id + '</td><td>' + esc(m.nickname || m.name) + '</td><td>' + esc(m.dex) + '</td><td>' + esc(m.level) + '</td><td>' + (m.shiny ? '★' : '') + '</td><td>' + ['alpha', 'legend', 'shadow'].filter((k) => m[k]).map((k) => '<span class="tag">' + k + '</span>').join('') + '</td><td>' + esc((m.moves || []).join(', ')) + '</td><td>' + esc(m.heldItem || '') + '</td><td>' + when(m.savedAt) + '</td></tr>').join('') + '</table>' : '<p class="dim">The PC is empty.</p>') +
    '<h3>Matches</h3><div id="am"></div><p><a href="#accounts">Back to accounts</a></p></div>';
  const drawMatches = (r, page) => {
    const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
    $('#am').innerHTML = r.matches.length ? '<table><tr><th>Ended</th><th>Mode</th><th>Place</th><th>Outcome</th><th></th></tr>' + r.matches.map((m) => '<tr class="click" data-id="' + esc(m.id) + '"><td>' + when(m.ended_at) + '</td><td>' + esc(m.mode) + '</td><td>' + m.place + '</td><td>' + esc(m.outcome) + '</td><td class="dim">' + (m.full ? '' : 'player record only') + '</td></tr>').join('') + '</table>' +
      '<div class="row"><button class="act alt" id="mp"' + (page <= 0 ? ' disabled' : '') + '>Newer</button><span class="dim">Page ' + (page + 1) + ' of ' + pages + '</span><button class="act alt" id="mn"' + (page + 1 >= pages ? ' disabled' : '') + '>Older</button></div>'
      : '<p class="dim">No recorded matches.</p>';
    for (const row of document.querySelectorAll('#am tr.click')) row.onclick = () => go('history', row.dataset.id);
    const pv = $('#mp'), nx = $('#mn');
    const load = async (pg) => { const r2 = await api('/api/admin/account/matches?id=' + id + '&page=' + pg); if (r2.error) return fail(r2.error); drawMatches(r2, pg); };
    if (pv) pv.onclick = () => load(page - 1);
    if (nx) nx.onclick = () => load(page + 1);
  };
  drawMatches(j.matches, 0);
}

window.onhashchange = () => { const [t, arg] = location.hash.slice(1).split('/'); if (t && (t !== tab || arg)) { tab = t; tabs(); if (timer) { clearInterval(timer); timer = null; } show(t, arg ? decodeURIComponent(arg) : undefined); } };
tabs();
{ const [t, arg] = location.hash.slice(1).split('/'); show(t || 'online', arg ? decodeURIComponent(arg) : undefined); }
</script></body></html>`;
