import { describe, expect, it } from 'vitest';
import { ratingsVelocity } from '../src/velocity';

describe('ratingsVelocity', () => {
  it('computes ratings per day across the window', () => {
    const v = ratingsVelocity([
      { date: '2026-07-01', ratingCount: 100 },
      { date: '2026-07-08', ratingCount: 240 },
    ]);
    expect(v).toBeCloseTo(20); // 140 new ratings over 7 days
  });

  it('uses only points within the trailing window', () => {
    const v = ratingsVelocity(
      [
        { date: '2026-01-01', ratingCount: 0 }, // far outside window, ignored
        { date: '2026-07-01', ratingCount: 100 },
        { date: '2026-07-11', ratingCount: 200 },
      ],
      14,
    );
    expect(v).toBeCloseTo(10); // (200-100)/10, not (200-0)/191
  });

  it('is null with fewer than two distinct days', () => {
    expect(ratingsVelocity([])).toBeNull();
    expect(ratingsVelocity([{ date: '2026-07-01', ratingCount: 5 }])).toBeNull();
    expect(
      ratingsVelocity([
        { date: '2026-07-01', ratingCount: 5 },
        { date: '2026-07-01', ratingCount: 9 },
      ]),
    ).toBeNull();
  });

  it('clamps negative deltas (Apple pruning ratings) to zero', () => {
    const v = ratingsVelocity([
      { date: '2026-07-01', ratingCount: 500 },
      { date: '2026-07-05', ratingCount: 480 },
    ]);
    expect(v).toBe(0);
  });

  it('sorts unsorted input', () => {
    const v = ratingsVelocity([
      { date: '2026-07-08', ratingCount: 240 },
      { date: '2026-07-01', ratingCount: 100 },
    ]);
    expect(v).toBeCloseTo(20);
  });
});
