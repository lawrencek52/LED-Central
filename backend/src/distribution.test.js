import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from './server.js';
import { ControllerService } from './application/controller-service.js';

async function request(server, body) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/distribution/frames`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

test('distributes frames to every selected controller', async t => {
  const controllerService = new ControllerService({
    idFactory: (() => {
      const ids = ['one', 'two'];
      return () => ids.shift();
    })()
  });
  controllerService.create({ name: 'One', host: '127.0.0.1', port: 49152 });
  controllerService.create({ name: 'Two', host: '127.0.0.1', port: 49153 });

  const sent = [];
  const distributionService = {
    async distribute(payload) {
      sent.push(payload);
      return {
        status: 'sent',
        frameCount: payload.frames.length,
        sent: payload.controllerIds.map(controllerId => ({
          controllerId,
          status: 'sent',
          frameCount: payload.frames.length
        })),
        failed: []
      };
    }
  };
  const server = createServer(createApp({ controllerService, distributionService })).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());

  const body = {
    controllerIds: ['one', 'two'],
    frames: [{ timestamp: 1000, pixels: [[255, 0, 0]] }]
  };
  const response = await request(server, body);

  assert.equal(response.status, 202);
  assert.deepEqual(sent, [body]);
  assert.equal(response.body.frameCount, 1);
  assert.equal(response.body.sent.length, 2);
});

test('rejects invalid frame payloads', async t => {
  const server = createServer(createApp({
    distributionService: { distribute: async () => ({}) }
  })).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());

  const response = await request(server, { controllerIds: ['one'], frames: [] });

  assert.equal(response.status, 400);
  assert.equal(response.body.details.frames, 'must be a non-empty array');
});
