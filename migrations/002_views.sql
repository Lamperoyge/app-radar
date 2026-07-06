-- Derived views powering the dashboard. All are plain views: at this data
-- volume (a few thousand chart rows/day, one reader) query-time evaluation
-- is fine and avoids refresh bookkeeping.

-- Latest rating count + ratings/day over the last 14 days, per (app, country).
-- Velocity = (latest count - earliest count within window) / days between.
-- NULL until an app has snapshots on two distinct days within the window.
CREATE OR REPLACE VIEW v_ratings_velocity AS
WITH latest AS (
  SELECT DISTINCT ON (app_id, country)
    app_id, country, snapshot_date, rating_count, avg_rating
  FROM ratings_snapshots
  ORDER BY app_id, country, snapshot_date DESC
),
baseline AS (
  SELECT DISTINCT ON (app_id, country)
    app_id, country, snapshot_date, rating_count
  FROM ratings_snapshots
  WHERE snapshot_date >= CURRENT_DATE - 14
  ORDER BY app_id, country, snapshot_date ASC
)
SELECT
  l.app_id,
  l.country,
  l.rating_count,
  l.avg_rating,
  l.snapshot_date AS ratings_as_of,
  CASE
    WHEN b.snapshot_date IS NOT NULL AND l.snapshot_date > b.snapshot_date
    THEN ROUND((l.rating_count - b.rating_count)::numeric
               / (l.snapshot_date - b.snapshot_date), 2)
  END AS ratings_per_day
FROM latest l
LEFT JOIN baseline b USING (app_id, country);

-- Recently released apps that appeared on any tracked grossing chart in the
-- last 7 days. One row per (app, country); the API layer filters by recency
-- window / country and computes the radar score.
CREATE OR REPLACE VIEW v_new_and_charting AS
WITH recent AS (
  SELECT app_id, country, chart, rank, snapshot_date
  FROM chart_snapshots
  WHERE snapshot_date >= CURRENT_DATE - 7
),
best AS (
  -- Best (lowest) rank per app+country in the window, with its chart.
  SELECT DISTINCT ON (app_id, country)
    app_id, country, rank AS best_rank, chart AS best_rank_chart,
    snapshot_date AS best_rank_date
  FROM recent
  ORDER BY app_id, country, rank ASC, snapshot_date DESC
),
total_days AS (
  -- Days on chart = distinct snapshot days with any rank, all time.
  SELECT app_id, country, COUNT(DISTINCT snapshot_date) AS days_on_chart
  FROM chart_snapshots
  GROUP BY app_id, country
)
SELECT
  a.app_id,
  a.name,
  a.developer,
  a.primary_genre,
  a.release_date,
  (CURRENT_DATE - a.release_date) AS days_since_release,
  a.price,
  a.artwork_url,
  b.country,
  b.best_rank,
  b.best_rank_chart,
  b.best_rank_date,
  td.days_on_chart,
  v.rating_count,
  v.avg_rating,
  v.ratings_per_day
FROM best b
JOIN apps a USING (app_id)
JOIN total_days td ON td.app_id = b.app_id AND td.country = b.country
LEFT JOIN v_ratings_velocity v ON v.app_id = b.app_id AND v.country = b.country
WHERE a.release_date IS NOT NULL
  AND a.release_date >= CURRENT_DATE - 365;

-- Apps whose average daily best rank improved week-over-week, regardless of
-- release date. Requires >= 3 charted days in each week to avoid noise.
CREATE OR REPLACE VIEW v_climbers AS
WITH daily_best AS (
  SELECT app_id, country, snapshot_date, MIN(rank) AS best_rank
  FROM chart_snapshots
  WHERE snapshot_date >= CURRENT_DATE - 14
  GROUP BY app_id, country, snapshot_date
),
weeks AS (
  SELECT
    app_id,
    country,
    AVG(best_rank) FILTER (WHERE snapshot_date >= CURRENT_DATE - 7)  AS avg_rank_last7,
    COUNT(*)       FILTER (WHERE snapshot_date >= CURRENT_DATE - 7)  AS days_last7,
    AVG(best_rank) FILTER (WHERE snapshot_date <  CURRENT_DATE - 7)  AS avg_rank_prev7,
    COUNT(*)       FILTER (WHERE snapshot_date <  CURRENT_DATE - 7)  AS days_prev7
  FROM daily_best
  GROUP BY app_id, country
)
SELECT
  a.app_id,
  a.name,
  a.developer,
  a.primary_genre,
  a.release_date,
  a.artwork_url,
  w.country,
  ROUND(w.avg_rank_last7, 1) AS avg_rank_last7,
  ROUND(w.avg_rank_prev7, 1) AS avg_rank_prev7,
  ROUND(w.avg_rank_prev7 - w.avg_rank_last7, 1) AS rank_improvement,
  w.days_last7,
  w.days_prev7,
  v.rating_count,
  v.ratings_per_day
FROM weeks w
JOIN apps a USING (app_id)
LEFT JOIN v_ratings_velocity v ON v.app_id = w.app_id AND v.country = w.country
WHERE w.days_last7 >= 3
  AND w.days_prev7 >= 3
  AND w.avg_rank_prev7 - w.avg_rank_last7 > 0;

-- Longest "consecutive-ish" charting run per (app, country), allowing gaps of
-- up to 2 missing days (gaps-and-islands: a new island starts when the gap
-- between charted days exceeds 3 calendar days). Only runs >= 30 days shown.
CREATE OR REPLACE VIEW v_persistence AS
WITH charted_days AS (
  SELECT DISTINCT app_id, country, snapshot_date
  FROM chart_snapshots
),
marked AS (
  SELECT
    app_id, country, snapshot_date,
    CASE
      WHEN snapshot_date
           - LAG(snapshot_date) OVER (PARTITION BY app_id, country ORDER BY snapshot_date)
           <= 3
      THEN 0 ELSE 1
    END AS is_new_island
  FROM charted_days
),
islands AS (
  SELECT
    app_id, country, snapshot_date,
    SUM(is_new_island) OVER (PARTITION BY app_id, country ORDER BY snapshot_date) AS island_id
  FROM marked
),
runs AS (
  SELECT
    app_id, country, island_id,
    MIN(snapshot_date) AS run_start,
    MAX(snapshot_date) AS run_end,
    (MAX(snapshot_date) - MIN(snapshot_date) + 1) AS run_days,
    COUNT(*) AS charted_day_count
  FROM islands
  GROUP BY app_id, country, island_id
),
best_run AS (
  SELECT DISTINCT ON (app_id, country) *
  FROM runs
  ORDER BY app_id, country, run_days DESC
)
SELECT
  a.app_id,
  a.name,
  a.developer,
  a.primary_genre,
  a.release_date,
  a.artwork_url,
  r.country,
  r.run_start,
  r.run_end,
  r.run_days,
  r.charted_day_count,
  (r.run_days >= 30) AS persistent_30d,
  (r.run_days >= 60) AS persistent_60d,
  (r.run_end >= CURRENT_DATE - 3) AS currently_charting,
  v.rating_count,
  v.ratings_per_day
FROM best_run r
JOIN apps a USING (app_id)
LEFT JOIN v_ratings_velocity v ON v.app_id = r.app_id AND v.country = r.country
WHERE r.run_days >= 30;
