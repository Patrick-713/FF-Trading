// Versioned, transactional migrations preserve legacy rows in an inert archive.
export function migrate(db) {
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS legacy_archive(name TEXT PRIMARY KEY, data TEXT NOT NULL, archived TEXT NOT NULL);`);
    const exists = (name) =>
      Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
    const archive = (name) =>
      db
        .prepare('INSERT OR IGNORE INTO legacy_archive VALUES (?,?,?)')
        .run(
          name,
          JSON.stringify(db.prepare(`SELECT * FROM ${name}`).all()),
          new Date().toISOString(),
        );
    if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=1').get()) {
      if (
        exists('sleeper_links') &&
        db
          .prepare('PRAGMA table_info(sleeper_links)')
          .all()
          .some((c) => c.name === 'market')
      ) {
        archive('sleeper_links');
        db.exec(
          'CREATE TABLE sleeper_links_new(account TEXT NOT NULL REFERENCES accounts(id), league TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(account,league)); INSERT INTO sleeper_links_new SELECT account,league,data FROM sleeper_links; DROP TABLE sleeper_links; ALTER TABLE sleeper_links_new RENAME TO sleeper_links;',
        );
      }
      for (const name of ['trades', 'holdings', 'history', 'quotes', 'market_teams'])
        if (exists(name)) {
          archive(name);
          db.exec(`DROP TABLE ${name}`);
        }
      if (
        exists('accounts') &&
        db
          .prepare('PRAGMA table_info(accounts)')
          .all()
          .some((c) => c.name === 'cash')
      ) {
        archive('accounts');
        db.exec(
          'CREATE TABLE accounts_new(id TEXT PRIMARY KEY,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO accounts_new(id) SELECT id FROM accounts; DROP TABLE accounts; ALTER TABLE accounts_new RENAME TO accounts;',
        );
      }
      db.exec(`CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS sleeper_links(account TEXT NOT NULL REFERENCES accounts(id),league TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(account,league));
        CREATE TABLE IF NOT EXISTS active_links(account TEXT PRIMARY KEY REFERENCES accounts(id),league TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sleeper_cache(path TEXT PRIMARY KEY,expires INTEGER NOT NULL,data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS league_settings(account TEXT NOT NULL REFERENCES accounts(id),league TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(account,league));`);
      if (exists('analysis_settings')) {
        // Old account-wide settings belong to the league active when this migration runs.
        db.exec(
          "INSERT OR IGNORE INTO league_settings SELECT s.account,COALESCE(a.league,'demo'),s.data FROM analysis_settings s LEFT JOIN active_links a ON a.account=s.account;",
        );
        archive('analysis_settings');
        db.exec('DROP TABLE analysis_settings');
      }
      db.prepare('INSERT INTO schema_migrations VALUES (1,?)').run(new Date().toISOString());
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Migration failed integrity verification');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys=ON;');
  }
}
export async function transaction(db, fn) {
  if (db.remote) return db.transaction(fn);
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = await fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
