import test from "node:test";
import assert from "node:assert/strict";
import { EffectRenderService } from "./effect-render-service.js";

test("renders a solid effect across the canvas", () => {
  const frame = new EffectRenderService().render({
    effect: {
      renderer: "solid",
      parameters: { color: { default: "#12abef" } },
    },
    canvas: { width: 2, height: 2 },
  });
  assert.deepEqual(frame.pixels, [
    [18, 171, 239],
    [18, 171, 239],
    [18, 171, 239],
    [18, 171, 239],
  ]);
});

test("renders gradient endpoints", () => {
  const frame = new EffectRenderService().render({
    effect: {
      renderer: "gradient",
      parameters: {
        startColor: { default: "#ff0000" },
        endColor: { default: "#0000ff" },
        angle: { default: 0 },
      },
    },
    canvas: { width: 3, height: 1 },
  });
  assert.deepEqual(frame.pixels, [
    [255, 0, 0],
    [128, 0, 128],
    [0, 0, 255],
  ]);
});

test("renders palette-scroll effect output with the expected pixel count", () => {
  const frame = new EffectRenderService().render({
    effect: {
      renderer: "palette-scroll",
      parameters: {
        palette: {
          default: { colors: ["#ff0000", "#00ff00", "#0000ff"], blend: false },
        },
        ledColorPerSecond: { default: 0 },
        ledScrollSpeed: { default: 0 },
        density: { default: 1 },
        everyNthDot: { default: 1 },
        dotSize: { default: 1 },
        rampedColor: { default: false },
        brightness: { default: 1 },
        mirrored: { default: false },
      },
    },
    canvas: { width: 4, height: 1 },
  });
  assert.equal(frame.pixels.length, 4);
  assert.ok(
    frame.pixels.every((pixel) => Array.isArray(pixel) && pixel.length === 3),
  );
});

test("renders starfield effect with zero stars as black", () => {
  const frame = new EffectRenderService().render({
    effect: {
      renderer: "starfield",
      parameters: { starCount: { default: 0 } },
    },
    canvas: { width: 3, height: 2 },
  });
  assert.equal(frame.pixels.length, 6);
  assert.ok(
    frame.pixels.every((pixel) => pixel.every((channel) => channel === 0)),
  );
});

test("renders visible Starfield stars on a one-row canvas", () => {
  const frame = new EffectRenderService().render({
    effect: {
      renderer: "starfield",
      parameters: { starCount: { default: 100 } },
    },
    canvas: { width: 100, height: 1 },
    parameters: { timeSeconds: 0.5 },
    timestamp: 500,
  });
  assert.ok(frame.pixels.some((pixel) => pixel.some((channel) => channel > 0)));
});

test("renders parallel mappings as independent strip effects", () => {
  const service = new EffectRenderService();
  const canvas = {
    width: 40,
    height: 2,
    mappings: [
      { controllerId: "deck-a", stripIndex: 0, layout: "parallel", x: 0, y: 0, width: 40, height: 1 },
      { controllerId: "deck-b", stripIndex: 1, layout: "parallel", x: 0, y: 1, width: 40, height: 1 },
    ],
  };
  const solid = service.render({
    effect: { renderer: "solid", parameters: { color: { default: "#123456" } } },
    canvas,
  });
  assert.deepEqual(solid.pixels.slice(0, 40), solid.pixels.slice(40));

  const stars = service.render({
    effect: { renderer: "starfield", parameters: { starCount: { default: 100 } } },
    canvas,
    parameters: { timeSeconds: 0.5 },
    timestamp: 500,
  });
  assert.ok(stars.pixels.slice(0, 40).some((pixel) => pixel.some(Boolean)));
  assert.ok(stars.pixels.slice(40).some((pixel) => pixel.some(Boolean)));
  assert.notDeepEqual(stars.pixels.slice(0, 40), stars.pixels.slice(40));
});

test("nds-bouncing-balls animates via kinematics instead of freezing at position 0", () => {
  const service = new EffectRenderService();
  const canvas = { width: 40, height: 1 };
  const effect = {
    renderer: "nds-bouncing-balls",
    parameters: {
      ballCount: { default: 3 },
      ballSize: { default: 2 },
      mirrored: { default: false },
    },
  };

  const frameA = service.render({
    effect,
    canvas,
    parameters: { timeSeconds: 0 },
  });
  const frameB = service.render({
    effect,
    canvas,
    parameters: { timeSeconds: 2 },
  });

  assert.notDeepEqual(frameA.pixels, frameB.pixels);
  assert.ok(frameB.pixels.some((pixel) => pixel.some((channel) => channel)));
});

test("nds-bouncing-balls' reversed parameter mirrors which end a single source bounces from", () => {
  const width = 30;
  const service = new EffectRenderService();
  const canvas = { width, height: 1 };
  const baseParameters = {
    ballCount: { default: 2 },
    ballSize: { default: 2 },
    mirrored: { default: false },
  };
  const forward = service.render({
    effect: {
      renderer: "nds-bouncing-balls",
      parameters: { ...baseParameters, reversed: { default: false } },
    },
    canvas,
    parameters: { timeSeconds: 3.7 },
  });
  const reversed = service.render({
    effect: {
      renderer: "nds-bouncing-balls",
      parameters: { ...baseParameters, reversed: { default: true } },
    },
    canvas,
    parameters: { timeSeconds: 3.7 },
  });
  // Flipping `reversed` bounces the same single source from the opposite end
  // of the strip, so the whole frame should be the horizontal mirror image.
  assert.deepEqual(reversed.pixels, [...forward.pixels].reverse());
});

test("nds-bouncing-balls' mirrored output doesn't depend on reversed (both ends are drawn either way)", () => {
  const width = 30;
  const service = new EffectRenderService();
  const canvas = { width, height: 1 };
  const baseParameters = {
    ballCount: { default: 2 },
    ballSize: { default: 2 },
    mirrored: { default: true },
  };
  const notReversed = service.render({
    effect: {
      renderer: "nds-bouncing-balls",
      parameters: { ...baseParameters, reversed: { default: false } },
    },
    canvas,
    parameters: { timeSeconds: 3.7 },
  });
  const reversed = service.render({
    effect: {
      renderer: "nds-bouncing-balls",
      parameters: { ...baseParameters, reversed: { default: true } },
    },
    canvas,
    parameters: { timeSeconds: 3.7 },
  });
  assert.deepEqual(reversed.pixels, notReversed.pixels);
});

test("twinkle-stars uses its configured palette after the ignition flash", () => {
  const frame = new EffectRenderService().render({
    effect: {
      renderer: "twinkle-stars",
      parameters: {
        palette: { default: { colors: ["#ff0000"] } },
        variant: { default: "quiet" },
        probability: { default: 1 },
        starSize: { default: 1 },
        maxSpeed: { default: 0 },
      },
    },
    canvas: { width: 100, height: 1 },
    timestamp: 1000,
  });

  const litPixels = frame.pixels.filter((pixel) =>
    pixel.some((channel) => channel),
  );
  assert.ok(litPixels.length > 0);
  assert.ok(
    litPixels.every(
      ([red, green, blue]) => red > 0 && green === 0 && blue === 0,
    ),
  );
});

test("vu-meter grows a symmetric bar from vuRatioFade and flashes on a recent beat", () => {
  const service = new EffectRenderService();
  const canvas = { width: 10, height: 1 };
  const quiet = service.render({
    effect: { renderer: "vu-meter", parameters: {} },
    canvas,
    parameters: { audio: { vuRatioFade: 0, lastBeatAt: null } },
    timestamp: 1000,
  });
  assert.ok(quiet.pixels.every((pixel) => pixel.every((channel) => channel === 0)));

  const loud = service.render({
    effect: { renderer: "vu-meter", parameters: {} },
    canvas,
    parameters: { audio: { vuRatioFade: 2, lastBeatAt: 950 } },
    timestamp: 1000,
  });
  assert.ok(loud.pixels.some((pixel) => pixel.some(Boolean)));
  // A beat 50ms in the past fades a white flash onto the bar's outer tips
  // (fade = 1 - 50/120, so channel = round(255 * fade) = 149).
  assert.deepEqual(loud.pixels[0], [149, 149, 149]);
  assert.deepEqual(loud.pixels[9], [149, 149, 149]);
});

test("spectrum-bars draws taller bars for louder bands, linear in dB", () => {
  const service = new EffectRenderService();
  const canvas = { width: 8, height: 20 };
  // Spread across the dB range (silent, -40dB, -20dB, 0dB) rather than
  // clustered near full scale, where a linear-amplitude spread like
  // [0.5, 1] would compress to nearly the same bar height once mapped
  // logarithmically. No peaksDecayed, so there's no peak-hold marker to
  // interfere with reading each band's own live bar height. The bar is a
  // live fire simulation, so individual lit cells can legitimately flicker
  // dark - what's deterministic is that the renderer never draws anything
  // *above* a band's computed height, so the row right above each bar is
  // guaranteed black regardless of the fire underneath.
  const levels = [0, 0.01, 0.1, 1];
  const frame = service.render({
    effect: { renderer: "spectrum-bars", parameters: { bandCount: { default: 4 } } },
    canvas,
    parameters: { timeSeconds: 5, audio: { bandCount: 4, peaks: levels } },
    timestamp: 5000,
  });
  const isBlack = (pixel) => pixel.every((channel) => channel === 0);
  const pixelAt = (x, row) => frame.pixels[(canvas.height - 1 - row) * canvas.width + x];
  // silent -> the silence floor alone gives a height-3 bar (out of 20)
  assert.ok(isBlack(pixelAt(0, 3)));
  // -40dB -> height 6
  assert.ok(isBlack(pixelAt(2, 6)));
  // -20dB -> height 13
  assert.ok(isBlack(pixelAt(4, 13)));
  // 0dB (full scale) fills the whole strip - nothing above it to check.
});

test("spectrum-bars draws a red peak-hold cap above the live bar when it's fallen since the peak", () => {
  const service = new EffectRenderService();
  const canvas = { width: 4, height: 4 };
  const frame = service.render({
    effect: { renderer: "spectrum-bars", parameters: { bandCount: { default: 1 } } },
    canvas,
    // Live level has since dropped to near-silent (floors to a 1-row bar),
    // but the peak-hold marker is still up near full scale.
    parameters: { timeSeconds: 5, audio: { bandCount: 1, peaks: [0.001], peaksDecayed: [1] } },
    timestamp: 5000,
  });
  const column = Array.from({ length: 4 }, (_, y) => frame.pixels[y * 4]);
  assert.deepEqual(column[0], [255, 0, 0]); // top row: the peak-hold cap
  assert.deepEqual(column[1], [0, 0, 0]);
  assert.deepEqual(column[2], [0, 0, 0]);
});

test("spectrum-bars widens the peak-hold cap to 2 pixels once the strip is over 100 LEDs", () => {
  const service = new EffectRenderService();
  const canvas = { width: 4, height: 120 };
  const frame = service.render({
    effect: { renderer: "spectrum-bars", parameters: { bandCount: { default: 1 } } },
    canvas,
    parameters: { timeSeconds: 5, audio: { bandCount: 1, peaks: [0], peaksDecayed: [1] } },
    timestamp: 5000,
  });
  const column = Array.from({ length: 120 }, (_, y) => frame.pixels[y * 4]);
  assert.deepEqual(column[0], [255, 0, 0]);
  assert.deepEqual(column[1], [255, 0, 0]);
  assert.deepEqual(column[2], [0, 0, 0]); // between the marker and the silence floor's own glow further down
});

function fireParameters(overrides = {}) {
  return {
    cooling: { default: 3 },
    sparking: { default: 100 },
    sparks: { default: 3 },
    sparkHeight: { default: 4 },
    reversed: { default: true },
    mirrored: { default: false },
    minHeightFraction: { default: 0.2 },
    averageHeightFraction: { default: 0.7 },
    maxHeightFraction: { default: 1 },
    heightWaveSeconds: { default: 25 },
    neighborBlend: { default: 0.2 },
    ...overrides,
  };
}

test("fire stays within its configured height ceiling and doesn't light the far end when unmirrored", () => {
  const width = 40;
  const service = new EffectRenderService();
  const farIndex = width - 1;
  for (const timeSeconds of [1, 4.5, 9.3, 20, 44.1]) {
    const frame = service.render({
      effect: {
        renderer: "fire",
        parameters: fireParameters({
          minHeightFraction: { default: 0.5 },
          averageHeightFraction: { default: 0.5 },
          maxHeightFraction: { default: 0.5 },
          neighborBlend: { default: 0 },
        }),
      },
      canvas: { width, height: 1 },
      parameters: { timeSeconds },
    });
    // The ceiling sits at 50% of the strip; the far end (display index 0 is
    // the source, since `reversed` puts it at the strip's start) is far
    // beyond the ceiling plus its falloff, so it must stay unlit.
    assert.deepEqual(frame.pixels[farIndex], [0, 0, 0]);
  }
});

test("fire blends neighboring rows together when neighborBlend is enabled", () => {
  const width = 30;
  const service = new EffectRenderService();
  const frame = service.render({
    effect: {
      renderer: "fire",
      parameters: fireParameters({ neighborBlend: { default: 1 } }),
    },
    canvas: { width, height: 3 },
    parameters: { timeSeconds: 5 },
  });
  const row0 = frame.pixels.slice(0, width);
  const row2 = frame.pixels.slice(2 * width, 3 * width);
  // With full neighbor blending, both edge rows end up entirely derived from
  // the middle row's pre-blend heat (each has only that one neighbor), so
  // they must match exactly even though each row's own sparks are random.
  assert.deepEqual(row0, row2);
});

test("fire rows are independent (not just duplicated) when neighborBlend is off", () => {
  const width = 30;
  const service = new EffectRenderService();
  const frame = service.render({
    effect: {
      renderer: "fire",
      parameters: fireParameters({ neighborBlend: { default: 0 } }),
    },
    canvas: { width, height: 3 },
    parameters: { timeSeconds: 5 },
  });
  const row0 = frame.pixels.slice(0, width);
  const row1 = frame.pixels.slice(width, 2 * width);
  assert.notDeepEqual(row0, row1);
});

test("musical-fire renders valid pixels with and without a recent beat", () => {
  const service = new EffectRenderService();
  const canvas = { width: 20, height: 1 };
  const effect = {
    renderer: "musical-fire",
    parameters: {
      cooling: { default: 3 },
      sparking: { default: 100 },
      sparks: { default: 3 },
      sparkHeight: { default: 4 },
      beatSparkBoost: { default: 60 },
      mirrored: { default: false },
    },
  };
  const noBeat = service.render({
    effect,
    canvas,
    parameters: { timeSeconds: 5, audio: { vu: 0, lastBeatAt: null } },
    timestamp: 5000,
  });
  const onBeat = service.render({
    effect,
    canvas,
    parameters: { timeSeconds: 5, audio: { vu: 1, lastBeatAt: 4900 } },
    timestamp: 5000,
  });
  for (const frame of [noBeat, onBeat]) {
    assert.equal(frame.pixels.length, 20);
    assert.ok(frame.pixels.every((pixel) => Array.isArray(pixel) && pixel.length === 3));
  }
});

function assertValidRgb(pixel) {
  assert.equal(pixel.length, 3);
  for (const channel of pixel) assert.ok(channel >= 0 && channel <= 255);
}

test("spectrum-band lights a fire-driven level bar plus a separate peak-hold marker", () => {
  const service = new EffectRenderService();
  const canvas = { width: 10, height: 1 };
  const frame = service.render({
    effect: { renderer: "spectrum-band", parameters: {} },
    canvas,
    parameters: { timeSeconds: 5, bandIndex: 0, audio: { peaks: [0.3], peaksDecayed: [0.8] } },
    timestamp: 5000,
  });
  // Level and peak are mapped linearly in dB across a 64dB range, not raw
  // linear amplitude, so 0.3 (-10.5dB) lights 8 of 10 pixels and 0.8 (-1.9dB,
  // near full scale) puts the peak marker at the very end. The lit pixels
  // are a live fire simulation rather than a static gradient, so their exact
  // colors vary - only the boundary (dark above the level, red at the peak)
  // and general shape are asserted.
  assert.deepEqual(frame.pixels[8], [0, 0, 0]); // just above the lit range
  assert.deepEqual(frame.pixels[9], [255, 0, 0]); // the peak-hold marker
  frame.pixels.slice(0, 8).forEach(assertValidRgb);
  assert.ok(
    frame.pixels.slice(0, 8).some((pixel) => pixel.some(Boolean)),
    "the fire should actually be lit somewhere within the level bar",
  );
});

test("spectrum-band's fire stays visible near a quiet level's own tip on a long strip, not frozen black", () => {
  // Regression test: on a 215+ LED strip, a quiet/floor-level reading gives a
  // small litCount (here, silence with no telemetry - peaks/peaksDecayed
  // empty, per CanvasAudioService's unavailable snapshot) that sits far from
  // the physical strip's high-index end. Sparks must anchor to the visible
  // tip (litCount - 1), not the strip's end, or heat never reaches the
  // visible region within the fire's ~3s simulation window and the display
  // renders as permanently black except for the static peak marker - exactly
  // what was reported as a "frozen" display on 215-LED strips (never seen on
  // shorter strips, where the same floor litCount sits close enough to the
  // strip's end for sparks to still reach it).
  const service = new EffectRenderService();
  const canvas = { width: 215, height: 1 };
  const audio = { peaks: [], peaksDecayed: [] };
  const hashes = new Set();
  for (const timeSeconds of [0, 2, 5, 10, 20, 30]) {
    const frame = service.render({
      effect: { renderer: "spectrum-band", parameters: {} },
      canvas,
      parameters: { timeSeconds, audio },
      timestamp: timeSeconds * 1000,
    });
    hashes.add(JSON.stringify(frame.pixels));
  }
  assert.ok(
    hashes.size > 1,
    "the rendered frame should change over time instead of staying frozen",
  );
});

test("spectrum-band widens the peak-hold marker to 2 pixels once the strip is over 100 LEDs", () => {
  const service = new EffectRenderService();
  const canvas = { width: 120, height: 1 };
  const frame = service.render({
    effect: { renderer: "spectrum-band", parameters: {} },
    canvas,
    parameters: { timeSeconds: 5, audio: { peaks: [0], peaksDecayed: [1] } },
    timestamp: 5000,
  });
  // Full-scale peak -> marker at the last index, widened one pixel toward
  // the base so it never runs off the strip's end.
  assert.deepEqual(frame.pixels[119], [255, 0, 0]);
  assert.deepEqual(frame.pixels[118], [255, 0, 0]);
  assert.deepEqual(frame.pixels[117], [0, 0, 0]);
});

test("assigns each parallel strip its own contiguous bandIndex for spectrum-band", () => {
  const service = new EffectRenderService();
  const canvas = {
    width: 4,
    height: 2,
    mappings: [
      { controllerId: "deck-a", stripIndex: 0, layout: "parallel", x: 0, y: 0, width: 4, height: 1 },
      { controllerId: "deck-b", stripIndex: 1, layout: "parallel", x: 0, y: 1, width: 4, height: 1 },
    ],
  };
  const frame = service.render({
    effect: { renderer: "spectrum-band", parameters: {} },
    canvas,
    parameters: {
      timeSeconds: 5,
      audio: { bandCount: 2, peaks: [1, 0], peaksDecayed: [1, 0] },
    },
    timestamp: 5000,
  });
  // Strip 0 (row 0) gets bandIndex 0 (full level + peak marker, on a live
  // fire rather than a static gradient); strip 1 (row 1) gets bandIndex 1,
  // whose band is silent - the silence floor still puts a small peak
  // marker at its first pixel (peaks and peaksDecayed of 0 both floor to
  // the same fraction), but nothing beyond that.
  assert.deepEqual(frame.pixels[3], [255, 0, 0]); // peak marker at full scale
  frame.pixels.slice(0, 3).forEach(assertValidRgb);
  assert.ok(frame.pixels.slice(0, 3).some((pixel) => pixel.some(Boolean)));
  assert.deepEqual(frame.pixels.slice(4, 8), [
    [255, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]);
});

test("groups multiple telemetry bands per strip: level averages the group, peak takes its max", () => {
  const service = new EffectRenderService();
  const canvas = {
    width: 4,
    height: 4,
    mappings: Array.from({ length: 4 }, (_, i) => ({
      controllerId: `deck-${i}`,
      stripIndex: i,
      layout: "parallel",
      x: 0,
      y: i,
      width: 4,
      height: 1,
    })),
  };
  // 4 strips over 16 bands -> each strip covers a contiguous group of 4 bands.
  const peaks = new Array(16).fill(0);
  peaks[0] = 0.1;
  peaks[1] = 0.2;
  peaks[2] = 0.3;
  peaks[3] = 0.4; // strip 0's group averages to 0.25
  const peaksDecayed = new Array(16).fill(0);
  peaksDecayed[1] = 0.9; // strip 0's group max is 0.9, distinct from its average
  const frame = service.render({
    effect: { renderer: "spectrum-band", parameters: {} },
    canvas,
    parameters: { timeSeconds: 5, audio: { bandCount: 16, peaks, peaksDecayed } },
    timestamp: 5000,
  });
  // Strip 0 (row 0): level averages the group to 0.25 (-12dB), which maps to
  // 3 of 4 pixels lit (on a live fire, not a static gradient), plus a peak
  // marker at index 3 for the group's max (0.9, -0.9dB, near full scale).
  // The other 3 strips' band groups are silent - the silence floor still
  // puts a small peak marker at each one's first pixel.
  assert.deepEqual(frame.pixels[3], [255, 0, 0]);
  frame.pixels.slice(0, 3).forEach(assertValidRgb);
  assert.ok(frame.pixels.slice(0, 3).some((pixel) => pixel.some(Boolean)));
  for (let row = 1; row < 4; row += 1) {
    assert.deepEqual(frame.pixels.slice(row * 4, row * 4 + 4), [
      [255, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
  }
});

// test('mp4-playback animates over time instead of showing a single still frame', () => {
//   const service = new EffectRenderService();
//   const canvas = { width: 16, height: 8 };
//   const effect = {
//     renderer: 'mp4-playback',
//     parameters: {
//       filePath: { default: './media/mp4/goldendollars.mp4' }
//     }
//   };
//
//   const frameA = service.render({ effect, canvas, timestamp: 0 });
//   const frameB = service.render({ effect, canvas, timestamp: 2000 });
//
//   assert.notDeepEqual(frameA.pixels, frameB.pixels);
// });
