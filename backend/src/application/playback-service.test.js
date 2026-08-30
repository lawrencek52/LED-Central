import test from "node:test";
import assert from "node:assert/strict";
import { PlaybackService } from "./playback-service.js";
import { EffectRenderService } from "./effect-render-service.js";

test("renders and distributes an effect frame on playback start", async () => {
  const sent = [];
  const service = new PlaybackService({
    canvasService: {
      get: (id) =>
        id === "canvas-1"
          ? {
              id,
              width: 1,
              height: 1,
              mappings: [{ controllerId: "deck-1", stripIndex: 0 }],
            }
          : null,
    },
    effectService: {
      get: (id) =>
        id === "solid"
          ? {
              id,
              renderer: "solid",
              parameters: { color: { default: "#ffffff" } },
            }
          : null,
    },
    renderService: new EffectRenderService(),
    distributionService: {
      distributeCanvasFrame: async (payload) => {
        sent.push(payload);
        return { status: "sent", frameCount: 1, sent: [], failed: [] };
      },
    },
    idFactory: () => "session-1",
    now: () => 1700000000000,
  });
  const session = await service.start({
    canvasId: "canvas-1",
    effectId: "solid",
  });
  assert.equal(session.status, "playing");
  assert.deepEqual(sent[0].frame.pixels, [[255, 255, 255]]);
  service.stop(session.id);
});

test("starts a replacement effect after the previous canvas timeline", async () => {
  const sent = [];
  const ids = ["session-1", "session-2"];
  const service = new PlaybackService({
    canvasService: {
      get: (id) =>
        id === "canvas-1"
          ? {
              id,
              width: 1,
              height: 1,
              mappings: [{ controllerId: "deck-1", stripIndex: 0 }],
            }
          : null,
    },
    effectService: {
      get: (id) =>
        ["solid", "gradient"].includes(id)
          ? {
              id,
              renderer: id,
              parameters:
                id === "solid"
                  ? { color: { default: "#ffffff" } }
                  : {
                      startColor: { default: "#000000" },
                      endColor: { default: "#ffffff" },
                      angle: { default: 0 },
                    },
            }
          : null,
    },
    renderService: new EffectRenderService(),
    distributionService: {
      distributeCanvasFrame: async (payload) => {
        sent.push(payload);
        return { status: "sent", frameCount: 1, sent: [], failed: [] };
      },
    },
    idFactory: () => ids.shift(),
    now: () => 1700000000000,
    frameRate: 20,
  });

  const first = await service.start({
    canvasId: "canvas-1",
    effectId: "solid",
  });
  const second = await service.start({
    canvasId: "canvas-1",
    effectId: "gradient",
  });

  assert.equal(first.status, "stopped");
  assert.equal(second.status, "playing");
  assert.equal(sent[1].frame.timestamp, sent[0].frame.timestamp + 50);
  service.stop(second.id);
});

test("continues scheduling frames after the first playback tick", async () => {
  const sent = [];
  const service = new PlaybackService({
    canvasService: {
      get: (id) =>
        id === "canvas-1"
          ? {
              id,
              width: 1,
              height: 1,
              mappings: [{ controllerId: "deck-1", stripIndex: 0 }],
            }
          : null,
    },
    effectService: {
      get: (id) =>
        id === "solid"
          ? {
              id,
              renderer: "solid",
              parameters: { color: { default: "#ffffff" } },
            }
          : null,
    },
    renderService: new EffectRenderService(),
    distributionService: {
      distributeCanvasFrame: async (payload) => {
        sent.push(payload);
        return { status: "sent", frameCount: 1, sent: [], failed: [] };
      },
    },
    idFactory: () => "session-1",
    frameRate: 1000,
  });

  const session = await service.start({
    canvasId: "canvas-1",
    effectId: "solid",
  });
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.ok(sent.length >= 2);
  assert.equal(session.status, "playing");
  service.stop(session.id);
});

test("tops up the controller queue in small paced batches instead of large bursts", async () => {
  const batches = [];
  const service = new PlaybackService({
    canvasService: {
      get: (id) =>
        id === "canvas-1"
          ? {
              id,
              width: 1,
              height: 1,
              mappings: [{ controllerId: "deck-1", stripIndex: 0 }],
            }
          : null,
    },
    effectService: {
      get: (id) =>
        id === "solid"
          ? {
              id,
              renderer: "solid",
              parameters: { color: { default: "#ffffff" } },
            }
          : null,
    },
    renderService: new EffectRenderService(),
    distributionService: {
      distributeCanvasFrames: async ({ frames }) => {
        batches.push(frames.length);
        return {
          status: "sent",
          frameCount: frames.length,
          sent: [],
          failed: [],
        };
      },
    },
    idFactory: () => "session-1",
    frameRate: 100,
    targetQueueMs: 40,
  });

  try {
    const session = await service.start({
      canvasId: "canvas-1",
      effectId: "solid",
    });
    await new Promise((resolve) => setTimeout(resolve, 35));

    assert.equal(batches[0], 4);
    assert.ok(batches.slice(1).every((size) => size <= 3));
    assert.equal(session.status, "playing");
    service.stop(session.id);
  } finally {
    for (const session of service.list()) service.stop(session.id);
  }
});

test("restores saved playback intents after a backend restart", async () => {
  const intents = [
    {
      canvasId: "canvas-1",
      effectId: "solid",
      parameters: {},
      fps: 20,
    },
  ];
  const repository = {
    list: () => intents,
    save: (intent) => {
      intents.splice(0, intents.length, intent);
    },
    remove: (canvasId) => {
      const index = intents.findIndex((intent) => intent.canvasId === canvasId);
      if (index >= 0) intents.splice(index, 1);
    },
  };
  const service = new PlaybackService({
    canvasService: {
      get: (id) =>
        id === "canvas-1"
          ? {
              id,
              width: 1,
              height: 1,
              mappings: [{ controllerId: "deck-1", stripIndex: 0 }],
            }
          : null,
    },
    effectService: {
      get: (id) =>
        id === "solid"
          ? {
              id,
              renderer: "solid",
              parameters: { color: { default: "#ffffff" } },
            }
          : null,
    },
    renderService: new EffectRenderService(),
    distributionService: {
      distributeCanvasFrame: async () => ({ status: "sent" }),
    },
    playbackRepository: repository,
    idFactory: () => "restored-session",
  });

  await service.restore();
  assert.equal(service.list()[0].id, "restored-session");
  service.stopByCanvas("canvas-1");
  assert.deepEqual(intents, []);
});
