/**
 * The administrator's dashboard (/admin): one page over /api/admin/* (server/adminApi.ts). Sign in
 * to the game with an admin account first; the server checks the account's role on every request.
 * It shows who is online, accounts and their PCs, and match history (read-only), and makes Mystery
 * Gift codes (the only thing here that changes anything; it never edits an account).
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
header a.modlink { opacity: 1; border: 2px solid var(--cream); padding: 3px 10px; text-decoration: none; }
.drainrow { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 4px 0 10px; }
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
.health { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 2px solid var(--ink); margin-bottom: 12px; font-size: 18px; }
.health .dot { width: 16px; height: 16px; border-radius: 50%; flex: none; }
.health.ok { background: #e7f3e5; } .health.ok .dot { background: var(--good); }
.health.busy { background: #fbf0d6; } .health.busy .dot { background: #c98a0a; }
.health.over { background: #f8e0dc; } .health.over .dot { background: var(--bad); }
.stat small { display: block; color: var(--dim); font-size: 12px; margin-top: 2px; }
.spark { width: 100%; height: 70px; display: block; background: #fffaf0; border: 1px solid #e0d0b4; }
.charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.charts h4 { margin: 0 0 4px; font-weight: normal; color: var(--dim); font-size: 13px; }
a { color: var(--accent); }
.err { color: var(--bad); }
tr:first-child > th { cursor: pointer; user-select: none; white-space: nowrap; }
tr:first-child > th:hover { color: var(--ink); }
th[data-dir="asc"]::after { content: " \\25B2"; } th[data-dir="desc"]::after { content: " \\25BC"; }
.fb { white-space: pre-wrap; max-width: 420px; }
.badge { background: var(--bad); color: #fff; padding: 0 5px; margin-left: 4px; font-size: 11px; }
</style></head><body>
<header><h1>Admin</h1><span id="tabs"></span><span class="who" id="who"></span><a class="modlink" href="/mod">Moderation page &rarr;</a></header>
<main id="main"><div class="panel">Loading...</div></main>
<script>
const TABS = [['online', 'Online'], ['server', 'Server'], ['live', 'Live matches'], ['history', 'Match history'], ['records', 'Records'], ['accounts', 'Accounts'], ['feedback', 'Feedback'], ['gifts', 'Mystery Gift']];
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Times and durations carry their raw value (data-v) so a column of them sorts by time, not text.
const when = (t) => t ? '<span data-v="' + t + '">' + new Date(t).toLocaleString() + '</span>' : '-';
const ago = (t) => { if (!t) return '-'; const s = Math.round((Date.now() - t) / 1000); return '<span data-v="' + t + '">' + (s < 60 ? s + ' s ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago') + '</span>'; };
const dur = (s) => s == null ? '-' : '<span data-v="' + s + '">' + Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0') + '</span>';
// Click a column header to sort its table (again to reverse). Lists the server pages through
// (accounts, match history) mark their headers data-sort and ask the server instead.
document.addEventListener('click', (e) => {
  const th = e.target.closest ? e.target.closest('th') : null;
  if (!th || th.dataset.sort) return;
  const tr = th.parentElement, table = th.closest('table');
  if (!tr || !table || tr.querySelector('td')) return;
  const i = Array.prototype.indexOf.call(tr.children, th);
  const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
  for (const h of tr.children) delete h.dataset.dir;
  th.dataset.dir = dir;
  const rows = Array.from(table.querySelectorAll('tr')).filter((r) => r !== tr && r.querySelector('td') && r.closest('table') === table);
  const val = (r) => { const c = r.children[i]; if (!c) return ''; const v = c.querySelector('[data-v]'); if (v) return Number(v.dataset.v); const t = c.textContent.trim(); const n = Number(t.replace(/[,%]/g, '')); return t !== '' && t !== '-' && !isNaN(n) ? n : t.toLowerCase(); };
  rows.sort((a, b) => { const x = val(a), y = val(b); const c = typeof x === 'number' && typeof y === 'number' ? x - y : typeof x === 'number' ? -1 : typeof y === 'number' ? 1 : String(x).localeCompare(String(y), undefined, { numeric: true }); return dir === 'asc' ? c : -c; });
  for (const r of rows) r.parentElement.appendChild(r);
});
// A header row for a list the server sorts: key = column, current = { sort, dir }.
const sortHead = (cols, cur) => '<tr>' + cols.map(([k, l]) => k ? '<th data-sort="' + k + '"' + (cur.sort === k ? ' data-dir="' + cur.dir + '"' : '') + '>' + l + '</th>' : '<th>' + l + '</th>').join('') + '</tr>';
const sortClicks = (cur, redo) => { for (const th of document.querySelectorAll('th[data-sort]')) th.onclick = () => { cur.dir = cur.sort === th.dataset.sort && cur.dir === 'asc' ? 'desc' : 'asc'; cur.sort = th.dataset.sort; redo(); }; };
const who = (p) => p.guest ? '<span class="tag guest">guest</span>' : p.human === false || p.bot ? '<span class="tag bot">bot</span>' : '<span class="tag human">account</span>';
const api = async (path, body) => {
  let r;
  const opts = body === undefined ? { credentials: 'include' } : { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Almia': '1' }, body: JSON.stringify(body) };
  try { r = await fetch(path, opts); } catch { return { error: 'Could not reach the server' }; }
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
  if (t === 'server') return server();
  if (t === 'live') return live();
  if (t === 'history') return arg ? match(arg) : history(0);
  if (t === 'accounts') return arg ? account(Number(arg)) : accounts('', 0);
  if (t === 'gifts') return gifts();
  if (t === 'records') return records();
  if (t === 'feedback') return feedback();
}

// ---------------------------------------------------------------- Records
async function records() {
  $('#main').innerHTML = '<div class="panel">Loading records...</div>';
  const j = await api('/api/admin/records');
  if (j.error) return fail(j.error);
  const acct = (id, who) => '<a href="#accounts/' + id + '">' + esc(who) + '</a>';
  const mon = (p) => (p.shiny ? '★ ' : '') + esc(p.name) + ' <span class="dim">Lv ' + esc(p.level) + '</span>';
  const bots = (await api('/api/admin/bots')) || { bots: [], matches: 0, since: null };
  const botTable = (key, label) => {
    const list = bots.bots.slice().sort((a, b) => b[key] - a[key] || b.wins - a.wins).slice(0, 15);
    return '<div><h3>' + label + '</h3>' + (list.length ? '<table><tr><th>#</th><th>Trainer</th><th>Wins</th><th>Elims</th><th>KOs</th><th>Matches</th><th>Win rate</th></tr>' + list.map((b, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(b.name) + '</td><td>' + b.wins + '</td><td>' + b.eliminations + '</td><td>' + b.knockouts + '</td><td>' + b.matches + '</td><td>' + (b.matches ? Math.round(100 * b.wins / b.matches) + '%' : '') + '</td></tr>').join('') + '</table>' : '<p class="dim">None yet.</p>') + '</div>';
  };
  const botsHtml = '<div class="panel"><h2>Computer trainers</h2><p class="dim">Every finished public match since ' + (bots.since ? when(bots.since) : 'the log began') + ' (' + bots.matches + ' matches, ' + bots.bots.length + ' computer trainers).</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px">' + botTable('wins', 'Most wins') + botTable('eliminations', 'Most eliminations') + '</div></div>';
  const d = await api('/api/admin/duplicates');
  const groups = (d && d.groups) || [];
  const suspects = [];
  for (const g of groups) for (const c of g.copies) if (c.suspect && !c.wonder) suspects.push(c.pcId);
  const dupHtml = '<div class="panel"><h2>Duplicate legendaries (' + groups.length + ')</h2><p class="dim">Players holding more than one of a legendary or Mythical line. The first is the original. <b>Likely copy</b>: came in from a win or an Extraction Voucher while they already had one, so most likely their own PC starter kept again (fixed now). Egg, gift and reward copies are never marked. Removing deletes it from their PC for good (the collection log keeps a record).</p>' +
    (groups.length ? '<table><tr><th>Player</th><th>Pokémon</th><th>Copy</th><th>How</th><th>When</th><th></th></tr>' + groups.map((g) => g.copies.map((c, i) => '<tr><td>' + (i === 0 ? acct(g.userId, g.who) : '') + '</td><td>' + (c.shiny ? '★ ' : '') + esc(c.name) + ' <span class="dim">Lv ' + esc(c.level) + '</span>' + (c.legendCatch ? ' <span class="tag">caught as a legend</span>' : '') + '</td><td>' + (i === 0 ? '<span class="good">original</span>' : c.suspect ? '<b class="err">likely copy</b>' : 'copy') + '</td><td>' + esc(c.via) + (c.match ? ' <a href="#history/' + esc(c.match) + '">match</a>' : '') + '</td><td class="dim">' + when(c.at) + '</td><td>' + (i === 0 ? '' : c.wonder ? '<span class="dim">on Wonder Trade</span>' : '<button class="act alt" data-dup="' + c.pcId + '">Remove</button>') + '</td></tr>').join('')).join('') + '</table>' +
      (suspects.length ? '<div class="row"><button class="act" id="dupall">Remove all ' + suspects.length + ' likely copies</button><span id="dupnote" class="err"></span></div>' : '') : '<p class="dim">None.</p>') + '</div>';
  $('#main').innerHTML = botsHtml + dupHtml +
    '<div class="panel"><h2>Legendaries and shinies by player</h2><p class="dim">Every one that went into a PC (won, Extraction Voucher, egg, gift or reward), even if traded or released since.</p>' +
    (j.people.length ? '<table><tr><th>Player</th><th>Legendaries</th><th>Shinies</th><th>Pokémon kept</th></tr>' + j.people.map((p) => '<tr><td>' + acct(p.id, p.who) + '</td><td data-v="' + p.legends + '">' + p.legends + '</td><td data-v="' + p.shinies + '">' + p.shinies + '</td><td data-v="' + p.total + '">' + p.total + '</td></tr>').join('') + '</table>' : '<p class="dim">None yet.</p>') + '</div>' +
    '<div class="panel"><h2>Legendaries (' + j.legends.length + ')</h2>' + (j.legends.length ? '<table><tr><th>When</th><th>Player</th><th>Pokémon</th><th>How</th></tr>' + j.legends.map((l) => '<tr><td>' + when(l.at) + '</td><td>' + acct(l.userId, l.who) + '</td><td>' + (l.shiny ? '★ ' : '') + esc(l.name) + '</td><td>' + esc(l.via) + '</td></tr>').join('') + '</table>' : '<p class="dim">None yet.</p>') + '</div>' +
    '<div class="panel"><h2>Shinies (' + j.shinies.length + ')</h2>' + (j.shinies.length ? '<table><tr><th>When</th><th>Player</th><th>Pokémon</th><th>How</th></tr>' + j.shinies.map((l) => '<tr><td>' + when(l.at) + '</td><td>' + acct(l.userId, l.who) + '</td><td>★ ' + esc(l.name) + (l.legend ? ' <span class="dim">(legendary)</span>' : '') + '</td><td>' + esc(l.via) + '</td></tr>').join('') + '</table>' : '<p class="dim">None yet.</p>') + '</div>' +
    '<div class="panel"><h2>Most common on winning teams</h2><p class="dim">From the last ' + j.teamsCounted + ' winning teams recorded.</p>' + (j.winningSpecies.length ? '<table><tr><th>Pokémon</th><th>Winning teams</th></tr>' + j.winningSpecies.map((w) => '<tr><td>' + esc(w.name) + '</td><td data-v="' + w.n + '">' + w.n + '</td></tr>').join('') + '</table>' : '<p class="dim">No winning teams recorded yet (recording starts with this update).</p>') + '</div>' +
    '<div class="panel"><h2>Winning teams</h2>' + (j.teams.length ? '<table><tr><th>When</th><th>Winner</th><th>Team</th><th></th></tr>' + j.teams.map((t) => '<tr><td>' + when(t.at) + '</td><td>' + esc(t.name) + (t.human ? '' : ' <span class="dim">(computer)</span>') + '</td><td>' + t.team.map(mon).join(', ') + '</td><td><a href="#history/' + esc(t.id) + '">match</a></td></tr>').join('') + '</table>' : '<p class="dim">None yet.</p>') + '</div>';
  const removeDup = async (ids, label) => {
    if (!confirm('Remove ' + label + ' from ' + (ids.length === 1 ? 'that PC' : 'those PCs') + ' for good?')) return;
    const r = await post('/api/admin/duplicates', { ids });
    const bad = (r.results || []).filter((x) => x.error);
    if (r.error || bad.length) alert(r.error || bad.map((x) => '#' + x.id + ': ' + x.error).join('; '));
    records();
  };
  for (const b of document.querySelectorAll('[data-dup]')) b.onclick = () => removeDup([Number(b.dataset.dup)], 'this copy');
  const all = $('#dupall');
  if (all) all.onclick = () => removeDup(suspects, 'all ' + suspects.length + ' likely copies');
}

// ---------------------------------------------------------------- Mystery Gift
const post = async (path, body) => {
  let r;
  try { r = await fetch(path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Almia': '1' }, body: JSON.stringify(body) }); } catch { return { error: 'Could not reach the server' }; }
  const j = await r.json().catch(() => ({ error: 'Bad reply (HTTP ' + r.status + ')' }));
  if (!r.ok && !j.error) j.error = 'HTTP ' + r.status;
  return j;
};
async function gifts(msg) {
  const j = await api('/api/admin/gifts');
  if (j.error) return fail(j.error);
  const what = (c) => c.kind === 'pokemon' ? (c.payload.shiny ? '★ ' : '') + esc(c.payload.name || ('#' + c.payload.dex)) + ' Lv ' + esc(c.payload.level) : 'Look: ' + esc((j.looks.find((l) => l.id === c.payload.look) || { name: c.payload.look }).name);
  $('#main').innerHTML = '<div class="panel"><h2>Make a Mystery Gift code</h2>' +
    '<p class="dim">Players enter the code on the home page (Mystery Gift). Each account can use a code once. A Pokémon goes straight to their PC; a look unlocks for them on the Trainer screen.</p>' +
    (msg ? '<div class="note">' + msg + '</div>' : '') +
    '<div class="row"><label>Code <input id="gc" placeholder="leave empty: made up for you" maxlength="24" style="text-transform:uppercase"></label></div>' +
    '<div class="row"><label>Gives <select id="gk"><option value="pokemon">a Pokémon</option><option value="look">a look (skin)</option></select></label></div>' +
    '<div class="row" id="gpk"><label>Pokémon <input id="gd" placeholder="number or name, e.g. 25 or Pikachu" size="28"></label><label>Level <input id="gl" type="number" min="1" max="100" value="5" style="width:70px"></label><label><input type="checkbox" id="gs"> Shiny</label></div>' +
    '<div class="row" id="glk" style="display:none"><label>Look <select id="go">' + j.looks.map((l) => '<option value="' + esc(l.id) + '">' + esc(l.name) + ' (' + esc(l.id) + ')</option>').join('') + '</select></label></div>' +
    '<div class="row"><label>Uses <input id="gu" type="number" min="1" placeholder="no limit" style="width:100px"></label><label>Expires <input id="ge" type="date"></label><label>Note <input id="gn" placeholder="for yourself, e.g. who it is for" size="30"></label></div>' +
    '<div class="row"><button class="act" id="gmake">Make code</button><span class="err" id="gerr"></span></div></div>' +
    '<div class="panel"><h2>Codes</h2>' + (j.codes.length ? '<table><tr><th>Code</th><th>Gives</th><th>Used</th><th>Expires</th><th>Note</th><th>Made</th><th></th></tr>' +
      j.codes.map((c) => '<tr><td><b>' + esc(c.code) + '</b></td><td>' + what(c) + '</td><td><a href="#" data-who="' + esc(c.code) + '">' + c.uses + (c.max_uses ? ' / ' + c.max_uses : '') + '</a></td><td>' + (c.expires_at ? when(c.expires_at) : '-') + '</td><td>' + esc(c.note || '') + '</td><td>' + when(c.created_at) + ' by ' + esc(c.created_by) + '</td><td>' +
        '<button class="act alt" data-code="' + esc(c.code) + '" data-on="' + (c.active ? 0 : 1) + '">' + (c.active ? 'Switch off' : 'Switch on') + '</button>' + (c.active ? '' : ' <span class="bad">off</span>') + '</td></tr>').join('') + '</table><div id="gwho"></div>' : '<p class="dim">No codes yet.</p>') + '</div>';
  const kind = $('#gk');
  kind.onchange = () => { $('#gpk').style.display = kind.value === 'pokemon' ? '' : 'none'; $('#glk').style.display = kind.value === 'look' ? '' : 'none'; };
  $('#gmake').onclick = async () => {
    const exp = $('#ge').value ? new Date($('#ge').value + 'T23:59:59').getTime() : null;
    const r = await post('/api/admin/gifts', { code: $('#gc').value, kind: kind.value, dex: $('#gd').value, level: Number($('#gl').value), shiny: $('#gs').checked, look: $('#go').value, maxUses: $('#gu').value === '' ? null : Number($('#gu').value), expiresAt: exp, note: $('#gn').value });
    if (r.error) { $('#gerr').textContent = r.error; return; }
    gifts('Made <b>' + esc(r.code) + '</b>: give it to players to enter on the home page (Mystery Gift).');
  };
  for (const b of document.querySelectorAll('button[data-code]')) b.onclick = async () => {
    const r = await post('/api/admin/gifts/active', { code: b.dataset.code, active: b.dataset.on === '1' });
    if (r.error) return fail(r.error);
    gifts();
  };
  for (const a of document.querySelectorAll('a[data-who]')) a.onclick = async (e) => {
    e.preventDefault();
    const r = await api('/api/admin/gifts?code=' + encodeURIComponent(a.dataset.who));
    $('#gwho').innerHTML = '<h3>Used ' + esc(a.dataset.who) + '</h3>' + (r.redemptions && r.redemptions.length ? '<table><tr><th>Account</th><th>When</th></tr>' + r.redemptions.map((x) => '<tr><td>' + esc(x.username) + '</td><td>' + when(x.at) + '</td></tr>').join('') + '</table>' : '<p class="dim">Nobody yet.</p>');
  };
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

// ---------------------------------------------------------------- server health
/** A small line chart of one measure over the last hour (an optional dashed line marks trouble). */
function spark(vals, max, color, warn) {
  const w = 300, h = 70;
  if (!vals.length) return '<svg class="spark" viewBox="0 0 300 70"></svg>';
  const top = Math.max(max, ...vals, 1);
  const x = (i) => vals.length < 2 ? w : (i / (vals.length - 1)) * w;
  const y = (v) => h - 4 - (v / top) * (h - 8);
  const pts = vals.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
  return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
    (warn !== undefined && warn <= top ? '<line x1="0" x2="' + w + '" y1="' + y(warn) + '" y2="' + y(warn) + '" stroke="#b0302a" stroke-dasharray="4 4" stroke-width="1"/>' : '') +
    '<polyline points="' + x(0) + ',' + h + ' ' + pts + ' ' + w + ',' + h + '" fill="' + color + '22" stroke="none"/>' +
    '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';
}
async function server() {
  const draw = async () => {
    const j = await api('/api/admin/server');
    if (j.error) { if (timer) clearInterval(timer); return fail(j.error); }
    const ss = j.samples || [];
    const s = ss[ss.length - 1] || { players: 0, rooms: 0, queued: 0, cpuPct: 0, memPct: 0, stepAvg: 0, stepMax: 0, lag: 0, rssMb: 0, kbOut: 0 };
    // About a fifth of a core per full match (measured): three a core is comfortable.
    const comfy = Math.max(1, j.cores * 3);
    // Recent worst (the last 30 s) decides the verdict, so one slow moment does not.
    const recent = ss.slice(-3);
    const cpu = Math.max(0, ...recent.map((x) => x.cpuPct || 0));
    // Clock delay only counts while matches run (starting up and quiet moments are not trouble).
    const lag = Math.max(0, ...recent.map((x) => (x.rooms ? x.lag || 0 : 0)));
    const busyStep = Math.max(0, ...recent.map((x) => (x.stepAvg || 0) * 60 / 10));
    const over = cpu >= 85 || lag >= 100 || busyStep >= 70;
    const busy = !over && (cpu >= 60 || lag >= 50 || s.rooms >= comfy);
    const verdict = over
      ? ['over', 'Overloaded: matches are lagging. Scale up now (Launch online server, size surge; see the emergency doc).']
      : busy ? ['busy', 'Busy: fine for now, but close to the limit. Get ready to scale up if more lobbies fill.']
      : ['ok', 'Healthy: plenty of room.'];
    const st = (v, l, sub) => '<div class="stat"><b>' + v + '</b>' + l + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
    const up = Math.round((Date.now() - j.startedAt) / 1000);
    const upText = up < 3600 ? Math.round(up / 60) + ' min' : up < 86400 ? (up / 3600).toFixed(1) + ' h' : (up / 86400).toFixed(1) + ' days';
    const col = (k) => ss.map((x) => x[k] || 0);
    // Drain: no new matches start (the ones running finish); for a deploy. Same switch as /mod#server.
    const drain = '<div class="drainrow">' + (j.draining
      ? '<b class="bad">DRAINING: no new matches</b><button class="act" data-drain="0">Let matches start</button>'
      : '<button class="act alt" data-drain="1">Drain (no new matches)</button>') +
      '<span class="dim">' + s.rooms + ' match' + (s.rooms === 1 ? '' : 'es') + ' running</span><a href="/mod#server">Moderation: Server &rarr;</a></div>';
    $('#main').innerHTML = '<div class="panel"><h2>Server health</h2>' + drain +
      '<div class="health ' + verdict[0] + '"><span class="dot"></span><span>' + verdict[1] + '</span></div>' +
      '<div class="grid">' +
        st(s.cpuPct + '%', 'CPU in use', j.cores + ' core' + (j.cores === 1 ? '' : 's') + '; trouble above 85%') +
        st(s.rooms + ' / ~' + comfy, 'Matches running', 'about ' + comfy + ' fit comfortably') +
        st(s.players, 'Players connected', s.queued + ' in the queue') +
        st(s.lag + ' ms', 'Game clock delay', 'worst in 10 s; trouble above 100 ms') +
        st((s.stepAvg || 0).toFixed(2) + ' ms', 'Per game tick', 'average over all matches; worst ' + (s.stepMax || 0) + ' ms') +
        st(s.memPct + '%', 'Memory in use', s.rssMb + ' MB by the game of ' + j.memoryMb + ' MB') +
        st(s.kbOut + ' KB/s', 'Sent to players', 'before compression') +
        st(upText, 'Up since restart', 'build ' + esc(j.build) + (j.draining ? ' · <span class="bad">draining</span>' : '')) +
      '</div>' +
      '<h3>Last hour</h3><div class="charts">' +
        '<div><h4>CPU % (dashed: 85%)</h4>' + spark(col('cpuPct'), 100, '#c2611a', 85) + '</div>' +
        '<div><h4>Matches running (dashed: comfortable limit)</h4>' + spark(col('rooms'), comfy + 1, '#1f5aa0', comfy) + '</div>' +
        '<div><h4>Players connected</h4>' + spark(col('players'), 10, '#2e7d32') + '</div>' +
        '<div><h4>Game clock delay, ms (dashed: 100)</h4>' + spark(col('lag'), 120, '#b0302a', 100) + '</div>' +
      '</div>' +
      '<p class="dim">Samples every 10 s, kept for an hour (they start over when the server restarts). Updated ' + new Date(j.at).toLocaleTimeString() + '; refreshes every 10 s while this tab is open.</p></div>';
  };
  // The drain buttons are drawn again on every refresh: wire them each time.
  const wireDrain = () => {
    for (const x of document.querySelectorAll('[data-drain]')) x.onclick = async () => {
      x.disabled = true;
      const res = await api('/api/mod/drain', { on: x.dataset.drain === '1' });
      if (res.error) alert(res.error);
      await draw();
      wireDrain();
    };
  };
  await draw();
  wireDrain();
  timer = setInterval(async () => { if (document.visibilityState === 'visible' && tab === 'server') { await draw(); wireDrain(); } }, 10000);
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
const hs = { sort: '', dir: 'desc' };
async function history(page) {
  $('#main').innerHTML = '<div class="panel">Loading matches...</div>';
  const q = new URLSearchParams({ page: String(page) });
  if (hf.mode) q.set('mode', hf.mode);
  if (hf.player) q.set('player', hf.player);
  if (hf.aborted) q.set('aborted', '1');
  if (hs.sort) { q.set('sort', hs.sort); q.set('dir', hs.dir); }
  const j = await api('/api/admin/matches?' + q);
  if (j.error) return fail(j.error);
  const pages = Math.max(1, Math.ceil(j.total / j.pageSize));
  $('#main').innerHTML = '<div class="panel"><h2>Match history</h2>' +
    '<div class="note">Full match records (duration, every trainer with bots marked, places, stats) start ' + (j.since ? when(j.since) : 'with this release') + '. Matches before that were recorded only for signed-in players (their place, outcome and stats): ' + j.legacy + ' such match' + (j.legacy === 1 ? '' : 'es') + ' can be opened from an account\\'s page.</div>' +
    '<div class="row"><select id="fm"><option value="">Any mode</option><option value="casual">Public</option><option value="private">Private</option></select>' +
    '<input id="fp" placeholder="Trainer name" value="' + esc(hf.player) + '"><label><input type="checkbox" id="fa"' + (hf.aborted ? ' checked' : '') + '> include called-off matches</label><button class="act" id="fgo">Filter</button></div>' +
    (j.matches.length ? '<table>' + sortHead([['ended_at', 'Ended'], ['mode', 'Mode'], ['seconds', 'Duration'], ['winner', 'Winner'], ['trainers_n', 'Trainers'], ['humans', 'Humans'], ['bots', 'Bots']], hs) +
      j.matches.map((m) => '<tr class="click" data-id="' + esc(m.id) + '"><td>' + when(m.ended_at) + '</td><td>' + esc(m.mode) + (m.aborted ? ' <span class="tag">called off</span>' : '') + '</td><td>' + dur(m.seconds) + '</td><td>' + esc(m.winner || '-') + '</td><td>' + m.trainers_n + '</td><td>' + m.humans + '</td><td>' + m.bots + '</td></tr>').join('') + '</table>'
      : '<p class="dim">No completed matches recorded' + (hf.mode || hf.player ? ' for this filter' : ' yet') + '.</p>') +
    '<div class="row"><button class="act alt" id="prev"' + (page <= 0 ? ' disabled' : '') + '>Newer</button><span class="dim">Page ' + (page + 1) + ' of ' + pages + ' · ' + j.total + ' match' + (j.total === 1 ? '' : 'es') + '</span><button class="act alt" id="next"' + (page + 1 >= pages ? ' disabled' : '') + '>Older</button></div></div>';
  $('#fm').value = hf.mode;
  $('#fgo').onclick = () => { hf = { mode: $('#fm').value, player: $('#fp').value.trim(), aborted: $('#fa').checked }; history(0); };
  $('#prev').onclick = () => history(page - 1);
  $('#next').onclick = () => history(page + 1);
  sortClicks(hs, () => history(0));
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

// ---------------------------------------------------------------- feedback
let ff = { kind: '', status: 'new' };
async function feedback() {
  const q = new URLSearchParams(ff);
  const j = await api('/api/admin/feedback?' + q);
  if (j.error) return fail(j.error);
  const c = j.counts || {};
  const kinds = { bug: 'Bug', suggestion: 'Suggestion', feedback: 'Feedback' };
  $('#main').innerHTML = '<div class="panel"><h2>Feedback</h2>' +
    '<p class="dim">Sent from Options, Send feedback (guests too). ' + (c.new || 0) + ' new · ' + (c.seen || 0) + ' seen · ' + (c.done || 0) + ' done. Click a column header to sort.</p>' +
    '<div class="row"><select id="fk"><option value="">Every kind</option><option value="bug">Bugs</option><option value="suggestion">Suggestions</option><option value="feedback">Feedback</option></select>' +
    '<select id="fs"><option value="">Any status</option><option value="new">New</option><option value="seen">Seen</option><option value="done">Done</option></select><button class="act" id="fgo">Show</button></div>' +
    (j.items.length ? '<table><tr><th>When</th><th>From</th><th>Kind</th><th>Message</th><th>Status</th><th>Note</th><th>Build / device</th></tr>' +
      j.items.map((f) => '<tr><td>' + when(f.at) + '</td><td>' + (f.user_id ? '<a href="#accounts/' + f.user_id + '">' + esc(f.name) + '</a>' : '<span class="tag guest">guest</span>') + '</td><td>' + esc(kinds[f.kind] || f.kind) + '</td><td class="fb">' + esc(f.text) + '</td>' +
        '<td><select data-st="' + f.id + '">' + ['new', 'seen', 'done'].map((s) => '<option value="' + s + '"' + (f.status === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></td>' +
        '<td>' + (f.note ? esc(f.note) + ' ' : '') + '<a href="#" data-note="' + f.id + '">' + (f.note ? 'edit' : 'add') + '</a></td><td class="dim" style="font-size:12px">' + esc(f.build || '') + '<br>' + esc(f.device || '') + '</td></tr>').join('') + '</table>'
      : '<p class="dim">Nothing here.</p>') + '</div>';
  $('#fk').value = ff.kind;
  $('#fs').value = ff.status;
  $('#fgo').onclick = () => { ff = { kind: $('#fk').value, status: $('#fs').value }; feedback(); };
  for (const s of document.querySelectorAll('[data-st]')) s.onchange = async () => { const r = await post('/api/admin/feedback', { id: Number(s.dataset.st), status: s.value }); if (r.error) alert(r.error); };
  for (const a of document.querySelectorAll('[data-note]')) a.onclick = async (e) => {
    e.preventDefault();
    const f = j.items.find((x) => x.id === Number(a.dataset.note));
    const note = prompt('A note for yourself on this one:', (f && f.note) || '');
    if (note === null) return;
    const r = await post('/api/admin/feedback', { id: Number(a.dataset.note), note });
    if (r.error) alert(r.error); else feedback();
  };
}

// ---------------------------------------------------------------- accounts
const as = { sort: '', dir: 'asc' };
async function accounts(q, page) {
  $('#main').innerHTML = '<div class="panel"><h2>Accounts</h2><div class="row"><input id="q" placeholder="Search by username" value="' + esc(q) + '" autofocus><button class="act" id="go">Search</button></div><div id="res" class="dim">Loading...</div></div>';
  const run = async (q, page) => {
    const j = await api('/api/admin/accounts?' + new URLSearchParams(Object.assign({ q, page: String(page) }, as.sort ? { sort: as.sort, dir: as.dir } : {})));
    if (j.error) return fail(j.error);
    const pages = Math.max(1, Math.ceil(j.total / j.pageSize));
    $('#res').className = '';
    $('#res').innerHTML = j.accounts.length ? '<table>' + sortHead([['username', 'Username'], ['role', 'Role'], ['created_at', 'Created'], ['last_seen', 'Last seen'], ['pc', 'PC']], as) +
      j.accounts.map((a) => '<tr class="click" data-id="' + a.id + '"><td>' + esc(a.username) + (a.banned ? ' <span class="tag">banned</span>' : '') + '</td><td>' + esc(a.role) + '</td><td>' + when(a.created_at) + '</td><td>' + (a.last_seen ? ago(a.last_seen) : a.device_seen ? ago(a.device_seen) + ' <span class="dim">(device log)</span>' : '-') + '</td><td>' + a.pc + '</td></tr>').join('') + '</table>' +
      '<div class="row"><button class="act alt" id="prev"' + (page <= 0 ? ' disabled' : '') + '>Previous</button><span class="dim">Page ' + (page + 1) + ' of ' + pages + ' · ' + j.total + ' account' + (j.total === 1 ? '' : 's') + '</span><button class="act alt" id="next"' + (page + 1 >= pages ? ' disabled' : '') + '>Next</button></div>'
      : '<p class="dim">No account matches "' + esc(q) + '".</p>';
    for (const r of document.querySelectorAll('tr.click')) r.onclick = () => go('accounts', r.dataset.id);
    sortClicks(as, () => run(q, 0));
    const p = $('#prev'), n = $('#next');
    if (p) p.onclick = () => run(q, page - 1);
    if (n) n.onclick = () => run(q, page + 1);
  };
  $('#go').onclick = () => run($('#q').value.trim(), 0);
  $('#q').onkeydown = (e) => { if (e.key === 'Enter') run($('#q').value.trim(), 0); };
  run(q, page);
}
async function drawGift(a) {
  const g = await api('/api/admin/account/gifts?id=' + a.id);
  const box = document.getElementById('gift');
  if (!box) return;
  if (g.error) { box.innerHTML = '<p class="err">' + esc(g.error) + '</p>'; return; }
  const what = (x) => !x ? 'message only' : x.kind === 'pokemon' ? (x.shiny ? '★ ' : '') + esc(x.name) + ' Lv ' + x.level : x.kind === 'look' ? 'look: ' + esc(x.name) : esc(x.name) + ' x' + x.count;
  box.className = '';
  box.innerHTML = '<p class="dim">They see it the next time they open the online menu, and claim it there: a Pokémon goes to their PC, a look to their Trainer screen, items to their storage chest.</p>' +
    '<div class="row"><label>Message <input id="gm" maxlength="500" size="60" placeholder="e.g. Thanks for reporting that bug!"></label></div>' +
    '<div class="row"><label>Gift <select id="gk2"><option value="">nothing, just the message</option><option value="pokemon">a Pokémon</option><option value="item">items</option><option value="look">a look</option></select></label>' +
    '<span id="gp2" style="display:none"><input id="gd2" placeholder="Pokémon: number or name" size="22"> Lv <input id="gl2" type="number" min="1" max="100" value="5" style="width:64px"> <label><input type="checkbox" id="gs2"> Shiny</label></span>' +
    '<span id="gi2" style="display:none"><input id="gitem" list="gitems" placeholder="item name" size="22"><datalist id="gitems">' + g.items.map((i) => '<option value="' + esc(i.name) + '">').join('') + '</datalist> x <input id="gc2" type="number" min="1" max="999" value="1" style="width:70px"></span>' +
    '<span id="glk2" style="display:none"><select id="glook">' + g.looks.map((l) => '<option value="' + esc(l.id) + '">' + esc(l.name) + '</option>').join('') + '</select></span></div>' +
    '<div class="row"><button class="act" id="gsend">Send to ' + esc(a.username) + '</button><span id="gout"></span></div>' +
    (g.gifts.length ? '<table><tr><th>Sent</th><th>From</th><th>Gift</th><th>Message</th><th>Claimed</th></tr>' + g.gifts.map((x) => '<tr><td>' + when(x.at) + '</td><td>' + esc(x.from) + '</td><td>' + what(x.gift) + '</td><td>' + esc(x.message) + '</td><td>' + (x.claimedAt ? when(x.claimedAt) : '<span class="dim">waiting</span>') + '</td></tr>').join('') + '</table>' : '');
  const kind = $('#gk2');
  kind.onchange = () => { $('#gp2').style.display = kind.value === 'pokemon' ? '' : 'none'; $('#gi2').style.display = kind.value === 'item' ? '' : 'none'; $('#glk2').style.display = kind.value === 'look' ? '' : 'none'; };
  $('#gsend').onclick = async () => {
    const body = { id: a.id, message: $('#gm').value.trim() };
    if (kind.value === 'pokemon') Object.assign(body, { kind: 'pokemon', dex: $('#gd2').value.trim(), level: Number($('#gl2').value), shiny: $('#gs2').checked });
    if (kind.value === 'item') Object.assign(body, { kind: 'item', item: $('#gitem').value.trim(), count: Number($('#gc2').value) });
    if (kind.value === 'look') Object.assign(body, { kind: 'look', look: $('#glook').value });
    $('#gsend').disabled = true;
    const r = await post('/api/admin/account/gift', body);
    $('#gsend').disabled = false;
    if (r.error) { $('#gout').innerHTML = '<span class="err">' + esc(r.error) + '</span>'; return; }
    drawGift(a);
  };
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
    kv('Email', a.email === 'confirmed' ? 'on file, confirmed <span class="dim">(the player can reset their password by email)</span>' : a.email === 'unconfirmed' ? 'on file, not confirmed yet' : '<span class="dim">none</span>') +
    (a.password ? kv('Locked out?', '<button class="act" id="reset">Make a reset code</button> <span class="dim">One-time, 24 hours. Give it only to the account owner: they type it in "Forgot your password?" as the recovery code.</span><div id="resetOut"></div>') : '') +
    kv('Status', a.banned ? '<span class="bad">banned</span>' : a.muted_until > Date.now() ? 'muted until ' + when(a.muted_until) : 'in good standing') +
    kv('Progression', 'XP ' + p.xp + ' (level ' + p.level + ', trainer levels are hidden in the game)' + (p.title ? ' · title: ' + esc(p.title) : '')) +
    kv('Achievements', p.achievements.length ? p.achievements.map((x) => '<span class="tag">' + esc(x) + '</span>').join('') : '<span class="dim">none</span>') +
    kv('Career stats', (s.matches || 0) + ' matches · ' + (s.wins || 0) + ' wins · ' + (s.catches || 0) + ' catches · ' + (s.knockouts || 0) + ' KOs · ' + (s.eliminations || 0) + ' eliminations · ' + Math.round(s.damage || 0) + ' damage · best place ' + (s.bestPlace ?? '-')) +
    kv('Currencies', '<span class="dim">None saved: Poké Dollars start fresh every match.</span>') +
    kv('Storage chest', j.chest.filter(Boolean).length ? j.chest.filter(Boolean).map((e) => '<span class="tag">' + esc(e.id) + (e.count > 1 ? ' x' + e.count : '') + '</span>').join('') : '<span class="dim">empty</span>') +
    '</table>' +
    '<h3>PC (' + pc.length + ' saved Pokémon)</h3><p class="dim">Saved account data: what this account keeps between matches. A match\\'s party is temporary and is not shown here; only Pokémon extracted at the end of a match are saved.</p>' + (pc.length ? '<table><tr><th>#</th><th>Pokémon</th><th>Dex</th><th>Lv</th><th>Shiny</th><th>Other</th><th>Moves</th><th>Held</th><th>Saved</th></tr>' +
      pc.map((m) => '<tr><td>' + m.id + '</td><td>' + esc(m.nickname || m.name) + '</td><td>' + esc(m.dex) + '</td><td>' + esc(m.level) + '</td><td>' + (m.shiny ? '★' : '') + '</td><td>' + ['alpha', 'legend', 'shadow'].filter((k) => m[k]).map((k) => '<span class="tag">' + k + '</span>').join('') + '</td><td>' + esc((m.moves || []).join(', ')) + '</td><td>' + esc(m.heldItem || '') + '</td><td>' + when(m.savedAt) + '</td></tr>').join('') + '</table>' : '<p class="dim">The PC is empty.</p>') +
    '<h3>Send a gift or message</h3><div id="gift" class="dim">Loading...</div>' +
    '<h3>Matches</h3><div id="am"></div><p><a href="#accounts">Back to accounts</a></p></div>';
  drawGift(a);
  const rb = document.getElementById('reset');
  if (rb) rb.onclick = async () => {
    if (!confirm('Make a one-time password reset code for ' + a.username + '? Only give it to the owner of this account.')) return;
    rb.disabled = true;
    const r = await post('/api/admin/account/reset', { id: a.id });
    rb.disabled = false;
    const out = document.getElementById('resetOut');
    if (r.error) { out.innerHTML = '<p class="bad">' + esc(r.error) + '</p>'; return; }
    out.innerHTML = '<p>Reset code for <b>' + esc(r.username) + '</b> (shown once, works until ' + when(r.expiresAt) + '):</p><p style="font: 22px monospace; letter-spacing: 3px">' + esc(r.code) + '</p><p class="dim">Making another cancels this one. Nothing changes on the account until it is used.</p>';
  };
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
