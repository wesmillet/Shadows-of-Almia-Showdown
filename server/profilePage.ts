/**
 * A trainer's public profile as a web page (/u/<name>), to share outside the game: their look,
 * level and title, ranked standing, lifetime stats, achievements and recent matches (with links to
 * watch the replays). Plain HTML from the server, in the game's cream-and-ink pixel style.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACHIEVEMENTS } from '../src/net/progression';
import type { PublicProfile } from './accounts';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

let frames: Record<string, { file: string; frame_w: number; frame_h: number }> | null = null;
function lookSheet(assetsDir: string, look: unknown): { file: string; w: number; h: number } | null {
  if (typeof look !== 'string') return null;
  try {
    frames ??= (JSON.parse(readFileSync(join(assetsDir, 'rangers', 'manifest.json'), 'utf8')) as { characters: typeof frames }).characters;
  } catch {
    return null;
  }
  const c = frames?.[look];
  return c ? { file: c.file, w: c.frame_w, h: c.frame_h } : null;
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function profilePage(p: PublicProfile, assetsDir: string): string {
  const sheet = lookSheet(assetsDir, p.look ?? 'union_00');
  const k = 4;
  const portrait = sheet
    ? `<div class="look" style="width:${sheet.w * k}px;height:${sheet.h * k}px;background-image:url('/assets/rangers/${esc(sheet.file)}');background-size:auto ${sheet.h * k}px;background-position:0 0"></div>`
    : '<div class="look none"></div>';
  const r = p.ranked;
  const ranked = r.tier
    ? `<div class="tier" style="color:${esc(r.tier.color)}">${esc(r.tier.name)} · ${r.rating}${r.rank ? ` · #${r.rank}` : ''}</div><div class="dim">Season ${r.season} · ${r.wins} wins in ${r.games} ranked games · peak ${r.peak}</div>`
    : `<div class="dim">${r.games ? `Ranked season ${r.season}: ${r.placementLeft} placement game${r.placementLeft === 1 ? '' : 's'} left` : `No ranked games in season ${r.season} yet`}</div>`;
  const s = p.stats;
  const have = new Map(p.achievements.map((a) => [a.id, a.at]));
  const badges = ACHIEVEMENTS.map((a) => {
    const at = have.get(a.id);
    return `<div class="badge${at ? '' : ' locked'}" title="${esc(a.desc)}${a.title ? ` (title: ${esc(a.title)})` : ''}"><b>${esc(a.name)}</b><span>${esc(a.desc)}</span>${at ? `<i>${new Date(at).toISOString().slice(0, 10)}</i>` : ''}</div>`;
  }).join('');
  const recent = p.recent.length
    ? p.recent.map((m) => {
        const when = new Date(m.at).toISOString().replace('T', ' ').slice(0, 16);
        const res = m.outcome === 'win' ? '<span class="win">Won</span>' : `#${m.place}`;
        const extra = [m.mode === 'ranked' ? `Ranked${m.ratingDelta !== null ? ` ${m.ratingDelta >= 0 ? '+' : ''}${m.ratingDelta}` : ''}` : 'Casual', m.xp !== null ? `+${m.xp} XP` : ''].filter(Boolean).join(' · ');
        const replay = m.replay ? `<a href="/?replay=${encodeURIComponent(m.match)}">Watch</a>` : '';
        return `<tr><td>${res}</td><td>${esc(extra)}</td><td class="dim">${esc(when)} UTC</td><td>${replay}</td></tr>`;
      }).join('')
    : '<tr><td class="dim">No matches yet</td></tr>';
  const pct = p.progress.next ? Math.round((p.progress.into / p.progress.next) * 100) : 100;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.name)} · Shadows of Almia Showdown</title>
<meta name="description" content="${esc(`${p.name}: level ${p.progress.level} trainer${p.title ? `, ${p.title}` : ''}. ${s.wins} wins in ${s.matches} matches.`)}">
<style>
@font-face { font-family: BoldPixels; src: url('/assets/fonts/BoldPixels.ttf'); }
:root { --cream: #f4ecdc; --ink: #4a3424; --dim: #8a6a4a; --accent: #c2611a; --bg: #17112a; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: BoldPixels, system-ui, sans-serif; padding: 24px 16px; }
.wrap { max-width: 860px; margin: 0 auto; }
.panel { background: var(--cream); border: 3px solid var(--ink); box-shadow: 0 4px 0 #2a1d14, 0 0 0 3px var(--cream) inset; padding: 16px 18px; margin-bottom: 16px; }
.head { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; }
.look { image-rendering: pixelated; background-repeat: no-repeat; flex: none; }
.look.none { width: 88px; height: 144px; background: #e9dcc2; }
h1 { margin: 0; font-size: 34px; font-weight: normal; }
h2 { margin: 0 0 10px; font-size: 18px; font-weight: normal; color: var(--dim); text-transform: uppercase; letter-spacing: 1px; }
.title { color: var(--accent); font-size: 18px; }
.dim { color: var(--dim); font-size: 14px; }
.tier { font-size: 22px; margin-top: 6px; }
.bar { height: 10px; background: #e9dcc2; border: 2px solid var(--ink); margin: 6px 0 2px; max-width: 320px; }
.bar i { display: block; height: 100%; background: #f2c24a; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
.stats div { background: #fffaf0; border: 2px solid var(--ink); padding: 8px; text-align: center; }
.stats b { display: block; font-size: 22px; font-weight: normal; }
.badges { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; }
.badge { background: #fffaf0; border: 2px solid var(--ink); padding: 8px; font-size: 13px; }
.badge b { display: block; font-weight: normal; font-size: 15px; color: var(--accent); }
.badge span { color: var(--dim); }
.badge i { display: block; font-style: normal; font-size: 11px; color: var(--dim); margin-top: 4px; }
.badge.locked { opacity: 0.45; }
.badge.locked b { color: var(--ink); }
table { width: 100%; border-collapse: collapse; font-size: 15px; }
td { padding: 6px; border-bottom: 1px dashed #d8c7a6; }
.win { color: #2e7d32; }
a { color: var(--accent); }
.play { display: inline-block; background: var(--accent); color: #fff; padding: 10px 18px; text-decoration: none; margin-top: 10px; }
.online { color: #2e7d32; }
</style></head><body><div class="wrap">
<div class="panel head">${portrait}<div>
<h1>${esc(p.name)}</h1>
${p.title ? `<div class="title">${esc(p.title)}</div>` : ''}
<div>Trainer level ${p.progress.level}</div>
<div class="bar"><i style="width:${pct}%"></i></div>
<div class="dim">${p.progress.next ? `${p.progress.into} / ${p.progress.next} XP to level ${p.progress.level + 1}` : 'Top level'}</div>
<div class="dim">${p.online ? '<span class="online">Online now</span> · ' : ''}Trainer since ${new Date(p.joined).toISOString().slice(0, 10)} · ${p.pc} Pokémon in their PC</div>
${ranked}
</div></div>
<div class="panel"><h2>Stats</h2><div class="stats">
<div><b>${s.matches}</b>matches</div><div><b>${s.wins}</b>wins</div><div><b>${s.bestPlace ?? '-'}</b>best place</div>
<div><b>${s.catches}</b>catches</div><div><b>${s.eliminations ?? 0}</b>eliminations</div><div><b>${s.knockouts}</b>knockouts</div><div><b>${s.damage.toLocaleString('en')}</b>damage</div>
</div></div>
<div class="panel"><h2>Achievements · ${p.achievements.length}/${ACHIEVEMENTS.length}</h2><div class="badges">${badges}</div></div>
<div class="panel"><h2>Recent matches</h2><table>${recent}</table></div>
<div class="panel"><a class="play" href="/">Play Shadows of Almia Showdown</a> <span class="dim">· a free fan game</span></div>
</div></body></html>`;
}

export function notFoundPage(name: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>No such trainer</title><style>body{background:#17112a;color:#f4ecdc;font-family:system-ui;text-align:center;padding:80px 16px}a{color:#f2c24a}</style></head><body><h1>No trainer called ${esc(name)}</h1><p><a href="/">Play Shadows of Almia Showdown</a></p></body></html>`;
}

export { fmtTime };
