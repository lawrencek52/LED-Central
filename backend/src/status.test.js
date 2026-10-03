import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "./server.js";

async function request(server, path) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
  return { status: response.status, body: await response.json() };
}

test("reports the playing session's own frame rate, not the service default", async (t) => {
  const canvas = { id: "canvas-1", name: "Deck8", mappings: [] };
  const canvasService = { list: () => [canvas] };
  const controllerService = { get: () => null };
  const gateway = {};
  const playbackService = {
    frameRate: 20, // the service-wide default - must NOT be what gets reported below
    list: () => [
      { canvasId: "canvas-1", status: "playing", effectId: "nds-fire", frameRate: 47 },
    ],
    effectService: { get: () => ({ name: "Fire" }) },
  };
  const server = createServer(
    createApp({ canvasService, controllerService, gateway, playbackService }),
  ).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());

  const { status, body } = await request(server, "/api/status");
  assert.equal(status, 200);
  assert.equal(body.canvases[0].effectName, "Fire");
  assert.equal(body.canvases[0].framesPerSecond, 47);
});

test("reports 0 frames per second for an inactive canvas", async (t) => {
  const canvas = { id: "canvas-1", name: "Deck8", mappings: [] };
  const canvasService = { list: () => [canvas] };
  const controllerService = { get: () => null };
  const gateway = {};
  const playbackService = {
    frameRate: 20,
    list: () => [],
    effectService: { get: () => null },
  };
  const server = createServer(
    createApp({ canvasService, controllerService, gateway, playbackService }),
  ).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());

  const { body } = await request(server, "/api/status");
  assert.equal(body.canvases[0].effectName, "Inactive");
  assert.equal(body.canvases[0].framesPerSecond, 0);
});

test("reports per-core host CPU utilization", async (t) => {
  const canvasService = { list: () => [] };
  const playbackService = { list: () => [], effectService: { get: () => null } };
  const server = createServer(
    createApp({ canvasService, controllerService: { get: () => null }, gateway: {}, playbackService }),
  ).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());

  const { body } = await request(server, "/api/status");
  assert.ok(Array.isArray(body.hostCpu));
  assert.ok(body.hostCpu.length > 0);
  for (const value of body.hostCpu) assert.ok(value >= 0 && value <= 100);
});

test("reports each strip's recv/draw rates from the controller and its sent KiB/s", async (t) => {
  const canvas = {
    id: "canvas-1",
    name: "Deck",
    width: 2,
    height: 2,
    mappings: [
      { controllerId: "deck-1", stripIndex: 0, x: 0, y: 0, width: 2, height: 1 },
      { controllerId: "deck-1", stripIndex: 1, x: 0, y: 1, width: 2, height: 1 },
    ],
  };
  const controller = { id: "deck-1", name: "Deck1", host: "deck1.local", port: 49152 };
  const gateway = {
    getQueueStatus: () => ({ queuedFrames: 30, framesPerSecond: 20, kibPerSecond: 3.2, activeChannels: 2 }),
    getControllerStats: () => ({ receivedPerSecond: 40, drawFps: 20 }),
  };
  const playbackService = { list: () => [], effectService: { get: () => null } };
  const server = createServer(
    createApp({
      canvasService: { list: () => [canvas] },
      controllerService: { get: () => controller },
      gateway,
      playbackService,
    }),
  ).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());

  const { body } = await request(server, "/api/status");
  const [strip] = body.canvases[0].strips;
  assert.equal(strip.recvFps, 20);
  assert.equal(strip.drawFps, 20);
  assert.equal(strip.kibPerSecond, 3.2);
});
