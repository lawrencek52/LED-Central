import test from "node:test";
import assert from "node:assert/strict";
import { moonElongation } from "./moon-phase.js";
import { createCanvas } from "./raster.js";
import { drawWeatherIcon } from "./weather-icons.js";

const NEW_MOON = Date.parse("2026-01-18T19:52:00Z");
const angleFrom = (elongation, target) => Math.abs(((elongation - target + 540) % 360) - 180);

test("moonElongation is near 0 at known new moons and 180 at a known full moon", () => {
  for (const instant of ["2024-01-11T11:57:00Z", "2025-01-29T12:36:00Z", "2026-01-18T19:52:00Z"]) {
    assert.ok(angleFrom(moonElongation(Date.parse(instant)), 0) < 1, instant);
  }
  assert.ok(angleFrom(moonElongation(Date.parse("2024-01-25T17:54:00Z")), 180) < 1);
});

// Lit (bright) pixels of a clear-night moon icon drawn for `timestamp`.
function litColumns(timestamp) {
  const canvas = createCanvas(16, 16);
  drawWeatherIcon(canvas, 30, 0, 0, 16, { timestamp });
  const columns = new Set();
  canvas.pixels.forEach(([r], index) => {
    if (r > 200) columns.add(index % 16);
  });
  return [...columns];
}

test("a new moon shows just its edge, on the side it's about to light or just lit", () => {
  const before = litColumns(NEW_MOON - 2 * 3600 * 1000);
  const after = litColumns(NEW_MOON + 2 * 3600 * 1000);
  assert.ok(before.length > 0 && Math.max(...before) < 8, `waning edge should be on the left: ${before}`);
  assert.ok(after.length > 0 && Math.min(...after) >= 8, `waxing edge should be on the right: ${after}`);
});

test("first quarter lights the right half and full moon the whole disc", () => {
  const firstQuarter = litColumns(NEW_MOON + 7.4 * 86400 * 1000);
  assert.ok(Math.min(...firstQuarter) >= 7, `${firstQuarter}`);
  const full = litColumns(NEW_MOON + 14.8 * 86400 * 1000);
  assert.ok(Math.max(...full) - Math.min(...full) >= 9, `${full}`);
});
