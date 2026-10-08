import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { FakeControllerGateway } from "./fake-controller-gateway.js";
import {
  TcpControllerGateway,
  consumeSocketResponses,
  encodePixelFrame,
} from "./tcp-controller-gateway.js";

// A firmware SocketResponse (72 bytes, little-endian) carrying `rssi`.
function socketResponse(rssi) {
  const buffer = Buffer.alloc(72);
  buffer.writeUInt32LE(72, 0);
  buffer.writeDoubleLE(rssi, 48);
  return buffer;
}

test("fake gateway records frames and simulates connection status", async () => {
  const gateway = new FakeControllerGateway();
  const controller = { id: "controller-1", host: "fake", port: 49152 };
  const frame = { timestamp: 1000, pixels: [[255, 0, 0]] };

  await gateway.sendFrame(controller, frame);

  assert.deepEqual(await gateway.getStatus(controller.id), {
    controllerId: controller.id,
    connected: true,
  });
  assert.deepEqual(gateway.sent[0], { controller, frames: [frame] });
  gateway.disconnect(controller.id);
  assert.equal((await gateway.getStatus(controller.id)).connected, false);
});

test("TCP gateway sends a NightDriverStrip pixel packet", async (t) => {
  const deviceServer = net.createServer();
  deviceServer.listen(0, "127.0.0.1");
  await new Promise((resolve) => deviceServer.once("listening", resolve));
  t.after(() => deviceServer.close());
  const port = deviceServer.address().port;
  const received = new Promise((resolve) => {
    deviceServer.once("connection", (socket) => {
      socket.once("data", (data) => resolve(data));
    });
  });

  const gateway = new TcpControllerGateway({ connectionTimeoutMs: 1000 });
  const controller = { id: "controller-1", host: "127.0.0.1", port };
  const frame = { timestamp: 1000, channelMask: 1, pixels: [[255, 0, 0]] };
  await gateway.sendFrame(controller, frame);

  assert.deepEqual(await received, encodePixelFrame(frame));
  assert.deepEqual(gateway.getStatus(controller.id), {
    controllerId: controller.id,
    connected: true,
  });
  gateway.disconnect(controller.id);
});

test("TCP gateway retains an independent status preview for each strip channel", () => {
  const gateway = new TcpControllerGateway();
  gateway.recordSent("controller-1", {
    timestamp: Date.now() + 1000,
    channelMask: 1,
    pixels: [[255, 0, 0]],
  });
  gateway.recordSent("controller-1", {
    timestamp: Date.now() + 1000,
    channelMask: 2,
    pixels: [[0, 0, 255]],
  });

  assert.deepEqual(gateway.getQueueStatus("controller-1", 1).latestFrame, {
    timestamp: gateway.getQueueStatus("controller-1", 1).latestFrame.timestamp,
    pixels: [[255, 0, 0]],
  });
  assert.deepEqual(gateway.getQueueStatus("controller-1", 2).latestFrame, {
    timestamp: gateway.getQueueStatus("controller-1", 2).latestFrame.timestamp,
    pixels: [[0, 0, 255]],
  });
});

test("TCP gateway shares one connection for concurrent sends", async (t) => {
  let connectionCount = 0;
  const sockets = new Set();
  const deviceServer = net.createServer((socket) => {
    connectionCount += 1;
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  deviceServer.listen(0, "127.0.0.1");
  await new Promise((resolve) => deviceServer.once("listening", resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    deviceServer.close();
  });

  const gateway = new TcpControllerGateway({ connectionTimeoutMs: 1000 });
  const controller = {
    id: "controller-1",
    host: "127.0.0.1",
    port: deviceServer.address().port,
  };
  const [first, second] = await Promise.all([
    gateway.connect(controller),
    gateway.connect(controller),
  ]);

  assert.equal(first, second);
  assert.equal(connectionCount, 1);
  gateway.disconnect(controller.id);
});

test("TCP gateway sends each strip channel over its own connection", async (t) => {
  const connections = [];
  const deviceServer = net.createServer((socket) => {
    const received = [];
    connections.push({ socket, received });
    socket.on("data", (data) => received.push(data));
  });
  deviceServer.listen(0, "127.0.0.1");
  await new Promise((resolve) => deviceServer.once("listening", resolve));
  t.after(() => {
    for (const { socket } of connections) socket.destroy();
    deviceServer.close();
  });

  const gateway = new TcpControllerGateway({ connectionTimeoutMs: 1000 });
  const controller = {
    id: "controller-1",
    host: "127.0.0.1",
    port: deviceServer.address().port,
  };
  const frameA = { timestamp: 1000, channelMask: 1, pixels: [[255, 0, 0]] };
  const frameB = { timestamp: 1000, channelMask: 2, pixels: [[0, 255, 0]] };

  // Two strips (channels) rendered for the same tick must not share a
  // connection - a stall on one strip's socket would otherwise freeze every
  // other strip on the same controller behind it in one shared FIFO.
  await gateway.sendFrames(controller, [frameA, frameB]);
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(connections.length, 2);
  const payloads = connections.map(({ received }) => Buffer.concat(received));
  assert.ok(payloads.some((buf) => buf.equals(encodePixelFrame(frameA))));
  assert.ok(payloads.some((buf) => buf.equals(encodePixelFrame(frameB))));
  gateway.disconnect(controller.id);
});

test("TCP gateway measures the audio telemetry rate from recent message timestamps", () => {
  const gateway = new TcpControllerGateway();
  const now = Date.now();
  gateway.audioStates.set("controller-1", {
    available: true,
    received: [now - 900, now - 500, now - 100, now - 1500, now - 2000],
  });

  // Only the 3 timestamps within the last second should count.
  assert.equal(gateway.getAudioTelemetryRate("controller-1"), 3);
  assert.equal(gateway.getAudioTelemetryRate("unknown-controller"), 0);
});

test("TCP gateway handles a controller socket error without crashing", async (t) => {
  const sockets = new Set();
  const deviceServer = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  deviceServer.listen(0, "127.0.0.1");
  await new Promise((resolve) => deviceServer.once("listening", resolve));
  t.after(() => {
    for (const serverSocket of sockets) serverSocket.destroy();
    deviceServer.close();
  });

  const gateway = new TcpControllerGateway({ connectionTimeoutMs: 1000 });
  const controller = {
    id: "controller-1",
    host: "127.0.0.1",
    port: deviceServer.address().port,
  };
  const socket = await gateway.connect(controller);

  socket.emit("error", new Error("controller disconnected"));
  assert.deepEqual(gateway.getStatus(controller.id), {
    controllerId: controller.id,
    connected: false,
  });
});

test("TCP gateway fails fast while a controller is offline and reconnects once it's back", async (t) => {
  // Reserve a port, then free it so the first connect is refused.
  const probe = net.createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => probe.once("listening", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));

  const gateway = new TcpControllerGateway({
    connectionTimeoutMs: 1000,
    reconnectDelayMs: 20,
  });
  const controller = { id: "controller-1", host: "127.0.0.1", port };
  const frame = { timestamp: Date.now(), channelMask: 1, pixels: [[1, 2, 3]] };

  await assert.rejects(gateway.sendFrames(controller, [frame]), /ECONNREFUSED/);
  // Known offline: rejected without awaiting another connect attempt.
  await assert.rejects(gateway.sendFrames(controller, [frame]), /offline/);

  let received = 0;
  const sockets = new Set();
  const deviceServer = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("data", (data) => {
      received += data.length;
    });
  });
  deviceServer.listen(port, "127.0.0.1");
  await new Promise((resolve) => deviceServer.once("listening", resolve));
  t.after(() => {
    for (const serverSocket of sockets) serverSocket.destroy();
    deviceServer.close();
  });

  for (let attempt = 0; attempt < 50 && received === 0; attempt += 1) {
    await gateway.sendFrames(controller, [frame]).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(received > 0);
  assert.equal(gateway.getStatus(controller.id).connected, true);
});

test("consumeSocketResponses parses packets split across reads and resyncs on garbage", () => {
  const signals = [];
  const onResponse = ({ wifiSignal }) => signals.push(wifiSignal);
  const two = Buffer.concat([socketResponse(-55), socketResponse(-61)]);

  let rest = consumeSocketResponses(two.subarray(0, 100), onResponse);
  assert.deepEqual(signals, [-55]);
  assert.equal(rest.length, 28);
  rest = consumeSocketResponses(Buffer.concat([rest, two.subarray(100)]), onResponse);
  assert.deepEqual(signals, [-55, -61]);
  assert.equal(rest.length, 0);

  rest = consumeSocketResponses(Buffer.from([1, 2, 3, 4, 5]), onResponse);
  assert.equal(rest.length, 0);
  assert.deepEqual(signals, [-55, -61]);
});

test("TCP gateway reports the WiFi signal from the controller's SocketResponses", async (t) => {
  const deviceServer = net.createServer((socket) => {
    socket.once("data", () => socket.write(socketResponse(-58)));
  });
  deviceServer.listen(0, "127.0.0.1");
  await new Promise((resolve) => deviceServer.once("listening", resolve));
  t.after(() => deviceServer.close());

  const gateway = new TcpControllerGateway();
  const controller = { id: "controller-1", host: "127.0.0.1", port: deviceServer.address().port };
  t.after(() => gateway.disconnect(controller.id));
  await gateway.sendFrames(controller, [{ timestamp: Date.now(), pixels: [[1, 2, 3]] }]);

  for (let attempt = 0; attempt < 50 && gateway.getWifiSignal(controller.id) === null; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(gateway.getWifiSignal(controller.id), -58);
});

test("TCP gateway logs a controller outage once when it starts and once when it ends", async (t) => {
  const logged = [];
  t.mock.method(console, "log", (message) => logged.push(String(message)));

  const probe = net.createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => probe.once("listening", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));

  const gateway = new TcpControllerGateway({ connectionTimeoutMs: 1000, reconnectDelayMs: 20 });
  const controller = { id: "controller-1", name: "Deck3", host: "127.0.0.1", port };
  const frame = { timestamp: Date.now(), channelMask: 1, pixels: [[1, 2, 3]] };

  await assert.rejects(gateway.sendFrames(controller, [frame]));
  await assert.rejects(gateway.sendFrames(controller, [frame]));
  await new Promise((resolve) => setTimeout(resolve, 30));
  await gateway.sendFrames(controller, [frame]).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(logged.filter((line) => line.includes("Deck3 (127.0.0.1) unreachable: ECONNREFUSED")).length, 1);

  const sockets = new Set();
  const deviceServer = net.createServer((socket) => sockets.add(socket));
  deviceServer.listen(port, "127.0.0.1");
  await new Promise((resolve) => deviceServer.once("listening", resolve));
  t.after(() => {
    for (const serverSocket of sockets) serverSocket.destroy();
    deviceServer.close();
  });

  for (let attempt = 0; attempt < 50 && !gateway.getStatus(controller.id).connected; attempt += 1) {
    await gateway.sendFrames(controller, [frame]).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(logged.filter((line) => /Deck3 \(127\.0\.0\.1\) reconnected after \d+s/.test(line)).length, 1);
});
