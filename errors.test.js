import test from 'node:test';
import assert from 'node:assert/strict';
import { invalid, provider, publicError, logRequest } from './errors.js';
test('validation and provider errors are distinct; unexpected details are private', () => {
  assert.equal(publicError(invalid('Choose a team')).status, 400);
  assert.equal(publicError(provider('Try later')).status, 503);
  const unexpected = publicError(new Error('SQL table password_hash failed'));
  assert.equal(unexpected.status, 500);
  assert.ok(!JSON.stringify(unexpected).includes('password_hash'));
});
test('structured request logger excludes sensitive and unrecognized fields', () => {
  let output;
  logRequest(
    {
      requestId: 'id',
      method: 'POST',
      path: '/api/auth/login',
      status: 401,
      durationMs: 1,
      body: { password: 'secret' },
      cookie: 'token',
      email: 'private',
    },
    (s) => (output = s),
  );
  assert.deepEqual(JSON.parse(output), {
    event: 'http_request',
    requestId: 'id',
    method: 'POST',
    path: '/api/auth/login',
    status: 401,
    durationMs: 1,
  });
});
