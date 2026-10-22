import { describe, expect, it } from 'vitest';
import { BOT_CEILING, DEFAULT_RATING, decay, rateMatch, seasonAt, seasonReset, tierOf, update, SEASON_START, SEASON_DAYS } from './rating';

describe('glicko-2', () => {
  it('matches the worked example in the paper', () => {
    // Glickman's example: 1500/200/0.06 plays 1400/30 (win), 1550/100 (loss), 1700/300 (loss).
    const r = update({ rating: 1500, rd: 200, vol: 0.06 }, [
      { opp: { rating: 1400, rd: 30, vol: 0.06 }, score: 1, weight: 1 },
      { opp: { rating: 1550, rd: 100, vol: 0.06 }, score: 0, weight: 1 },
      { opp: { rating: 1700, rd: 300, vol: 0.06 }, score: 0, weight: 1 },
    ]);
    expect(r.rating).toBeCloseTo(1464.06, 0);
    expect(r.rd).toBeCloseTo(151.52, 0);
    expect(r.vol).toBeCloseTo(0.05999, 4);
  });

  it('grows the deviation back with time away', () => {
    const r = decay({ rating: 1600, rd: 60, vol: 0.06 }, 30);
    expect(r.rd).toBeGreaterThan(60);
    expect(r.rating).toBe(1600);
    expect(decay({ rating: 1600, rd: 340, vol: 0.06 }, 9999).rd).toBe(350);
  });
});

describe('free-for-all', () => {
  const p = (key: string, place: number, rating = DEFAULT_RATING, team?: number) => ({ key, place, rating, team });

  it('moves the winner up and the last place down, in order', () => {
    const out = rateMatch([p('a', 1), p('b', 2), p('c', 3), p('d', 4)], []);
    const r = (k: string) => (out.get(k) as { rating: number }).rating;
    expect(r('a')).toBeGreaterThan(r('b'));
    expect(r('b')).toBeGreaterThan(r('c'));
    expect(r('c')).toBeGreaterThan(r('d'));
    expect(r('a')).toBeGreaterThan(1500);
    expect(r('d')).toBeLessThan(1500);
  });

  it('weighs a match about the same whatever its size', () => {
    const small = rateMatch([p('a', 1), p('b', 2)], []).get('a') as { rating: number };
    const big = rateMatch([p('a', 1), ...Array.from({ length: 7 }, (_, i) => p(`x${i}`, i + 2))], []).get('a') as { rating: number };
    expect(Math.abs(big.rating - small.rating)).toBeLessThan(120);
  });

  it('counts computer trainers for less, and caps how far they carry you', () => {
    const vsBots = rateMatch([p('a', 1)], [2, 3, 4, 5, 6, 7, 8]).get('a') as { rating: number };
    const vsHumans = rateMatch([p('a', 1), ...Array.from({ length: 7 }, (_, i) => p(`x${i}`, i + 2))], []).get('a') as { rating: number };
    expect(vsBots.rating).toBeGreaterThan(1500);
    expect(vsBots.rating).toBeLessThan(vsHumans.rating);
    let r = { rating: 1500, rd: 350, vol: 0.06 };
    for (let i = 0; i < 200; i++) r = rateMatch([{ key: 'a', place: 1, rating: r }], [2, 3, 4, 5, 6, 7, 8]).get('a') as typeof r;
    expect(r.rating).toBeLessThan(BOT_CEILING + 60);
    // Losing to them still costs.
    const lost = rateMatch([{ key: 'a', place: 8, rating: r }], [1, 2, 3, 4, 5, 6, 7]).get('a') as typeof r;
    expect(lost.rating).toBeLessThan(r.rating);
  });

  it('leaves teammates out of each other\'s result', () => {
    const out = rateMatch([p('a', 1, DEFAULT_RATING, 1), p('b', 1, DEFAULT_RATING, 1), p('c', 3, DEFAULT_RATING, 2), p('d', 3, DEFAULT_RATING, 2)], []);
    expect((out.get('a') as { rating: number }).rating).toBeCloseTo((out.get('b') as { rating: number }).rating, 6);
    expect((out.get('a') as { rating: number }).rating).toBeGreaterThan(1500);
  });
});

describe('seasons and tiers', () => {
  it('numbers seasons from the start date', () => {
    expect(seasonAt(SEASON_START - 1000).season).toBe(1);
    expect(seasonAt(SEASON_START + 1000).season).toBe(1);
    expect(seasonAt(SEASON_START + SEASON_DAYS * 86400_000 + 1).season).toBe(2);
  });

  it('starts a season halfway back to 1500', () => {
    expect(seasonReset({ rating: 1900, rd: 50, vol: 0.06 })).toEqual({ rating: 1700, rd: 200, vol: 0.06 });
  });

  it('shows no tier during placement games', () => {
    expect(tierOf(2000, 2)).toBeNull();
    expect(tierOf(1520, 10)?.id).toBe('gold');
    expect(tierOf(1000, 10)?.id).toBe('bronze');
    expect(tierOf(2100, 10)?.id).toBe('master');
  });
});
