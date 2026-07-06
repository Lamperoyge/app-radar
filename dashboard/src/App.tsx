import { useEffect, useMemo, useState } from 'react';
import { api, type NewAndChartingFilters } from './api';
import type { Climber, Meta, NewItem, PersistentApp, SparkSeries } from './types';
import { AppCell } from './components/AppCell';
import { Sparkline } from './components/Sparkline';

type Tab = 'new' | 'climbers' | 'persistent';

const fmt = new Intl.NumberFormat('en-US');

function num(v: number | null, digits = 0): string {
  if (v === null) return '—';
  return digits > 0 ? v.toFixed(digits) : fmt.format(Math.round(v));
}

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 55 ? 'score hi' : score >= 35 ? 'score mid' : 'score';
  return <span className={cls}>{score}</span>;
}

function useSparklines(ids: string[], country: string): SparkSeries {
  const [series, setSeries] = useState<SparkSeries>({});
  const key = ids.join(',');
  useEffect(() => {
    if (ids.length === 0) {
      setSeries({});
      return;
    }
    let cancelled = false;
    api
      .sparklines(ids, country)
      .then((r) => {
        if (!cancelled) setSeries(r.series);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, country]);
  return series;
}

function NewTab({ meta, country }: { meta: Meta; country: string }) {
  const [window, setWindow] = useState(meta.recencyWindows[meta.recencyWindows.length - 1] ?? 365);
  const [chart, setChart] = useState('');
  const [minVelocity, setMinVelocity] = useState(0);
  const [items, setItems] = useState<NewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filters: NewAndChartingFilters = { window, country, chart, minVelocity };
  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .newAndCharting(filters)
      .then((r) => {
        if (!cancelled) setItems(r.items);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window, country, chart, minVelocity]);

  const topIds = useMemo(() => (items ?? []).slice(0, 60).map((i) => i.appId), [items]);
  const sparks = useSparklines(topIds, country);
  const velocityKnown = meta.snapshotDays >= 2;

  return (
    <>
      <div className="filters">
        <label>
          Released within
          <select value={window} onChange={(e) => setWindow(Number(e.target.value))}>
            {meta.recencyWindows.map((w) => (
              <option key={w} value={w}>
                {w}d
              </option>
            ))}
          </select>
        </label>
        <label>
          Chart
          <select value={chart} onChange={(e) => setChart(e.target.value)}>
            <option value="">All</option>
            {meta.charts.map((c) => (
              <option key={c.chart} value={c.chart}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Min ratings/day
          <input
            type="number"
            min={0}
            value={minVelocity}
            onChange={(e) => setMinVelocity(Number(e.target.value) || 0)}
            disabled={!velocityKnown}
            title={velocityKnown ? '' : 'Needs at least 2 days of snapshots'}
          />
        </label>
        {items && <span>{items.length} apps</span>}
      </div>
      {error && <div className="error">{error}</div>}
      {items && items.length === 0 && (
        <div className="empty">No recently released apps on tracked charts yet.</div>
      )}
      {items && items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>App</th>
              <th>Category</th>
              <th>Released</th>
              <th className="num">Best rank</th>
              <th>Chart</th>
              <th className="num">Days on chart</th>
              <th className="num">Ratings</th>
              <th className="num">Ratings/day</th>
              <th>Rank 30d</th>
              <th className="num">Score</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={`${it.appId}-${it.country}`}>
                <td>
                  <AppCell {...it} />
                </td>
                <td>
                  <span className="tag">{it.primaryGenre ?? '?'}</span>
                </td>
                <td>
                  {it.releaseDate ?? '—'} <span className="dim">({it.daysSinceRelease}d)</span>
                </td>
                <td className="num">#{it.bestRank}</td>
                <td>
                  <span className="tag">
                    {it.country.toUpperCase()} · {it.bestRankChartLabel}
                  </span>
                </td>
                <td className="num">{it.daysOnChart}</td>
                <td className="num">{num(it.ratingCount)}</td>
                <td className="num">{num(it.ratingsPerDay, 1)}</td>
                <td>
                  <Sparkline points={sparks[it.appId]} />
                </td>
                <td className="num">
                  <ScoreBadge score={it.score} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function ClimbersTab({ meta, country }: { meta: Meta; country: string }) {
  const [items, setItems] = useState<Climber[] | null>(null);
  useEffect(() => {
    api.climbers(country).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [country]);

  if (meta.snapshotDays < 8) {
    return (
      <div className="empty">
        Climbers compare average rank week-over-week, which needs ~14 days of history.
        Collecting since {meta.collectingSince ?? 'today'} ({meta.snapshotDays} day
        {meta.snapshotDays === 1 ? '' : 's'} so far).
      </div>
    );
  }
  if (!items) return <div className="empty">Loading…</div>;
  if (items.length === 0) return <div className="empty">No week-over-week climbers yet.</div>;
  return (
    <table>
      <thead>
        <tr>
          <th>App</th>
          <th>Category</th>
          <th>Country</th>
          <th className="num">Avg rank prev 7d</th>
          <th className="num">Avg rank last 7d</th>
          <th className="num">Improvement</th>
          <th className="num">Ratings</th>
          <th className="num">Ratings/day</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <tr key={`${it.appId}-${it.country}`}>
            <td>
              <AppCell {...it} />
            </td>
            <td>
              <span className="tag">{it.primaryGenre ?? '?'}</span>
            </td>
            <td>{it.country.toUpperCase()}</td>
            <td className="num">#{it.avgRankPrev7}</td>
            <td className="num">#{it.avgRankLast7}</td>
            <td className="num" style={{ color: 'var(--good)' }}>
              ▲ {it.rankImprovement}
            </td>
            <td className="num">{num(it.ratingCount)}</td>
            <td className="num">{num(it.ratingsPerDay, 1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PersistentTab({ meta, country }: { meta: Meta; country: string }) {
  const [items, setItems] = useState<PersistentApp[] | null>(null);
  useEffect(() => {
    api.persistence(country).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [country]);

  if (meta.snapshotDays < 30) {
    return (
      <div className="empty">
        Persistent earners need a ≥30-day charting run. Collecting since{' '}
        {meta.collectingSince ?? 'today'} ({meta.snapshotDays} day
        {meta.snapshotDays === 1 ? '' : 's'} so far).
      </div>
    );
  }
  if (!items) return <div className="empty">Loading…</div>;
  if (items.length === 0) return <div className="empty">No 30-day persistent apps yet.</div>;
  return (
    <table>
      <thead>
        <tr>
          <th>App</th>
          <th>Category</th>
          <th>Country</th>
          <th>Run</th>
          <th className="num">Run days</th>
          <th className="num">Charted days</th>
          <th>Tier</th>
          <th>Status</th>
          <th className="num">Ratings</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <tr key={`${it.appId}-${it.country}`}>
            <td>
              <AppCell {...it} />
            </td>
            <td>
              <span className="tag">{it.primaryGenre ?? '?'}</span>
            </td>
            <td>{it.country.toUpperCase()}</td>
            <td className="dim">
              {it.runStart} → {it.runEnd}
            </td>
            <td className="num">{it.runDays}</td>
            <td className="num">{it.chartedDayCount}</td>
            <td>{it.persistent60d ? <span className="tag">60d+</span> : <span className="tag">30d+</span>}</td>
            <td>{it.currentlyCharting ? <span style={{ color: 'var(--good)' }}>charting</span> : <span className="dim">dropped</span>}</td>
            <td className="num">{num(it.ratingCount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('new');
  const [country, setCountry] = useState('');

  useEffect(() => {
    api.meta().then(setMeta).catch((e: unknown) => setMetaError(String(e)));
  }, []);

  if (metaError) return <div className="app error">Failed to load: {metaError}</div>;
  if (!meta) return <div className="app empty">Loading…</div>;

  return (
    <div className="app">
      <header className="top">
        <h1>App Radar</h1>
        <span className="sub">
          top-grossing charts · {meta.countries.map((c) => c.toUpperCase()).join(' ')} ·{' '}
          {meta.charts.length} charts/country
        </span>
      </header>

      {meta.snapshotDays < 7 && (
        <div className="banner">
          Collecting data since {meta.collectingSince ?? 'today'} — {meta.snapshotDays}/7 days.
          Velocity, climbers, and persistence signals sharpen as history accumulates; charts can't
          be backfilled.
        </div>
      )}

      <div className="tabs">
        <button className={tab === 'new' ? 'active' : ''} onClick={() => setTab('new')}>
          New &amp; Charting
        </button>
        <button className={tab === 'climbers' ? 'active' : ''} onClick={() => setTab('climbers')}>
          Climbers
        </button>
        <button
          className={tab === 'persistent' ? 'active' : ''}
          onClick={() => setTab('persistent')}
        >
          Persistent Earners
        </button>
        <span style={{ flex: 1 }} />
        <label className="filters" style={{ marginBottom: 4 }}>
          Country
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">All</option>
            {meta.countries.map((c) => (
              <option key={c} value={c}>
                {c.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
      </div>

      {tab === 'new' && <NewTab meta={meta} country={country} />}
      {tab === 'climbers' && <ClimbersTab meta={meta} country={country} />}
      {tab === 'persistent' && <PersistentTab meta={meta} country={country} />}
    </div>
  );
}
