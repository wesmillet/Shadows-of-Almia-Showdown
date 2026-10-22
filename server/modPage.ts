/**
 * The moderators' dashboard (/mod): one page, talking to /api/mod/* (server/modApi.ts). Sign in to
 * the game first with a moderator account (admin.js mod <name> makes one).
 */
export const MOD_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Moderators · Shadows of Almia Showdown</title>
<style>
@font-face { font-family: BoldPixels; src: url('/assets/fonts/BoldPixels.ttf'); }
:root { --cream: #f4ecdc; --ink: #4a3424; --dim: #8a6a4a; --accent: #c2611a; --bad: #b0302a; --good: #2e7d32; }
* { box-sizing: border-box; }
body { margin: 0; background: #17112a; color: var(--ink); font-family: system-ui, sans-serif; font-size: 14px; }
header { background: var(--ink); color: var(--cream); padding: 10px 16px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; position: sticky; top: 0; z-index: 2; }
header h1 { font-family: BoldPixels, system-ui; font-weight: normal; font-size: 18px; margin: 0 14px 0 0; }
header button { font: inherit; background: transparent; color: var(--cream); border: 2px solid transparent; padding: 4px 10px; cursor: pointer; }
header button.on { border-color: var(--cream); }
header .who { margin-left: auto; opacity: 0.8; }
main { max-width: 1100px; margin: 16px auto; padding: 0 16px; }
.panel { background: var(--cream); border: 3px solid var(--ink); box-shadow: 0 4px 0 #2a1d14; padding: 14px 16px; margin-bottom: 14px; }
h2 { font-family: BoldPixels, system-ui; font-weight: normal; margin: 0 0 10px; font-size: 18px; }
table { width: 100%; border-collapse: collapse; }
td, th { text-align: left; padding: 5px 6px; border-bottom: 1px dashed #d8c7a6; vertical-align: top; }
th { color: var(--dim); font-weight: normal; font-size: 12px; text-transform: uppercase; }
.dim { color: var(--dim); }
.bad { color: var(--bad); } .good { color: var(--good); }
button.act, input, select, textarea { font: inherit; }
button.act { background: var(--accent); color: #fff; border: 0; padding: 4px 9px; cursor: pointer; margin: 2px 2px 2px 0; }
button.act.alt { background: #e9dcc2; color: var(--ink); }
button.act.danger { background: var(--bad); }
input, select, textarea { border: 2px solid var(--ink); background: #fffaf0; color: var(--ink); padding: 5px 7px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.stat { background: #fffaf0; border: 2px solid var(--ink); padding: 10px; }
.stat b { display: block; font-size: 24px; font-family: BoldPixels, system-ui; font-weight: normal; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 6px 0; }
a { color: var(--accent); }
.err { color: var(--bad); }
.tag { display: inline-block; padding: 0 5px; border: 1px solid var(--dim); font-size: 12px; margin-right: 3px; }
</style></head><body>
<header><h1>Moderators</h1><span id="tabs"></span><span class="who" id="who"></span></header>
<main id="main"><div class="panel">Loading...</div></main>
<script>
const TABS = [['overview', 'Overview'], ['reports', 'Reports'], ['player', 'Player'], ['chat', 'Chat'], ['flags', 'Flags'], ['matches', 'Live'], ['events', 'Events'], ['server', 'Server'], ['log', 'Log']];
/** A small line chart of one value over the last hour (inline SVG). */
function spark(samples, key, label, unit) {
  const w = 300, h = 60;
  const vals = samples.map((x) => x[key] || 0);
  const max = Math.max(1e-9, ...vals);
  const pts = vals.map((v, i) => (vals.length < 2 ? 0 : (i / (vals.length - 1)) * w).toFixed(1) + ',' + (h - (v / max) * (h - 4) - 2).toFixed(1)).join(' ');
  const now = vals.length ? vals[vals.length - 1] : 0;
  return '<div class="stat"><div class="dim">' + label + '</div><b>' + (Math.round(now * 100) / 100) + (unit || '') + '</b><svg width="100%" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="height:60px"><polyline fill="none" stroke="#c2611a" stroke-width="2" points="' + pts + '"/></svg><div class="dim">max ' + (Math.round(max * 100) / 100) + (unit || '') + ' this hour</div></div>';
}
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const when = (t) => t ? new Date(t).toLocaleString() : '-';
const api = async (path, body) => {
  const r = await fetch(path, body === undefined ? { credentials: 'include' } : { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Almia': '1' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: 'Bad reply' }));
  if (!r.ok && !j.error) j.error = 'HTTP ' + r.status;
  return j;
};
let tab = location.hash.slice(1).split('/')[0] || 'overview';
function tabs() {
  $('#tabs').innerHTML = TABS.map(([k, l]) => '<button data-k="' + k + '" class="' + (k === tab ? 'on' : '') + '">' + l + '</button>').join('');
  for (const b of document.querySelectorAll('#tabs button')) b.onclick = () => go(b.dataset.k);
}
function go(k, arg) { tab = k; location.hash = k + (arg ? '/' + encodeURIComponent(arg) : ''); tabs(); render(); }
const main = (html) => { $('#main').innerHTML = html; };
const player = (n) => '<a href="#player/' + encodeURIComponent(n) + '" data-player="' + esc(n) + '">' + esc(n) + '</a>';
function wire() { for (const a of document.querySelectorAll('[data-player]')) a.onclick = (e) => { e.preventDefault(); go('player', a.dataset.player); }; }

async function render() {
  const arg = decodeURIComponent(location.hash.split('/')[1] || '');
  if (tab === 'overview') {
    const o = await api('/api/mod/overview');
    if (o.error) return main('<div class="panel err">' + esc(o.error) + '. Sign in to the game with a moderator account, then come back. <a href="/">Open the game</a></div>');
    $('#who').textContent = o.you.name + ' (' + o.you.role + ')';
    main('<div class="panel"><h2>Right now</h2><div class="grid">' +
      [['Online', o.online], ['Live matches', o.matches], ['Open reports', o.openReports], ['Flagged today', o.flagsToday], ['Accounts', o.accounts], ['New today', o.newToday], ['Banned', o.banned], ['Muted', o.muted], ['Chat today', o.chatToday], ['Matches today', o.matchesToday]]
        .map(([l, v]) => '<div class="stat"><b>' + v + '</b>' + l + '</div>').join('') + '</div></div>' +
      '<div class="panel"><h2>Announce</h2><div class="row"><input id="ann" maxlength="300" style="flex:1" placeholder="A message everyone sees in chat (maintenance, events...)"><button class="act" id="annGo">Send</button></div><div id="annNote" class="dim"></div></div>');
    $('#annGo').onclick = async () => { const r = await api('/api/mod/announce', { text: $('#ann').value }); $('#annNote').textContent = r.ok ? 'Sent.' : r.error; if (r.ok) $('#ann').value = ''; };
    return;
  }
  if (tab === 'reports') {
    const r = await api('/api/mod/reports' + (arg === 'all' ? '?all=1' : ''));
    main('<div class="panel"><h2>Reports</h2><div class="row"><a href="#reports">Open</a> · <a href="#reports/all">All recent</a></div><table><tr><th>#</th><th>When</th><th>Against</th><th>By</th><th>What</th><th></th></tr>' +
      (r.reports || []).map((x) => '<tr><td>' + x.id + '</td><td class="dim">' + when(x.at) + '</td><td>' + player(x.target) + '</td><td>' + (x.reporter_key === 'system' ? '<span class="tag">server</span>' : esc(x.by || '-')) + '</td><td>' + esc(x.reason) + (x.chat ? '<div class="dim">“' + esc(x.chat) + '”</div>' : '') + '</td><td>' + (x.resolved ? '<span class="good">done</span>' : '<button class="act alt" data-res="' + x.id + '">Resolve</button>') + '</td></tr>').join('') +
      '</table>' + (r.reports && r.reports.length ? '' : '<p class="dim">Nothing open. Good.</p>') + '</div>');
    for (const b of document.querySelectorAll('[data-res]')) b.onclick = async () => { await api('/api/mod/resolve', { id: Number(b.dataset.res) }); render(); };
    return wire();
  }
  if (tab === 'player') {
    let html = '<div class="panel"><h2>Find a player</h2><div class="row"><input id="pname" value="' + esc(arg) + '" placeholder="Trainer name"><button class="act" id="pgo">Look up</button></div></div>';
    if (!arg) { main(html); $('#pgo').onclick = () => go('player', $('#pname').value.trim()); return; }
    const p = await api('/api/mod/player?name=' + encodeURIComponent(arg));
    if (p.error) {
      main(html + '<div class="panel err">' + esc(p.error) + (p.matches && p.matches.length ? '<div class="dim">Did you mean: ' + p.matches.map(player).join(', ') + '</div>' : '') + '</div>');
      $('#pgo').onclick = () => go('player', $('#pname').value.trim()); return wire();
    }
    const pr = p.profile;
    html += '<div class="panel"><h2>' + esc(p.name) + ' <span class="dim">#' + p.id + ' · ' + esc(p.role) + '</span></h2>' +
      '<div>' + (p.banned ? '<b class="bad">BANNED</b> · ' : '') + (p.mutedUntil ? '<b class="bad">muted until ' + when(p.mutedUntil) + '</b> · ' : '') + 'joined ' + when(p.joined) + (p.google ? ' · Google' : '') + ' · level ' + pr.progress.level + ' · ' + pr.stats.matches + ' matches, ' + pr.stats.wins + ' wins · ' + pr.pc + ' in PC · <a href="/u/' + encodeURIComponent(p.name) + '" target="_blank">public profile</a></div>' +
      '<div class="row"><input id="reason" placeholder="Reason (kept in the log)" style="flex:1"></div>' +
      '<div class="row"><select id="mins"><option value="10">10 minutes</option><option value="60">1 hour</option><option value="1440">1 day</option><option value="10080">1 week</option></select><button class="act alt" data-a="mute">Mute</button><button class="act alt" data-a="unmute">Unmute</button>' +
      '<button class="act alt" data-a="kick">Kick</button>' + (p.banned ? '<button class="act" data-a="unban">Unban</button>' : '<button class="act danger" data-a="ban">Ban</button><label><input type="checkbox" id="devs" checked> and their devices</label>') +
      '<span style="margin-left:auto"></span><select id="role"><option>player</option><option>mod</option><option>admin</option></select><button class="act alt" data-a="role">Set role (admin)</button><button class="act danger" data-a="delete">Delete account (admin)</button></div><div id="pnote" class="dim"></div></div>';
    html += '<div class="panel"><h2>Reports against</h2><table>' + (p.reports.map((x) => '<tr><td class="dim">' + when(x.at) + '</td><td>' + (x.reporter_key === 'system' ? '<span class="tag">server</span>' : esc(x.by || '-')) + '</td><td>' + esc(x.reason) + '</td><td>' + (x.resolved ? 'done' : 'open') + '</td></tr>').join('') || '<tr><td class="dim">None</td></tr>') + '</table></div>';
    html += '<div class="panel"><h2>Anti-cheat flags</h2><table>' + (p.flags.map((x) => '<tr><td class="dim">' + when(x.at) + '</td><td>' + esc(x.match_id) + '</td><td><span class="tag">' + esc(x.kind) + '</span> x' + x.count + '</td><td class="dim">' + esc(x.detail) + '</td></tr>').join('') || '<tr><td class="dim">None</td></tr>') + '</table></div>';
    html += '<div class="panel"><h2>Chat</h2><table>' + (p.chat.map((x) => '<tr><td class="dim">' + when(x.at) + '</td><td>' + esc(x.text) + '</td><td>' + (x.text === '[removed]' ? '' : '<button class="act alt" data-rm="' + x.id + '">Remove</button>') + '</td></tr>').join('') || '<tr><td class="dim">Nothing said</td></tr>') + '</table></div>';
    html += '<div class="panel"><h2>Devices</h2><table><tr><th>Device</th><th>Address</th><th>Seen</th><th>Accounts</th><th></th></tr>' + p.devices.map((d) => '<tr><td>' + esc(d.device_id.slice(0, 10)) + '…</td><td>' + esc(d.ip) + '</td><td class="dim">' + when(d.last_seen) + '</td><td>' + d.accounts + '</td><td>' + (d.banned ? '<span class="bad">banned</span>' : '') + '</td></tr>').join('') + '</table>' +
      (p.alts.length ? '<p>Also used by: ' + p.alts.map((a) => player(a.username) + (a.banned ? ' <span class="bad">(banned)</span>' : '')).join(', ') + '</p>' : '<p class="dim">No other accounts on these devices.</p>') + '</div>';
    html += '<div class="panel"><h2>History</h2><table>' + (p.history.map((x) => '<tr><td class="dim">' + when(x.at) + '</td><td>' + esc(x.by_name) + '</td><td>' + esc(x.action) + '</td><td>' + esc(x.detail) + '</td></tr>').join('') || '<tr><td class="dim">Nothing yet</td></tr>') + '</table></div>';
    main(html);
    $('#pgo').onclick = () => go('player', $('#pname').value.trim());
    $('#role').value = p.role;
    for (const b of document.querySelectorAll('[data-a]')) b.onclick = async () => {
      const a = b.dataset.a;
      if ((a === 'ban' || a === 'delete') && !confirm(a === 'ban' ? 'Ban ' + p.name + '?' : 'Delete ' + p.name + ' and everything kept for them? This can not be undone.')) return;
      const body = { name: p.name, reason: $('#reason').value, action: a === 'unmute' ? 'mute' : a, minutes: a === 'unmute' ? 0 : Number($('#mins').value), devices: $('#devs') ? $('#devs').checked : false, role: $('#role').value };
      const r = await api('/api/mod/action', body);
      if (r.error) $('#pnote').textContent = r.error; else render();
    };
    for (const b of document.querySelectorAll('[data-rm]')) b.onclick = async () => { await api('/api/mod/chat/remove', { id: Number(b.dataset.rm) }); render(); };
    return wire();
  }
  if (tab === 'chat') {
    const r = await api('/api/mod/chat' + (arg ? '?q=' + encodeURIComponent(arg) : ''));
    main('<div class="panel"><h2>Chat</h2><div class="row"><input id="q" value="' + esc(arg) + '" placeholder="Search words or names"><button class="act" id="qgo">Search</button></div><table>' +
      (r.chat || []).map((x) => '<tr><td class="dim">' + when(x.at) + '</td><td>' + player(x.name) + '</td><td>' + esc(x.text) + '</td><td>' + (x.text === '[removed]' ? '' : '<button class="act alt" data-rm="' + x.id + '">Remove</button>') + '</td></tr>').join('') + '</table></div>');
    $('#qgo').onclick = () => go('chat', $('#q').value.trim());
    for (const b of document.querySelectorAll('[data-rm]')) b.onclick = async () => { await api('/api/mod/chat/remove', { id: Number(b.dataset.rm) }); render(); };
    return wire();
  }
  if (tab === 'flags') {
    const r = await api('/api/mod/flags');
    main('<div class="panel"><h2>Flagged players · last two weeks</h2><p class="dim">Flags are impossible actions the server refused (a ball thrown past its range, someone else\\'s Pokémon, tampered keys). One or two can be lag; many, over several matches, is a modified game.</p><table><tr><th>Player</th><th>Matches</th><th>Flags</th><th>Kinds</th><th>Last</th></tr>' +
      (r.flags || []).map((x) => '<tr><td>' + (x.user_id ? player(x.name) : esc(x.name) + ' <span class="tag">guest</span>') + '</td><td>' + x.matches + '</td><td>' + x.total + '</td><td>' + String(x.kinds || '').split(',').map((k) => '<span class="tag">' + esc(k) + '</span>').join('') + '</td><td class="dim">' + when(x.last) + '</td></tr>').join('') + '</table>' + (r.flags && r.flags.length ? '' : '<p class="dim">Nobody flagged.</p>') + '</div>');
    return wire();
  }
  if (tab === 'matches') {
    const r = await api('/api/mod/matches');
    main('<div class="panel"><h2>Live matches</h2><table><tr><th>Match</th><th>Mode</th><th>Time</th><th>Players</th><th>Watching</th><th></th></tr>' +
      (r.matches || []).map((m) => '<tr><td>' + esc(m.id) + '</td><td>' + esc(m.mode) + '</td><td>' + Math.floor(m.time / 60) + ':' + String(Math.floor(m.time % 60)).padStart(2, '0') + '</td><td>' + m.players.map(player).join(', ') + '</td><td>' + m.watchers + '</td><td><a href="/?watch=' + encodeURIComponent(m.id) + '" target="_blank">Watch</a></td></tr>').join('') + '</table>' + (r.matches && r.matches.length ? '' : '<p class="dim">No matches running.</p>') + '</div>');
    return wire();
  }
  if (tab === 'server') {
    const r = await api('/api/mod/server');
    if (r.error) return main('<div class="panel err">' + esc(r.error) + '</div>');
    const sm = r.samples || [];
    const up = Math.round((Date.now() - r.startedAt) / 60000);
    let html = '<div class="panel"><h2>Server · ' + esc(r.kind) + ' · build ' + esc(r.build) + '</h2><div class="row">Up ' + (up >= 120 ? Math.round(up / 60) + ' h' : up + ' min') + ' · ' + r.counters.matchesStarted + ' matches started, ' + r.counters.matchesEnded + ' finished, ' + r.counters.matchesAborted + ' called off · ' + r.counters.connections + ' connections' +
      '<span style="margin-left:auto"></span>' + (r.draining ? '<b class="bad">DRAINING: no new matches</b> <button class="act" data-drain="0">Let matches start</button>' : '<button class="act alt" data-drain="1">Drain (no new matches)</button>') + '</div></div>';
    html += '<div class="panel"><h2>The last hour</h2><div class="grid">' + spark(sm, 'players', 'Players online') + spark(sm, 'rooms', 'Matches') + spark(sm, 'stepAvg', 'Simulation per step', ' ms') + spark(sm, 'stepMax', 'Worst step', ' ms') + spark(sm, 'lag', 'Clock late by', ' ms') + spark(sm, 'kbOut', 'Sent', ' KB/s') + spark(sm, 'msgIn', 'Messages in', '/s') + spark(sm, 'rssMb', 'Memory', ' MB') + '</div><p class="dim">A step must stay well under 16 ms for all matches together (60 a second); the server warns past about 11.</p></div>';
    const b = r.backups;
    html += '<div class="panel"><h2>Backups</h2><div class="row">' + (b.last ? 'Last: ' + when(b.last.at) + ' · ' + Math.round(b.last.bytes / 1024) + ' KB · ' + b.last.ms + ' ms' + (b.last.uploaded.length ? ' · uploaded ' + b.last.uploaded.map(esc).join(', ') : '') : 'None yet (the first runs a minute after start)') +
      (b.lastError ? ' · <span class="bad">failing: ' + esc(b.lastError) + '</span>' : '') + '<span style="margin-left:auto"></span><button class="act alt" id="bk">Back up now</button></div><div class="dim">' + (b.s3 ? 'Off the machine: s3://' + esc(b.s3) : '<span class="bad">Only on the volume: set up S3 storage (fly storage create) for copies off the machine.</span>') + '</div>' +
      '<table>' + b.local.map((f) => '<tr><td>' + esc(f.name) + '</td><td>' + Math.round(f.bytes / 1024) + ' KB</td><td class="dim">' + when(f.at) + '</td></tr>').join('') + '</table></div>';
    html += '<div class="panel"><h2>Errors</h2><table><tr><th>Last</th><th>Where</th><th>Count</th><th>What</th><th></th></tr>' + (r.errors || []).map((e) => '<tr><td class="dim">' + when(e.last_at) + '</td><td><span class="tag">' + esc(e.source) + '</span></td><td>' + e.count + '</td><td>' + esc(e.message) + '<details><summary class="dim">details</summary><pre style="white-space:pre-wrap;font-size:12px">' + esc(e.stack) + '\n' + esc(e.context) + '</pre></details></td><td><button class="act alt" data-clr="' + esc(e.key) + '">Clear</button></td></tr>').join('') + '</table>' + (r.errors && r.errors.length ? '' : '<p class="dim">No errors. Nice.</p>') + '</div>';
    main(html);
    for (const x of document.querySelectorAll('[data-drain]')) x.onclick = async () => { const res = await api('/api/mod/drain', { on: x.dataset.drain === '1' }); if (res.error) alert(res.error); render(); };
    $('#bk').onclick = async () => { $('#bk').textContent = 'Backing up...'; const res = await api('/api/mod/backup', {}); if (res.error) alert(res.error); render(); };
    for (const x of document.querySelectorAll('[data-clr]')) x.onclick = async () => { await api('/api/mod/errors/clear', { key: x.dataset.clr }); render(); };
    return;
  }
  if (tab === 'events') {
    const r = await api('/api/mod/events');
    const KINDS = { xp: ['XP boost', 'times the XP (2 = Double XP)', 2], shiny: ['Shiny boost', 'times the shiny odds (5 = Shiny Hour)', 5], storm: ['Storm speed', 'times as fast (1.5 = Storm Rush; 0.5 = slow)', 1.5], message: ['Announcement', 'said in chat at the start time', 0] };
    const status = (e) => e.kind === 'message' ? (e.startsAt > r.now ? 'scheduled' : 'sent') : e.endsAt <= r.now ? 'over' : e.startsAt <= r.now ? '<b class="good">on now</b>' : 'upcoming';
    let html = '<div class="panel"><h2>Events</h2><p class="dim">Casual and ranked matches that start during an event get its boost; everyone online sees it and hears when it starts and ends.</p><table><tr><th>Event</th><th>Kind</th><th>When</th><th></th><th></th></tr>' +
      (r.events || []).map((e) => '<tr><td>' + esc(e.name) + '</td><td>' + esc(KINDS[e.kind][0]) + (e.kind === 'message' ? '' : ' x' + e.value) + '</td><td class="dim">' + when(e.startsAt) + (e.kind === 'message' ? '' : ' to ' + when(e.endsAt)) + '</td><td>' + status(e) + '</td><td><button class="act alt" data-del="' + e.id + '">Delete</button></td></tr>').join('') + '</table>' + (r.events && r.events.length ? '' : '<p class="dim">No events.</p>') + '</div>';
    html += '<div class="panel"><h2>New event</h2><div class="row"><select id="ek">' + Object.entries(KINDS).map(([k, v]) => '<option value="' + k + '">' + v[0] + '</option>').join('') + '</select><input id="en" placeholder="Name (shown to players), e.g. Double XP Weekend" style="flex:1"></div>' +
      '<div class="row">Starts <input id="es" type="datetime-local"> for <input id="eh" type="number" value="2" min="0.25" step="0.25" style="width:80px"> hours · amount <input id="ev" type="number" step="0.25" style="width:80px"> <span id="ehint" class="dim"></span></div><div class="row"><button class="act" id="ego">Create</button><span id="enote" class="err"></span></div></div>';
    main(html);
    const k = $('#ek');
    const hint = () => { const d = KINDS[k.value]; $('#ehint').textContent = d[1]; $('#ev').value = d[2]; $('#ev').disabled = $('#eh').disabled = k.value === 'message'; };
    k.onchange = hint; hint();
    const t = new Date(Date.now() + 60000); t.setSeconds(0, 0); $('#es').value = new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    $('#ego').onclick = async () => {
      const res = await api('/api/mod/events', { kind: k.value, name: $('#en').value, startsAt: new Date($('#es').value).getTime(), hours: Number($('#eh').value), value: Number($('#ev').value) });
      if (res.error) $('#enote').textContent = res.error; else render();
    };
    for (const x of document.querySelectorAll('[data-del]')) x.onclick = async () => { await api('/api/mod/events/delete', { id: Number(x.dataset.del) }); render(); };
    return;
  }
  if (tab === 'log') {
    const r = await api('/api/mod/log');
    main('<div class="panel"><h2>Moderators\\' log</h2><table>' + (r.log || []).map((x) => '<tr><td class="dim">' + when(x.at) + '</td><td>' + esc(x.by_name) + '</td><td><span class="tag">' + esc(x.action) + '</span></td><td>' + (x.target && x.target !== 'everyone' && !x.target.startsWith('report') ? player(x.target) : esc(x.target)) + '</td><td>' + esc(x.detail) + '</td></tr>').join('') + '</table></div>');
    return wire();
  }
}
window.addEventListener('hashchange', () => { tab = location.hash.slice(1).split('/')[0] || 'overview'; tabs(); render(); });
tabs();
render();
setInterval(() => { if (tab === 'overview' || tab === 'matches' || tab === 'server') render(); }, 15000);
</script></body></html>`;
