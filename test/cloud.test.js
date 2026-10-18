import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../src/http/application.js';

/** Opt in only with a separate preview database and the synthetic provider fixture. */
test(
  'two cloud instances preserve accounts and isolate league settings and saved trades',
  { skip: process.env.FF_CLOUD_TEST !== 'true' },
  async () => {
    assert.ok(process.env.DATABASE_URL, 'Use the isolated preview database');
    const apps = [],
      servers = [];
    async function start() {
      const app = await createApplication();
      apps.push(app);
      const server = http.createServer(app.handler).listen(0, '127.0.0.1');
      servers.push(server);
      await once(server, 'listening');
      return 'http://127.0.0.1:' + server.address().port + '/api/';
    }
    try {
      const [a, b] = await Promise.all([start(), start()]);
      async function request(base, path, cookie, input, method = input ? 'POST' : 'GET') {
        const r = await fetch(base + path, {
          method,
          headers: { 'Content-Type': 'application/json', Cookie: cookie || '' },
          ...(input ? { body: JSON.stringify(input) } : {}),
        });
        const data = await r.json();
        assert.ok(r.status < 500, JSON.stringify(data));
        return {
          status: r.status,
          data,
          cookie:
            r.headers
              .getSetCookie()
              .find((c) => c.startsWith('ff_auth='))
              ?.split(';')[0] || r.headers.getSetCookie()[0]?.split(';')[0],
        };
      }
      assert.equal((await request(a, 'health')).data.storage, 'postgres');
      const guests = await Promise.all([request(a, 'state'), request(b, 'state')]);
      assert.equal(
        (await request(a, 'preferences', guests[0].cookie, { favoriteTeam: 'BUF' }, 'PUT')).status,
        200,
      );
      const users = await Promise.all(
        guests.map((g, i) =>
          request(i ? b : a, 'auth/register', g.cookie, {
            name: 'Cloud Test ' + i,
            email: 'cloud-' + randomUUID() + '@example.test',
            password: 'synthetic cloud test passphrase',
          }),
        ),
      );
      users.forEach((u) => assert.equal(u.status, 200));
      assert.equal(users[0].data.preferences.favoriteTeam, 'BUF');
      assert.equal(users[1].data.preferences.favoriteTeam, null);
      assert.notEqual(users[0].data.account.id, users[1].data.account.id);
      const link = { username: 'testmanager', leagueId: '1234567890123' };
      const links = await Promise.all(
        users.map((u, i) => request(i ? b : a, 'sleeper/link', u.cookie, link)),
      );
      links.forEach((r) => assert.equal(r.status, 200));
      await request(
        a,
        'analysis/settings',
        users[0].cookie,
        { mode: 'dynasty', scoring: 'half' },
        'PUT',
      );
      await request(
        b,
        'analysis/settings',
        users[1].cookie,
        { mode: 'dynasty', scoring: 'standard' },
        'PUT',
      );
      const models = await Promise.all([
        request(b, 'analysis', users[0].cookie),
        request(a, 'analysis', users[1].cookie),
      ]);
      assert.equal(models[0].data.settings.scoring, 'half');
      assert.equal(models[1].data.settings.scoring, 'standard');
      const saved = await request(a, 'analysis/save', users[0].cookie, {
        teamA: 'sl_1',
        teamB: 'sl_2',
        sendA: ['101'],
        sendB: ['201'],
        title: 'Cloud persistence test',
      });
      assert.equal(saved.status, 200);
      assert.equal(saved.data.saved.length, 1);
      assert.equal((await request(a, 'analysis', users[1].cookie)).data.saved.length, 0);
      // A fresh application and connection pool must read previously committed state.
      const fresh = await start();
      assert.equal(
        (await request(fresh, 'state', users[0].cookie)).data.preferences.favoriteTeam,
        'BUF',
      );
      assert.equal(
        (await request(fresh, 'state', users[0].cookie)).data.account.id,
        users[0].data.account.id,
      );
      assert.equal(
        (await request(fresh, 'analysis', users[0].cookie)).data.saved[0].title,
        'Cloud persistence test',
      );
      const id = randomUUID();
      await assert.rejects(
        apps[0].db.transaction(async () => {
          await apps[0].db.prepare('INSERT INTO accounts(id) VALUES (?)').run(id);
          throw new Error('rollback fixture');
        }),
        /rollback fixture/,
      );
      assert.equal(
        await apps[1].db.prepare('SELECT id FROM accounts WHERE id=?').get(id),
        undefined,
      );
      console.log('Cloud account isolation, fresh-instance persistence and rollback verified.');
    } finally {
      await Promise.all(servers.map((server) => new Promise((r) => server.close(r))));
      await Promise.all(apps.map((app) => app.close()));
    }
  },
);
