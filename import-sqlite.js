/** Copy a consistent SQLite backup into an empty cloud database without changing the source. */
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { openDatabase } from './storage.js';
import { migrate } from './database.js';
const sourcePath = process.argv[2];
if (!sourcePath || !process.env.DATABASE_URL)
  throw new Error('Provide a SQLite source path and a direct DATABASE_URL.');
const backupPath = resolve('data/backups', 'before-postgres-' + Date.now() + '.sqlite');
mkdirSync(dirname(backupPath), { recursive: true });
const original = new DatabaseSync(resolve(sourcePath), { readOnly: true });
await backup(original, backupPath);
original.close();
const source = new DatabaseSync(backupPath);
// Upgrade the backup, never the original local file, before mapping its columns.
migrate(source);
const db = await openDatabase();
const tables = {
  accounts: ['id', 'created'],
  users: ['id', 'email', 'name', 'account', 'salt', 'hash', 'recovery', 'created'],
  login_sessions: ['token', 'user', 'expires'],
  sleeper_links: ['account', 'league', 'data'],
  active_links: ['account', 'league'],
  sleeper_cache: ['path', 'expires', 'data'],
  league_settings: ['account', 'league', 'data'],
  analysis_snapshots: ['account', 'league', 'data', 'refreshed'],
  fantasy_cache: ['key', 'data', 'fetched'],
  trade_scenarios: ['id', 'account', 'data', 'created'],
};
try {
  const counts = {};
  await db.transaction(async () => {
    await db.exec('SELECT pg_advisory_xact_lock(6832147001)');
    if (Number((await db.prepare('SELECT COUNT(*) AS count FROM accounts').get()).count) !== 0)
      throw new Error('Cloud database is not empty. Import stopped without changing data.');
    for (const [table, columns] of Object.entries(tables)) {
      if (!source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
        continue;
      const names = columns.map((c) => '"' + c + '"').join(',');
      const rows = source.prepare('SELECT ' + names + ' FROM ' + table).all();
      const statement = db.prepare(
        'INSERT INTO ' +
          table +
          ' (' +
          names +
          ') VALUES (' +
          columns.map(() => '?').join(',') +
          ')',
      );
      for (const row of rows) await statement.run(...columns.map((c) => row[c]));
      counts[table] = rows.length;
    }
  });
  console.log(
    JSON.stringify({ event: 'sqlite_import_complete', backup: backupPath, rows: counts }),
  );
} finally {
  source.close();
  await db.close();
}
