import { runMigrations } from './migrate.js';
import { runDailySnapshot } from './snapshot.js';
import { closePool } from './db.js';

// `npm run snapshot [yyyy-mm-dd]` — run the daily pipeline once and exit.
const dateArg = process.argv[2];
if (dateArg !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  console.error(`Invalid date "${dateArg}", expected yyyy-mm-dd`);
  process.exit(1);
}

try {
  await runMigrations();
  const summary = await runDailySnapshot(dateArg);
  if (summary.failures.length > 0) process.exitCode = 2;
} catch (err) {
  console.error('[snapshot] fatal:', err);
  process.exitCode = 1;
} finally {
  await closePool();
}
