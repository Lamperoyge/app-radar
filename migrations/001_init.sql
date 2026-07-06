-- App Radar initial schema.

CREATE TABLE apps (
  app_id                        BIGINT PRIMARY KEY,
  bundle_id                     TEXT,
  name                          TEXT NOT NULL,
  developer                     TEXT,
  primary_genre                 TEXT,
  genres                        TEXT[],
  release_date                  DATE,
  current_version_release_date  DATE,
  price                         NUMERIC(10, 2),
  artwork_url                   TEXT,
  description                   TEXT,
  -- Set by the daily job: released recently AND charting in the last 7 days.
  -- Interesting apps get a ratings snapshot every day, not just on the
  -- 7-day enrichment cadence, so velocity data stays fresh.
  interesting                   BOOLEAN NOT NULL DEFAULT FALSE,
  first_seen_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_enriched_at              TIMESTAMPTZ
);

CREATE INDEX idx_apps_release_date ON apps (release_date);
CREATE INDEX idx_apps_interesting ON apps (interesting) WHERE interesting;

CREATE TABLE chart_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  country       TEXT NOT NULL,
  chart         TEXT NOT NULL,   -- e.g. 'top-grossing-overall', 'top-grossing-6013'
  app_id        BIGINT NOT NULL REFERENCES apps (app_id),
  rank          INT NOT NULL CHECK (rank >= 1),
  UNIQUE (snapshot_date, country, chart, app_id)
);

CREATE INDEX idx_chart_snapshots_app_date ON chart_snapshots (app_id, snapshot_date);
CREATE INDEX idx_chart_snapshots_date ON chart_snapshots (snapshot_date, country, chart, rank);

CREATE TABLE ratings_snapshots (
  snapshot_date DATE NOT NULL,
  country       TEXT NOT NULL,
  app_id        BIGINT NOT NULL REFERENCES apps (app_id),
  rating_count  BIGINT NOT NULL,
  avg_rating    NUMERIC(3, 2),
  PRIMARY KEY (snapshot_date, country, app_id)
);

CREATE INDEX idx_ratings_snapshots_app ON ratings_snapshots (app_id, country, snapshot_date);

-- One row per daily job run; summary is the logged run report.
CREATE TABLE job_runs (
  id            BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  success       BOOLEAN,
  summary       JSONB
);
