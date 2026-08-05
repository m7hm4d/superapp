/* eslint-disable no-console */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as path from 'node:path';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
  console.log('migrations applied');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
