import test from "node:test";
import assert from "node:assert/strict";
import {
  EffectRenderService,
  starfieldAngle,
  starfieldExitDistance,
  interpolateSeries,
  makeFireworkEvent,
} from "./effect-render-service.js";

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

test("starfield keeps showing roughly starCount stars well after they would have originally all flown offscreen", () => {
  const service = new EffectRenderService();
  const effect = {
    renderer: "starfield",
    parameters: { starCount: { default: 100 } },
  };
  const canvas = { width: 100, height: 1 };
  const countLit = (timeSeconds) => {
    const frame = service.render({ effect, canvas, parameters: { timeSeconds } });
    return frame.pixels.filter((pixel) => pixel.some((channel) => channel > 0)).length;
  };
  // Every star's fixed lifespan is at most 9s (3 + 6), so by the later
  // samples every star has respawned many times over - the old code (which
  // never respawned) would trend toward zero lit pixels here since stars
  // would have traveled off-canvas long ago with nothing replacing them.
  // Two stars can collide onto the same pixel, so the lit count runs below
  // starCount even in steady state - just check it stays in a stable band
  // rather than decaying away.
  for (const timeSeconds of [0.5, 1, 5, 20, 100, 500, 2000]) {
    const lit = countLit(timeSeconds);
    assert.ok(
      lit >= 30 && lit <= 100,
      `expected a stable ~30-100 lit pixels at t=${timeSeconds}, got ${lit}`,
    );
  }
});

test("starfieldExitDistance finds the exact distance to the canvas edge along a heading", () => {
  // Pure +x heading from center on a wide, 1-row strip: exits at the x edge,
  // scaled by the same width/height aspect factor the position formula uses.
  const width = 100;
  const height = 1;
  const scale = width / height / 2; // 50
  const exitRight = starfieldExitDistance(width / 2, 0, 0, width, height);
  assert.ok(Math.abs(exitRight - (width - 1 - width / 2) / scale) < 1e-9);

  // A heading with no x or y component on a 1-row strip (vy forced to 0
  // there too) never reaches an edge - falls back to a finite value instead
  // of Infinity/NaN so the star doesn't freeze forever.
  const stuck = starfieldExitDistance(width / 2, 0, Math.PI / 2, width, height);
  assert.equal(stuck, 1);
});

test("starfield's left/right origin restricts stars to the hemisphere that actually enters the canvas", () => {
  for (let seed = 0; seed < 50; seed += 1) {
    const unitRandom = seed / 50;
    const leftAngle = starfieldAngle("left", unitRandom);
    const rightAngle = starfieldAngle("right", unitRandom);
    // "left" (origin at x=0) must always move toward increasing x; "right"
    // (origin at the far edge) must always move toward decreasing x -
    // otherwise a star would head straight off the strip it starts on and
    // never appear at all.
    assert.ok(Math.cos(leftAngle) >= -1e-9);
    assert.ok(Math.cos(rightAngle) <= 1e-9);
  }
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

function cylonParameters(overrides = {}) {
  return {
    transitSeconds: { default: 3 },
    eyeCount: { default: 2 },
    eyeSize: { default: 1 },
    eyeColors: {
      default: {
        colors: ["#ff0000", "#00ff00", "#0000ff", "#00ffff", "#ff00ff", "#ffff00"],
      },
    },
    ...overrides,
  };
}

test("cylon's default 2-eye scanner mirrors the same sweep (matches the original Silon look)", () => {
  const width = 20;
  const service = new EffectRenderService();
  const effect = { renderer: "cylon", parameters: cylonParameters() };
  for (const timestamp of [0, 137, 812, 2001]) {
    const frame = service.render({ effect, canvas: { width, height: 1 }, timestamp });
    const redIndex = frame.pixels.findIndex((p) => p[0] === 255 && p[1] === 0);
    const greenIndex = frame.pixels.findIndex((p) => p[1] === 255 && p[0] === 0);
    assert.ok(redIndex >= 0 && greenIndex >= 0);
    // The second eye is the first eye's sweep mirrored (a half-period phase
    // shift), same as the original two-eye scanner.
    assert.equal(redIndex + greenIndex, width - 1);
  }
});

test("cylon's transitSeconds is a real, width-independent crossing time", () => {
  const service = new EffectRenderService();
  for (const width of [11, 41]) {
    const effect = {
      renderer: "cylon",
      parameters: cylonParameters({ eyeCount: { default: 1 }, transitSeconds: { default: 4 } }),
    };
    // At t=0 the eye starts at index 0; after exactly one transitSeconds it
    // should have reached the far end (width - 1), regardless of width.
    const start = service.render({ effect, canvas: { width, height: 1 }, timestamp: 0 });
    const end = service.render({ effect, canvas: { width, height: 1 }, timestamp: 4000 });
    assert.deepEqual(start.pixels[0], [255, 0, 0]);
    assert.deepEqual(end.pixels[width - 1], [255, 0, 0]);
  }
});

test("cylon's eyeSize over 2 fades its two end pixels to half intensity", () => {
  const service = new EffectRenderService();
  const width = 20;
  const effect = {
    renderer: "cylon",
    parameters: cylonParameters({ eyeCount: { default: 1 }, eyeSize: { default: 4 } }),
  };
  // A timestamp where the eye sits mid-strip (position 10, well clear of
  // either edge) so a size-4 eye's 4 pixels (9-12) render without any edge
  // clamping distorting the expected fade pattern.
  const span = width - 1; // 19
  const timestamp = Math.round((10 / (span / 3)) * 1000);
  const frame = service.render({ effect, canvas: { width, height: 1 }, timestamp });
  assert.deepEqual(frame.pixels[9], [128, 0, 0]);
  assert.deepEqual(frame.pixels[10], [255, 0, 0]);
  assert.deepEqual(frame.pixels[11], [255, 0, 0]);
  assert.deepEqual(frame.pixels[12], [128, 0, 0]);
  assert.deepEqual(frame.pixels[8], [0, 0, 0]);
  assert.deepEqual(frame.pixels[13], [0, 0, 0]);
});

test("cylon's eyeSize of 2 or less stays full intensity (no fade)", () => {
  const service = new EffectRenderService();
  const width = 20;
  const effect = {
    renderer: "cylon",
    parameters: cylonParameters({ eyeCount: { default: 1 }, eyeSize: { default: 2 } }),
  };
  const frame = service.render({ effect, canvas: { width, height: 1 }, timestamp: 0 });
  const lit = frame.pixels.filter((p) => p.some((c) => c > 0));
  assert.ok(lit.every((p) => p[0] === 255));
});

test("cylon draws up to 6 independently colored, evenly staggered eyes", () => {
  const width = 30;
  const service = new EffectRenderService();
  const effect = {
    renderer: "cylon",
    parameters: cylonParameters({ eyeCount: { default: 6 } }),
  };
  const frame = service.render({
    effect,
    canvas: { width, height: 1 },
    timestamp: 123,
  });
  const litColors = frame.pixels.filter((p) => p.some((c) => c > 0));
  assert.equal(litColors.length, 6);
  const distinctColors = new Set(litColors.map((c) => c.join(",")));
  assert.equal(distinctColors.size, 6);
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

test("vu-meter's bar length scales directly with vuRatioFade instead of being compressed by a dB curve", () => {
  // vuRatioFade is already the firmware's own self-normalized ratio (0-2,
  // 1.0 = the middle of the recently observed loudness range) - not a raw
  // linear amplitude - so it must map onto the bar directly rather than
  // through the same dB-compression curve used for FFT-magnitude-derived
  // levels elsewhere, which was flattening most of its usable range.
  //
  // The bar's own heat gradient starts at 0 (black) right at the center and
  // ramps up toward the tip, so the innermost lit pixel can legitimately
  // render black too - check the boundary (first pixel *beyond* the bar is
  // black) rather than counting non-black pixels.
  const service = new EffectRenderService();
  const canvas = { width: 20, height: 1 };
  const center = 10;
  const boundaryPixelsFor = (vuRatioFade) => {
    const frame = service.render({
      effect: { renderer: "vu-meter", parameters: {} },
      canvas,
      parameters: { audio: { vuRatioFade } },
      timestamp: 0,
    });
    return frame.pixels;
  };
  // level 0.2 of a 10-pixel half -> litCount 2: index center+1 (last lit) is
  // some color, center+2 is black.
  let pixels = boundaryPixelsFor(0.4);
  assert.ok(pixels[center + 1].some(Boolean));
  assert.deepEqual(pixels[center + 2], [0, 0, 0]);
  // level 0.5 -> litCount 5: index center+4 lit, center+5 black.
  pixels = boundaryPixelsFor(1.0);
  assert.ok(pixels[center + 4].some(Boolean));
  assert.deepEqual(pixels[center + 5], [0, 0, 0]);
  // level 1.0 -> full half lit, right up to the strip's edge.
  pixels = boundaryPixelsFor(2.0);
  assert.ok(pixels[canvas.width - 1].some(Boolean));
});

test("vu-meter's left/right origin grows a single-ended bar across the full width", () => {
  const service = new EffectRenderService();
  const canvas = { width: 20, height: 1 };
  const left = service.render({
    effect: { renderer: "vu-meter", parameters: { origin: { default: "left" } } },
    canvas,
    parameters: { audio: { vuRatioFade: 1.0 } },
    timestamp: 0,
  });
  const right = service.render({
    effect: { renderer: "vu-meter", parameters: { origin: { default: "right" } } },
    canvas,
    parameters: { audio: { vuRatioFade: 1.0 } },
    timestamp: 0,
  });
  // level 0.5 of the full 20-wide strip -> 10 lit pixels, from the
  // respective end rather than split symmetrically from the center.
  assert.ok(left.pixels.slice(0, 10).some((p) => p.some(Boolean)));
  assert.deepEqual(left.pixels.slice(10), new Array(10).fill([0, 0, 0]));
  assert.ok(right.pixels.slice(10).some((p) => p.some(Boolean)));
  assert.deepEqual(right.pixels.slice(0, 10), new Array(10).fill([0, 0, 0]));
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

test("interpolateSeries gives a continuous per-column curve instead of discrete same-value blocks", () => {
  // 4 control points (as if 4 telemetry bands) spread across 7 columns
  // (position = (x/6)*3, so x lands exactly on each control point at
  // x=0,2,4,6). Values strictly between two control points must be
  // strictly between their two values - a block-based design would instead
  // repeat one control point's value across a whole span of columns.
  const values = [0, 30, 60, 90];
  const width = 7;
  assert.equal(interpolateSeries(values, 0, width), 0);
  assert.equal(interpolateSeries(values, 2, width), 30);
  assert.equal(interpolateSeries(values, 4, width), 60);
  assert.equal(interpolateSeries(values, 6, width), 90);
  const between = interpolateSeries(values, 1, width); // halfway from 0 to 30
  assert.equal(between, 15);
  const between2 = interpolateSeries(values, 3, width); // halfway from 30 to 60
  assert.equal(between2, 45);
});

test("spectrum-bars shows level as brightness/color along the strip on a single row instead of an all-or-nothing bar", () => {
  const service = new EffectRenderService();
  const canvas = { width: 8, height: 1 };
  // A one-row canvas can't grow a vertical bar at all - height would only
  // ever be 0 or 1, reading as "no dynamic range". Level should drive color
  // intensity across the row instead.
  const quiet = service.render({
    effect: { renderer: "spectrum-bars", parameters: {} },
    canvas,
    parameters: { timeSeconds: 5, audio: { peaks: [0] } },
    timestamp: 5000,
  });
  const loud = service.render({
    effect: { renderer: "spectrum-bars", parameters: {} },
    canvas,
    parameters: { timeSeconds: 5, audio: { peaks: [1] } },
    timestamp: 5000,
  });
  const brightnessOf = (pixel) => pixel.reduce((sum, c) => sum + c, 0);
  const totalBrightness = (frame) =>
    frame.pixels.reduce((sum, pixel) => sum + brightnessOf(pixel), 0);
  assert.ok(totalBrightness(loud) > totalBrightness(quiet));
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

test("fire supersamples a narrow canvas so more than a couple of cells light up, not just the spark end", () => {
  const width = 16;
  const service = new EffectRenderService();
  const frame = service.render({
    effect: { renderer: "fire", parameters: fireParameters() },
    canvas: { width, height: 1 },
    parameters: { timeSeconds: 5 },
  });
  const litCells = frame.pixels.filter(
    (pixel) => pixel[0] + pixel[1] + pixel[2] > 0,
  ).length;
  // Below the fix, the automaton (tuned for 100+ cells) cools to black within
  // a few cells of the spark end on a 16-wide strip, leaving most of it dark.
  assert.ok(
    litCells >= width / 2,
    `expected at least half of ${width} cells lit, got ${litCells}`,
  );
});

test("fire's supersampled output still matches the real canvas width", () => {
  const width = 16;
  const service = new EffectRenderService();
  const frame = service.render({
    effect: { renderer: "fire", parameters: fireParameters() },
    canvas: { width, height: 2 },
    parameters: { timeSeconds: 5 },
  });
  assert.equal(frame.pixels.length, width * 2);
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

test("spectrum-band's level bar is a graded flame, not solid white", () => {
  // Regression test: the diffusion step's neighbor reads (h[i-1], h[i-2])
  // must run in a high-to-low loop, not low-to-high - a low-to-high loop
  // would read each cell's *already-updated* neighbors from earlier in the
  // very same step, cascading heat across the whole row within one 20ms
  // simulation tick. That saturates nearly every cell near 255, which
  // heatToFireColor renders as solid white instead of a red/orange/yellow
  // gradient - exactly what was reported as "all of the bars are white".
  const service = new EffectRenderService();
  const width = 60;
  const canvas = { width, height: 1 };
  const frame = service.render({
    effect: { renderer: "spectrum-band", parameters: {} },
    canvas,
    parameters: {
      timeSeconds: 5,
      audio: { bandCount: 1, peaks: [0.9], peaksDecayed: [0.9] },
      stripCount: 1,
      mappingOrdinal: 0,
    },
    timestamp: 5000,
  });
  const litPixels = frame.pixels.filter((pixel) => pixel.some(Boolean));
  assert.ok(litPixels.length > 10, "expected a wide lit level bar to sample");
  const whiteCount = litPixels.filter(
    (pixel) => pixel[0] === 255 && pixel[1] === 255,
  ).length;
  assert.ok(
    whiteCount < litPixels.length / 2,
    `expected a graded flame, but ${whiteCount}/${litPixels.length} lit pixels were white`,
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

test("spectrum-band's neighborBlend correlates each strip's fire with its neighbors, using the Fire effect's own mechanism", () => {
  const service = new EffectRenderService();
  const canvas = {
    width: 20,
    height: 3,
    mappings: Array.from({ length: 3 }, (_, i) => ({
      controllerId: `deck-${i}`,
      stripIndex: i,
      layout: "parallel",
      x: 0,
      y: i,
      width: 20,
      height: 1,
    })),
  };
  // Same level for the two edge strips (rows 0 and 2) so their litCount
  // matches - only their fire's underlying heat differs, which neighborBlend
  // should equalize since each has only the (louder) middle strip as its
  // one neighbor.
  const audio = { bandCount: 3, peaks: [0.5, 0.95, 0.5], peaksDecayed: [0.5, 0.95, 0.5] };
  const frame = service.render({
    effect: {
      renderer: "spectrum-band",
      parameters: { neighborBlend: { default: 1 } },
    },
    canvas,
    parameters: { timeSeconds: 5, audio },
    timestamp: 5000,
  });
  const row0 = frame.pixels.slice(0, 20);
  const row2 = frame.pixels.slice(40, 60);
  // With full neighbor blending, both edge rows end up entirely derived from
  // the middle row's pre-blend heat (each has only that one neighbor) - the
  // exact same proof used for `fire`'s own neighborBlend test.
  assert.deepEqual(row0, row2);
});

// Strip spacing ratio is set huge (relative to explosion radius) so no
// particle's sideways drift ever rounds to a different row - keeps these
// single-row, phase-timing-focused tests from losing particles off the only
// row that exists, independent of the dedicated cross-strip spreading test
// below. stripSpacingRatio lives on the canvas, not the effect parameters
// (see renderCanvasEffect), so test canvases set it explicitly too.
const TEST_LED_SPACING_CM = 2;
const TEST_STRIP_SPACING_RATIO = 50000;

function rocketParameters(overrides = {}) {
  return {
    launchIntervalSeconds: { default: 20 }, // wide enough that only one event is ever in play
    reversed: { default: false },
    ledSpacingCm: { default: TEST_LED_SPACING_CM },
    palette: { default: { colors: ["#ff0000"] } },
    ...overrides,
  };
}

function makeTestEvent(n, width, palette, launchIntervalSeconds = 20) {
  return makeFireworkEvent(n, 0, 1, width, palette, launchIntervalSeconds, TEST_LED_SPACING_CM);
}

test("makeFireworkEvent produces valid, in-range fields deterministically from its own index alone", () => {
  const palette = [
    [255, 0, 0],
    [0, 255, 0],
  ];
  const event = makeTestEvent(0, 100, palette);
  assert.ok(event.apexHeightLed > 0 && event.apexHeightLed <= 99);
  assert.ok(event.originRow === 0); // only one row (rows=1) to choose from
  assert.ok(event.tApex > 0);
  assert.ok(event.particles.length >= 10 && event.particles.length <= 100);
  for (const particle of event.particles) {
    assert.ok(Number.isFinite(particle.angle));
    assert.ok(particle.speedCm > 0);
    assert.ok(particle.life > 0);
    assert.ok(palette.includes(particle.color));
  }
  // Same index/seed/inputs -> identical event (stateless, replayable).
  const again = makeTestEvent(0, 100, palette);
  assert.deepEqual(event, again);
});

test("rocket-fireworks: the rocket dims as it climbs toward apogee, then something is visible at the burst", () => {
  const service = new EffectRenderService();
  const width = 100;
  const canvas = { width, height: 1, stripSpacingRatio: TEST_STRIP_SPACING_RATIO };
  const event = makeTestEvent(0, width, [[255, 0, 0]]);
  const effect = { renderer: "rocket-fireworks", parameters: rocketParameters() };

  const early = service.render({
    effect,
    canvas,
    parameters: { timeSeconds: event.tApex * 0.2 },
    timestamp: event.tApex * 200,
  });
  const late = service.render({
    effect,
    canvas,
    parameters: { timeSeconds: event.tApex * 0.9 },
    timestamp: event.tApex * 900,
  });
  const brightnessOf = (frame) =>
    frame.pixels.reduce((sum, p) => sum + p[0] + p[1] + p[2], 0);
  assert.ok(brightnessOf(early) > 0);
  // Dimmer late in the ascent (closer to apogee) than early on.
  assert.ok(brightnessOf(late) < brightnessOf(early));

  // Just after apogee with no audio, it's already exploded into particles.
  const exploded = service.render({
    effect,
    canvas,
    parameters: { timeSeconds: event.tApex + 0.05 },
    timestamp: (event.tApex + 0.05) * 1000,
  });
  assert.ok(exploded.pixels.some((p) => p.some(Boolean)));
});

test("rocket-fireworks: with audio available, pauses at apogee until a beat arrives instead of exploding immediately", () => {
  const service = new EffectRenderService();
  const width = 100;
  const canvas = { width, height: 1, stripSpacingRatio: TEST_STRIP_SPACING_RATIO };
  const event = makeTestEvent(0, width, [[255, 0, 0]]);
  const effect = { renderer: "rocket-fireworks", parameters: rocketParameters() };
  const startedAtMs = 0;
  const apexAtMs = (event.launchTime + event.tApex) * 1000;

  // Shortly after apogee, no beat has happened yet (lastBeatAt is well
  // before apogee) - still waiting, not exploded.
  const waiting = service.render({
    effect,
    canvas,
    parameters: {
      timeSeconds: event.tApex + 0.3,
      audio: { available: true, lastBeatAt: 0 },
    },
    timestamp: startedAtMs + (event.tApex + 0.3) * 1000,
  });
  const litCount = (frame) => frame.pixels.filter((p) => p.some(Boolean)).length;
  assert.ok(litCount(waiting) <= 2); // just the single waiting point

  // A beat lands shortly before this render moment -> exploded and the
  // particles have had a little time to spread out from their shared
  // starting point (sampling exactly at the beat itself would show every
  // particle still stacked on the same one or two starting pixels).
  const beatTimestamp = apexAtMs + 300;
  const renderTimestamp = beatTimestamp + 200;
  const exploded = service.render({
    effect,
    canvas,
    parameters: {
      timeSeconds: (renderTimestamp - startedAtMs) / 1000,
      audio: { available: true, lastBeatAt: beatTimestamp },
    },
    timestamp: renderTimestamp,
  });
  assert.ok(litCount(exploded) > 2);
});

test("rocket-fireworks: a rocket stuck waiting for a beat through silence explodes anyway after the wait cap", () => {
  const service = new EffectRenderService();
  const width = 100;
  const canvas = { width, height: 1, stripSpacingRatio: TEST_STRIP_SPACING_RATIO };
  const event = makeTestEvent(0, width, [[255, 0, 0]]);
  const effect = { renderer: "rocket-fireworks", parameters: rocketParameters() };
  const apexAtSeconds = event.launchTime + event.tApex;

  const stillWaiting = service.render({
    effect,
    canvas,
    parameters: {
      timeSeconds: apexAtSeconds + 3.9,
      audio: { available: true, lastBeatAt: 0 },
    },
    timestamp: (apexAtSeconds + 3.9) * 1000,
  });
  const timedOut = service.render({
    effect,
    canvas,
    parameters: {
      timeSeconds: apexAtSeconds + 4.1,
      audio: { available: true, lastBeatAt: 0 },
    },
    timestamp: (apexAtSeconds + 4.1) * 1000,
  });
  const litCount = (frame) => frame.pixels.filter((p) => p.some(Boolean)).length;
  assert.ok(litCount(stillWaiting) <= 2);
  assert.ok(litCount(timedOut) > 2);
});

test("rocket-fireworks' reversed parameter flips which end of the strip is the ground/launch point", () => {
  const service = new EffectRenderService();
  const width = 100;
  const canvas = { width, height: 1, stripSpacingRatio: TEST_STRIP_SPACING_RATIO };
  const event = makeTestEvent(0, width, [[255, 0, 0]]);
  const earlyAscentSeconds = event.tApex * 0.1;
  const forward = service.render({
    effect: { renderer: "rocket-fireworks", parameters: rocketParameters() },
    canvas,
    parameters: { timeSeconds: earlyAscentSeconds },
    timestamp: earlyAscentSeconds * 1000,
  });
  const reversed = service.render({
    effect: {
      renderer: "rocket-fireworks",
      parameters: rocketParameters({ reversed: { default: true } }),
    },
    canvas,
    parameters: { timeSeconds: earlyAscentSeconds },
    timestamp: earlyAscentSeconds * 1000,
  });
  assert.deepEqual(reversed.pixels, [...forward.pixels].reverse());
});

test("rocket-fireworks' explosions genuinely spread sideways onto neighboring strips using the real physical spacing", () => {
  const rows = 8;
  const width = 215;
  const event = makeFireworkEvent(0, 0, rows, width, [[255, 0, 0]], 3, 1.667);
  // No audio -> explodes immediately at apogee.
  const explodeAtElapsed = event.launchTime + event.tApex;
  const service = new EffectRenderService();
  const canvas = {
    width,
    height: rows,
    stripSpacingRatio: 40.64 / 1.667, // the user's real wall
    mappings: Array.from({ length: rows }, (_, i) => ({
      controllerId: `deck-${i}`,
      stripIndex: i,
      layout: "parallel",
      x: 0,
      y: i,
      width,
      height: 1,
    })),
  };
  const effect = {
    renderer: "rocket-fireworks",
    parameters: {
      launchIntervalSeconds: { default: 3 },
      reversed: { default: false },
      ledSpacingCm: { default: 1.667 },
      palette: { default: { colors: ["#ff0000"] } },
    },
  };
  const timeSeconds = explodeAtElapsed + 0.6;
  const frame = service.render({
    effect,
    canvas,
    parameters: { timeSeconds },
    timestamp: timeSeconds * 1000,
  });
  const litRows = new Set();
  for (let row = 0; row < rows; row += 1) {
    if (frame.pixels.slice(row * width, (row + 1) * width).some((p) => p.some(Boolean))) {
      litRows.add(row);
    }
  }
  // The rocket launched on event.originRow; 0.6s after exploding, real
  // particle speeds/angles against this exact 40.64cm strip spacing/1.667cm
  // LED spacing carry some particles onto the immediately neighboring
  // strips too, not just up and down the origin strip.
  assert.ok(litRows.size > 1, `expected more than one lit strip, got rows: ${[...litRows]}`);
  assert.ok(litRows.has(event.originRow));
});

test("rocket-fireworks: strips show different content over time (rockets originate on random strips)", () => {
  const service = new EffectRenderService();
  const canvas = {
    width: 100,
    height: 3,
    stripSpacingRatio: TEST_STRIP_SPACING_RATIO,
    mappings: Array.from({ length: 3 }, (_, i) => ({
      controllerId: `deck-${i}`,
      stripIndex: i,
      layout: "parallel",
      x: 0,
      y: i,
      width: 100,
      height: 1,
    })),
  };
  // Huge stripSpacingRatio keeps this test focused on "different strips show
  // different content" without also depending on the cross-strip spreading
  // covered by the dedicated test above.
  const effect = {
    renderer: "rocket-fireworks",
    parameters: rocketParameters({ launchIntervalSeconds: { default: 3 } }),
  };
  let sawDifference = false;
  for (let timeSeconds = 0; timeSeconds < 20 && !sawDifference; timeSeconds += 0.3) {
    const frame = service.render({
      effect,
      canvas,
      parameters: { timeSeconds },
      timestamp: timeSeconds * 1000,
    });
    const row0 = frame.pixels.slice(0, 100);
    const row1 = frame.pixels.slice(100, 200);
    const row2 = frame.pixels.slice(200, 300);
    if (
      JSON.stringify(row0) !== JSON.stringify(row1) ||
      JSON.stringify(row1) !== JSON.stringify(row2)
    ) {
      sawDifference = true;
    }
  }
  assert.ok(sawDifference, "expected the 3 parallel strips to diverge at some point over 20s");
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
