import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChartFeed, chartFeedUrl } from '../src/charts';

const fixture = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rss-grossing-6013.json'), 'utf8'),
) as Parameters<typeof parseChartFeed>[0];

describe('parseChartFeed', () => {
  it('parses a real legacy RSS feed with ranks in feed order', () => {
    const entries = parseChartFeed(fixture);
    expect(entries.length).toBe(3);
    expect(entries[0]).toMatchObject({
      rank: 1,
      appId: 341232718,
      name: 'MyFitnessPal: Calorie Counter',
      bundleId: 'com.myfitnesspal.mfp',
      developer: 'MyFitnessPal, Inc.',
    });
    expect(entries[1]!.rank).toBe(2);
    expect(entries[2]!.rank).toBe(3);
    expect(entries[0]!.artworkUrl).toMatch(/^https:\/\//);
  });

  it('handles the single-entry-as-object quirk', () => {
    const single = { feed: { entry: (fixture.feed!.entry as unknown[])[0] } };
    const entries = parseChartFeed(single as Parameters<typeof parseChartFeed>[0]);
    expect(entries.length).toBe(1);
    expect(entries[0]!.rank).toBe(1);
  });

  it('returns [] for an empty feed', () => {
    expect(parseChartFeed({ feed: {} })).toEqual([]);
    expect(parseChartFeed({})).toEqual([]);
  });

  it('skips entries with missing or non-numeric app ids', () => {
    const mangled = {
      feed: {
        entry: [
          { id: { attributes: { 'im:id': 'not-a-number' } } },
          { 'im:name': { label: 'No id at all' } },
          { id: { attributes: { 'im:id': '123' } }, 'im:name': { label: 'Valid' } },
        ],
      },
    };
    const entries = parseChartFeed(mangled);
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatchObject({ appId: 123, rank: 1, name: 'Valid' });
  });

  it('builds overall and per-genre feed URLs', () => {
    expect(chartFeedUrl('us', { genreId: null, label: 'Overall' })).toBe(
      'https://itunes.apple.com/us/rss/topgrossingapplications/limit=200/json',
    );
    expect(chartFeedUrl('de', { genreId: 6013, label: 'Health & Fitness' })).toBe(
      'https://itunes.apple.com/de/rss/topgrossingapplications/limit=200/genre=6013/json',
    );
  });
});
