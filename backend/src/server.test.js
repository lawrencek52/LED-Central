import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from './server.js';

async function request(server, path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) }
  });
  return {
    status: response.status,
    requestId: response.headers.get('x-request-id'),
    body: await response.json()
  };
}

test('serves controller CRUD and validates requests', async t => {
  const server = createServer(createApp()).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());

  const invalid = await request(server, '/api/controllers', {
    method: 'POST',
    body: JSON.stringify({ name: 'Kitchen', port: 49152 })
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.details.host, 'must be a non-empty string');
  assert.ok(invalid.requestId);

  const emptyPatch = await request(server, '/api/controllers/missing', {
    method: 'PATCH',
    body: JSON.stringify({})
  });
  assert.equal(emptyPatch.status, 400);

  const invalidJson = await request(server, '/api/controllers', {
    method: 'POST',
    body: '{"name":'
  });
  assert.equal(invalidJson.status, 400);
  assert.equal(invalidJson.body.error, 'Invalid JSON body');

  const created = await request(server, '/api/controllers', {
    method: 'POST',
    body: JSON.stringify({ name: 'Kitchen', host: '192.168.1.100', port: 49152, strips: 4, ledCounts: [215, 215, 215, 215] })
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'Kitchen');

  const updated = await request(server, `/api/controllers/${created.body.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'Kitchen ceiling' })
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.name, 'Kitchen ceiling');

  const missing = await request(server, '/api/controllers/missing');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'Controller not found');

  const deleted = await request(server, `/api/controllers/${created.body.id}`, {
    method: 'DELETE'
  });
  assert.deepEqual(deleted.body, { success: true });
});
