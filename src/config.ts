export interface CategoryConfig {
  /** iTunes genre id, or null for the overall (all-categories) chart. */
  genreId: number | null;
  label: string;
}

export interface ScoreWeights {
  recency: number;
  rank: number;
  persistence: number;
  velocity: number;
}

export interface AppConfig {
  countries: string[];
  categories: CategoryConfig[];
  /**
   * Requested chart depth. NOTE: verified at build time (2026-07) that the
   * legacy iTunes RSS caps at 100 entries regardless of the limit parameter,
   * and the marketing RSS API no longer serves top-grossing feeds at all.
   * We request 200 anyway in case Apple restores deeper feeds; expect 100.
   */
  chartDepth: number;
  /** Recency windows (days since release) offered by the dashboard. */
  recencyWindows: number[];
  /** Max app ids per iTunes Lookup call (API maximum is 200). */
  lookupBatchSize: number;
  /** Min interval between Lookup calls; 3200ms ≈ 18 req/min (limit ~20/min). */
  lookupMinIntervalMs: number;
  /** Re-enrich an app's metadata if last enriched more than this many days ago. */
  enrichStaleDays: number;
  /** Per-request timeout for all external calls. */
  requestTimeoutMs: number;
  /** Retries per external call (exponential backoff). */
  requestRetries: number;
  /** Hour of day (UTC) at which the scheduler runs the daily snapshot. */
  snapshotHourUtc: number;
  /** Radar score weights — must sum to 1. See README "Tuning the score". */
  scoreWeights: ScoreWeights;
  /** Days-since-release beyond which the recency component reaches 0. */
  scoreRecencyHorizonDays: number;
  /** Days-on-chart at which the persistence component saturates at 1. */
  scorePersistenceSaturationDays: number;
  /** Ratings/day at which the velocity component saturates at 1. */
  scoreVelocitySaturationPerDay: number;
}

function envList(name: string): string[] | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  return v
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config: AppConfig = {
  // US-focused; add e.g. 'gb', 'de', 'au', 'ca' here (or via COUNTRIES env)
  // to widen coverage — smaller storefronts surface apps before the US top-100.
  countries: envList('COUNTRIES') ?? ['us'],
  // Every active non-game App Store genre. Each category chart reaches ~100
  // deep, so wide category coverage is how we see past the overall top-100.
  categories: [
    { genreId: null, label: 'Overall' },
    { genreId: 6000, label: 'Business' },
    { genreId: 6001, label: 'Weather' },
    { genreId: 6002, label: 'Utilities' },
    { genreId: 6003, label: 'Travel' },
    { genreId: 6004, label: 'Sports' },
    { genreId: 6005, label: 'Social Networking' },
    { genreId: 6006, label: 'Reference' },
    { genreId: 6007, label: 'Productivity' },
    { genreId: 6008, label: 'Photo & Video' },
    { genreId: 6009, label: 'News' },
    { genreId: 6010, label: 'Navigation' },
    { genreId: 6011, label: 'Music' },
    { genreId: 6012, label: 'Lifestyle' },
    { genreId: 6013, label: 'Health & Fitness' },
    { genreId: 6015, label: 'Finance' },
    { genreId: 6016, label: 'Entertainment' },
    { genreId: 6017, label: 'Education' },
    { genreId: 6018, label: 'Books' },
    { genreId: 6020, label: 'Medical' },
    { genreId: 6023, label: 'Food & Drink' },
    { genreId: 6024, label: 'Shopping' },
    { genreId: 6026, label: 'Developer Tools' },
    { genreId: 6027, label: 'Graphics & Design' },
    // { genreId: 6014, label: 'Games' }, // huge + dominated by big publishers; enable if wanted
  ],
  chartDepth: 200,
  recencyWindows: [90, 180, 365],
  lookupBatchSize: 200,
  lookupMinIntervalMs: 3200,
  enrichStaleDays: 7,
  requestTimeoutMs: 20_000,
  requestRetries: 3,
  snapshotHourUtc: envInt('SNAPSHOT_HOUR_UTC', 6),
  scoreWeights: {
    recency: 0.3,
    rank: 0.25,
    persistence: 0.2,
    velocity: 0.25,
  },
  scoreRecencyHorizonDays: 365,
  scorePersistenceSaturationDays: 30,
  scoreVelocitySaturationPerDay: 100,
};

/** Canonical chart name stored in chart_snapshots, e.g. "top-grossing-overall" or "top-grossing-6013". */
export function chartName(category: CategoryConfig): string {
  return category.genreId === null ? 'top-grossing-overall' : `top-grossing-${category.genreId}`;
}

export function chartLabel(chart: string): string {
  const suffix = chart.replace('top-grossing-', '');
  if (suffix === 'overall') return 'Overall';
  const cat = config.categories.find((c) => String(c.genreId) === suffix);
  return cat ? cat.label : suffix;
}
