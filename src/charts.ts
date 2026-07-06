import { config, chartName, type CategoryConfig } from './config.js';
import { fetchJson } from './http.js';

/** One ranked entry parsed from a chart feed. */
export interface ChartEntry {
  appId: number;
  rank: number;
  name: string;
  developer: string | null;
  bundleId: string | null;
  artworkUrl: string | null;
}

// --- Legacy iTunes RSS JSON shapes (only the fields we read). ---
// Quirk: `entry` is an array normally, but a bare object when the feed has
// exactly one item, and absent when empty.

interface RssLabel {
  label?: string;
}

interface RssEntry {
  'im:name'?: RssLabel;
  'im:artist'?: RssLabel;
  'im:image'?: RssLabel[];
  id?: {
    label?: string;
    attributes?: { 'im:id'?: string; 'im:bundleId'?: string };
  };
}

interface RssFeed {
  feed?: {
    entry?: RssEntry | RssEntry[];
  };
}

/**
 * Parse a legacy iTunes RSS chart feed into ranked entries. Entries without a
 * numeric app id are skipped. Exported separately for unit testing.
 */
export function parseChartFeed(payload: RssFeed): ChartEntry[] {
  const raw = payload.feed?.entry;
  if (raw === undefined) return [];
  const entries = Array.isArray(raw) ? raw : [raw];
  const parsed: ChartEntry[] = [];

  for (const entry of entries) {
    const idStr = entry.id?.attributes?.['im:id'];
    const appId = idStr === undefined ? Number.NaN : Number.parseInt(idStr, 10);
    if (!Number.isFinite(appId)) continue;
    const images = entry['im:image'] ?? [];
    const lastImage = images.length > 0 ? images[images.length - 1] : undefined;
    parsed.push({
      appId,
      rank: parsed.length + 1,
      name: entry['im:name']?.label ?? `App ${appId}`,
      developer: entry['im:artist']?.label ?? null,
      bundleId: entry.id?.attributes?.['im:bundleId'] ?? null,
      artworkUrl: lastImage?.label ?? null,
    });
  }
  return parsed;
}

export function chartFeedUrl(country: string, category: CategoryConfig): string {
  const genrePart = category.genreId === null ? '' : `/genre=${category.genreId}`;
  return `https://itunes.apple.com/${country}/rss/topgrossingapplications/limit=${config.chartDepth}${genrePart}/json`;
}

export interface FetchedChart {
  country: string;
  chart: string;
  entries: ChartEntry[];
}

export async function fetchChart(
  country: string,
  category: CategoryConfig,
): Promise<FetchedChart> {
  const payload = await fetchJson<RssFeed>(chartFeedUrl(country, category), {
    timeoutMs: config.requestTimeoutMs,
    retries: config.requestRetries,
  });
  return {
    country,
    chart: chartName(category),
    entries: parseChartFeed(payload),
  };
}
