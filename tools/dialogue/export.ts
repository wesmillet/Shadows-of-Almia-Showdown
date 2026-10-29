/**
 * Exports every player-facing line in the game for review: npx tsx tools/dialogue/export.ts <out dir>
 *
 * How it finds them (the coverage method, also written into the document):
 *   1. Code: every string and template literal in src/ and server/ (TypeScript compiler API), kept
 *      when it reads as text a person sees (words with a space, or a capitalised word or sentence)
 *      and dropped when it is clearly not (identifiers, asset paths, CSS, SQL, log lines, event
 *      names, map keys). Each keeps its file, line, the call or property it sits in, and the
 *      condition around it (the nearest enclosing if / case / ternary, as written in the code).
 *   2. Data: item names and descriptions, move names, shop and stall names, characters, TMs, the
 *      fishing rods, special events (data/*.json).
 *   3. The two dashboards (server/modPage.ts, server/adminPage.ts): the text in their HTML and the
 *      strings their scripts write into the page.
 * Then: identical text is listed once with all its uses; template placeholders are listed with a
 * representative example; entries are grouped by where a player meets them; and a review section
 * lists what looks contradictory, stale or confusing (without changing anything).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = process.argv[2] ?? join(ROOT, 'docs', 'dialogue');

interface Use { file: string; line: number; where: string; condition: string; status: Status }
type Status = 'active' | 'unused' | 'legacy' | 'test-only' | 'admin';
interface Entry { id: string; text: string; placeholders: Array<{ name: string; example: string }>; example: string | null; uses: Use[]; group: string; who: string }

const entries = new Map<string, Entry>();
const rejected: Array<{ file: string; line: number; text: string }> = [];

// ---------------------------------------------------------------- groups (by player experience)

const GROUPS: Array<[string, string]> = [
  ['title', '1. Title screen, options and offline setup'],
  ['starters', '2. Starter selection'],
  ['hub', '3. Online hub, lobbies, parties, private matches, friends and trades'],
  ['account', '4. Accounts: sign-in, registration, recovery, profiles'],
  ['hud', '5. In a match: HUD, prompts and controls'],
  ['npc', '6. NPC dialogue: townsfolk, the Breeder, visitors, healers, the challenger'],
  ['shops', '7. Shops, items, TMs and fishing'],
  ['moves', '8. Moves'],
  ['battle', '9. Battle and match messages (catching, evolving, the storm, legends)'],
  ['results', '10. Results screens'],
  ['progress', '10b. Achievements, titles and XP'],
  ['pc', '10c. The PC and storage'],
  ['spectate', '11. Spectating and replays'],
  ['connection', '12. Connection, server and error messages'],
  ['admin', '13. Moderators and the admin dashboard'],
  ['other', '14. Other'],
];

function groupOf(file: string, where: string, text: string): string {
  const f = file.replace(/\\/g, '/');
  if (f.includes('progression')) return 'progress';
  if (f.includes('settings.ts')) return 'title';
  if (f.endsWith('src/sim/data.ts')) return 'shops';
  if (f.includes('pcScreen') || f.endsWith('src/pc.ts')) return 'pc';
  if (f.includes('adminPage') || f.includes('modPage') || f.includes('adminApi') || f.includes('modApi') || f.endsWith('server/admin.ts')) return 'admin';
  if (f.includes('rollScreen') || f.includes('starters')) return 'starters';
  if (f.includes('titleScreen') || f.includes('characterScreen') || f.includes('optionsMenu') || f.includes('screens.ts') || f.includes('moveGallery') || f.endsWith('src/main.ts') && !/replay|watch/i.test(text)) return 'title';
  if (f.includes('watchScreens') || /replay|spectat|watching/i.test(where + text) && !f.includes('accounts')) return 'spectate';
  if (f.includes('endScreen')) return 'results';
  if (f.includes('onlineScreens') && /VICTORY|ELIMINATED|placed|Keep |extract|PC on the server|Back to the lobby|Watch the rest|won as a guest|stats/i.test(text)) return 'results';
  if (f.includes('townsfolk') || f.includes('visitors') || (f.includes('town.ts') && !/₽/.test(text))) return 'npc';
  if (f.includes('connection.ts') || f.includes('server/main.ts') || f.includes('server/hub.ts') && /server|updat|connect|disconnect|tab/i.test(text) || f.includes('remoteRoom') || f.includes('room.ts') && /match is over|called off|disconnect|server/i.test(text)) return 'connection';
  if (f.includes('accounts.ts') || /password|sign in|sign-in|username|account|recovery|log in/i.test(text) && (f.includes('overlay') || f.includes('onlineScreens'))) return 'account';
  if (f.includes('onlineScreens') || f.includes('socialPanel') || f.includes('tradeMenu') || f.includes('overlay') || f.includes('server/hub.ts') || f.includes('privateLobby') || f.includes('matchmaker') || f.includes('chat.ts') || f.includes('server/')) return 'hub';
  if (f.includes('data/items') || f.includes('data/shops') || f.includes('data/fishing') || f.includes('fishing.ts') || f.includes('src/sim/items.ts') || f.includes('chest')) return 'shops';
  if (f.includes('data/moves')) return 'moves';
  if (f.includes('hud.ts') || f.includes('matchScreen') && /Space ·|click|press|\(|key|Hold|Esc|Tab|mode|Ball target|target|Auto|Music/i.test(text + where)) return 'hud';
  if (f.includes('match.ts') || f.includes('battle.ts') || f.includes('catching') || f.includes('evolution') || f.includes('mega') || f.includes('darkness') || f.includes('matchScreen') || f.includes('party.ts') || f.includes('mirror')) return 'battle';
  return 'other';
}

function whoOf(file: string, where: string): string {
  const f = file.replace(/\\/g, '/');
  if (f.includes('townsfolk')) return 'Townsfolk, the Breeder or the wandering stranger';
  if (f.includes('visitors')) return 'A visitor (merchant, Celeste, Hoopa, the ace trainer)';
  if (f.includes('town.ts')) return 'Town NPC (vendor, healer, challenger)';
  if (/notice|say|reply/.test(where)) return 'On-screen notice';
  if (/button/.test(where)) return 'Button';
  if (/error/.test(where)) return 'Error message';
  if (/text|ink|label|wrapText|heading|creamStrip/.test(where)) return 'Screen text';
  if (f.startsWith('data/')) return 'Game data';
  if (f.includes('Page')) return 'Dashboard page';
  return 'UI';
}

// ---------------------------------------------------------------- what counts as player-facing

const NOT_TEXT = [
  /^[a-z0-9_\-./:#@?=&%*+]*$/i, // ids, paths, urls, keys (no spaces)
  /^\s*$/,
  /^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|PRAGMA|BEGIN|COMMIT|ROLLBACK|RELEASE|SAVEPOINT|WITH)\b/i,
  /^[#.]?[a-z-]+\s*\{/, // css
  /[a-z-]+:\s*[^;]+;/, // css declarations
  /^\d+(\.\d+)?(px|ms|s|%)?$/,
  /^rgba?\(|^#[0-9a-f]{3,8}$/i,
  /^\(?[a-z]+\)?=>/,
  /^bold |^italic |px [A-Za-z]/,
  /grayscale\(|brightness\(|blur\(|sans-serif|system-ui|monospace/,
  /\b(INTEGER|TEXT|REAL) (NOT NULL|PRIMARY|DEFAULT)/,
  /^[^a-z]*\$\{/,
  /gl_|void main|precision |uniform |varying |translate\(|^\$[a-z]+$/,
  /charset=|max-age|^HTTP\/1\.1|^Path \d+$/,
  /^(almia-|[a-z]+-[a-z-]+ [a-z-])/,
];
const SKIP_CALLEES = new Set(['warnOnce', 'warn', 'placeholder', 'track', 'log', 'console.log', 'console.error', 'console.warn', 'console.info', 'require', 'import', 'prepare', 'exec', 'querySelector', 'querySelectorAll', 'getElementById', 'addEventListener', 'removeEventListener', 'setAttribute', 'createElement', 'loadImage', 'json', 'get', 'has', 'set', 'delete', 'startsWith', 'endsWith', 'includes', 'split', 'join', 'replace', 'test', 'match', 'play', 'flat', 'skinPiece', 'img', 'sheet', 'fetch', 'api', 'cmd', 'send', 'on', 'emit', 'Error', 'record', 'alerts.send', 'errors.record', 'metrics', 'writeHead', 'setHeader', 'execFileSync', 'spawn', 'Number', 'parseInt', 'padStart', 'toLocaleString', 'localStorage.getItem', 'localStorage.setItem', 'getItem', 'setItem', 'removeItem']);
// call sites whose strings are shown to a player even though they look like an "error"
const SHOW_CALLEES = new Set(['say', 'notice', 'text', 'ink', 'label', 'button', 'wrapText', 'heading', 'creamStrip', 'panelText', 'el', 'alert', 'confirm', 'toast', 'drawInfoBar', 'push', 'textBox', 'dialog', 'line', 'title', 'ask']);

function looksLikeText(s: string): boolean {
  const t = s.trim();
  if (t.length < 2) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  for (const re of NOT_TEXT) if (re.test(t)) return false;
  if (/^[a-z]+[A-Z][a-zA-Z]*$/.test(t)) return false; // camelCase id
  if (/^[a-z][a-z-]+$/.test(t)) return false; // kebab id
  if (/^[A-Z_]+$/.test(t) && t.length > 1 && !/^(VICTORY|ELIMINATED|WIPED OUT|VS|KO|HP|PC|XP|TM|DEMO|MOD|NEW)$/.test(t)) return false; // CONSTANT
  if (/^(http|https|ws|wss):\/\//.test(t)) return false;
  if (/^[\w-]+\.(png|json|ttf|ogg|mp3|wav|tmx|tsx|js|ts|html|css|webp|svg|txt|md)$/i.test(t)) return false;
  if (/^(Idle|Walk|Attack|Hurt|Faint|Shoot|Charge|Sleep|Pose|Hop|Swing|Double|Rotate|Strike|Special|Kick|Head|Bite|Pull)$/.test(t)) return false; // animation names
  if (/^[a-z ]+$/.test(t) && t.split(' ').length === 1) return false;
  return true;
}

// ---------------------------------------------------------------- examples for placeholders

const EXAMPLES: Array<[RegExp, string]> = [
  [/\.name\b|name\b|Name\b|mon\b|who\b/, 'Pikachu'], [/trainer|player|from|by\b|winner|host|target\.name|foe/i, 'Wes'],
  [/level|\.lv|\blv\b/i, '12'], [/money|price|cost|₽/i, '1,500'], [/count|n\b|left|picks|need|total|matches|wins/i, '3'],
  [/place/i, '2'], [/seconds|secs|time|left\(|in\b/i, '45'], [/item|ball|def\.name|label/i, 'Great Ball'], [/move/i, 'Thunder Shock'],
  [/town/i, 'Frostmere'], [/code/i, 'K7Q2D'], [/xp/i, '120'], [/hp/i, '23/40'], [/ping/i, '42'], [/dex/i, '0025'], [/title/i, 'Master Ranger'],
  [/reason|why|text|msg|error/i, '(a reason)'], [/build/i, '4cad177'],
];
function exampleFor(expr: string): string {
  for (const [re, ex] of EXAMPLES) if (re.test(expr)) return ex;
  return '…';
}

// ---------------------------------------------------------------- the code walk

function idOf(text: string): string {
  return `T${createHash('sha1').update(text).digest('hex').slice(0, 6).toUpperCase()}`;
}

function add(text: string, use: Use, placeholders: Array<{ name: string; example: string }> = [], example: string | null = null, group?: string): void {
  const key = text;
  let e = entries.get(key);
  if (!e) {
    e = { id: idOf(text), text, placeholders, example, uses: [], group: group ?? groupOf(use.file, use.where, text), who: whoOf(use.file, use.where) };
    entries.set(key, e);
  }
  if (!e.uses.some((u) => u.file === use.file && u.line === use.line)) e.uses.push(use);
}

function files(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.ts$/.test(f) && !/\.test\.ts$|\.d\.ts$/.test(f)) out.push(p);
  }
  return out;
}

function calleeName(n: ts.Node): string {
  let p: ts.Node | undefined = n.parent;
  for (let depth = 0; p && depth < 6; depth++, p = p.parent) {
    if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
      const ex = p.expression;
      if (ts.isIdentifier(ex)) return ex.text;
      if (ts.isPropertyAccessExpression(ex)) return `${ts.isIdentifier(ex.expression) ? ex.expression.text + '.' : ''}${ex.name.text}`;
      return 'call';
    }
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) return `${p.name.text}:`;
    if (ts.isReturnStatement(p)) return 'return';
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return `${p.name.text} =`;
  }
  return '';
}

function conditionOf(n: ts.Node, sf: ts.SourceFile): string {
  let p: ts.Node | undefined = n.parent;
  for (let depth = 0; p && depth < 14; depth++, p = p.parent) {
    if (ts.isIfStatement(p)) return `if (${p.expression.getText(sf).replace(/\s+/g, ' ').slice(0, 140)})`;
    if (ts.isConditionalExpression(p)) return `${p.condition.getText(sf).replace(/\s+/g, ' ').slice(0, 140)} ?`;
    if (ts.isCaseClause(p)) return `case ${p.expression.getText(sf).slice(0, 80)}`;
    if (ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) return `in ${p.name?.getText(sf) ?? 'a function'}()`;
    if (ts.isArrowFunction(p) && ts.isPropertyAssignment(p.parent) && ts.isIdentifier(p.parent.name)) return `in ${p.parent.name.text}`;
  }
  return '';
}

function statusOf(file: string, cond: string, text: string): Status {
  if (/adminPage|modPage|adminApi|modApi|server\/admin\.ts/.test(file)) return 'admin';
  if (/LEVELS_ON/.test(cond)) return 'unused';
  if (/ranked/i.test(cond) || /\bRanked\b|ranked/.test(text) && !/no ranked|retired/i.test(text)) return 'legacy';
  if (/isDev|rareChest|DEV_|tester|dev\b/i.test(cond) || /^Tester mode|Every rare item is waiting/.test(text) || /src\/dev\.ts|devProbe/.test(file)) return 'test-only';
  return 'active';
}

for (const dir of ['src', 'server']) {
  for (const path of files(join(ROOT, dir))) {
    const rel = relative(ROOT, path).replace(/\\/g, '/');
    if (/server\/checks\/|src\/tools\/|devProbe|server\/bots\.ts/.test(rel)) continue;
    if (/adminPage\.ts|modPage\.ts/.test(rel)) continue; // the dashboards' HTML: below
    const src = readFileSync(path, 'utf8');
    const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => {
      if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isTypeNode(n) || ts.isLiteralTypeNode(n)) return;
      let text: string | null = null;
      let placeholders: Array<{ name: string; example: string }> = [];
      let example: string | null = null;
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) text = n.text;
      else if (ts.isTemplateExpression(n)) {
        let t = n.head.text;
        let ex = n.head.text;
        for (const span of n.templateSpans) {
          const expr = span.expression.getText(sf).replace(/\s+/g, ' ');
          const nameRaw = expr.length > 60 ? `${expr.slice(0, 57)}...` : expr;
          // a nested string choice (cond ? 'a' : 'b') is shown as such
          t += `{${nameRaw}}${span.literal.text}`;
          const e = exampleFor(expr);
          placeholders.push({ name: nameRaw, example: e });
          ex += e + span.literal.text;
        }
        text = t;
        example = ex;
      }
      if (text !== null) {
        const where = calleeName(n);
        const bare = text.replace(/\{[^}]*\}/g, 'X');
        const skip = [...SKIP_CALLEES].some((c) => where === c || where.endsWith(`.${c}`)) && !SHOW_CALLEES.has(where.split('.').pop() ?? '');
        // property keys and switch cases ('hit': ...) are not text; nor are object keys used as ids
        const isKey = ts.isPropertyAssignment(n.parent) && n.parent.name === n || ts.isCaseClause(n.parent) || ts.isElementAccessExpression(n.parent);
        const compare = ts.isBinaryExpression(n.parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(n.parent.operatorToken.kind);
        if (!skip && !isKey && !compare && looksLikeText(bare) && !/^\s*[{[<]/.test(text)) {
          const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
          const condition = conditionOf(n, sf);
          add(text, { file: rel, line, where, condition, status: statusOf(rel, condition, text) }, placeholders, example);
        } else if (looksLikeText(bare) && (skip || compare)) {
          rejected.push({ file: rel, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, text });
        }
        if (ts.isTemplateExpression(n)) for (const span of n.templateSpans) ts.forEachChild(span.expression, visit);
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
}

// ---------------------------------------------------------------- data files

const json = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const dataUse = (file: string, where: string, status: Status = 'active'): Use => ({ file, line: 0, where, condition: '', status });
{
  const items = json('data/items/items.json').items as Array<{ id: string; name: string; short?: string; desc?: string; kind: string }>;
  const loot = JSON.stringify(json('data/items/loot.json'));
  const shops = JSON.stringify(json('data/shops.json'));
  for (const it of items) {
    const sold = shops.includes(`"${it.id}"`) || loot.includes(`"${it.id}"`);
    // kept so saved chests still load, but no longer sold or found
    const status: Status = !sold && /dusk-ball|net-ball/.test(it.id) ? 'legacy' : 'active';
    add(it.name, dataUse('data/items/items.json', `item ${it.id}: name`, status), [], null, 'shops');
    if (it.short && it.short !== it.name) add(it.short, dataUse('data/items/items.json', `item ${it.id}: short label`, status), [], null, 'shops');
    if (it.desc) add(it.desc, dataUse('data/items/items.json', `item ${it.id}: description`, status), [], null, 'shops');
  }
  const mj = json('data/moves.json') as { moves?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>;
  const moves = Array.isArray(mj) ? mj : (mj.moves ?? []);
  for (const m of moves) add(m.name, dataUse('data/moves.json', `move ${m.id}: name`), [], null, 'moves');
  const sh = json('data/shops.json') as Record<string, unknown>;
  const walk = (o: unknown, path: string): void => {
    if (typeof o === 'string') {
      if (/name|title|line|text|greet|say|desc/i.test(path) && looksLikeText(o)) add(o, dataUse('data/shops.json', path), [], null, /challenger/.test(path) ? 'npc' : 'shops');
    } else if (Array.isArray(o)) o.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (!k.startsWith('_')) walk(v, path ? `${path}.${k}` : k);
  };
  walk(sh, '');
  const ch = json('data/characters.json').roles as Record<string, { name?: string }>;
  for (const [k, v] of Object.entries(ch)) if (v.name) add(v.name, dataUse('data/characters.json', `role ${k}: name`), [], null, 'npc');
  const fish = json('data/fishing.json') as { rods?: Record<string, { name?: string }> };
  for (const [k, v] of Object.entries(fish.rods ?? {})) if (v && typeof v === 'object' && v.name) add(v.name, dataUse('data/fishing.json', `rod ${k}`), [], null, 'shops');
  const spawns = json('data/spawns.json') as { events?: Record<string, { name?: string }> };
  for (const [k, v] of Object.entries(spawns.events ?? {})) if (v.name) add(v.name, dataUse('data/spawns.json', `event ${k}: name`), [], null, 'npc');
}

// ---------------------------------------------------------------- the dashboards' pages

for (const [file, label] of [['server/modPage.ts', 'moderators'], ['server/adminPage.ts', 'admin']] as const) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const lines = src.split('\n');
  lines.forEach((l, i) => {
    // text between tags
    for (const m of l.matchAll(/>([^<>{}=;]{2,})</g)) {
      const t = (m[1] as string).trim();
      if (looksLikeText(t) && !/['+?()]/.test(t)) add(t, { file, line: i + 1, where: `${label} page HTML`, condition: '', status: 'admin' }, [], null, 'admin');
    }
    // quoted strings in the page script that read as text
    for (const m of l.matchAll(/'((?:[^'\\]|\\.){3,})'/g)) {
      const t = (m[1] as string).replace(/\\'/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (t.length > 2 && looksLikeText(t) && /[a-z] [a-z]|^[A-Z][a-z]/.test(t) && !/[=;]|\(\)|=>|document|querySelector|class=|style=/.test(t)) add(t, { file, line: i + 1, where: `${label} page script`, condition: '', status: 'admin' }, [], null, 'admin');
    }
  });
}

// ---------------------------------------------------------------- review: what looks off

const review: Array<{ id: string; text: string; why: string }> = [];
const all = [...entries.values()];
const flag = (e: Entry, why: string) => review.push({ id: e.id, text: e.text, why });
for (const e of all) {
  // the words a player reads: placeholders stand in as #
  let t = e.text;
  while (/\{[^{}]*\}/.test(t)) t = t.replace(/\{[^{}]*\}/g, '#');
  if (/\bPokemon\b/.test(t) && e.uses.every((u) => u.status !== 'admin')) flag(e, '"Pokemon" without the accent (elsewhere "Pokémon")');
  if (/Pokeball|Poke Ball|pokeball/i.test(t) && !/Poké Ball/.test(t)) flag(e, '"Poke Ball" spelt without the accent (elsewhere "Poké Ball")');
  if (/—/.test(t)) flag(e, 'an em dash');
  if (/\S {2,}\S/.test(t) && !/·|✓|\bHP\b|ATK/.test(t)) flag(e, 'two spaces in a row');
  if (/\bcollapse|wiped out \(back at an outpost/i.test(t) && /storm/i.test(t)) flag(e, 'describes passing out in the storm as being wiped out and coming back; passing out in the storm now ends the match (Darkrai takes the trainer)');
  if (/ranked|Ranked/.test(t) && e.uses.some((u) => u.status === 'active')) flag(e, 'mentions ranked play, which is retired');
  if (/Net Ball|Dusk Ball/.test(t) && e.uses.some((u) => !u.file.startsWith('data/items'))) flag(e, 'mentions a ball no longer sold or found');
  if (/\bLv\b|level/i.test(t) && /trainer level|Trainer level|XP/i.test(t) && e.uses.some((u) => u.status === 'active')) flag(e, 'trainer levels and XP are hidden in the game (LEVELS_ON is off)');
  if (/\bstats\b.*saved|stats were saved/i.test(t)) flag(e, 'says stats were saved (asked to be removed)');
  if (/colour|favourite|behaviour|centre/.test(t) && e.uses.some((u) => u.status !== 'admin')) flag(e, 'British spelling (the rest of the game mixes spellings)');
  if (/\?\?|TODO|FIXME|XXX/.test(t)) flag(e, 'placeholder or TODO text');
  if (/eight|8 trainers|Eight trainers/i.test(t) && /trainer/i.test(t)) flag(e, 'may describe an eight-trainer match; public matches have ten');
}
// the same thing worded differently in different places
const lower = new Map<string, Entry[]>();
for (const e of all) {
  const k = e.text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  if (k.length < 8) continue;
  lower.set(k, [...(lower.get(k) ?? []), e]);
}
for (const [, es] of lower) if (es.length > 1) review.push({ id: es.map((e) => e.id).join(', '), text: es.map((e) => e.text).join(' / '), why: 'the same words with different capitals or punctuation' });

// ---------------------------------------------------------------- write

mkdirSync(OUT, { recursive: true });
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, '⏎ ');
const statusLabel: Record<Status, string> = { active: 'active', unused: 'unused (switched off)', legacy: 'legacy', 'test-only': 'testing only', admin: 'admin only' };
let md = `# Shadows of Almia Showdown: every player-facing line\n\n`;
md += `Exported ${new Date().toISOString().slice(0, 10)} from the \`online\` branch for wording review. Nothing was reworded by this export.\n\n`;
md += `## How to read this\n\n`;
md += `- Each entry: its **id** (stable: derived from the text itself, so it stays the same while the wording does), the **exact wording**, **who says it or where it appears**, the **condition** that shows it (the nearest \`if\`, \`case\` or \`? :\` in the code, as written), and every **source** (file:line).\n`;
md += `- Text in \`{braces}\` is filled in by the game: the expression is shown, with a representative example under it.\n`;
md += `- Status: **active** (players see it), **unused** (behind a switch that is off, e.g. trainer levels), **legacy** (kept for old saves or retired features), **testing only** (dev builds or test switches), **admin only**.\n`;
md += `- Identical text used in several places is listed once, with all its uses.\n`;
md += `- Contradictions, stale references and confusing wording are collected in the **Review** section at the end. Nothing was changed.\n\n`;
md += `## Coverage\n\n`;
md += `Found by reading the code and data, not only by looking at screens:\n\n`;
md += `1. **Code** (src/ and server/, ${files(join(ROOT, 'src')).length + files(join(ROOT, 'server')).length} TypeScript files, tests excluded): every string and template literal, through the TypeScript compiler, kept when it reads as text a person sees and dropped when it is clearly an identifier, path, CSS, SQL, an event or animation name, a comparison or a log line. ${rejected.length} text-like strings were dropped as log lines, comparisons or lookups (listed in \`dropped.json\` beside this file, for spot checks).\n`;
md += `2. **Data**: item names, short labels and descriptions; move names; shop, stall and challenger text; character names; fishing rods; special events.\n`;
md += `3. **The two dashboards** (/mod and the new /admin): the text in their HTML and the text their scripts write.\n\n`;
md += `Not captured: Pokémon species names (data/species.json, the official names, ${(json('data/species.json').species as unknown[]).length} entries); the map's place names drawn into the island art; text inside images (the logo, the title art); browser-native messages (e.g. a failed connection page); and text the server builds from other text in ways the extractor can not see whole (each piece is listed, the sentence they make may not be). Strings assembled across several statements show as their separate parts.\n\n`;
md += `**${all.length} distinct lines** (${all.filter((e) => e.uses.some((u) => u.status === 'active')).length} active).\n\n`;
for (const [key, title] of GROUPS) {
  const es = all.filter((e) => e.group === key).sort((a, b) => (a.uses[0]?.file ?? '').localeCompare(b.uses[0]?.file ?? '') || (a.uses[0]?.line ?? 0) - (b.uses[0]?.line ?? 0));
  if (!es.length) continue;
  md += `## ${title}\n\n${es.length} lines.\n\n`;
  for (const e of es) {
    const st = [...new Set(e.uses.map((u) => statusLabel[u.status]))].join(', ');
    md += `**${e.id}** · ${e.who} · *${st}*\n\n`;
    md += `> ${esc(e.text)}\n\n`;
    if (e.placeholders.length) {
      md += `Placeholders: ${e.placeholders.map((p) => `\`${esc(p.name)}\``).join(', ')}  \nExample: "${esc(e.example ?? '')}"\n\n`;
    }
    for (const u of e.uses.slice(0, 8)) md += `- \`${u.file}${u.line ? `:${u.line}` : ''}\`${u.where ? ` · ${esc(u.where)}` : ''}${u.condition ? ` · when \`${esc(u.condition)}\`` : ''}\n`;
    if (e.uses.length > 8) md += `- and ${e.uses.length - 8} more uses\n`;
    md += `\n`;
  }
}
md += `## Review: contradictions, stale references and confusing wording\n\n`;
md += `Collected automatically by the checks listed beside each, plus the notes below. Nothing has been changed.\n\n`;
md += `| id | text | why it is listed |\n|---|---|---|\n`;
for (const r of review) md += `| ${r.id} | ${esc(r.text).slice(0, 220)} | ${r.why} |\n`;
// Read by hand: things a pattern can not catch. Each names the line by its text, so the id shown is
// the current one; a note whose line has gone is left out.
const NOTES: Array<[string, string]> = [
  ['Team Dim Sun Grunt (placeholder)', 'a character name that says "(placeholder)"; shown wherever that character is named'],
  ['Gardevoi', 'Mega Stone short labels are cut to 8 letters (Gardevoi, Tyranita, Steelixi, Latiosit...); fine as a slot label, reads as a typo if it appears anywhere wider'],
  ['your Pokémon last 2 minutes in the storm before falling asleep', 'the Storm Mask describes Pokémon falling asleep in the storm; the trainer now passes out and is taken by Darkrai, so check the two read as one rule'],
  ['Wear it under 10% HP', 'Shadow Pokémon catching is given as "under 10% HP" here and "under ten percent" by Veteran Sarge; same rule, two spellings'],
  ['take the controls yourself. R, trainer. R.', 'refers to the R key for auto-battle; R is still the key, keep in mind if controls are remapped'],
];
md += `\n### Notes from reading through\n\n| id | text | note |\n|---|---|---|\n`;
for (const [find, note] of NOTES) {
  const e = all.find((x) => x.text === find) ?? all.find((x) => x.text.includes(find));
  if (e) md += `| ${e.id} | ${esc(e.text).slice(0, 220)} | ${note} |\n`;
}
writeFileSync(join(OUT, 'dialogue-export.md'), md);
writeFileSync(join(OUT, 'dialogue-export.json'), JSON.stringify({ entries: all, review }, null, 1));
writeFileSync(join(OUT, 'dropped.json'), JSON.stringify(rejected, null, 1));
console.log(`${all.length} lines, ${review.length} review notes, ${rejected.length} dropped -> ${OUT}`);
