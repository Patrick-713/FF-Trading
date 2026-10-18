import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAuth, digest } from '../src/auth/auth.js';

test('email tokens expire, remain hashed, are purpose-bound and cannot race or be reused', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES ('guest');");
  const emails = [];
  const auth = createAuth(db, async (email, purpose, token) =>
    emails.push({ email, purpose, token }),
  );
  const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  const res = { setHeader() {} };
  try {
    await auth.register(
      req,
      res,
      { email: 'test@example.test', name: 'Test', password: 'synthetic secure passphrase' },
      'guest',
    );
    const first = emails.at(-1).token;
    assert.equal(db.prepare('SELECT token FROM email_tokens').get().token, digest(first));
    await auth.requestEmail(req, { email: 'test@example.test' }, 'verify');
    await assert.rejects(auth.consumeLink(req, { token: first }, 'verify'), /invalid or expired/);
    const current = emails.at(-1).token;
    db.prepare('UPDATE email_tokens SET expires=0').run();
    await assert.rejects(auth.consumeLink(req, { token: current }, 'verify'), /invalid or expired/);
    await auth.requestEmail(req, { email: 'test@example.test' }, 'verify');
    const token = emails.at(-1).token;
    const attempts = await Promise.allSettled([
      auth.consumeLink(req, { token }, 'verify'),
      auth.consumeLink(req, { token }, 'verify'),
    ]);
    assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await auth.profile('guest')).emailVerified, 1);
    const count = emails.length;
    await auth.requestEmail(req, { email: 'test@example.test' }, 'verify');
    assert.equal(emails.length, count, 'already verified accounts receive no redundant link');
  } finally {
    db.close();
  }
});
