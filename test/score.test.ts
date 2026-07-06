import { describe, expect, it } from 'vitest';
import { radarScore } from '../src/score';

describe('radarScore', () => {
  it('gives the theoretical maximum to a brand-new #1 app with huge velocity', () => {
    const score = radarScore({
      daysSinceRelease: 0,
      bestRank: 1,
      daysOnChart: 30,
      ratingsPerDay: 100,
    });
    expect(score).toBe(100);
  });

  it('gives ~0 to an old, bottom-of-chart, no-velocity app', () => {
    const score = radarScore({
      daysSinceRelease: 400,
      bestRank: 200,
      daysOnChart: 0,
      ratingsPerDay: 0,
    });
    expect(score).toBe(0);
  });

  it('treats unknown velocity as zero contribution', () => {
    const withNull = radarScore({
      daysSinceRelease: 30,
      bestRank: 10,
      daysOnChart: 5,
      ratingsPerDay: null,
    });
    const withZero = radarScore({
      daysSinceRelease: 30,
      bestRank: 10,
      daysOnChart: 5,
      ratingsPerDay: 0,
    });
    expect(withNull).toBe(withZero);
  });

  it('scores newer releases higher, all else equal', () => {
    const base = { bestRank: 20, daysOnChart: 10, ratingsPerDay: 5 };
    const newer = radarScore({ ...base, daysSinceRelease: 15 });
    const older = radarScore({ ...base, daysSinceRelease: 300 });
    expect(newer).toBeGreaterThan(older);
  });

  it('scores better ranks higher on a log scale', () => {
    const base = { daysSinceRelease: 30, daysOnChart: 10, ratingsPerDay: 5 };
    const rank1 = radarScore({ ...base, bestRank: 1 });
    const rank10 = radarScore({ ...base, bestRank: 10 });
    const rank100 = radarScore({ ...base, bestRank: 100 });
    expect(rank1).toBeGreaterThan(rank10);
    expect(rank10).toBeGreaterThan(rank100);
    // Log scale: 1→10 hurts about as much as 10→100.
    expect(Math.abs(rank1 - rank10 - (rank10 - rank100))).toBeLessThanOrEqual(2);
  });

  it('saturates persistence at 30 days and velocity at 100/day', () => {
    const base = { daysSinceRelease: 30, bestRank: 10 };
    expect(
      radarScore({ ...base, daysOnChart: 30, ratingsPerDay: 100 }),
    ).toBe(radarScore({ ...base, daysOnChart: 90, ratingsPerDay: 5000 }));
  });

  it('stays within 0..100 and respects custom weights', () => {
    const score = radarScore(
      { daysSinceRelease: 10, bestRank: 3, daysOnChart: 20, ratingsPerDay: 40 },
      { recency: 1, rank: 0, persistence: 0, velocity: 0 },
    );
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBe(97); // pure recency: (1 - 10/365) * 100 ≈ 97.3
  });
});
