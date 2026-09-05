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
  const canvas = { width: 8, height: 4 };
  // Spread across the dB range (silent, -40dB, -20dB, 0dB) rather than
  // clustered near full scale, where a linear-amplitude spread like
  // [0.5, 1] would compress to nearly the same bar height once mapped
  // logarithmically. peaksDecayed matches peaks here so the peak-hold cap
  // coincides with the bar top instead of adding an extra lit row.
  const levels = [0, 0.01, 0.1, 1];
  const frame = service.render({
    effect: { renderer: "spectrum-bars", parameters: { bandCount: { default: 4 } } },
    canvas,
    parameters: { audio: { bandCount: 4, peaks: levels, peaksDecayed: levels } },
  });
  const litRowsInColumn = (x) =>
    Array.from({ length: 4 }, (_, y) => frame.pixels[y * 8 + x]).filter((pixel) =>
      pixel.some(Boolean),
    ).length;
  assert.equal(litRowsInColumn(0), 0);
  assert.ok(litRowsInColumn(2) > litRowsInColumn(0));
  assert.ok(litRowsInColumn(4) > litRowsInColumn(2));
  assert.ok(litRowsInColumn(6) > litRowsInColumn(4));
});

test("spectrum-bars draws a white peak-hold cap above the live bar when it's fallen since the peak", () => {
  const service = new EffectRenderService();
  const canvas = { width: 4, height: 4 };
  const frame = service.render({
    effect: { renderer: "spectrum-bars", parameters: { bandCount: { default: 1 } } },
    canvas,
    // Live level has since dropped to near-silent, but the peak-hold marker
    // is still up near full scale.
    parameters: { audio: { bandCount: 1, peaks: [0.001], peaksDecayed: [1] } },
  });
  const column = Array.from({ length: 4 }, (_, y) => frame.pixels[y * 4]);
  assert.deepEqual(column[0], [255, 255, 255]); // top row: the peak-hold cap
  assert.ok(column.slice(1).every((pixel) => pixel.every((channel) => channel === 0)));
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

test("spectrum-band lights a level bar plus a separate slow-decaying peak marker", () => {
  const service = new EffectRenderService();
  const canvas = { width: 10, height: 1 };
  const frame = service.render({
    effect: { renderer: "spectrum-band", parameters: {} },
    canvas,
    parameters: { bandIndex: 0, audio: { peaks: [0.3], peaksDecayed: [0.8] } },
  });
  // Level and peak are mapped linearly in dB across a 64dB range, not raw
  // linear amplitude, so 0.3 (-10.5dB) lights ~84% of the strip (8 of 10
  // pixels - index 0 is heat 0, which the fire palette renders as black by
  // design) and 0.8 (-1.9dB, near full scale) puts the peak marker at the
  // very end.
  assert.deepEqual(frame.pixels, [
    [0, 0, 0],
    [84, 0, 0],
    [172, 0, 0],
    [255, 0, 0],
    [255, 84, 0],
    [255, 168, 0],
    [255, 252, 0],
    [255, 255, 80],
    [0, 0, 0],
    [255, 255, 255],
  ]);
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
    parameters: { audio: { bandCount: 2, peaks: [1, 0], peaksDecayed: [1, 0] } },
  });
  // Strip 0 (row 0) gets bandIndex 0 (full level + peak marker); strip 1
  // (row 1) gets bandIndex 1, whose band is silent, so it stays dark.
  assert.deepEqual(frame.pixels.slice(0, 4), [
    [0, 0, 0],
    [255, 0, 0],
    [255, 252, 0],
    [255, 255, 255],
  ]);
  assert.deepEqual(frame.pixels.slice(4, 8), [
    [0, 0, 0],
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
    parameters: { audio: { bandCount: 16, peaks, peaksDecayed } },
  });
  // Strip 0 (row 0): level averages the group to 0.25 (-12dB), which maps to
  // 3 of 4 pixels lit (index 0 is heat 0 -> black by the fire palette's
  // design), plus a peak marker at index 3 for the group's max (0.9, -0.9dB,
  // near full scale). The other 3 strips' band groups are silent.
  assert.deepEqual(frame.pixels.slice(0, 4), [
    [0, 0, 0],
    [255, 0, 0],
    [255, 252, 0],
    [255, 255, 255],
  ]);
  for (let row = 1; row < 4; row += 1) {
    assert.deepEqual(frame.pixels.slice(row * 4, row * 4 + 4), [
      [0, 0, 0],
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
