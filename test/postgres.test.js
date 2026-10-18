import test from 'node:test';
import assert from 'node:assert/strict';
import { postgresSql, postgresDatabase } from '../src/storage/postgres.js';

test('SQL placeholders preserve literal question marks and escaped quotes', () => {
  assert.equal(
    postgresSql(`SELECT '?' AS "?",'it''s ?' WHERE id=? AND name=?`),
    `SELECT '?' AS "?",'it''s ?' WHERE id=$1 AND name=$2`,
  );
});

test('overlapping Postgres transactions pin separate clients and roll back only the failure', async () => {
  const calls = [];
  let id = 0;
  const pool = {
    async connect() {
      const client = ++id;
      return {
        async query(sql, values) {
          calls.push({ client, sql, values });
          return { rows: [{ client }], rowCount: 1 };
        },
        release() {
          calls.push({ client, sql: 'release' });
        },
      };
    },
    async query(sql) {
      calls.push({ client: 'pool', sql });
      return { rows: [], rowCount: 0 };
    },
    async end() {},
  };
  const db = postgresDatabase(pool);
  let unblock;
  const wait = new Promise((r) => {
    unblock = r;
  });
  const a = db.transaction(async () => {
    const first = await db.prepare('SELECT ?').get('a');
    await wait;
    assert.equal((await db.prepare('SELECT ?').get('a2')).client, first.client);
  });
  const b = db.transaction(async () => {
    await db.prepare('SELECT ?').get('b');
    throw new Error('expected rollback');
  });
  await assert.rejects(b, /expected rollback/);
  unblock();
  await a;
  assert.deepEqual(
    calls.filter((c) => c.sql === 'COMMIT').map((c) => c.client),
    [1],
  );
  assert.deepEqual(
    calls.filter((c) => c.sql === 'ROLLBACK').map((c) => c.client),
    [2],
  );
  assert.equal(calls.filter((c) => c.sql === 'release').length, 2);
  assert.ok(calls.filter((c) => c.sql === 'SELECT $1').every((c) => c.client !== 'pool'));
});
