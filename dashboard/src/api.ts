import type { Climber, Meta, NewItem, PersistentApp, SparkSeries } from './types';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface NewAndChartingFilters {
  window: number;
  country: string; // '' = all
  chart: string; // '' = all
  minVelocity: number;
}

function qs(params: Record<string, string | number>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v !== 0) search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const api = {
  meta: () => getJson<Meta>('/api/meta'),
  newAndCharting: (f: NewAndChartingFilters) =>
    getJson<{ items: NewItem[] }>(
      `/api/new-and-charting${qs({ window: f.window, country: f.country, chart: f.chart, minVelocity: f.minVelocity })}`,
    ),
  climbers: (country: string) =>
    getJson<{ items: Climber[] }>(`/api/climbers${qs({ country })}`),
  persistence: (country: string) =>
    getJson<{ items: PersistentApp[] }>(`/api/persistence${qs({ country })}`),
  sparklines: (ids: string[], country: string) =>
    getJson<{ series: SparkSeries }>(
      `/api/sparklines?ids=${ids.join(',')}${country ? `&country=${country}` : ''}&days=30`,
    ),
};

export function appStoreUrl(appId: string, country: string): string {
  return `https://apps.apple.com/${country || 'us'}/app/id${appId}`;
}
