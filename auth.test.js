import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
test('login preserves linked leagues and saved analyses, isolates accounts, rotates sessions, and resets by email once', async () => {
  const port = 54000 + Math.floor(Math.random() * 5000),
    folder = mkdtempSync(join(tmpdir(), 'ff-auth-test-'));
  let child;
  async function start() {
    child = spawn(process.execPath, ['--import', './fixtures/sleeper-fetch.mjs', 'server.js'], {
      env: {
        ...process.env,
        PORT: String(port),
        DB_PATH: join(folder, 'test.sqlite'),
        RESEND_API_KEY: 'test-key',
        EMAIL_FROM: 'Test <test@example.test>',
        EMAIL_APP_ORIGIN: 'http://127.0.0.1:' + port,
        TEST_EMAIL_LOG: join(folder, 'emails.jsonl'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await Promise.race([
      new Promise((resolve, reject) => {
        child.stdout.on('data', (c) => {
          if (c.toString().includes('running at')) resolve();
        });
        child.once('error', reject);
        child.once('exit', (c) => reject(new Error(`Server exited ${c}`)));
      }),
      new Promise((_, reject) => {
        const t = setTimeout(() => reject(new Error('Startup timeout')), 10000);
        t.unref();
      }),
    ]);
  }
  async function request(path, cookie, body, headers = {}) {
    const r = await fetch(`http://127.0.0.1:${port}/api/${path}`, {
      method: path === 'preferences' ? 'PUT' : body ? 'POST' : 'GET',
      headers: { Cookie: cookie || '', 'Content-Type': 'application/json', ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: r.status,
      cookie: r.headers.get('set-cookie')?.split(';')[0],
      data: await r.json(),
    };
  }
  try {
    await start();
    const guest = await request('state');
    await request('sleeper/link', guest.cookie, {
      username: 'testmanager',
      leagueId: '1234567890123',
    });
    const saved = await request('analysis/save', guest.cookie, {
      teamA: 'sl_1',
      teamB: 'sl_2',
      sendA: ['101'],
      sendB: ['201'],
      title: 'Preserved analysis',
    });
    assert.equal(saved.status, 200);
    assert.equal((await request('preferences', guest.cookie, { favoriteTeam: 'BUF' })).status, 200);
    const credentials = {
      email: 'Manager@example.test',
      password: 'synthetic test passphrase',
      name: 'Test manager',
    };
    assert.equal(
      (await request('auth/register', guest.cookie, { ...credentials, password: 'short' })).status,
      400,
    );
    const signup = await request('auth/register', guest.cookie, credentials);
    assert.equal(signup.status, 200);
    assert.equal(signup.data.user.email, 'manager@example.test');
    assert.equal(signup.data.preferences.favoriteTeam, 'BUF');
    assert.ok(signup.data.account.id);
    assert.equal(signup.data.connection.league.name, 'Integration League');
    assert.match(signup.cookie, /^ff_auth=/);
    assert.equal(signup.data.emailSent, true);
    const emails = () =>
      readFileSync(join(folder, 'emails.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const tokenFrom = (mail) =>
      new URLSearchParams(new URL(mail.text.match(/Open this link: (\S+)/)[1]).hash.slice(1)).get(
        'token',
      );
    const verification = tokenFrom(emails()[0]);
    assert.equal(signup.data.user.emailVerified, 0);
    assert.equal((await request('auth/verify', '', { token: verification })).status, 200);
    assert.equal((await request('auth/verify', '', { token: verification })).status, 400);
    assert.equal((await request('state', signup.cookie)).data.user.emailVerified, 1);
    assert.equal(
      (await request('state', guest.cookie)).data.user,
      null,
      'old guest cookie cannot access registered account',
    );
    const wrong = await request('auth/login', '', {
      email: credentials.email,
      password: 'wrong synthetic passphrase',
    });
    assert.equal(wrong.status, 401);
    const login = await request('auth/login', '', credentials);
    assert.equal(login.status, 200);
    assert.equal(login.data.preferences.favoriteTeam, 'BUF');
    assert.equal(
      (await request('preferences', login.cookie, { favoriteTeam: '<script>' })).status,
      400,
    );
    assert.notEqual(login.cookie, signup.cookie);
    assert.equal(
      (await request('analysis', login.cookie)).data.saved[0].title,
      'Preserved analysis',
    );
    assert.equal('hash' in login.data.user, false);
    assert.equal('recoveryCode' in login.data, false);
    const other = await request('auth/register', '', {
      email: 'other@example.test',
      password: 'another test passphrase',
      name: 'Other manager',
    });
    assert.equal(other.data.connection, null);
    assert.equal(other.data.preferences.favoriteTeam, null);
    assert.notEqual(other.data.account.id, login.data.account.id);
    const csrf = await request(
      'auth/logout',
      login.cookie,
      {},
      { Origin: 'https://attacker.example' },
    );
    assert.equal(csrf.status, 403);
    child.kill();
    await once(child, 'exit');
    await start();
    assert.equal((await request('state', login.cookie)).data.user.email, 'manager@example.test');
    assert.equal((await request('state', login.cookie)).data.preferences.favoriteTeam, 'BUF');
    await request('auth/logout', login.cookie, {});
    assert.equal((await request('state', login.cookie)).data.user, null);
    assert.equal((await request('state', signup.cookie)).data.user.email, 'manager@example.test');
    const known = await request('auth/forgot', '', { email: credentials.email });
    const unknown = await request('auth/forgot', '', { email: 'absent@example.test' });
    assert.deepEqual(known.data, unknown.data);
    const resetToken = tokenFrom(emails().at(-1));
    assert.equal((await request('auth/verify', '', { token: resetToken })).status, 400);
    const reset = await request('auth/reset', '', {
      token: resetToken,
      password: 'new synthetic passphrase',
    });
    assert.equal(reset.status, 200);
    assert.equal(
      (await request('state', signup.cookie)).data.user,
      null,
      'reset revokes earlier sessions',
    );
    assert.equal(
      (await request('auth/reset', '', { token: resetToken, password: 'new synthetic passphrase' }))
        .status,
      400,
    );
    assert.equal((await request('auth/recover', '', {})).status, 404);
    assert.equal((await request('auth/login', '', credentials)).status, 401);
    assert.equal(
      (await request('auth/login', '', { ...credentials, password: 'new synthetic passphrase' }))
        .status,
      200,
    );
    for (let i = 0; i < 10; i++)
      await request('auth/login', '', {
        email: 'missing@example.test',
        password: 'synthetic missing passphrase',
      });
    assert.equal(
      (
        await request('auth/login', '', {
          email: 'missing@example.test',
          password: 'synthetic missing passphrase',
        })
      ).status,
      429,
    );
  } finally {
    if (child?.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
  }
});
