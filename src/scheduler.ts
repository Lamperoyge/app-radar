import { config } from './config.js';
import { pool } from './db.js';
import { runDailySnapshot } from './snapshot.js';

function msUntilNextRun(hourUtc: number): number {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0),
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

async function hasSuccessfulRunToday(): Promise<boolean> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM job_runs
     WHERE snapshot_date = CURRENT_DATE AND success = TRUE`,
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function runGuarded(): Promise<void> {
  try {
    if (await hasSuccessfulRunToday()) {
      console.log('[scheduler] snapshot already succeeded today, skipping');
      return;
    }
    await runDailySnapshot();
  } catch (err) {
    // Never let a failed run kill the scheduler loop; tomorrow retries.
    console.error('[scheduler] snapshot run threw:', err);
  }
}

/**
 * Plain-node daily scheduler: sleeps until the next SNAPSHOT_HOUR_UTC, runs
 * the pipeline, repeats. With RUN_ON_BOOT=true (default) it also catches up
 * immediately on process start if today's snapshot hasn't succeeded yet —
 * useful after deploys and restarts.
 */
export function startScheduler(): void {
  const scheduleNext = (): void => {
    const delay = msUntilNextRun(config.snapshotHourUtc);
    console.log(
      `[scheduler] next run in ${Math.round(delay / 60_000)} min ` +
        `(daily at ${config.snapshotHourUtc}:00 UTC)`,
    );
    setTimeout(() => {
      void runGuarded().finally(scheduleNext);
    }, delay);
  };

  if (process.env.RUN_ON_BOOT !== 'false') {
    void runGuarded().finally(scheduleNext);
  } else {
    scheduleNext();
  }
}
