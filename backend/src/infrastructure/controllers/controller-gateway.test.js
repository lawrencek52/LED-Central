import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { FakeControllerGateway } from './fake-controller-gateway.js';
import { TcpControllerGateway, encodePixelFrame } from './tcp-controller-gateway.js';

test('fake gateway records frames and simulates connection status', async () => {
  const gateway = new FakeControllerGateway();
  const controller = { id: 'controller-1', host: 'fake', port: 49152 };
  const frame = { timestamp: 1000, pixels: [[255, 0, 0]] };

  await gateway.sendFrame(controller, frame);

  assert.deepEqual(await gateway.getStatus(controller.id), {
    controllerId: controller.id,
    connected: true
  });
  assert.deepEqual(gateway.sent[0], { controller, frames: [frame] });
  gateway.disconnect(controller.id);
  assert.equal((await gateway.getStatus(controller.id)).connected, false);
});

test('TCP gateway sends a NightDriverStrip pixel packet', async t => {
  const deviceServer = net.createServer();
  deviceServer.listen(0, '127.0.0.1');
  await new Promise(resolve => deviceServer.once('listening', resolve));
  t.after(() => deviceServer.close());
  const port = deviceServer.address().port;
  const received = new Promise(resolve => {
    deviceServer.once('connection', socket => {
      socket.once('data', data => resolve(data));
    });
  });

  const gateway = new TcpControllerGateway({ connectionTimeoutMs: 1000 });
  const controller = { id: 'controller-1', host: '127.0.0.1', port };
  const frame = { timestamp: 1000, channelMask: 1, pixels: [[255, 0, 0]] };
  await gateway.sendFrame(controller, frame);

  assert.deepEqual(await received, encodePixelFrame(frame));
  assert.deepEqual(gateway.getStatus(controller.id), {
    controllerId: controller.id,
    connected: true
  });
  gateway.disconnect(controller.id);
});