import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './database.js';
import { postgresDatabase, migratePostgres } from './postgres.js';

/** Production always uses durable Postgres. SQLite is retained for local development and tests. */
export async function openDatabase({ migrateSchema = false } = {}) {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    const { Pool, types } = await import('pg');
    const uri = new URL(connectionString);
    if (uri.hostname.endsWith('.neon.tech')) uri.searchParams.set('sslmode', 'verify-full');
    // Millisecond timestamps fit safely in JavaScript numbers; retain strings for larger integers.
    const numericTypes = {
      getTypeParser(oid, format) {
        return oid === 20
          ? (value) => {
              const n = Number(value);
              return Number.isSafeInteger(n) ? n : value;
            }
          : types.getTypeParser(oid, format);
      },
    };
    const pool = new Pool({
      connectionString: uri.href,
      types: numericTypes,
      max: 2,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
      allowExitOnIdle: true,
    });
    pool.on('error', () => console.error(JSON.stringify({ event: 'database_pool_error' })));
    if (process.env.VERCEL) {
      const { attachDatabasePool } = await import('@vercel/functions');
      attachDatabasePool(pool);
    }
    const db = postgresDatabase(pool);
    try {
      if (migrateSchema) {
        if (new URL(connectionString).hostname.includes('-pooler.'))
          throw new Error('Schema migration requires a direct connection.');
        await migratePostgres(db);
      } else if (!(await db.prepare('SELECT 1 FROM schema_migrations WHERE version=2').get()))
        throw new Error('Database schema migration is required.');
      return db;
    } catch (error) {
      await db.close();
      throw error;
    }
  }
  if (process.env.VERCEL || process.env.NODE_ENV === 'production')
    throw new Error('A durable DATABASE_URL is required for production.');
  const { DatabaseSync, backup } = await import('node:sqlite');
  const root = dirname(fileURLToPath(import.meta.url)),
    path = process.env.DB_PATH || resolve(root, 'data/ff-trading.sqlite');
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  const existing = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'")
    .get();
  const versions = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get();
  if (
    existing &&
    (!versions || !db.prepare('SELECT 1 FROM schema_migrations WHERE version=1').get())
  ) {
    const folder = resolve(dirname(path), 'backups');
    mkdirSync(folder, { recursive: true });
    await backup(db, resolve(folder, 'before-backend-v3-' + Date.now() + '.sqlite'));
  }
  migrate(db);
  db.exec(
    'CREATE TABLE IF NOT EXISTS resource_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS refresh_locks(account TEXT PRIMARY KEY REFERENCES accounts(id),token TEXT NOT NULL,expires INTEGER NOT NULL);',
  );
  return db;
}
