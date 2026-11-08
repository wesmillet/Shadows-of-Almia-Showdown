/**
 * Starter achievements: permanent unlocks saved to a player's account. Each one adds a Pokémon the
 * player can nominate for the third starter slot (src/sim/starters.ts), and its Pokémon goes to the
 * PC. Most let the player choose one of three (a choice is final); the launch-week one gives a
 * random shiny starter.
 */
export type StarterStat = 'signin' | 'catches' | 'matches' | 'species' | 'top3' | 'launchWeekKos';

/** Every first-stage starter, Kanto to Paldea. */
export const ALL_STARTERS = [
  '0001', '0004', '0007', '0152', '0155', '0158', '0252', '0255', '0258', '0387', '0390', '0393', '0495', '0498', '0501',
  '0650', '0653', '0656', '0722', '0725', '0728', '0810', '0813', '0816', '0906', '0909', '0912',
];

/**
 * Launch week: trainers defeated in matches that end in the 7 days from this moment count for
 * Launch Week Champion. null until the launch date is set: the achievement is hidden until then.
 * Set as an ISO time with its offset, e.g. '2026-11-10T12:00:00-05:00'.
 */
export const LAUNCH_WEEK_START: string | null = '2026-11-06T00:00:00-05:00';
export const LAUNCH_WEEK_MS = 7 * 24 * 3600 * 1000;

export function launchWeek(startAt: string | null = LAUNCH_WEEK_START): { start: number; end: number } | null {
  const t = startAt ? Date.parse(startAt) : NaN;
  return Number.isFinite(t) ? { start: t, end: t + LAUNCH_WEEK_MS } : null;
}

export interface StarterAchievement {
  id: string;
  name: string;
  desc: string;
  stat: StarterStat;
  goal: number;
  reward: { kind: 'random'; tier?: string; options?: string[]; shiny?: boolean; label: string } | { kind: 'choice'; options: string[] };
  /** Only shown (and only earned) during launch week, or once earned. */
  launchWeek?: boolean;
}

export const STARTER_ACHIEVEMENTS: StarterAchievement[] = [
  { id: 'sign_in', name: 'Welcome, Ranger', desc: 'Sign in', stat: 'signin', goal: 1, reward: { kind: 'choice', options: ['0001', '0004', '0007'] } },
  { id: 'three_matches', name: 'Getting Started', desc: 'Finish 3 matches', stat: 'matches', goal: 3, reward: { kind: 'choice', options: ['0252', '0255', '0258'] } },
  { id: 'ten_species', name: 'Field Researcher', desc: 'Catch 10 different species', stat: 'species', goal: 10, reward: { kind: 'choice', options: ['0387', '0390', '0393'] } },
  { id: 'podium_three', name: 'Podium Regular', desc: 'Finish in the top three 3 times', stat: 'top3', goal: 3, reward: { kind: 'choice', options: ['0152', '0155', '0158'] } },
  { id: 'launch_week', name: 'Launch Week Champion', desc: 'Defeat 25 trainers during launch week', stat: 'launchWeekKos', goal: 25, reward: { kind: 'random', options: ALL_STARTERS, shiny: true, label: 'a random shiny starter' }, launchWeek: true },
];

/** What /api/starters answers (the Starters panel). */
export interface StartersInfo {
  achievements: Array<{ id: string; name: string; desc: string; goal: number; progress: number; done: boolean; reward: StarterAchievement['reward']; dex: string | null }>;
  eligible: Array<{ dex: string; tier: string; cost: number }>;
  nominations: string[];
  budget: number;
  slots: number;
  costs: Record<string, number>;
  weights: Record<string, number>;
  /** Today's pick from the PC: offered beside the three rolled starters in every match today. */
  daily: { dex: string; name: string; pcId: number } | null;
  /** When a new daily pick can be made (ms since 1970; midnight UTC). */
  dailyResetAt: number;
}

/** The day a daily starter pick belongs to (UTC date), and when the next day starts. */
export function starterDay(now = Date.now()): { day: string; resetAt: number } {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return { day: new Date(start).toISOString().slice(0, 10), resetAt: start + 86400_000 };
}
