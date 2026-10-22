/**
 * Online progression, shared by the server (which awards it) and the browser (which shows it):
 * trainer XP and levels, achievements, titles, and the trainer looks they unlock.
 *
 * Every match a signed-in player finishes (casual or ranked; private matches keep nothing) earns
 * XP for playing, for how far they got, and for what they did. Levels unlock Ranger looks;
 * achievements unlock titles (shown on profiles and in battles) and the two named looks.
 */

// ---------------------------------------------------------------- XP and levels

export const MAX_LEVEL = 100;

/** XP from one level to the next. */
export function xpToNext(level: number): number {
  return 200 + 60 * (level - 1);
}

/** Level and progress for a lifetime XP total. */
export function levelOf(xp: number): { level: number; into: number; next: number } {
  let level = 1;
  let left = Math.max(0, Math.floor(xp));
  while (level < MAX_LEVEL && left >= xpToNext(level)) {
    left -= xpToNext(level);
    level++;
  }
  return { level, into: left, next: level >= MAX_LEVEL ? 0 : xpToNext(level) };
}

export interface MatchFacts {
  mode: 'casual' | 'ranked' | 'private';
  place: number;
  /** Trainers in the match (humans and computer trainers). */
  field: number;
  outcome: 'win' | 'loss';
  /** Won as part of a squad. */
  squad: boolean;
  stats: { catches: number; knockouts: number; damage: number; timeSurvived: number };
  /** The party at the end. */
  party: Array<{ dex: string; level: number; shiny: boolean; alpha: boolean; legend: boolean; shadow: boolean }>;
}

/** XP for a match, line by line (the end screen lists them). */
export function matchXp(f: MatchFacts): Array<{ what: string; xp: number }> {
  if (f.mode === 'private') return [];
  const out: Array<{ what: string; xp: number }> = [{ what: 'Played a match', xp: 40 }];
  const beaten = Math.max(0, f.field - f.place);
  if (beaten) out.push({ what: `Outlasted ${beaten} trainer${beaten === 1 ? '' : 's'}`, xp: beaten * 12 });
  if (f.outcome === 'win') out.push({ what: f.squad ? 'Squad victory' : 'Victory', xp: 150 });
  if (f.stats.knockouts) out.push({ what: `${f.stats.knockouts} knockout${f.stats.knockouts === 1 ? '' : 's'}`, xp: f.stats.knockouts * 10 });
  if (f.stats.catches) out.push({ what: `${f.stats.catches} catch${f.stats.catches === 1 ? '' : 'es'}`, xp: f.stats.catches * 15 });
  const dmg = Math.floor(f.stats.damage / 60);
  if (dmg) out.push({ what: 'Damage dealt', xp: Math.min(150, dmg) });
  const minutes = Math.floor(f.stats.timeSurvived / 60);
  if (minutes) out.push({ what: `Survived ${minutes} min`, xp: Math.min(120, minutes * 10) });
  if (f.mode === 'ranked') {
    const sum = out.reduce((n, x) => n + x.xp, 0);
    out.push({ what: 'Ranked bonus', xp: Math.round(sum * 0.25) });
  }
  return out;
}

// ---------------------------------------------------------------- achievements

/** What an achievement can look at: this match, and the player's totals after it. */
export interface AchievementContext {
  match: MatchFacts | null;
  life: { matches: number; wins: number; catches: number; knockouts: number; damage: number };
  level: number;
  /** Ranked tier id this season (null before placement). */
  tier: string | null;
  rankedWins: number;
  pc: number;
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  /** A title it unlocks (to wear on your profile and in battles). */
  title?: string;
  /** A trainer look it unlocks. */
  look?: string;
  check: (c: AchievementContext) => boolean;
}

const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master'];
const atLeast = (tier: string | null, want: string) => tier !== null && TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(want);

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_match', name: 'First Steps', desc: 'Finish an online match', check: (c) => c.life.matches >= 1 },
  { id: 'first_win', name: 'Last One Standing', desc: 'Win a match', title: 'Champion', look: 'orig_00', check: (c) => c.life.wins >= 1 },
  { id: 'wins_10', name: 'Seasoned', desc: 'Win 10 matches', title: 'Veteran', check: (c) => c.life.wins >= 10 },
  { id: 'wins_50', name: 'Island Legend', desc: 'Win 50 matches', title: 'Legend of Almia', check: (c) => c.life.wins >= 50 },
  { id: 'squad_win', name: 'Stronger Together', desc: 'Win as a squad', title: 'Squad Leader', check: (c) => !!c.match && c.match.outcome === 'win' && c.match.squad },
  { id: 'top3', name: 'Podium', desc: 'Finish in the top three', check: (c) => !!c.match && c.match.place <= 3 && c.match.field >= 4 },
  { id: 'ko_10', name: 'Unstoppable', desc: '10 knockouts in one match', title: 'Unstoppable', check: (c) => (c.match?.stats.knockouts ?? 0) >= 10 },
  { id: 'catch_5', name: 'Gotta Catch Them', desc: 'Catch 5 Pokémon in one match', check: (c) => (c.match?.stats.catches ?? 0) >= 5 },
  { id: 'catches_100', name: 'Collector', desc: 'Catch 100 Pokémon', title: 'Collector', check: (c) => c.life.catches >= 100 },
  { id: 'damage_5000', name: 'Heavy Hitter', desc: 'Deal 5,000 damage in one match', title: 'Heavy Hitter', check: (c) => (c.match?.stats.damage ?? 0) >= 5000 },
  { id: 'survivor', name: 'Storm Chaser', desc: 'Survive 10 minutes in one match', check: (c) => (c.match?.stats.timeSurvived ?? 0) >= 600 },
  { id: 'full_party', name: 'Full House', desc: 'Finish a match with six Pokémon', check: (c) => (c.match?.party.length ?? 0) >= 6 },
  { id: 'shiny', name: 'Something Sparkly', desc: 'Finish a match with a shiny Pokémon', title: 'Shiny Hunter', check: (c) => !!c.match?.party.some((m) => m.shiny) },
  { id: 'alpha', name: 'Alpha Wrangler', desc: 'Finish a match with an alpha Pokémon', check: (c) => !!c.match?.party.some((m) => m.alpha) },
  { id: 'legend', name: 'Legend Tamer', desc: 'Finish a match with a legendary Pokémon', title: 'Legend Tamer', check: (c) => !!c.match?.party.some((m) => m.legend) },
  { id: 'level_50_mon', name: 'Raised Right', desc: 'Finish a match with a Pokémon at level 50 or higher', check: (c) => !!c.match?.party.some((m) => m.level >= 50) },
  { id: 'ranked_win', name: 'Ranked Victor', desc: 'Win a ranked match', check: (c) => c.rankedWins >= 1 },
  { id: 'tier_gold', name: 'Gold Standard', desc: 'Reach Gold in ranked', look: 'orig_01', check: (c) => atLeast(c.tier, 'gold') },
  { id: 'tier_diamond', name: 'Diamond Hands', desc: 'Reach Diamond in ranked', title: 'Diamond', check: (c) => atLeast(c.tier, 'diamond') },
  { id: 'tier_master', name: 'Master Ranger', desc: 'Reach Master in ranked', title: 'Master Ranger', check: (c) => atLeast(c.tier, 'master') },
  { id: 'pc_10', name: 'Starting a Collection', desc: 'Keep 10 Pokémon in your PC', check: (c) => c.pc >= 10 },
  { id: 'pc_50', name: 'Professor', desc: 'Keep 50 Pokémon in your PC', title: 'Professor', check: (c) => c.pc >= 50 },
  { id: 'level_10', name: 'Ace Trainer', desc: 'Reach trainer level 10', title: 'Ace Trainer', check: (c) => c.level >= 10 },
  { id: 'level_25', name: 'Elite', desc: 'Reach trainer level 25', title: 'Elite', check: (c) => c.level >= 25 },
  { id: 'level_50', name: "Almia's Finest", desc: 'Reach trainer level 50', title: "Almia's Finest", check: (c) => c.level >= 50 },
];

export function achievement(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/** Titles a player can wear, from what they have earned. */
export function titlesFor(earned: Iterable<string>): string[] {
  const have = new Set(earned);
  return ACHIEVEMENTS.filter((a) => a.title && have.has(a.id)).map((a) => a.title as string);
}

// ---------------------------------------------------------------- looks

/** Looks every trainer has from the start: the townsfolk, and the game's own Ranger. */
export function isFreeLook(look: string): boolean {
  return look.startsWith('civ_') || look === 'union_00';
}

/** The other Ranger looks unlock with trainer levels. */
export const LOOK_LEVELS: Record<string, number> = {
  union_01: 2, union_02: 3, union_03: 5, union_04: 7, union_05: 10,
  union_06: 13, union_07: 16, union_08: 20, union_09: 25,
};

/** What it takes to wear a look (null: free). */
export function lookRequirement(look: string): { level?: number; achievement?: Achievement } | null {
  if (isFreeLook(look)) return null;
  const level = LOOK_LEVELS[look];
  if (level !== undefined) return { level };
  const a = ACHIEVEMENTS.find((x) => x.look === look);
  if (a) return { achievement: a };
  return null;
}

/** Can a trainer at this level with these achievements wear this look? */
export function canWear(look: string, level: number, earned: Iterable<string>): boolean {
  const req = lookRequirement(look);
  if (!req) return true;
  if (req.level !== undefined) return level >= req.level;
  return !!req.achievement && new Set(earned).has(req.achievement.id);
}
