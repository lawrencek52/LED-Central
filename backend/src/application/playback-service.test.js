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
    audioService: {
      getCanvasAudio: () => ({ available: false }),
      hasAudioCapability: () => false,
    },
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
      hasAudioCapability: () => true,
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
      hasAudioCapability: () => true,
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
      hasAudioCapability: () => true,
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
    audioService: {
      getCanvasAudio: () => ({ available: true }),
      hasAudioCapability: () => true,
    },
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

test("an 'audio-optional' effect starts fine with no audio available, at its own requested fps", async () => {
  const renderedParameters = [];
  const service = new PlaybackService({
    canvasService: baseServiceOptions().canvasService,
    effectService: {
      get: (id) =>
        id === "fireworks-show"
          ? { id, renderer: "solid", parameters: {}, tags: ["audio-optional"] }
          : null,
    },
    renderService: {
      render: ({ parameters }) => {
        renderedParameters.push(parameters);
        return { pixels: [[0, 0, 0]] };
      },
    },
    distributionService: { distributeCanvasFrame: async () => ({ status: "sent" }) },
    audioService: {
      getCanvasAudio: () => {
        throw new Error("should not be called when audio is unavailable");
      },
      hasAudioCapability: () => false,
    },
    idFactory: () => "session-1",
  });
  const session = await service.start({ canvasId: "canvas-1", effectId: "fireworks-show", fps: 33 });
  assert.equal(session.status, "playing");
  assert.equal(session.frameRate, 33); // its own requested fps, not paced to telemetry
  assert.equal(renderedParameters[0].audio, undefined);
  service.stop(session.id);
});

test("an 'audio-optional' effect receives live audio when the canvas has it, without being paced to it", async () => {
  const service = new PlaybackService({
    canvasService: baseServiceOptions().canvasService,
    effectService: {
      get: (id) =>
        id === "fireworks-show"
          ? { id, renderer: "solid", parameters: { color: { default: "#ffffff" } }, tags: ["audio-optional"] }
          : null,
    },
    renderService: {
      render: ({ parameters }) => {
        renderedParameters.push(parameters);
        return { pixels: [[0, 0, 0]] };
      },
    },
    distributionService: { distributeCanvasFrame: async () => ({ status: "sent" }) },
    audioService: {
      getCanvasAudio: () => ({ available: true, lastBeatAt: 123 }),
      hasAudioCapability: () => true,
      getUpdateRateHz: () => 47,
    },
    idFactory: () => "session-1",
  });
  const renderedParameters = [];
  const session = await service.start({ canvasId: "canvas-1", effectId: "fireworks-show", fps: 33 });
  // Not re-paced to the 47Hz telemetry rate, unlike a "audio"-tagged effect.
  assert.equal(session.frameRate, 33);
  assert.deepEqual(renderedParameters[0].audio, { available: true, lastBeatAt: 123 });
  service.stop(session.id);
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

test("resolves a mapping's ledsPerMeter from the live controller instead of a stale/null canvas snapshot", async () => {
  const seenLedsPerMeter = [];
  const service = new PlaybackService({
    canvasService: {
      get: (id) =>
        id === "canvas-1"
          ? {
              id,
              width: 1,
              height: 1,
              // Snapshot is null, as it is on a canvas built (or last saved)
              // before the controller's density was known/updated.
              mappings: [{ controllerId: "deck-1", stripIndex: 0, ledsPerMeter: null }],
            }
          : null,
    },
    controllerService: {
      get: (id) => (id === "deck-1" ? { id, ledsPerMeter: [30] } : null),
    },
    effectService: {
      get: (id) =>
        id === "probe"
          ? {
              id,
              renderer: "probe",
              parameters: {},
            }
          : null,
    },
    renderService: {
      render: ({ canvas }) => {
        seenLedsPerMeter.push(canvas.mappings[0].ledsPerMeter);
        return { timestamp: 0, pixels: [[0, 0, 0]] };
      },
    },
    distributionService: {
      distributeCanvasFrame: async () => ({ status: "sent", frameCount: 1, sent: [], failed: [] }),
    },
    idFactory: () => "session-1",
    now: () => 1700000000000,
  });
  const session = await service.start({ canvasId: "canvas-1", effectId: "probe" });
  assert.equal(seenLedsPerMeter[0], 30);
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

test("small, consistent per-tick overhead doesn't accumulate into growing schedule drift", async () => {
  const callTimes = [];
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
      // Every call carries a small, consistent extra delay - real TCP write
      // latency, not a stall - well under `targetQueueMs`, so this never
      // trips the large-deficit catch-up path; it's purely testing whether
      // ordinary per-tick overhead accumulates.
      distributeCanvasFrames: async ({ frames }) => {
        callTimes.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 8));
        return {
          status: "sent",
          frameCount: frames.length,
          sent: [],
          failed: [],
        };
      },
    },
    idFactory: () => "session-1",
    frameRate: 50, // 20ms/frame
    targetQueueMs: 100,
  });

  try {
    const session = await service.start({
      canvasId: "canvas-1",
      effectId: "solid",
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    // The old scheduler rescheduled `intervalMs` after each tick's own work
    // finished, so this steady ~8-10ms/tick of real overhead accumulated in
    // full, call after call (measured: ~9.8ms/call of pure drift, close to
    // the full delay, on the pre-fix code in this exact scenario). The fix
    // doesn't make Node's own timer scheduling perfectly exact - some
    // residual jitter is normal - but it should absorb most of that steady
    // overhead as slack within each 20ms interval rather than carrying all
    // of it forward every single tick. Threshold set well below the old
    // behavior's ~10ms/call but above pure timer noise.
    const first = callTimes[0];
    const last = callTimes[callTimes.length - 1];
    const expectedSpan = (callTimes.length - 1) * 20;
    const actualSpan = last - first;
    assert.ok(
      actualSpan < expectedSpan + (callTimes.length - 1) * 7,
      `expected well under ${(callTimes.length - 1) * 8}ms of accumulated drift (the old code's full per-tick overhead), got ${actualSpan - expectedSpan}ms over ${callTimes.length} calls`,
    );
    service.stop(session.id);
  } finally {
    for (const session of service.list()) service.stop(session.id);
  }
});

test("a large catch-up deficit skips ahead to now instead of bursting every missed frame", async () => {
  const batches = [];
  let slowedOnce = false;
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
        // A long stall (e.g. a wedged TCP write) on the second call - by the
        // time it resolves, the target queue is now hundreds of ms behind
        // session.lastFrameAt at this fast a frame rate.
        if (!slowedOnce && batches.length === 2) {
          slowedOnce = true;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        return {
          status: "sent",
          frameCount: frames.length,
          sent: [],
          failed: [],
        };
      },
    },
    idFactory: () => "session-1",
    frameRate: 100, // 10ms/frame - 300ms of stall is a ~30-frame deficit
    targetQueueMs: 10,
    maxCatchUpFrames: 4,
  });

  try {
    const session = await service.start({
      canvasId: "canvas-1",
      effectId: "solid",
    });
    await new Promise((resolve) => setTimeout(resolve, 400));

    // Sending every one of the ~30 missed frames would be mostly wasted
    // work - NightDriverStrip's firmware discards all but the newest
    // already-due frame it finds buffered when it wakes up to draw, so a
    // big burst is bandwidth spent on frames nobody will ever see, and each
    // extra write is one more chance to hit another stall. Every batch
    // should stay within the configured cap.
    assert.ok(batches.every((size) => size <= 4), `batches: ${batches.join(",")}`);
    service.stop(session.id);
  } finally {
    for (const session of service.list()) service.stop(session.id);
  }
});

test("a large catch-up deficit publishes a playback.catchup event describing the skipped gap", async () => {
  // Regression test for a real reported symptom: the controller freezes for
  // a fraction of a second every so often, but the queue-depth status
  // endpoint reads as normal because it can't see a skipped-ahead gap
  // (session.lastFrameAt is deliberately re-anchored to "now + targetQueueMs"
  // right when the gap is created). This event is the one place that gap is
  // ever surfaced, so it needs to actually fire with a sane, positive gapMs.
  const events = [];
  let callCount = 0;
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
          ? { id, renderer: "solid", parameters: { color: { default: "#ffffff" } } }
          : null,
    },
    renderService: new EffectRenderService(),
    distributionService: {
      distributeCanvasFrames: async ({ frames }) => {
        callCount += 1;
        // A long stall on the second call, same setup as the sibling test
        // above - by the time it resolves, the target queue is hundreds of
        // ms behind session.lastFrameAt at this fast a frame rate.
        if (callCount === 2) await new Promise((resolve) => setTimeout(resolve, 300));
        return { status: "sent", frameCount: frames.length, sent: [], failed: [] };
      },
    },
    eventHub: { publish: (event) => events.push(event) },
    idFactory: () => "session-1",
    frameRate: 100,
    targetQueueMs: 10,
    maxCatchUpFrames: 4,
  });

  try {
    const session = await service.start({ canvasId: "canvas-1", effectId: "solid" });
    await new Promise((resolve) => setTimeout(resolve, 400));

    const catchupEvents = events.filter((event) => event.type === "playback.catchup");
    assert.ok(catchupEvents.length >= 1, "expected at least one playback.catchup event");
    const event = catchupEvents[0];
    assert.equal(event.payload.sessionId, "session-1");
    assert.equal(event.payload.canvasId, "canvas-1");
    assert.ok(event.payload.framesBehind > service.maxCatchUpFrames);
    assert.ok(
      event.payload.gapMs > 0,
      `expected a positive skipped gap, got ${event.payload.gapMs}`,
    );
    service.stop(session.id);
  } finally {
    for (const session of service.list()) service.stop(session.id);
  }
});
