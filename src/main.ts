import { runMigrations } from './migrate.js';
import { createServer } from './server.js';
import { startScheduler } from './scheduler.js';

// Single-process deployment: apply migrations, serve API + dashboard, and run
// the daily snapshot on a plain-node timer.
await runMigrations();

const port = Number(process.env.PORT) || 8080;
createServer().listen(port, () => {
  console.log(`[server] listening on :${port}`);
});

startScheduler();
