export interface Meta {
  collectingSince: string | null;
  snapshotDays: number;
  countries: string[];
  charts: { chart: string; label: string }[];
  recencyWindows: number[];
  lastRun: { finished_at: string | null; success: boolean | null } | null;
}

export interface NewItem {
  appId: string;
  name: string;
  developer: string | null;
  primaryGenre: string | null;
  releaseDate: string | null;
  daysSinceRelease: number;
  price: number | null;
  artworkUrl: string | null;
  country: string;
  bestRank: number;
  bestRankChart: string;
  bestRankChartLabel: string;
  daysOnChart: number;
  ratingCount: number | null;
  avgRating: number | null;
  ratingsPerDay: number | null;
  score: number;
}

export interface Climber {
  appId: string;
  name: string;
  developer: string | null;
  primaryGenre: string | null;
  releaseDate: string | null;
  artworkUrl: string | null;
  country: string;
  avgRankLast7: number;
  avgRankPrev7: number;
  rankImprovement: number;
  ratingCount: number | null;
  ratingsPerDay: number | null;
}

export interface PersistentApp {
  appId: string;
  name: string;
  developer: string | null;
  primaryGenre: string | null;
  releaseDate: string | null;
  artworkUrl: string | null;
  country: string;
  runStart: string;
  runEnd: string;
  runDays: number;
  chartedDayCount: number;
  persistent30d: boolean;
  persistent60d: boolean;
  currentlyCharting: boolean;
  ratingCount: number | null;
  ratingsPerDay: number | null;
}

export type SparkPoint = { date: string; rank: number };
export type SparkSeries = Record<string, SparkPoint[]>;
