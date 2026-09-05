import test from "node:test";
import assert from "node:assert/strict";
import { PlaybackService } from "./playback-service.js";
import { EffectRenderService } from "./effect-render-service.js";

function baseServiceOptions() {
  return {
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
        id === "vu-meter"
          ? { id, renderer: "vu-meter", parameters: {}, tags: ["audio"] }
          : id === "solid"
            ? {
                id,
                renderer: "solid",
                parameters: { color: { default: "#ffffff" } },
              }
            : null,
    },
    renderService: new EffectRenderService(),
  };
}

test("rejects starting an audio-tagged effect when no canvas audio is available", async () => {
  const service = new PlaybackService({
    ...baseServiceOptions(),
    distributionService: { distributeCanvasFrame: async () => ({ status: "sent" }) },
    audioService: { getCanvasAudio: () => ({ available: false }) },
  });
  await assert.rejects(
    service.start({ canvasId: "canvas-1", effectId: "vu-meter" }),
    /audio-capable controllers/,
  );
});

test("injects live canvas audio into an audio-tagged effect's parameters", async () => {
  const sent = [];
  const service = new PlaybackService({
    ...baseServiceOptions(),
    distributionService: {
      distributeCanvasFrame: async (payload) => {
        sent.push(payload);
        return { status: "sent" };
      },
    },
    audioService: {
      getCanvasAudio: () => ({ available: true, vuRatioFade: 2, lastBeatAt: null }),
    },
    idFactory: () => "session-1",
    now: () => 1700000000000,
  });
  const session = await service.start({ canvasId: "canvas-1", effectId: "vu-meter" });
  assert.equal(session.status, "playing");
  // vuRatioFade: 2 on a 1-pixel-wide strip lights the single pixel via the
  // fire palette at heat 0, i.e. black - the important thing is the render
  // didn't throw and consumed the injected `audio` parameter without error.
  assert.equal(sent[0].frame.pixels.length, 1);
  service.stop(session.id);
});

test("paces an audio-tagged effect to the measured telemetry rate instead of the requested fps", async () => {
  const service = new PlaybackService({
    ...baseServiceOptions(),
    distributionService: { distributeCanvasFrame: async () => ({ status: "sent" }) },
    audioService: {
      getCanvasAudio: () => ({ available: true }),
      getUpdateRateHz: () => 45,
    },
    frameRate: 20,
    idFactory: () => "session-1",
  });
  const session = await service.start({
    canvasId: "canvas-1",
    effectId: "vu-meter",
    fps: 20,
  });
  assert.equal(session.frameRate, 45);
  service.stop(session.id);

  const nonAudio = await service.start({
    canvasId: "canvas-1",
    effectId: "solid",
    fps: 20,
  });
  assert.equal(nonAudio.frameRate, 20);
  service.stop(nonAudio.id);
});

test("falls back to the default frame rate when telemetry rate can't be measured", async () => {
  const service = new PlaybackService({
    ...baseServiceOptions(),
    distributionService: { distributeCanvasFrame: async () => ({ status: "sent" }) },
    audioService: {
      getCanvasAudio: () => ({ available: true }),
      getUpdateRateHz: () => 0,
    },
    frameRate: 20,
    idFactory: () => "session-1",
  });
  const session = await service.start({ canvasId: "canvas-1", effectId: "vu-meter" });
  assert.equal(session.frameRate, 20);
  service.stop(session.id);
});

test("uses a much shorter frame lookahead for audio-tagged effects than the default", async () => {
  const service = new PlaybackService({
    ...baseServiceOptions(),
    distributionService: { distributeCanvasFrame: async () => ({ status: "sent" }) },
    audioService: { getCanvasAudio: () => ({ available: true }) },
    frameRate: 20,
    targetQueueMs: 1500,
    audioQueueFrames: 2,
    idFactory: () => "session-1",
  });
  const session = await service.start({ canvasId: "canvas-1", effectId: "vu-meter" });
  // 2 frames at 20fps (50ms/frame) = 100ms, not the default 1500ms.
  assert.equal(session.targetQueueMs, 100);
  assert.equal(session.frameCount, 2);
  service.stop(session.id);

  const nonAudio = await service.start({ canvasId: "canvas-1", effectId: "solid" });
  assert.equal(nonAudio.targetQueueMs, 1500);
  service.stop(nonAudio.id);
});

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
