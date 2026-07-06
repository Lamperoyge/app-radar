import { config, chartName } from './config.js';
import { pool } from './db.js';
import { fetchChart, type ChartEntry } from './charts.js';
import { lookupApps, type AppLookup } from './lookup.js';

export interface RunSummary {
  snapshotDate: string;
  chartsFetched: number;
  chartsFailed: number;
  appsSeen: number;
  newAppsDiscovered: number;
  lookupCalls: number;
  lookupFailedBatches: number;
  ratingsSnapshotted: number;
  appsEnriched: number;
  interestingApps: number;
  failures: string[];
  durationMs: number;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Dedupe chart entries by app id, keeping the best (lowest) rank. */
function dedupeByAppId(entries: ChartEntry[]): ChartEntry[] {
  const byId = new Map<number, ChartEntry>();
  for (const e of entries) {
    const existing = byId.get(e.appId);
    if (!existing || e.rank < existing.rank) byId.set(e.appId, e);
  }
  return [...byId.values()];
}

/** Insert stub rows for apps we haven't seen before; returns count of new apps. */
async function insertStubApps(entries: ChartEntry[]): Promise<number> {
  if (entries.length === 0) return 0;
  const { rows } = await pool.query<{ app_id: string }>(
    `INSERT INTO apps (app_id, name, developer, bundle_id, artwork_url)
     SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[])
     ON CONFLICT (app_id) DO NOTHING
     RETURNING app_id`,
    [
      entries.map((e) => e.appId),
      entries.map((e) => e.name),
      entries.map((e) => e.developer),
      entries.map((e) => e.bundleId),
      entries.map((e) => e.artworkUrl),
    ],
  );
  return rows.length;
}

async function upsertChartSnapshots(
  snapshotDate: string,
  country: string,
  chart: string,
  entries: ChartEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  await pool.query(
    `INSERT INTO chart_snapshots (snapshot_date, country, chart, app_id, rank)
     SELECT $1, $2, $3, * FROM unnest($4::bigint[], $5::int[])
     ON CONFLICT (snapshot_date, country, chart, app_id)
     DO UPDATE SET rank = EXCLUDED.rank`,
    [
      snapshotDate,
      country,
      chart,
      entries.map((e) => e.appId),
      entries.map((e) => e.rank),
    ],
  );
}

async function upsertEnrichedApps(apps: AppLookup[]): Promise<void> {
  if (apps.length === 0) return;
  // genres is TEXT[]; multidimensional arrays don't survive unnest cleanly,
  // so each row's genres travel as a single '\x1f'-joined string.
  await pool.query(
    `INSERT INTO apps (app_id, bundle_id, name, developer, primary_genre, genres,
                       release_date, current_version_release_date, price,
                       artwork_url, description, last_enriched_at)
     SELECT u.app_id, u.bundle_id, u.name, u.developer, u.primary_genre,
            string_to_array(NULLIF(u.genres_joined, ''), e'\\x1f'),
            u.release_date, u.current_version_release_date, u.price,
            u.artwork_url, u.description, now()
     FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[],
                 $6::text[], $7::date[], $8::date[], $9::numeric[],
                 $10::text[], $11::text[])
       AS u(app_id, bundle_id, name, developer, primary_genre, genres_joined,
            release_date, current_version_release_date, price, artwork_url, description)
     ON CONFLICT (app_id) DO UPDATE SET
       bundle_id = EXCLUDED.bundle_id,
       name = EXCLUDED.name,
       developer = EXCLUDED.developer,
       primary_genre = EXCLUDED.primary_genre,
       genres = EXCLUDED.genres,
       release_date = EXCLUDED.release_date,
       current_version_release_date = EXCLUDED.current_version_release_date,
       price = EXCLUDED.price,
       artwork_url = EXCLUDED.artwork_url,
       description = EXCLUDED.description,
       last_enriched_at = now()`,
    [
      apps.map((a) => a.appId),
      apps.map((a) => a.bundleId),
      apps.map((a) => a.name),
      apps.map((a) => a.developer ?? a.sellerName),
      apps.map((a) => a.primaryGenre),
      apps.map((a) => a.genres.join('\x1f')),
      apps.map((a) => a.releaseDate),
      apps.map((a) => a.currentVersionReleaseDate),
      apps.map((a) => a.price),
      apps.map((a) => a.artworkUrl),
      apps.map((a) => a.description),
    ],
  );
}

async function insertRatingsSnapshots(
  snapshotDate: string,
  country: string,
  apps: AppLookup[],
): Promise<number> {
  if (apps.length === 0) return 0;
  const result = await pool.query(
    `INSERT INTO ratings_snapshots (snapshot_date, country, app_id, rating_count, avg_rating)
     SELECT $1, $2, * FROM unnest($3::bigint[], $4::bigint[], $5::numeric[])
     ON CONFLICT (snapshot_date, country, app_id)
     DO UPDATE SET rating_count = EXCLUDED.rating_count, avg_rating = EXCLUDED.avg_rating`,
    [
      snapshotDate,
      country,
      apps.map((a) => a.appId),
      apps.map((a) => a.ratingCount),
      apps.map((a) => a.avgRating),
    ],
  );
  return result.rowCount ?? 0;
}

/**
 * Ids to look up for a country: apps seen on its charts today that are new,
 * stale (not enriched within enrichStaleDays), or flagged interesting — plus
 * interesting apps previously rated in this country even if they fell off the
 * charts today (keeps velocity data fresh).
 */
async function lookupCandidates(
  country: string,
  seenToday: Set<number>,
): Promise<number[]> {
  const seenIds = [...seenToday];
  const { rows } = await pool.query<{ app_id: string }>(
    `SELECT app_id FROM apps
     WHERE app_id = ANY($1::bigint[])
       AND (interesting
            OR last_enriched_at IS NULL
            OR last_enriched_at < now() - make_interval(days => $2))
     UNION
     SELECT DISTINCT a.app_id FROM apps a
     JOIN ratings_snapshots rs ON rs.app_id = a.app_id AND rs.country = $3
     WHERE a.interesting`,
    [seenIds, config.enrichStaleDays, country],
  );
  return rows.map((r) => Number(r.app_id));
}

/** Recompute the `interesting` flag: released ≤365d ago and charted in last 7d. */
async function updateInterestingFlags(): Promise<number> {
  await pool.query(
    `UPDATE apps a SET interesting = computed.value
     FROM (
       SELECT a2.app_id,
              (a2.release_date IS NOT NULL
               AND a2.release_date >= CURRENT_DATE - 365
               AND EXISTS (
                 SELECT 1 FROM chart_snapshots cs
                 WHERE cs.app_id = a2.app_id
                   AND cs.snapshot_date >= CURRENT_DATE - 7
               )) AS value
       FROM apps a2
     ) computed
     WHERE computed.app_id = a.app_id AND a.interesting IS DISTINCT FROM computed.value`,
  );
  const { rows } = await pool.query<{ n: string }>(
    'SELECT COUNT(*) AS n FROM apps WHERE interesting',
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * The daily pipeline. Idempotent: re-running for the same day upserts rather
 * than duplicating. Each country×chart fetch is isolated — one failure is
 * recorded in the summary and the run continues.
 */
export async function runDailySnapshot(
  snapshotDate: string = todayUtc(),
): Promise<RunSummary> {
  const startedAt = Date.now();
  const runRow = await pool.query<{ id: string }>(
    'INSERT INTO job_runs (snapshot_date) VALUES ($1) RETURNING id',
    [snapshotDate],
  );
  const runId = runRow.rows[0]!.id;

  const summary: RunSummary = {
    snapshotDate,
    chartsFetched: 0,
    chartsFailed: 0,
    appsSeen: 0,
    newAppsDiscovered: 0,
    lookupCalls: 0,
    lookupFailedBatches: 0,
    ratingsSnapshotted: 0,
    appsEnriched: 0,
    interestingApps: 0,
    failures: [],
    durationMs: 0,
  };

  // 1. Fetch all charts; upsert positions. Per-source error isolation.
  const seenByCountry = new Map<string, Set<number>>();
  const allSeen = new Set<number>();
  for (const country of config.countries) {
    const seen = seenByCountry.get(country) ?? new Set<number>();
    seenByCountry.set(country, seen);
    for (const category of config.categories) {
      const name = chartName(category);
      try {
        const { entries } = await fetchChart(country, category);
        const deduped = dedupeByAppId(entries);
        summary.newAppsDiscovered += await insertStubApps(deduped);
        await upsertChartSnapshots(snapshotDate, country, name, deduped);
        for (const e of deduped) {
          seen.add(e.appId);
          allSeen.add(e.appId);
        }
        summary.chartsFetched += 1;
        console.log(`[snapshot] ${country}/${name}: ${deduped.length} entries`);
      } catch (err) {
        summary.chartsFailed += 1;
        summary.failures.push(`chart ${country}/${name}: ${String(err)}`);
        console.error(`[snapshot] FAILED ${country}/${name}: ${String(err)}`);
      }
    }
  }
  summary.appsSeen = allSeen.size;

  // 2. Decide lookup sets for every country BEFORE enriching anything, so
  // enrichment in one country doesn't mark apps fresh and starve another
  // country of its ratings snapshot.
  const candidatesByCountry = new Map<string, number[]>();
  for (const country of config.countries) {
    candidatesByCountry.set(
      country,
      await lookupCandidates(country, seenByCountry.get(country) ?? new Set()),
    );
  }

  // 3. Enrich + snapshot ratings, per country (ratings are per storefront).
  const enrichedIds = new Set<number>();
  for (const country of config.countries) {
    const ids = candidatesByCountry.get(country) ?? [];
    if (ids.length === 0) continue;
    try {
      const { apps, callsMade, failedBatches } = await lookupApps(ids, country);
      summary.lookupCalls += callsMade;
      summary.lookupFailedBatches += failedBatches;
      await upsertEnrichedApps(apps);
      summary.ratingsSnapshotted += await insertRatingsSnapshots(
        snapshotDate,
        country,
        apps,
      );
      for (const a of apps) enrichedIds.add(a.appId);
      console.log(
        `[snapshot] ${country}: looked up ${ids.length} ids in ${callsMade} calls, ${apps.length} results`,
      );
    } catch (err) {
      summary.failures.push(`lookup ${country}: ${String(err)}`);
      console.error(`[snapshot] FAILED lookup ${country}: ${String(err)}`);
    }
  }
  summary.appsEnriched = enrichedIds.size;

  // 4. Refresh the interesting flag for tomorrow's run.
  try {
    summary.interestingApps = await updateInterestingFlags();
  } catch (err) {
    summary.failures.push(`interesting flags: ${String(err)}`);
  }

  summary.durationMs = Date.now() - startedAt;
  const success = summary.chartsFailed < config.countries.length * config.categories.length;
  await pool.query(
    'UPDATE job_runs SET finished_at = now(), success = $2, summary = $3 WHERE id = $1',
    [runId, success, JSON.stringify(summary)],
  );

  console.log(
    `[snapshot] run summary: ${summary.chartsFetched} charts fetched ` +
      `(${summary.chartsFailed} failed), ${summary.appsSeen} apps seen, ` +
      `${summary.newAppsDiscovered} new, ${summary.lookupCalls} lookup calls ` +
      `(${summary.lookupFailedBatches} failed batches), ` +
      `${summary.ratingsSnapshotted} ratings snapshots, ` +
      `${summary.interestingApps} interesting apps, ` +
      `${Math.round(summary.durationMs / 1000)}s`,
  );
  if (summary.failures.length > 0) {
    console.error(`[snapshot] failures:\n  - ${summary.failures.join('\n  - ')}`);
  }
  return summary;
}
