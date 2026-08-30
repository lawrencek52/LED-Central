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

test("bouncing-balls animates instead of freezing on the first frame", () => {
  const service = new EffectRenderService();
  const canvas = { width: 16, height: 1 };
  const effect = {
    renderer: "bouncing-balls",
    parameters: {
      ballCount: { default: 4 },
      ballSize: { default: 2 },
      mirrored: { default: true },
      erase: { default: true },
    },
  };

  const frameA = service.render({ effect, canvas, timestamp: 0 });
  const frameB = service.render({ effect, canvas, timestamp: 2000 });

  assert.notDeepEqual(frameA.pixels, frameB.pixels);
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
