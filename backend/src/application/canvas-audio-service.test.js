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

test("calibrates raw FFT magnitude against referenceMagnitude into a 0..1 amplitude", () => {
  const telemetry = new Map([
    ["deck-a", { rawBands: [50], vu: 0, vuRatio: 0, vuRatioFade: 0, beatSeq: 0, bpm: 0, receivedAt: 0 }],
  ]);
  const service = new CanvasAudioService({
    telemetrySource: makeTelemetrySource(telemetry),
    bandCount: 1,
    referenceMagnitude: 100,
    now: () => 0,
  });
  const canvas = { id: "canvas-1", mappings: [{ controllerId: "deck-a" }] };
  const audio = service.getCanvasAudio(canvas);
  assert.equal(audio.available, true);
  assert.equal(audio.peaks[0], 0.5); // 50 / 100 reference
});

test("resamples the fixed-16-band raw telemetry and averages across a canvas's controllers", () => {
  let now = 1000;
  const telemetry = new Map([
    ["deck-a", { rawBands: [1, 0], vu: 0.4, vuRatio: 0.2, vuRatioFade: 0.2, beatSeq: 1, bpm: 120, receivedAt: now }],
    ["deck-b", { rawBands: [0, 1, 0, 1], vu: 0.6, vuRatio: 0.4, vuRatioFade: 0.4, beatSeq: 1, bpm: 100, receivedAt: now }],
  ]);
  const service = new CanvasAudioService({
    telemetrySource: makeTelemetrySource(telemetry),
    bandCount: 4,
    referenceMagnitude: 1,
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
    ["deck-a", { rawBands: [1], vu: 1, vuRatio: 1, vuRatioFade: 1, beatSeq: 1, bpm: 120, receivedAt: now - 5000 }],
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
    ["deck-a", { rawBands: [0], vu: 0, vuRatio: 0, vuRatioFade: 0, beatSeq: 1, bpm: 120, beatConfidence: 0.9, receivedAt: now }],
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

test("the bar (peaks) reads live every tick, with no attack/release damping", () => {
  let now = 0;
  const telemetry = new Map([
    ["deck-a", { rawBands: [1], vu: 0, vuRatio: 0, vuRatioFade: 0, beatSeq: 0, bpm: 0, receivedAt: now }],
  ]);
  const service = new CanvasAudioService({
    telemetrySource: makeTelemetrySource(telemetry),
    bandCount: 1,
    referenceMagnitude: 1,
    now: () => now,
  });
  const canvas = { id: "canvas-1", mappings: [{ controllerId: "deck-a" }] };

  assert.equal(service.getCanvasAudio(canvas).peaks[0], 1);

  telemetry.get("deck-a").rawBands = [0.2];
  now = 10; // an instant later - the bar should already reflect the new value
  telemetry.get("deck-a").receivedAt = now;
  assert.equal(service.getCanvasAudio(canvas).peaks[0], 0.2);
});

test("peak-hold jumps instantly to a new peak, holds, then falls smoothly at a constant dB rate", () => {
  let now = 0;
  const telemetry = new Map([
    ["deck-a", { rawBands: [1], vu: 0, vuRatio: 0, vuRatioFade: 0, beatSeq: 0, bpm: 0, receivedAt: now }],
  ]);
  const service = new CanvasAudioService({
    telemetrySource: makeTelemetrySource(telemetry),
    bandCount: 1,
    referenceMagnitude: 1,
    peakHoldMs: 500,
    peakDecayDbPerSecond: 1,
    now: () => now,
  });
  const canvas = { id: "canvas-1", mappings: [{ controllerId: "deck-a" }] };

  const peaked = service.getCanvasAudio(canvas);
  assert.equal(peaked.peaksDecayed[0], 1); // instant rise

  telemetry.get("deck-a").rawBands = [0];
  now = 300; // still within the 500ms hold window
  telemetry.get("deck-a").receivedAt = now;
  const held = service.getCanvasAudio(canvas);
  assert.equal(held.peaksDecayed[0], 1, "peak should still be held");
  assert.equal(held.peaks[0], 0, "the live bar should already reflect silence though");

  now = 600; // 100ms past the hold deadline, at 1dB/sec: a small, smooth dip - not a jump
  telemetry.get("deck-a").receivedAt = now;
  const justStarting = service.getCanvasAudio(canvas);
  assert.ok(
    justStarting.peaksDecayed[0] < 1 && justStarting.peaksDecayed[0] > 0.98,
    "100ms of 1dB/sec decay should barely move the marker, not jump",
  );

  // A full-scale peak takes ~64s to fall off the bottom of the display at
  // 1dB/sec, since the display's own dynamic range is 64dB - i.e. the same
  // constant dB/sec rate takes visibly longer to cross a longer LED strip
  // (more LEDs per dB) and shorter to cross a shorter one, without the
  // service needing to know strip length at all.
  now = 500 + 64_000;
  telemetry.get("deck-a").receivedAt = now;
  const fullyFallen = service.getCanvasAudio(canvas);
  assert.ok(
    fullyFallen.peaksDecayed[0] < 0.001,
    "after ~64s at 1dB/sec a full-scale peak should have fallen off the bottom of the 64dB display range",
  );
});

test("AGC is disabled by default - a loud signal isn't gain-adjusted toward the target", () => {
  let now = 0;
  const telemetry = new Map([
    ["deck-a", { rawBands: [1], vu: 0, vuRatio: 0, vuRatioFade: 0, beatSeq: 0, bpm: 0, receivedAt: now }],
  ]);
  const service = new CanvasAudioService({
    telemetrySource: makeTelemetrySource(telemetry),
    bandCount: 1,
    referenceMagnitude: 1,
    now: () => now,
  });
  const canvas = { id: "canvas-1", mappings: [{ controllerId: "deck-a" }] };

  now = 60000; // comfortably more than the AGC's ~30s time constant, if it were enabled
  telemetry.get("deck-a").receivedAt = now;
  const audio = service.getCanvasAudio(canvas);
  assert.equal(audio.peaks[0], 1, "gain should stay fixed at 1x with AGC off");
});

test("AGC, when enabled, slowly raises gain toward the midpoint of the dB display range", () => {
  // Target is ~50% *up the 64dB display range* (-32dB, ~0.0251 linear
  // amplitude) - not 50% raw linear amplitude - so it stays consistent with
  // the renderers' own dB-linear LED mapping. 0.01 is below that target, so
  // gain should climb (slowly - ~30s time constant) to bring it up to ~0.0251.
  let now = 0;
  const telemetry = new Map([
    ["deck-a", { rawBands: [0.01, 0.01], vu: 0, vuRatio: 0, vuRatioFade: 0, beatSeq: 0, bpm: 0, receivedAt: now }],
  ]);
  const service = new CanvasAudioService({
    telemetrySource: makeTelemetrySource(telemetry),
    bandCount: 2,
    referenceMagnitude: 1,
    agcEnabled: true,
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

test("AGC, when enabled, ducks gain quickly (fast attack) on a loud transient instead of clipping at max", () => {
  // Simulates gain having drifted up to its ceiling (8x) during silence, then
  // a loud clap (raw amplitude 1.0, i.e. full scale) arriving. A slow
  // attack would keep 1.0 * 8 clamped at max brightness for as long as it
  // takes the *raw* signal to fall below 1/8 - which could look like the
  // display sitting pinned at full brightness for a second or more even
  // though the actual acoustic transient decays much faster. Fast attack
  // should duck gain back down within a couple hundred milliseconds instead.
  let now = 0;
  const telemetry = new Map([
    ["deck-a", { rawBands: [1, 1], vu: 0, vuRatio: 0, vuRatioFade: 0, beatSeq: 0, bpm: 0, receivedAt: now }],
  ]);
  const service = new CanvasAudioService({
    telemetrySource: makeTelemetrySource(telemetry),
    bandCount: 2,
    referenceMagnitude: 1,
    agcEnabled: true,
    now: () => now,
  });
  const canvas = { id: "canvas-1", mappings: [{ controllerId: "deck-a" }] };
  service.canvasStates.set("canvas-1", {
    peakHold: [0, 0],
    peakHeldAt: [-Infinity, -Infinity],
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
