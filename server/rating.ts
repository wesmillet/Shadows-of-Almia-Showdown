/**
 * Ranked rating: Glicko-2 (Mark Glickman, glicko.net/glicko/glicko2.pdf), extended to a free-for-all.
 *
 * A match with n trainers counts as a game between every pair of them: the better placed of the two
 * won it (teammates, who place together, drew). Each pairing is weighted so that a whole match moves
 * a rating about as much as PAIR_WEIGHT_TOTAL games would, whatever the match size; computer trainers
 * count as fixed opponents (BOT) at half weight, so a ranked match that filled up with them still
 * means something but can not carry anyone past BOT_CEILING.
 *
 * Ratings are shown on the familiar 1500 scale. Deviation (RD) is how unsure the rating is: it
 * shrinks with games and grows back with time away (one rating period is a day). A season starts
 * everyone halfway back toward 1500 with a wider RD.
 */

export interface Rating {
  rating: number;
  rd: number;
  vol: number;
}

export const DEFAULT_RATING: Rating = { rating: 1500, rd: 350, vol: 0.06 };
/** A computer trainer, as a ranked opponent. */
export const BOT: Rating = { rating: 1350, rd: 80, vol: 0.06 };
const BOT_WEIGHT = 0.5;
/** Above this, beating computer trainers stops counting (losing to them still does): the top tiers take people. */
export const BOT_CEILING = 1750;
/** A whole match is worth about this many head-to-head games. */
const PAIR_WEIGHT_TOTAL = 3;
/** The system constant: how much volatility may change (Glickman suggests 0.3 to 1.2). */
const TAU = 0.5;
const SCALE = 173.7178;
const MAX_RD = 350;
const MIN_RD = 45;

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expect = (mu: number, muj: number, phij: number) => 1 / (1 + Math.exp(-g(phij) * (mu - muj)));

/** The RD after `days` without a game (it grows back toward the starting RD). */
export function decay(r: Rating, days: number): Rating {
  if (days <= 0) return r;
  const phi = r.rd / SCALE;
  const phi2 = Math.sqrt(phi * phi + days * r.vol * r.vol);
  return { ...r, rd: Math.min(MAX_RD, phi2 * SCALE) };
}

export interface Pairing {
  opp: Rating;
  /** 1 a win, 0.5 a draw, 0 a loss. */
  score: number;
  weight: number;
}

/** One Glicko-2 rating period with weighted games (weight 1 everywhere is the standard algorithm). */
export function update(r: Rating, games: Pairing[]): Rating {
  const mu = (r.rating - 1500) / SCALE;
  const phi = r.rd / SCALE;
  if (!games.length) return decay(r, 1);
  let vInv = 0;
  let dSum = 0;
  for (const gm of games) {
    const muj = (gm.opp.rating - 1500) / SCALE;
    const phij = gm.opp.rd / SCALE;
    const e = expect(mu, muj, phij);
    const gj = g(phij);
    vInv += gm.weight * gj * gj * e * (1 - e);
    dSum += gm.weight * gj * (gm.score - e);
  }
  const v = 1 / vInv;
  const delta = v * dSum;
  // New volatility (the Illinois algorithm from the paper, step 5).
  const a = Math.log(r.vol * r.vol);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * TAU) < 0 && k < 100) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > 1e-6; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else fA /= 2;
    B = C;
    fB = fC;
  }
  const vol = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + vol * vol);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * dSum;
  return { rating: muNew * SCALE + 1500, rd: Math.max(MIN_RD, Math.min(MAX_RD, phiNew * SCALE)), vol };
}

export interface Entrant {
  key: string;
  rating: Rating;
  /** 1 for the winner. Teammates share their team's place. */
  place: number;
  team?: number;
}

/**
 * Everyone's new rating after one match. `bots` is how many computer trainers were in it and the
 * places they finished in (each is a fixed BOT opponent).
 */
export function rateMatch(players: Entrant[], botPlaces: number[]): Map<string, Rating> {
  const out = new Map<string, Rating>();
  const field = players.length + botPlaces.length;
  if (field < 2) {
    for (const p of players) out.set(p.key, p.rating);
    return out;
  }
  const w = PAIR_WEIGHT_TOTAL / (field - 1);
  for (const p of players) {
    const games: Pairing[] = [];
    for (const q of players) {
      if (q === p) continue;
      const mates = p.team !== undefined && p.team === q.team;
      const score = mates || q.place === p.place ? 0.5 : p.place < q.place ? 1 : 0;
      // Teammates' shared result says nothing about who is better: it is left out.
      if (!mates) games.push({ opp: q.rating, score, weight: w });
    }
    for (const bp of botPlaces) {
      const score = bp === p.place ? 0.5 : p.place < bp ? 1 : 0;
      if (score > 0 && p.rating.rating >= BOT_CEILING) continue;
      games.push({ opp: BOT, score, weight: w * BOT_WEIGHT });
    }
    out.set(p.key, games.length ? update(p.rating, games) : p.rating);
  }
  return out;
}

// ---------------------------------------------------------------- seasons and tiers

/** Season 1 starts here; each runs SEASON_DAYS (both can be set on the server). */
export const SEASON_START = Date.parse(process.env.SEASON_START ?? '2026-11-01T00:00:00Z');
export const SEASON_DAYS = Number(process.env.SEASON_DAYS ?? 60);

export function seasonAt(t: number): { season: number; startsAt: number; endsAt: number } {
  const len = SEASON_DAYS * 86400_000;
  const n = Math.max(1, Math.floor((t - SEASON_START) / len) + 1);
  const startsAt = SEASON_START + (n - 1) * len;
  return { season: n, startsAt, endsAt: startsAt + len };
}

/** The new season's starting rating: halfway back to 1500, less sure. */
export function seasonReset(prev: Rating): Rating {
  return { rating: 1500 + (prev.rating - 1500) / 2, rd: Math.max(prev.rd, 200), vol: DEFAULT_RATING.vol };
}

/** Ranked games before a tier is shown. */
export const PLACEMENT_GAMES = 5;

export const TIERS = [
  { id: 'bronze', name: 'Bronze', min: -Infinity, color: '#b0764a' },
  { id: 'silver', name: 'Silver', min: 1350, color: '#c0c6d0' },
  { id: 'gold', name: 'Gold', min: 1500, color: '#f2c24a' },
  { id: 'platinum', name: 'Platinum', min: 1650, color: '#7fd8d0' },
  { id: 'diamond', name: 'Diamond', min: 1800, color: '#8ab4ff' },
  { id: 'master', name: 'Master', min: 1950, color: '#d77bff' },
] as const;

export function tierOf(rating: number, games: number): { id: string; name: string; color: string } | null {
  if (games < PLACEMENT_GAMES) return null;
  let t: (typeof TIERS)[number] = TIERS[0];
  for (const x of TIERS) if (rating >= x.min) t = x;
  return { id: t.id, name: t.name, color: t.color };
}
