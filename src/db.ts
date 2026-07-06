import pg from 'pg';

function sslConfig(url: string): false | { rejectUnauthorized: boolean } {
  const override = process.env.DATABASE_SSL;
  if (override === 'true') return { rejectUnauthorized: false };
  if (override === 'false') return false;
  // Railway's internal network (*.railway.internal) and localhost don't use
  // TLS; the public proxy (*.rlwy.net) does, with a cert we can't verify.
  try {
    const host = new URL(url).hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.railway.internal')) {
      return false;
    }
    return { rejectUnauthorized: false };
  } catch {
    return false;
  }
}

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/app_radar';

export const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: sslConfig(databaseUrl),
  max: 5,
});

export async function closePool(): Promise<void> {
  await pool.end();
}
