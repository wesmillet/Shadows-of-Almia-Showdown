/**
 * Tester mode, for the game's owner while it is being built: open the site once with ?dev=1 and
 * it stays on in that browser (?dev=0 turns it off). Hoopa visits every match and the storage
 * chests start stocked with the Snag Machine, the Super Rod, every Mega Stone, Extraction
 * Vouchers and the rare items, so new features can be tried without hunting for them.
 */
const KEY = 'almia.dev';

let cached: boolean | null = null;

export function isDev(): boolean {
  if (cached !== null) return cached;
  try {
    if (typeof location !== 'undefined') {
      const q = new URLSearchParams(location.search).get('dev');
      if (q === '1') localStorage.setItem(KEY, '1');
      if (q === '0') localStorage.removeItem(KEY);
    }
    cached = typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1';
  } catch {
    cached = false;
  }
  return cached;
}

/** What a tester's storage chest starts with: [item id, count]. */
export const DEV_CHEST: Array<[string, number]> = [
  ['capture-styler', 5], ['super-rod', 1], ['extraction-voucher', 5], ['master-ball', 3],
  ['charizardite-x', 1], ['gengarite', 1], ['steelixite', 1], ['tyranitarite', 1], ['gardevoirite', 1],
  ['absolite', 1], ['glalitite', 1], ['latiosite', 1], ['lucarionite', 1], ['galladite', 1],
  ['ultra-ball', 10], ['quick-ball', 5], ['net-ball', 5], ['dusk-ball', 5], ['rare-candy', 10], ['max-revive', 5],
  ['crystal-shard', 3], ['exp-share', 1], ['lucky-egg', 1], ['leftovers', 1], ['focus-sash', 1], ['choice-band', 1], ['life-orb', 1],
  ['charcoal', 1], ['mystic-water', 1], ['magnet', 1], ['miracle-seed', 1], ['never-melt-ice', 1], ['black-belt', 1],
  ['soft-sand', 1], ['sharp-beak', 1], ['twisted-spoon', 1], ['poison-barb', 1], ['hard-stone', 1], ['spell-tag', 1],
  ['dragon-fang', 1], ['black-glasses', 1], ['metal-coat', 1], ['silk-scarf', 1],
];
