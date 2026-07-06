import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, chartLabel } from './config.js';
import { pool } from './db.js';
import { radarScore } from './score.js';

interface NewAndChartingRow {
  app_id: string;
  name: string;
  developer: string | null;
  primary_genre: string | null;
  release_date: string | null;
  days_since_release: number;
  price: string | null;
  artwork_url: string | null;
  country: string;
  best_rank: number;
  best_rank_chart: string;
  days_on_chart: number;
  rating_count: string | null;
  avg_rating: string | null;
  ratings_per_day: string | null;
}

function toNum(v: string | number | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function scored(row: NewAndChartingRow) {
  const ratingsPerDay = toNum(row.ratings_per_day);
  return {
    appId: row.app_id,
    name: row.name,
    developer: row.developer,
    primaryGenre: row.primary_genre,
    releaseDate: row.release_date,
    daysSinceRelease: row.days_since_release,
    price: toNum(row.price),
    artworkUrl: row.artwork_url,
    country: row.country,
    bestRank: row.best_rank,
    bestRankChart: row.best_rank_chart,
    bestRankChartLabel: chartLabel(row.best_rank_chart),
    daysOnChart: row.days_on_chart,
    ratingCount: toNum(row.rating_count),
    avgRating: toNum(row.avg_rating),
    ratingsPerDay,
    score: radarScore({
      daysSinceRelease: row.days_since_release,
      bestRank: row.best_rank,
      daysOnChart: row.days_on_chart,
      ratingsPerDay,
    }),
  };
}

export function createServer(): express.Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/meta', async (_req, res) => {
    try {
      const [range, lastRun] = await Promise.all([
        pool.query<{ since: string | null; days: number }>(
          `SELECT to_char(MIN(snapshot_date), 'YYYY-MM-DD') AS since,
                  COUNT(DISTINCT snapshot_date)::int AS days
           FROM chart_snapshots`,
        ),
        pool.query<{ finished_at: string | null; success: boolean | null; summary: unknown }>(
          `SELECT finished_at, success, summary FROM job_runs
           ORDER BY started_at DESC LIMIT 1`,
        ),
      ]);
      res.json({
        collectingSince: range.rows[0]?.since ?? null,
        snapshotDays: range.rows[0]?.days ?? 0,
        countries: config.countries,
        charts: config.categories.map((c) => ({
          chart: c.genreId === null ? 'top-grossing-overall' : `top-grossing-${c.genreId}`,
          label: c.label,
        })),
        recencyWindows: config.recencyWindows,
        lastRun: lastRun.rows[0] ?? null,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/new-and-charting', async (req, res) => {
    try {
      const window = Number(req.query.window) || 365;
      const country = typeof req.query.country === 'string' ? req.query.country : null;
      const chart = typeof req.query.chart === 'string' ? req.query.chart : null;
      const minVelocity = Number(req.query.minVelocity) || 0;

      const { rows } = await pool.query<NewAndChartingRow>(
        `SELECT app_id::text, name, developer, primary_genre,
                to_char(release_date, 'YYYY-MM-DD') AS release_date,
                days_since_release::int, price::text, artwork_url, country,
                best_rank::int, best_rank_chart, days_on_chart::int,
                rating_count::text, avg_rating::text, ratings_per_day::text
         FROM v_new_and_charting
         WHERE days_since_release <= $1
           AND ($2::text IS NULL OR country = $2)
           AND ($3::text IS NULL OR best_rank_chart = $3)
           AND ($4::numeric = 0 OR ratings_per_day >= $4)`,
        [window, country, chart, minVelocity],
      );

      let items = rows.map(scored);
      if (!country) {
        // All-countries mode: one row per app, keeping its best-ranked country.
        const byApp = new Map<string, ReturnType<typeof scored>>();
        for (const item of items) {
          const prev = byApp.get(item.appId);
          if (!prev || item.bestRank < prev.bestRank) byApp.set(item.appId, item);
        }
        items = [...byApp.values()];
      }
      items.sort((a, b) => b.score - a.score);
      res.json({ items });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/climbers', async (req, res) => {
    try {
      const country = typeof req.query.country === 'string' ? req.query.country : null;
      const { rows } = await pool.query(
        `SELECT app_id::text AS "appId", name, developer,
                primary_genre AS "primaryGenre",
                to_char(release_date, 'YYYY-MM-DD') AS "releaseDate",
                artwork_url AS "artworkUrl", country,
                avg_rank_last7::float AS "avgRankLast7",
                avg_rank_prev7::float AS "avgRankPrev7",
                rank_improvement::float AS "rankImprovement",
                rating_count::float AS "ratingCount",
                ratings_per_day::float AS "ratingsPerDay"
         FROM v_climbers
         WHERE ($1::text IS NULL OR country = $1)
         ORDER BY rank_improvement DESC
         LIMIT 200`,
        [country],
      );
      res.json({ items: rows });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/persistence', async (req, res) => {
    try {
      const country = typeof req.query.country === 'string' ? req.query.country : null;
      const { rows } = await pool.query(
        `SELECT app_id::text AS "appId", name, developer,
                primary_genre AS "primaryGenre",
                to_char(release_date, 'YYYY-MM-DD') AS "releaseDate",
                artwork_url AS "artworkUrl", country,
                to_char(run_start, 'YYYY-MM-DD') AS "runStart",
                to_char(run_end, 'YYYY-MM-DD') AS "runEnd",
                run_days::int AS "runDays",
                charted_day_count::int AS "chartedDayCount",
                persistent_30d AS "persistent30d",
                persistent_60d AS "persistent60d",
                currently_charting AS "currentlyCharting",
                rating_count::float AS "ratingCount",
                ratings_per_day::float AS "ratingsPerDay"
         FROM v_persistence
         WHERE ($1::text IS NULL OR country = $1)
         ORDER BY run_days DESC
         LIMIT 200`,
        [country],
      );
      res.json({ items: rows });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Batch sparkline data: best rank per day per app over the last N days.
  app.get('/api/sparklines', async (req, res) => {
    try {
      const idsParam = typeof req.query.ids === 'string' ? req.query.ids : '';
      const ids = idsParam
        .split(',')
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isFinite(n))
        .slice(0, 100);
      const days = Math.min(Number(req.query.days) || 30, 90);
      const country = typeof req.query.country === 'string' ? req.query.country : null;
      if (ids.length === 0) {
        res.json({ series: {} });
        return;
      }
      const { rows } = await pool.query<{ app_id: string; date: string; rank: number }>(
        `SELECT app_id::text, to_char(snapshot_date, 'YYYY-MM-DD') AS date,
                MIN(rank)::int AS rank
         FROM chart_snapshots
         WHERE app_id = ANY($1::bigint[])
           AND snapshot_date >= CURRENT_DATE - $2::int
           AND ($3::text IS NULL OR country = $3)
         GROUP BY app_id, snapshot_date
         ORDER BY app_id, snapshot_date`,
        [ids, days, country],
      );
      const series: Record<string, { date: string; rank: number }[]> = {};
      for (const row of rows) {
        (series[row.app_id] ??= []).push({ date: row.date, rank: row.rank });
      }
      res.json({ series });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Serve the built dashboard.
  const distDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'dashboard',
    'dist',
  );
  app.use(express.static(distDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'), (err) => {
      if (err) res.status(404).send('Dashboard not built. Run: npm run build');
    });
  });

  return app;
}
