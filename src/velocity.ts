export interface RatingsPoint {
  /** ISO date string (yyyy-mm-dd). */
  date: string;
  ratingCount: number;
}

const MS_PER_DAY = 86_400_000;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / MS_PER_DAY);
}

/**
 * Ratings velocity: new ratings per day over a trailing window.
 *
 * Takes the latest snapshot and the earliest snapshot no older than
 * `windowDays` before it, and returns (Δ rating count) / (Δ days).
 * Returns null when there are fewer than two distinct days of data in the
 * window (velocity is undefined, not zero — the dashboard shows a dash).
 *
 * Negative deltas (Apple occasionally prunes ratings) are clamped to 0.
 * Mirrors the SQL in v_ratings_velocity; keep the two in sync.
 */
export function ratingsVelocity(
  points: RatingsPoint[],
  windowDays = 14,
): number | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1]!;
  const inWindow = sorted.filter(
    (p) => daysBetween(p.date, latest.date) <= windowDays,
  );
  const earliest = inWindow[0]!;
  const span = daysBetween(earliest.date, latest.date);
  if (span <= 0) return null;
  const delta = Math.max(0, latest.ratingCount - earliest.ratingCount);
  return delta / span;
}
