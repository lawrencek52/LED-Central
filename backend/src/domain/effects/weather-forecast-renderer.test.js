import test from "node:test";
import assert from "node:assert/strict";
import { FONT_4X5, FONT_5X7 } from "../display/bitmap-fonts.js";
import { clockParts, renderWeatherForecast } from "./weather-forecast-renderer.js";

const weather = {
  status: "ok",
  data: {
    city: "Ottawa (Kanata - Orléans)",
    current: {
      temperature: -12.3,
      iconCode: 6,
      condition: "Chance of showers",
      humidity: 71,
      windDirection: "NNW",
      windSpeed: 25,
      windGust: 45,
    },
    days: ["Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"].map((day, index) => ({
      day,
      iconCode: [6, 2, 2, 10, 12, 16][index],
      summary: "",
      high: 14 - index,
      low: index === 5 ? null : -20 + index,
    })),
    sunrise: "2026-10-09T11:11:00Z",
    sunset: "2026-10-09T22:29:00Z",
  },
};

const timestamp = Date.parse("2026-10-08T21:07:00-04:00");
const lit = (pixels) => pixels.filter(([r, g, b]) => r + g + b > 0).length;

test("bitmap font glyphs have consistent row widths and heights", () => {
  for (const font of [FONT_5X7, FONT_4X5]) {
    for (const [char, rows] of Object.entries(font.glyphs)) {
      assert.ok(
        rows.length === font.height || (font === FONT_5X7 && rows.length === font.height + 1),
        `${font.name} '${char}' has ${rows.length} rows`,
      );
      assert.ok(
        rows.every((row) => row.length === rows[0].length && /^[#.]+$/.test(row)),
        `${font.name} '${char}' has ragged or invalid rows`,
      );
    }
  }
});

test("clockParts reports wall-clock time in the requested time zone", () => {
  assert.deepEqual(clockParts(timestamp, "America/Toronto"), {
    hour: 21,
    minute: "07",
    weekday: "Thu",
    month: "Oct",
    day: "8",
  });
  assert.equal(clockParts(timestamp, "America/Vancouver").hour, 18);
  // An unknown zone falls back to the host's rather than throwing.
  assert.ok(Number.isInteger(clockParts(timestamp, "Not/AZone").hour));
});

test("weather-forecast renders both matrix layouts at full size", () => {
  for (const [width, height] of [[128, 64], [64, 64]]) {
    const pixels = renderWeatherForecast({
      width,
      height,
      parameters: { weather, timeZone: "America/Toronto" },
      timestamp,
    });
    assert.equal(pixels.length, width * height);
    // Each forecast column draws its icon in the lower half.
    assert.ok(lit(pixels.slice((height / 2) * width)) > width, `${width}x${height} forecast row is empty`);
  }
});

test("weather-forecast shows a message instead of data while loading", () => {
  const loading = renderWeatherForecast({
    width: 64,
    height: 64,
    parameters: { weather: { status: "loading", data: null }, timeZone: "America/Toronto" },
    timestamp,
  });
  const withData = renderWeatherForecast({
    width: 64,
    height: 64,
    parameters: { weather, timeZone: "America/Toronto" },
    timestamp,
  });
  assert.ok(lit(loading) > 0);
  assert.ok(lit(loading) < lit(withData));
});
