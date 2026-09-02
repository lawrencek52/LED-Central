import test from "node:test";
import assert from "node:assert/strict";
import { validateDatabase } from "./database-validation-service.js";

function makeServices({
  effects = [],
  canvases = [],
  controllers = [],
  intents = [],
} = {}) {
  const removed = [];
  return {
    effectService: { list: () => effects },
    canvasService: { list: () => canvases },
    controllerService: { list: () => controllers },
    playbackRepository: {
      list: () => intents,
      remove: (canvasId) => removed.push(canvasId),
    },
    removed,
  };
}

test("reports unknown renderer on an effect", () => {
  const services = makeServices({
    effects: [
      {
        id: "mystery",
        renderer: "does-not-exist",
        parameters: {},
      },
    ],
  });
  const report = validateDatabase(services);
  assert.equal(report.effects.issues.length, 1);
  assert.match(report.effects.issues[0].issues[0], /Unknown renderer/);
});

test("reports invalid parameter schema ranges", () => {
  const services = makeServices({
    effects: [
      {
        id: "bad-range",
        renderer: "solid",
        parameters: {
          speed: { type: "number", min: 10, max: 5, default: 20 },
        },
      },
    ],
  });
  const report = validateDatabase(services);
  const issues = report.effects.issues[0].issues;
  assert.ok(issues.some((issue) => issue.includes("min (10) greater than max (5)")));
});

test("reports canvas mapping referencing unknown controller", () => {
  const services = makeServices({
    canvases: [
      {
        id: "canvas-1",
        width: 10,
        height: 1,
        mappings: [{ controllerId: "missing", stripIndex: 0 }],
      },
    ],
  });
  const report = validateDatabase(services);
  assert.equal(report.canvases.issues.length, 1);
  assert.match(report.canvases.issues[0].issues[0], /unknown controller/);
});

test("reports canvas mapping with out-of-range strip index", () => {
  const services = makeServices({
    controllers: [{ id: "c1", name: "One", strips: 2 }],
    canvases: [
      {
        id: "canvas-1",
        width: 10,
        height: 1,
        mappings: [{ controllerId: "c1", stripIndex: 5 }],
      },
    ],
  });
  const report = validateDatabase(services);
  assert.match(report.canvases.issues[0].issues[0], /out of range/);
});

test("removes invalid startup playback intents", () => {
  const services = makeServices({
    intents: [
      { canvasId: "missing-canvas", effectId: "solid", parameters: {}, fps: 20 },
    ],
  });
  const report = validateDatabase(services);
  assert.equal(report.startupEffects.removed.length, 1);
  assert.equal(services.removed.length, 1);
  assert.equal(services.removed[0], "missing-canvas");
});

test("keeps valid startup playback intents", () => {
  const services = makeServices({
    controllers: [{ id: "c1", name: "One", strips: 1, ledCounts: [215], host: "h", port: 1 }],
    canvases: [
      {
        id: "canvas-1",
        width: 10,
        height: 1,
        mappings: [{ controllerId: "c1", stripIndex: 0 }],
      },
    ],
    effects: [
      {
        id: "solid",
        renderer: "solid",
        parameters: { color: { type: "color", default: "#ffffff" } },
      },
    ],
    intents: [
      {
        canvasId: "canvas-1",
        effectId: "solid",
        parameters: { color: "#ff0000" },
        fps: 20,
      },
    ],
  });
  const report = validateDatabase(services);
  assert.equal(report.startupEffects.issues.length, 0);
  assert.equal(services.removed.length, 0);
});
