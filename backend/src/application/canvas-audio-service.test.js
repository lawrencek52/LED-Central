import test from "node:test";
import assert from "node:assert/strict";
import { CanvasAudioService } from "./canvas-audio-service.js";

function makeTelemetrySource(telemetryByController) {
  return {
    getAudioTelemetry: (controllerId) => telemetryByController.get(controllerId) ?? null,
  };
}

test("reports unavailable when no controller on the canvas has telemetry", () => {
  const service = new CanvasAudioService({
    telemetrySource: makeTelemetrySource(new Map()),
    now: () => 1000,
  });
  const canvas = { id: "canvas-1", mappings: [{ controllerId: "deck-1" }] };
  const audio = service.getCanvasAudio(canvas);
  assert.equal(audio.available, false);
  assert.equal(audio.peaksDecayed.length, 16);
});

test("resamples differing band counts and averages across a canvas's controllers", () => {
  let now = 1000;
  const telemetry = new Map([
    ["deck-a", { peaks: [1, 0], vu: 0.4, vuRatio: 0.2, vuRatioFade: 0.2, beatSeq: 1, bpm: 120, receivedAt: now }],
    ["deck-b", { peaks: [0, 1, 0, 1], vu: 0.6, vuRatio: 0.4, vuRatioFade: 0.4, beatSeq: 1, bpm: 100, receivedAt: now }],
  ]);
  const service = new CanvasAudioService({
    telemetrySource: makeTelemetrySource(telemetry),
    bandCount: 4,
    now: () => now,
  });
  const canvas = {
    id: "canvas-1",
    mappings: [{ controllerId: "deck-a" }, { controllerId: "deck-b" }],
  };
  const audio = service.getCanvasAudio(canvas);
  assert.equal(audio.available, true);
  assert.equal(audio.peaks.length, 4);
  assert.equal(audio.vu, 0.5);
});

test("ignores telemetry from a controller that hasn't reported recently", () => {
  let now = 1000;
  const telemetry = new Map([
    ["deck-a", { peaks: [1], vu: 1, vuRatio: 1, vuRatioFade: 1, beatSeq: 1, bpm: 120, receivedAt: now - 5000 }],
  ]);
  const service = new CanvasAudioService({
    telemetrySource: makeTelemetrySource(telemetry),
    bandCount: 1,
    now: () => now,
  });
  const canvas = { id: "canvas-1", mappings: [{ controllerId: "deck-a" }] };
  const audio = service.getCanvasAudio(canvas);
  assert.equal(audio.available, false);
});

test("fires a canvas-level beat when any controller's beatSeq advances, decays otherwise", () => {
  let now = 1000;
  const telemetry = new Map([
    ["deck-a", { peaks: [0], vu: 0, vuRatio: 0, vuRatioFade: 0, beatSeq: 1, bpm: 120, beatConfidence: 0.9, receivedAt: now }],
  ]);
  const service = new CanvasAudioService({
    telemetrySource: makeTelemetrySource(telemetry),
    bandCount: 1,
    now: () => now,
  });
  const canvas = { id: "canvas-1", mappings: [{ controllerId: "deck-a" }] };

  const first = service.getCanvasAudio(canvas);
  assert.equal(first.lastBeatAt, 1000);
  assert.equal(first.beatConfidence, 0.9);

  now = 1050;
  const second = service.getCanvasAudio(canvas); // same beatSeq, no new beat
  assert.equal(second.lastBeatAt, 1000);

  now = 2000;
  telemetry.get("deck-a").beatSeq = 2;
  telemetry.get("deck-a").receivedAt = now;
  const third = service.getCanvasAudio(canvas);
  assert.equal(third.lastBeatAt, 2000);
});

test("decays per-band peaks over elapsed time and raises them to new highs", () => {
  let now = 0;
  const telemetry = new Map([
    ["deck-a", { peaks: [1], vu: 0, vuRatio: 0, vuRatioFade: 0, beatSeq: 0, bpm: 0, receivedAt: now }],
  ]);
  const service = new CanvasAudioService({
    telemetrySource: makeTelemetrySource(telemetry),
    bandCount: 1,
    decayRatePerSecond: 1,
    agcAttackRatePerSecond: 0,
    agcReleaseRatePerSecond: 0, // isolate decay from the AGC's gain adjustments
    now: () => now,
  });
  const canvas = { id: "canvas-1", mappings: [{ controllerId: "deck-a" }] };

  const peaked = service.getCanvasAudio(canvas);
  assert.equal(peaked.peaksDecayed[0], 1);

  telemetry.get("deck-a").peaks = [0];
  now = 500; // 0.5s elapsed at a decay rate of 1/sec -> peak drops by 0.5
  telemetry.get("deck-a").receivedAt = now;
  const decaying = service.getCanvasAudio(canvas);
  assert.equal(decaying.peaksDecayed[0], 0.5);

  telemetry.get("deck-a").peaks = [0.9];
  now = 600; // a fresh high raises the decayed value back up immediately
  telemetry.get("deck-a").receivedAt = now;
  const raised = service.getCanvasAudio(canvas);
  assert.equal(raised.peaksDecayed[0], 0.9);
});

test("AGC slowly raises gain toward the midpoint of the dB display range instead of jumping there", () => {
  // Target is ~50% *up the 64dB display range* (-32dB, ~0.0251 linear
  // amplitude) - not 50% raw linear amplitude - so it stays consistent with
  // the renderers' own dB-linear LED mapping. 0.01 is below that target, so
  // gain should climb (slowly - ~30s time constant) to bring it up to ~0.0251.
  let now = 0;
  const telemetry = new Map([
    ["deck-a", { peaks: [0.01, 0.01], vu: 0, vuRatio: 0, vuRatioFade: 0, beatSeq: 0, bpm: 0, receivedAt: now }],
  ]);
  const service = new CanvasAudioService({
    telemetrySource: makeTelemetrySource(telemetry),
    bandCount: 2,
    now: () => now,
  });
  const canvas = { id: "canvas-1", mappings: [{ controllerId: "deck-a" }] };

  const first = service.getCanvasAudio(canvas); // state just created, elapsed=0 -> gain still 1
  assert.equal(first.peaks[0], 0.01);

  now = 1000;
  telemetry.get("deck-a").receivedAt = now;
  const afterOneSecond = service.getCanvasAudio(canvas);
  assert.ok(afterOneSecond.peaks[0] > first.peaks[0], "gain should start rising toward the target");
  assert.ok(afterOneSecond.peaks[0] < 0.015, "gain moves slowly, shouldn't get far in 1s of a ~30s ramp");

  now = 60000; // comfortably more than the ~30s time constant
  telemetry.get("deck-a").receivedAt = now;
  const later = service.getCanvasAudio(canvas);
  assert.ok(
    later.peaks[0] > 0.024 && later.peaks[0] <= 0.0252,
    "gain should have converged near the dB-range midpoint",
  );
});

test("AGC ducks gain quickly (fast attack) when a loud transient hits, instead of clipping at max", () => {
  // Simulates gain having drifted up to its ceiling (8x) during silence, then
  // a loud clap (raw amplitude 1.0, i.e. full scale) arriving. A slow
  // attack would keep 1.0 * 8 clamped at max brightness for as long as it
  // takes the *raw* signal to fall below 1/8 - which could look like the
  // display sitting pinned at full brightness for a second or more even
  // though the actual acoustic transient decays much faster. Fast attack
  // should duck gain back down within a couple hundred milliseconds instead.
  let now = 0;
  const telemetry = new Map([
    ["deck-a", { peaks: [1, 1], vu: 0, vuRatio: 0, vuRatioFade: 0, beatSeq: 0, bpm: 0, receivedAt: now }],
  ]);
  const service = new CanvasAudioService({
    telemetrySource: makeTelemetrySource(telemetry),
    bandCount: 2,
    now: () => now,
  });
  const canvas = { id: "canvas-1", mappings: [{ controllerId: "deck-a" }] };
  service.canvasStates.set("canvas-1", {
    peaksDecayed: [0, 0],
    gain: 8, // as if it had drifted to the ceiling during a preceding silence
    lastUpdateAt: 0,
    lastBeatSeqByController: new Map(),
    lastBeatAt: null,
    beatSeq: 0,
  });

  const atImpact = service.getCanvasAudio(canvas);
  assert.equal(atImpact.peaks[0], 1); // clamped at full brightness at the instant of impact

  now = 300; // just 300ms later
  telemetry.get("deck-a").receivedAt = now;
  const afterAttack = service.getCanvasAudio(canvas);
  assert.ok(
    afterAttack.peaks[0] < 0.5,
    "gain should have ducked down well within a second, not stayed pinned at max",
  );
});
