# App Radar

Internal App Store intelligence tool. Tracks Apple top-grossing charts daily,
enriches apps with release dates and rating counts, and surfaces the core
signal: **an app that released recently, appears on a grossing chart, and is
accumulating ratings fast is a validated, monetizing niche worth studying.**

No paid data sources, no API keys — everything comes from Apple's free public
endpoints. No dollar revenue estimates by design: chart presence + persistence
+ ratings velocity is the signal.

## Chart-source strategy (verified at build time, 2026-07-06)

The spec called for probing what Apple actually serves today. Findings:

| Source | Status |
| --- | --- |
| `rss.marketingtools.apple.com/api/v2/{cc}/apps/top-grossing/...` | **Gone.** Returns 404 at every limit. Only `top-free` and `top-paid` feeds exist on the marketing API — no grossing feed at all. |
| `itunes.apple.com/{cc}/rss/topgrossingapplications/limit=N/json` | **Works**, including per-genre via `/genre={id}/` and in all tracked countries. |
| Chart depth | The legacy RSS **caps at 100 entries** regardless of `limit=200`. |

So v1 ingests the legacy iTunes RSS: overall + 7 category charts × 5 countries
(40 charts/day), **top 100 deep**. `chartDepth` in config stays at 200 so we
automatically pick up deeper feeds if Apple ever restores them.

## Stack

- **Ingestion/API**: TypeScript, Node 20+, Express, `pg`. No ORM.
- **Storage**: Postgres (SQL migrations in `migrations/`, applied automatically).
- **Scheduling**: plain Node `setTimeout` loop inside the server process.
- **Dashboard**: Vite + React + recharts, built to static files and served by
  the same Express server. Dark, dense, data-first.

## Setup (local)

```bash
npm install
createdb app_radar               # or point DATABASE_URL anywhere
cp .env.example .env             # defaults work for local postgres
npm run snapshot                 # migrations + one full pipeline run (~2 min)
npm run build                    # compile server + build dashboard
npm start                        # serve API + dashboard on :8080, schedule daily runs
```

Dev loops:

```bash
npm test                         # vitest unit tests
npm run typecheck                # tsc, no emit
npm run migrate                  # apply pending migrations only
COUNTRIES=us npm run snapshot    # quick single-country run
npm run dev:server               # run server from source (tsx)
cd dashboard && npm run dev      # Vite dev server, proxies /api to :8080
```

`npm run snapshot [yyyy-mm-dd]` accepts an optional date (defaults to today
UTC) and is **idempotent** — re-running for the same day upserts, never
duplicates.

## Environment variables

See [.env.example](.env.example). Summary:

| Var | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://localhost:5432/app_radar` | Postgres connection |
| `DATABASE_SSL` | auto | Force TLS on/off (auto: off for localhost/`*.railway.internal`) |
| `PORT` | `8080` | HTTP port |
| `SNAPSHOT_HOUR_UTC` | `6` | Daily run hour (UTC) |
| `RUN_ON_BOOT` | `true` | Catch-up run on process start if today's snapshot hasn't succeeded |
| `COUNTRIES` | `us,gb,de,au,ca` | Override tracked storefronts |

All other tuning (categories, recency windows, rate limits, score weights)
lives in [src/config.ts](src/config.ts).

## Deploying on Railway

One service + one Postgres plugin. The single process applies migrations on
boot, serves the API + dashboard, and runs the daily snapshot on a plain-node
timer — no separate cron infrastructure needed.

1. Create a Railway project, add a **Postgres** database.
2. Add a service from this repo (`railway.json` sets build/start commands:
   `npm ci && npm run build`, then `npm start`).
3. On the service, set `DATABASE_URL` to `${{Postgres.DATABASE_URL}}`
   (Railway variable reference). Optionally set `SNAPSHOT_HOUR_UTC`.
4. Generate a domain for the service — that's the dashboard URL.

`RUN_ON_BOOT=true` (default) means every deploy/restart checks whether today's
snapshot already succeeded and catches up if not, so redeploys never lose a day.

## Database schema

- **`apps`** — one row per app: metadata from the Lookup API plus
  `first_seen_at`, `last_enriched_at`, and an `interesting` flag (released
  ≤365d ago and charted in the last 7d) that the job recomputes daily.
- **`chart_snapshots`** — `(snapshot_date, country, chart, app_id, rank)`,
  unique on the natural key. `chart` is e.g. `top-grossing-overall` or
  `top-grossing-6013`.
- **`ratings_snapshots`** — `(snapshot_date, country, app_id, rating_count,
  avg_rating)`. Ratings are per-storefront, hence the country column. Powers
  velocity: Δ rating_count / Δ days.
- **`job_runs`** — one row per pipeline run with a JSON summary.
- **`schema_migrations`** — applied migration files.

## Daily pipeline (`src/snapshot.ts`)

1. Fetch all 40 charts. Each country×chart is error-isolated: a failure is
   logged into the run summary and the run continues.
2. Upsert stub `apps` rows for never-seen apps (RSS provides name/dev/icon),
   then upsert `chart_snapshots`.
3. Compute per-country lookup sets **before** enriching anything (so enriching
   in one country can't starve another): apps seen today that are new, stale
   (>7 days since enrichment), or `interesting` — plus interesting apps that
   fell off the charts but were previously rated in that country, so their
   velocity series stays fresh.
4. Batch-call the Lookup API (≤200 ids/call, throttled to ~18 req/min with
   3× exponential-backoff retries on 403/429/5xx), upsert full metadata into
   `apps`, insert `ratings_snapshots`.
5. Recompute `interesting` flags; write the run summary to `job_runs` and logs.

## Views

- **`v_new_and_charting`** — per (app, country): apps released ≤365d ago that
  charted in the last 7 days, with best current rank + chart, days-on-chart
  (distinct snapshot days), latest rating count, and 14-day ratings velocity.
  The API filters this by recency window / country / chart / min velocity.
- **`v_climbers`** — avg daily best rank last 7d vs previous 7d, ≥3 charted
  days in each week, improvement > 0.
- **`v_persistence`** — longest "consecutive-ish" charting run per
  (app, country) using gaps-and-islands, allowing up to 2-day gaps; rows with
  runs ≥30 days, flagged `persistent_30d` / `persistent_60d` and
  `currently_charting`.
- **`v_ratings_velocity`** — shared helper view: latest count + ratings/day
  over the last 14 days.

Plain (non-materialized) views: at this volume (~4k chart rows/day, one
reader) query-time evaluation is instant and avoids refresh bookkeeping.

## Radar score — exact formula & tuning

Computed in [src/score.ts](src/score.ts) (unit-tested, applied by the API when
serving `v_new_and_charting`). Four components, each normalized to [0, 1]:

```
recency     = clamp01(1 − daysSinceRelease / 365)
rank        = clamp01(1 − ln(bestRank) / ln(chartDepth))      # log-scaled, #1 → 1
persistence = clamp01(daysOnChart / 30)                       # saturates at 30 days
velocity    = clamp01(log10(1 + ratingsPerDay) / log10(101))  # saturates at 100/day
                                                              # unknown velocity → 0

score = round(100 × (0.30·recency + 0.25·rank + 0.20·persistence + 0.25·velocity))
```

Tune in `src/config.ts`: `scoreWeights` (keep them summing to 1),
`scoreRecencyHorizonDays`, `scorePersistenceSaturationDays`,
`scoreVelocitySaturationPerDay`. Rationale: log-scaling rank makes #1→#10 cost
as much as #10→#100 (grossing rank is roughly log-revenue); log-scaling
velocity keeps mega-apps from drowning out fast-moving niche apps.

## Dashboard

Three tabs, shared country filter:

- **New & Charting** — sorted by radar score. Icon, name (links to App Store
  page), developer, category, release date, best rank + chart, days on chart,
  rating count, ratings/day, 30-day rank sparkline, score. Filters: recency
  window (90/180/365d), chart/category, min ratings velocity.
- **Climbers** — week-over-week rank improvers.
- **Persistent Earners** — 30d+/60d+ charting runs.

**Cold start**: charts can't be backfilled, so day 1 starts empty-ish. The
dashboard shows a "collecting data since {date}" banner until 7 days of
snapshots exist, the velocity filter is disabled until there are 2 days of
data, and the climbers/persistence tabs show explanatory placeholders until
enough history accumulates (~14 and 30 days respectively).

## Known limitations

- **No Google Play** — App Store only.
- **Top 100, not 200** — the legacy RSS silently caps at 100 entries; the
  marketing API no longer has grossing feeds at all (verified 2026-07-06).
- **Grossing rank reflects IAP + paid revenue, not ad revenue** — ad-monetized
  apps are invisible here.
- **Rank is within-chart position, not revenue** — #50 in Health & Fitness and
  #50 overall are very different businesses.
- **Ratings velocity needs history** — null until an app has snapshots on two
  distinct days in the 14-day window; non-`interesting` apps are only
  re-snapshotted on the 7-day enrichment cadence, so their velocity is coarser.
- **No historical backfill** — Apple publishes no chart history; data starts
  the day you deploy. Deploy early, analyze later.
- **Legacy RSS is deprecated infrastructure** — it could disappear like the
  marketing grossing feed did. The parser and fetcher are isolated in
  `src/charts.ts` for easy source swaps; chart fetch failures are logged per
  source and never kill a run.
