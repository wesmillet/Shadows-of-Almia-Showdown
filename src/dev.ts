/**
 * Tester mode, for the game's owner while it is being built: open the site once with ?dev=1 and
 * it stays on in that browser (?dev=0 turns it off). Hoopa visits every match and the Storm Mask is
 * always in the shop. (The rare-item chest is separate and on for everyone: rareChest below.)
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

const RARE_KEY = 'almia.rareChest';
let rareCached: boolean | null = null;

/**
 * The rare-item chest: while the game is being built, the player's storage chest is topped up with
 * every rare item (DEV_CHEST below) at the start of every match, normal games and demo alike. It is
 * on by default; open the site once with ?rare=0 to turn it off in that browser (?rare=1 back on).
 */
export function rareChest(): boolean {
  if (rareCached !== null) return rareCached;
  try {
    if (typeof location !== 'undefined') {
      const q = new URLSearchParams(location.search).get('rare');
      if (q === '0') localStorage.setItem(RARE_KEY, '0');
      if (q === '1') localStorage.removeItem(RARE_KEY);
    }
    rareCached = typeof localStorage === 'undefined' || localStorage.getItem(RARE_KEY) !== '0';
  } catch {
    rareCached = true;
  }
  return rareCached;
}

/** What the rare-item chest holds (every rare thing), topped back up at the start of each match: [item id, count]. */
export const DEV_CHEST: Array<[string, number]> = [
  ['capture-styler', 5], ['super-rod', 1], ['storm-mask', 1], ['extraction-voucher', 5], ['master-ball', 3],
  ['charizardite-x', 1], ['gengarite', 1], ['steelixite', 1], ['tyranitarite', 1], ['gardevoirite', 1],
  ['absolite', 1], ['glalitite', 1], ['latiosite', 1], ['lucarionite', 1], ['galladite', 1],
  ['ultra-ball', 10], ['quick-ball', 5], ['net-ball', 5], ['dusk-ball', 5], ['rare-candy', 10], ['max-revive', 5],
  ['crystal-shard', 3], ['exp-share', 1], ['lucky-egg', 1], ['leftovers', 1], ['focus-sash', 1], ['choice-band', 1], ['life-orb', 1],
  ['charcoal', 1], ['mystic-water', 1], ['magnet', 1], ['miracle-seed', 1], ['never-melt-ice', 1], ['black-belt', 1],
  ['soft-sand', 1], ['sharp-beak', 1], ['twisted-spoon', 1], ['poison-barb', 1], ['hard-stone', 1], ['spell-tag', 1],
  ['dragon-fang', 1], ['black-glasses', 1], ['metal-coat', 1], ['silk-scarf', 1],
  ['fire-stone', 1], ['water-stone', 1], ['thunder-stone', 1], ['leaf-stone', 1], ['ice-stone', 1],
  ['moon-stone', 1], ['sun-stone', 1], ['shiny-stone', 1], ['dusk-stone', 1], ['dawn-stone', 1],
  ['tm-flamethrower', 1], ['tm-surf', 1], ['tm-thunderbolt', 1], ['tm-earthquake', 1], ['tm-sludge-bomb', 1],
  ['tm-stone-edge', 1], ['tm-wild-charge', 1], ['tm-return', 1], ['tm-heat-wave', 1], ['tm-swords-dance', 1], ['tm-nasty-plot', 1],
];
