import test from "node:test";
import assert from "node:assert/strict";
import { FakeControllerGateway } from "../infrastructure/controllers/fake-controller-gateway.js";
import { WeatherAlertNotifier } from "./weather-alert-notifier.js";

const weatherEffect = {
  id: "weather-forecast",
  tags: ["weather"],
  parameters: { postalCode: { default: "K2L" }, alertSound: { default: true } },
};

function notifierWith(sessions) {
  const gateway = new FakeControllerGateway();
  const canvases = {
    big: { mappings: [{ controllerId: "m128" }] },
    small: { mappings: [{ controllerId: "m64" }] },
    deck: { mappings: [{ controllerId: "deck1" }, { controllerId: "deck2" }] },
  };
  const notifier = new WeatherAlertNotifier({
    playbackService: { list: () => sessions },
    canvasService: { get: (id) => canvases[id] },
    controllerService: { get: (id) => ({ id, name: id, host: `${id}.local` }) },
    effectService: { get: (id) => (id === "weather-forecast" ? weatherEffect : { id, tags: [] }) },
    gateway,
    logger: {},
  });
  return { notifier, gateway };
}

test("a new alert rings the controllers showing a weather effect for that postal code", async () => {
  const { notifier, gateway } = notifierWith([
    { status: "playing", effectId: "weather-forecast", canvasId: "big", parameters: { postalCode: "K2L 1A1" } },
    { status: "playing", effectId: "weather-forecast", canvasId: "small", parameters: {} },
    { status: "playing", effectId: "nds-fire", canvasId: "deck", parameters: {} },
    { status: "stopped", effectId: "weather-forecast", canvasId: "deck", parameters: {} },
  ]);
  await notifier.notify("K2L");
  assert.deepEqual(
    gateway.rings.map((ring) => ring.controllerId).sort(),
    ["m128", "m64"],
  );
  assert.ok(gateway.rings.every((ring) => ring.seconds === 12));
});

test("alert rings skip other postal codes and sessions with the alert sound off", async () => {
  const { notifier, gateway } = notifierWith([
    { status: "playing", effectId: "weather-forecast", canvasId: "big", parameters: { postalCode: "M5V" } },
    { status: "playing", effectId: "weather-forecast", canvasId: "small", parameters: { alertSound: false } },
  ]);
  await notifier.notify("K2L");
  assert.equal(gateway.rings, undefined);
});
