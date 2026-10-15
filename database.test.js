import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from './database.js';

test('legacy migration preserves identities, links, settings and scenarios; archives stock rows atomically', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE accounts(id TEXT PRIMARY KEY,cash INTEGER,week INTEGER,roster TEXT);
    INSERT INTO accounts VALUES ('a',2500000,8,'[]'),('market',2500000,8,'[]');
    CREATE TABLE users(id TEXT PRIMARY KEY,account TEXT REFERENCES accounts(id));INSERT INTO users VALUES('user','a');
    CREATE TABLE login_sessions(token TEXT,user TEXT REFERENCES users(id));INSERT INTO login_sessions VALUES ('hash','user');
    CREATE TABLE sleeper_links(account TEXT REFERENCES accounts(id),league TEXT,market TEXT REFERENCES accounts(id),data TEXT,PRIMARY KEY(account,league));INSERT INTO sleeper_links VALUES ('a','123','market','{"league":{"id":"123"}}');
    CREATE TABLE active_links(account TEXT PRIMARY KEY REFERENCES accounts(id),league TEXT);INSERT INTO active_links VALUES ('a','123');
    CREATE TABLE analysis_settings(account TEXT PRIMARY KEY REFERENCES accounts(id),data TEXT);INSERT INTO analysis_settings VALUES ('a','{"mode":"dynasty"}');
    CREATE TABLE trade_scenarios(id TEXT,account TEXT REFERENCES accounts(id),data TEXT,created TEXT);INSERT INTO trade_scenarios VALUES ('saved','a','{}','2026');
    CREATE TABLE holdings(account TEXT REFERENCES accounts(id),shares INTEGER);INSERT INTO holdings VALUES ('a',7);`);
  migrate(db);
  migrate(db);
  assert.equal(db.prepare('SELECT account FROM users').get().account, 'a');
  assert.equal(db.prepare('SELECT token FROM login_sessions').get().token, 'hash');
  assert.equal(db.prepare('SELECT data FROM sleeper_links').get().data, '{"league":{"id":"123"}}');
  assert.equal(db.prepare('SELECT id FROM trade_scenarios').get().id, 'saved');
  assert.equal(db.prepare('SELECT league FROM league_settings').get().league, '123');
  assert.equal(
    JSON.parse(db.prepare("SELECT data FROM legacy_archive WHERE name='holdings'").get().data)[0]
      .shares,
    7,
  );
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='holdings'").get(), undefined);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.deepEqual(
    db
      .prepare('PRAGMA table_info(accounts)')
      .all()
      .map((c) => c.name),
    ['id', 'created'],
  );
  db.close();
});
test('migration rolls back on integrity failure', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    "PRAGMA foreign_keys=OFF;CREATE TABLE accounts(id TEXT PRIMARY KEY,cash INTEGER);INSERT INTO accounts VALUES('a',1);CREATE TABLE orphan(account TEXT REFERENCES accounts(id));INSERT INTO orphan VALUES('missing');",
  );
  assert.throws(() => migrate(db), /integrity/);
  assert.ok(
    db
      .prepare('PRAGMA table_info(accounts)')
      .all()
      .some((c) => c.name === 'cash'),
  );
  db.close();
});
