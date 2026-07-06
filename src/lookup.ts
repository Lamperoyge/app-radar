import { config } from './config.js';
import { fetchJson, RateLimiter } from './http.js';

/** App metadata parsed from an iTunes Lookup result. */
export interface AppLookup {
  appId: number;
  bundleId: string | null;
  name: string;
  developer: string | null;
  sellerName: string | null;
  primaryGenre: string | null;
  genres: string[];
  releaseDate: string | null; // ISO date (yyyy-mm-dd)
  currentVersionReleaseDate: string | null;
  price: number | null;
  artworkUrl: string | null;
  description: string | null;
  ratingCount: number;
  avgRating: number | null;
}

interface LookupResult {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  bundleId?: string;
  trackName?: string;
  artistName?: string;
  sellerName?: string;
  primaryGenreName?: string;
  genres?: string[];
  releaseDate?: string;
  currentVersionReleaseDate?: string;
  price?: number;
  artworkUrl100?: string;
  description?: string;
  userRatingCount?: number;
  averageUserRating?: number;
}

interface LookupResponse {
  resultCount?: number;
  results?: LookupResult[];
}

function toIsoDate(value: string | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Parse a Lookup API response, keeping only software results. Exported for tests. */
export function parseLookupResponse(payload: LookupResponse): AppLookup[] {
  const results = payload.results ?? [];
  const apps: AppLookup[] = [];
  for (const r of results) {
    if (r.kind !== 'software' && r.wrapperType !== 'software') continue;
    if (typeof r.trackId !== 'number') continue;
    apps.push({
      appId: r.trackId,
      bundleId: r.bundleId ?? null,
      name: r.trackName ?? `App ${r.trackId}`,
      developer: r.artistName ?? null,
      sellerName: r.sellerName ?? null,
      primaryGenre: r.primaryGenreName ?? null,
      genres: r.genres ?? [],
      releaseDate: toIsoDate(r.releaseDate),
      currentVersionReleaseDate: toIsoDate(r.currentVersionReleaseDate),
      price: typeof r.price === 'number' ? r.price : null,
      artworkUrl: r.artworkUrl100 ?? null,
      description: r.description ?? null,
      ratingCount: r.userRatingCount ?? 0,
      avgRating: typeof r.averageUserRating === 'number' ? r.averageUserRating : null,
    });
  }
  return apps;
}

/** Split ids into Lookup-API-sized chunks (max 200 per call). Exported for tests. */
export function chunkIds(ids: number[], size: number = config.lookupBatchSize): number[][] {
  if (size < 1) throw new Error(`chunk size must be >= 1, got ${size}`);
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

export interface LookupBatchResult {
  apps: AppLookup[];
  callsMade: number;
  failedBatches: number;
}

// Shared limiter: all lookup callers in the process respect one budget.
const limiter = new RateLimiter(config.lookupMinIntervalMs);

/**
 * Look up app metadata for `ids` in a given storefront, batched at 200 ids
 * per call and throttled to stay under ~20 requests/minute. A failed batch
 * (after retries) is logged and skipped — it doesn't fail the whole set.
 */
export async function lookupApps(
  ids: number[],
  country: string,
): Promise<LookupBatchResult> {
  const result: LookupBatchResult = { apps: [], callsMade: 0, failedBatches: 0 };
  for (const chunk of chunkIds(ids)) {
    await limiter.wait();
    const url = `https://itunes.apple.com/lookup?id=${chunk.join(',')}&country=${country}&entity=software`;
    try {
      const payload = await fetchJson<LookupResponse>(url, {
        timeoutMs: config.requestTimeoutMs,
        retries: config.requestRetries,
      });
      result.callsMade += 1;
      result.apps.push(...parseLookupResponse(payload));
    } catch (err) {
      result.callsMade += 1;
      result.failedBatches += 1;
      console.error(
        `[lookup] batch failed (country=${country}, ${chunk.length} ids): ${String(err)}`,
      );
    }
  }
  return result;
}
