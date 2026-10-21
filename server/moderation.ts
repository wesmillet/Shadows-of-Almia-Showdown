/**
 * Chat and name moderation: a word filter that catches the usual dodges (l33t letters, spacing,
 * repeated letters), and a cleaner for names that come from Google. The list is short and
 * conservative on purpose; reports and mutes (server/chat.ts) handle what a filter can not.
 */

/** Blocked words (lower case, letters only). Matching ignores spacing, symbols and repeats. */
const BLOCKED = [
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'asshole', 'bastard', 'slut', 'whore', 'faggot', 'fag', 'nigger', 'nigga',
  'retard', 'rape', 'rapist', 'nazi', 'hitler', 'kys', 'killyourself', 'porn', 'sex', 'nude', 'nudes', 'penis', 'vagina', 'cum', 'dildo',
  'tranny', 'chink', 'spic', 'kike', 'wetback', 'pedo', 'pedophile', 'molest',
];

/** Short words that only count as whole words (so "class" or "assess" are fine). */
const WHOLE_ONLY = new Set(['fag', 'cum', 'sex', 'kys', 'spic', 'dick', 'cock']);

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't' };

function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0134578@$!|+]/g, (c) => LEET[c] ?? c);
}

/** Letters only, repeats squashed ("fuuuck" -> "fuck"). */
function squash(s: string): string {
  return s.replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
}

export function isClean(text: string): boolean {
  return censor(text) === text;
}

/** The text with blocked words starred out. */
export function censor(text: string): string {
  const norm = normalise(text);
  const words = norm.split(/\s+/);
  const joined = squash(norm);
  let out = text;
  for (const bad of BLOCKED) {
    const target = squash(bad);
    if (WHOLE_ONLY.has(bad)) {
      if (words.some((w) => squash(w) === target)) out = out.replace(new RegExp(`\\b[^\\s]*${bad.split('').join('[^a-z\\s]*')}[^\\s]*\\b`, 'gi'), (m) => '*'.repeat(m.length));
      if (words.some((w) => squash(w) === target) && out === text) return '*'.repeat(Math.min(text.length, 12));
      continue;
    }
    if (joined.includes(target)) {
      const re = new RegExp(bad.split('').map((c) => `${c}+`).join('[^a-z]*'), 'gi');
      const replaced = normalise(out).replace(re, (m) => '*'.repeat(m.length));
      // Map stars back onto the original text by position.
      if (replaced !== normalise(out)) out = out.split('').map((c, i) => (replaced[i] === '*' ? '*' : c)).join('');
      else return '*'.repeat(Math.min(text.length, 12));
    }
  }
  return out;
}

/** A display name from elsewhere (Google's first name), with anything blocked removed. */
export function cleanName(name: string): string {
  const n = name.replace(/[^\p{L}\p{N}_ ]/gu, '').trim().slice(0, 16);
  return isClean(n) ? n : '';
}
