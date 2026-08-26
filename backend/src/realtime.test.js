import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { createApp } from './server.js';
import { EventHub } from './infrastructure/realtime/event-hub.js';
import { attachRealtimeServer } from './infrastructure/realtime/websocket-server.js';

function messageReader(client) {
  const messages = [];
  const waiters = [];

  client.on('message', data => {
    const message = JSON.parse(data.toString());
    const resolve = waiters.shift();
    if (resolve) {
      resolve(message);
    } else {
      messages.push(message);
    }
  });

  return () => {
    if (messages.length > 0) {
      return Promise.resolve(messages.shift());
    }
    return Promise.race([
      new Promise(resolve => waiters.push(resolve)),
      new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timed out waiting for WebSocket message')), 2000);
      })
    ]);
  };
}

test('supports realtime subscriptions and effect commands', async t => {
  const eventHub = new EventHub();
  const received = [];
  const distributionService = {
    async distribute(payload) {
      received.push(payload);
      return { status: 'sent', frameCount: payload.frames.length, sent: [], failed: [] };
    }
  };
  const server = createServer(createApp({ eventHub, distributionService }));
  const realtime = attachRealtimeServer({ server, eventHub, distributionService });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => {
    realtime.closeAll();
    server.close();
  });

  const client = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/realtime`);
  const nextMessage = messageReader(client);
  await new Promise((resolve, reject) => {
    client.once('open', resolve);
    client.once('error', reject);
  });
  t.after(() => client.close());

  const connected = await nextMessage();
  assert.equal(connected.type, 'realtime.connected');

  client.send(JSON.stringify({
    type: 'effect.frames',
    requestId: 'request-1',
    controllerIds: ['controller-1'],
    frames: [{ timestamp: 1000, pixels: [[255, 0, 0]] }]
  }));
  const accepted = await nextMessage();
  assert.equal(accepted.type, 'effect.frames.accepted');
  assert.equal(accepted.requestId, 'request-1');
  assert.equal(received.length, 1);

  eventHub.publish({ topic: 'playback', type: 'playback.updated', payload: { status: 'playing' } });
  const event = await nextMessage();
  assert.equal(event.type, 'playback.updated');
});
