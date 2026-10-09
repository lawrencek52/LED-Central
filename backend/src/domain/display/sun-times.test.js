import test from "node:test";
import assert from "node:assert/strict";
import { sunTimes } from "./sun-times.js";

const localTime = (ms) =>
  new Date(ms).toLocaleTimeString("en-CA", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit", hourCycle: "h23" });

test("sunTimes matches weather.gc.ca's Ottawa sunrise for the day, to the minute", () => {
  // weather.gc.ca showed sunrise 7:09 for Ottawa on 2026-10-08.
  const { sunrise, sunset } = sunTimes("2026-10-08", 45.4, -75.69);
  assert.equal(localTime(sunrise), "07:09");
  assert.match(localTime(sunset), /^18:3[01]$/);
});

test("sunTimes is later at a location further west, and null on a polar night", () => {
  const ottawa = sunTimes("2026-10-08", 45.4, -75.69);
  const kanata = sunTimes("2026-10-08", 45.3138, -75.8753);
  assert.ok(kanata.sunrise > ottawa.sunrise);
  assert.equal(sunTimes("2026-12-21", 82.5, -62.3), null); // Alert, Nunavut
});
