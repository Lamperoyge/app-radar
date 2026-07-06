import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool, closePool } from './db.js';

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

export async function runMigrations(): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows } = await pool.query<{ name: string }>(
    'SELECT name FROM schema_migrations',
  );
  const applied = new Set(rows.map((r) => r.name));
  const newlyApplied: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      newlyApplied.push(file);
      console.log(`[migrate] applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${String(err)}`);
    } finally {
      client.release();
    }
  }
  return newlyApplied;
}

// Run directly: `npm run migrate`
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runMigrations()
    .then((applied) => {
      console.log(
        applied.length > 0
          ? `[migrate] done, ${applied.length} migration(s) applied`
          : '[migrate] up to date',
      );
      return closePool();
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
      return closePool();
    });
}
