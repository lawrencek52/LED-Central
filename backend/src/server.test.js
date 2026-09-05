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

test('connects and disconnects a controller through the gateway', async t => {
  const controllerService = new (class {
    constructor() { this.controller = { id: 'deck1', name: 'Deck', host: 'deck1.local', port: 49152, connected: false, strips: 4, ledCounts: [215, 215, 215, 215], lastSeen: '2026-01-01T00:00:00.000Z' }; }
    list() { return [this.controller]; }
    get() { return this.controller; }
    setConnectionState(id, connected) { this.controller = { ...this.controller, id, connected }; return this.controller; }
    remove() { return true; }
  })();
  const calls = [];
  const gateway = {
    connect: async controller => calls.push(['connect', controller.id]),
    disconnect: id => calls.push(['disconnect', id])
  };
  const server = createServer(createApp({ controllerService, gateway })).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());

  const connected = await request(server, '/api/controllers/deck1/connect', { method: 'POST' });
  assert.equal(connected.status, 200);
  assert.equal(connected.body.connected, true);
  const disconnected = await request(server, '/api/controllers/deck1/disconnect', { method: 'POST' });
  assert.equal(disconnected.status, 200);
  assert.equal(disconnected.body.connected, false);
  assert.deepEqual(calls, [['connect', 'deck1'], ['disconnect', 'deck1']]);
});

test('re-probes a controller for audio support on demand', async t => {
  const controllerService = new (class {
    constructor() {
      this.controller = {
        id: 'deck1', name: 'Deck', host: 'deck1.local', port: 49152, connected: false,
        strips: 4, ledCounts: [215, 215, 215, 215], audioAvailable: false, audioCheckedAt: null,
        lastSeen: '2026-01-01T00:00:00.000Z'
      };
    }
    get(id) { return id === this.controller.id ? this.controller : undefined; }
    setAudioAvailability(id, { available, checkedAt }) {
      this.controller = { ...this.controller, id, audioAvailable: available, audioCheckedAt: checkedAt ?? this.controller.audioCheckedAt };
      return this.controller;
    }
  })();
  const calls = [];
  const gateway = {
    probeAudioSupport: async controller => { calls.push(controller.id); return true; },
    getStatus: async () => ({ connected: false }),
    getAudioStatus: () => ({ available: true, checkedAt: Date.now() })
  };
  const server = createServer(createApp({ controllerService, gateway })).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());

  const rechecked = await request(server, '/api/controllers/deck1/recheck-audio', { method: 'POST' });
  assert.equal(rechecked.status, 200);
  assert.equal(rechecked.body.audioAvailable, true);
  assert.deepEqual(calls, ['deck1']);

  const missing = await request(server, '/api/controllers/missing/recheck-audio', { method: 'POST' });
  assert.equal(missing.status, 404);
});
