import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthMiddleware } from './auth.js';

function run(authorization) {
  const request = { get: name => name === 'authorization' ? authorization : undefined, requestId: 'request-1' };
  let response;
  const result = { status: code => { response = { status: code, json: body => { response.body = body; } }; return response; } };
  createAuthMiddleware({ token: 'secret' })(request, result, () => { response = { next: true }; });
  return response;
}

test('accepts the configured bearer token and rejects invalid credentials', () => {
  assert.deepEqual(run('Bearer secret'), { next: true });
  const rejected = run('Bearer wrong');
  assert.equal(rejected.status, 401);
  assert.deepEqual(rejected.body, { error: 'Authentication required', requestId: 'request-1' });
});
