import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chunkIds, parseLookupResponse } from '../src/lookup';
import { RateLimiter } from '../src/http';

const fixture = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'lookup-sample.json'), 'utf8'),
) as Parameters<typeof parseLookupResponse>[0];

describe('chunkIds', () => {
  it('splits ids into batches of at most 200', () => {
    const ids = Array.from({ length: 450 }, (_, i) => i + 1);
    const chunks = chunkIds(ids, 200);
    expect(chunks.map((c) => c.length)).toEqual([200, 200, 50]);
    expect(chunks.flat()).toEqual(ids);
  });

  it('handles empty input and exact multiples', () => {
    expect(chunkIds([], 200)).toEqual([]);
    expect(chunkIds([1, 2, 3, 4], 2).map((c) => c.length)).toEqual([2, 2]);
  });

  it('rejects invalid chunk sizes', () => {
    expect(() => chunkIds([1], 0)).toThrow();
  });
});

describe('parseLookupResponse', () => {
  it('parses real lookup results', () => {
    const apps = parseLookupResponse(fixture);
    expect(apps.length).toBe(2);
    const chatgpt = apps.find((a) => a.appId === 6448311069);
    expect(chatgpt).toBeDefined();
    expect(chatgpt!.releaseDate).toBe('2023-05-18');
    expect(chatgpt!.ratingCount).toBeGreaterThan(0);
    expect(chatgpt!.primaryGenre).toBeTruthy();
    expect(chatgpt!.genres.length).toBeGreaterThan(0);
  });

  it('ignores non-software results and results without trackId', () => {
    const apps = parseLookupResponse({
      results: [
        { wrapperType: 'artist', trackId: 1 },
        { kind: 'software' }, // no trackId
        { kind: 'software', trackId: 42, trackName: 'Kept' },
      ],
    });
    expect(apps.length).toBe(1);
    expect(apps[0]!.appId).toBe(42);
  });

  it('handles an empty response', () => {
    expect(parseLookupResponse({})).toEqual([]);
  });
});

describe('RateLimiter', () => {
  it('spaces consecutive calls by at least the minimum interval', async () => {
    const limiter = new RateLimiter(50);
    const timestamps: number[] = [];
    for (let i = 0; i < 3; i++) {
      await limiter.wait();
      timestamps.push(Date.now());
    }
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(45);
    expect(timestamps[2]! - timestamps[1]!).toBeGreaterThanOrEqual(45);
  });
});
