import { AsyncLocalStorage } from 'node:async_hooks';

/** Translate positional placeholders without touching quoted SQL text or identifiers. */
export function postgresSql(sql) {
  let output = '',
    quote = null,
    index = 0;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (quote) {
      output += char;
      if (char === quote) {
        if (sql[i + 1] === quote) output += sql[++i];
        else quote = null;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
      output += char;
    } else output += char === '?' ? '$' + ++index : char;
  }
  return output;
}

/** Each transaction pins one client; concurrent requests cannot share its uncommitted work. */
export function postgresDatabase(pool) {
  const context = new AsyncLocalStorage();
  const query = (sql, values = []) => (context.getStore() || pool).query(sql, values);
  const database = {
    remote: true,
    prepare(sql) {
      const text = postgresSql(sql);
      return {
        async get(...values) {
          return (await query(text, values)).rows[0];
        },
        async all(...values) {
          return (await query(text, values)).rows;
        },
        async run(...values) {
          const result = await query(text, values);
          return { changes: result.rowCount };
        },
      };
    },
    async exec(sql) {
      await query(sql);
    },
    async transaction(work) {
      if (context.getStore()) return work();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await context.run(client, work);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
  return database;
}

/** Cloud schema creation is idempotent and serialized across cold starts. */
export async function migratePostgres(db) {
  await db.transaction(async () => {
    await db.exec('SELECT pg_advisory_xact_lock(6832147001)');
    await db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text);
      CREATE TABLE IF NOT EXISTS account_preferences(account TEXT PRIMARY KEY REFERENCES accounts(id),data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,account TEXT UNIQUE NOT NULL REFERENCES accounts(id),salt TEXT NOT NULL,hash TEXT NOT NULL,recovery TEXT NOT NULL,created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS verified_emails("user" TEXT PRIMARY KEY REFERENCES users(id),verified TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS email_tokens(token TEXT PRIMARY KEY,"user" TEXT NOT NULL REFERENCES users(id),purpose TEXT NOT NULL,expires BIGINT NOT NULL);
      CREATE INDEX IF NOT EXISTS email_tokens_user ON email_tokens("user",purpose);
      CREATE TABLE IF NOT EXISTS login_sessions(token TEXT PRIMARY KEY,"user" TEXT NOT NULL REFERENCES users(id),expires BIGINT NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,expires BIGINT NOT NULL);
      CREATE TABLE IF NOT EXISTS sleeper_links(account TEXT NOT NULL REFERENCES accounts(id),league TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(account,league));
      CREATE TABLE IF NOT EXISTS active_links(account TEXT PRIMARY KEY REFERENCES accounts(id),league TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sleeper_cache(path TEXT PRIMARY KEY,expires BIGINT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS league_settings(account TEXT NOT NULL REFERENCES accounts(id),league TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(account,league));
      CREATE TABLE IF NOT EXISTS analysis_snapshots(account TEXT NOT NULL REFERENCES accounts(id),league TEXT NOT NULL,data TEXT NOT NULL,refreshed TEXT NOT NULL,PRIMARY KEY(account,league));
      CREATE TABLE IF NOT EXISTS fantasy_cache(key TEXT PRIMARY KEY,data TEXT NOT NULL,fetched BIGINT NOT NULL);
      CREATE TABLE IF NOT EXISTS trade_scenarios(id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),data TEXT NOT NULL,created TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS scenarios_account_created ON trade_scenarios(account,created DESC);
      CREATE TABLE IF NOT EXISTS resource_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,expires BIGINT NOT NULL);
      CREATE TABLE IF NOT EXISTS refresh_locks(account TEXT PRIMARY KEY REFERENCES accounts(id),token TEXT NOT NULL,expires BIGINT NOT NULL);
    `);
    await db
      .prepare('INSERT INTO schema_migrations VALUES (?,?) ON CONFLICT(version) DO NOTHING')
      .run(2, new Date().toISOString());
    await db
      .prepare('INSERT INTO schema_migrations VALUES (?,?) ON CONFLICT(version) DO NOTHING')
      .run(3, new Date().toISOString());
    await db
      .prepare('INSERT INTO schema_migrations VALUES (?,?) ON CONFLICT(version) DO NOTHING')
      .run(4, new Date().toISOString());
  });
}
