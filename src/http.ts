import { setTimeout as sleep } from 'node:timers/promises';

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  /** Base backoff delay; attempt n waits base * 2^n (+ jitter). */
  backoffBaseMs?: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) {
    // 403/429 are how the iTunes APIs signal throttling; 5xx are transient.
    return err.status === 403 || err.status === 429 || err.status >= 500;
  }
  // Network errors / timeouts.
  return true;
}

/**
 * Fetch JSON with a per-request timeout and exponential-backoff retries on
 * 403/429/5xx and network errors. Non-retryable HTTP errors (e.g. 404) throw
 * immediately.
 */
export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const { timeoutMs = 20_000, retries = 3, backoffBaseMs = 1000 } = opts;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = backoffBaseMs * 2 ** (attempt - 1) + Math.random() * 250;
      await sleep(delay);
    }
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new HttpError(res.status, url);
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (!isRetryable(err)) throw err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`fetch failed for ${url}: ${String(lastError)}`);
}

/**
 * Serializes async operations so consecutive calls are at least
 * `minIntervalMs` apart. Used to stay under the iTunes Lookup rate limit.
 */
export class RateLimiter {
  private lastCallAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly minIntervalMs: number) {}

  async wait(): Promise<void> {
    const myTurn = this.queue.then(async () => {
      const elapsed = Date.now() - this.lastCallAt;
      if (elapsed < this.minIntervalMs) {
        await sleep(this.minIntervalMs - elapsed);
      }
      this.lastCallAt = Date.now();
    });
    // Keep the chain alive even if a waiter's work later rejects.
    this.queue = myTurn.catch(() => undefined);
    return myTurn;
  }
}
