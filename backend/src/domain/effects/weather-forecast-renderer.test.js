import test from "node:test";
import assert from "node:assert/strict";
import { FONT_4X5, FONT_5X7 } from "../display/bitmap-fonts.js";
import { activeAlerts, clockParts, renderWeatherForecast, sunEventToShow } from "./weather-forecast-renderer.js";

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
    second: "00",
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

test("activeAlerts drops expired alerts and puts the most severe first", () => {
  const data = {
    alerts: [
      { type: "statement", description: "SPECIAL WEATHER STATEMENT", expiresAt: "2026-10-10T00:00:00Z" },
      { type: "watch", description: "SEVERE THUNDERSTORM WATCH", expiresAt: "2026-10-01T00:00:00Z" },
      { type: "warning", description: "EXTREME COLD WARNING", expiresAt: null },
    ],
  };
  assert.deepEqual(
    activeAlerts(data, timestamp).map((alert) => alert.type),
    ["warning", "statement"],
  );
});

test("an active alert replaces the furthest forecast columns with a box in its colour", () => {
  const withAlert = {
    ...weather,
    data: { ...weather.data, alerts: [{ type: "warning", description: "SEVERE THUNDERSTORM WARNING", expiresAt: null }] },
  };
  const width = 128;
  const pixels = renderWeatherForecast({ width, height: 64, parameters: { weather: withAlert, timeZone: "America/Toronto" }, timestamp });
  // The box's border runs along the bottom row of the last two columns.
  const bottomRight = pixels[63 * width + 120];
  assert.deepEqual(bottomRight, [255, 0, 0]);
  const without = renderWeatherForecast({ width, height: 64, parameters: { weather, timeZone: "America/Toronto" }, timestamp });
  assert.notDeepEqual(without[63 * width + 120], [255, 0, 0]);
});

test("the sun event shown rolls over an hour after each sunrise and sunset", () => {
  const data = { location: [-75.8753, 45.3138] };
  const at = (local) => sunEventToShow(data, Date.parse(`${local}-04:00`), "America/Toronto");
  const shown = (local) => {
    const event = at(local);
    const time = new Date(event.at).toLocaleTimeString("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    return `${event.label} ${new Date(event.at).toISOString().slice(0, 10)} ${time}`;
  };
  // Today's sunrise (07:10) shows from midnight until an hour after it...
  assert.equal(shown("2026-10-08T00:30:00"), "RISE 2026-10-08 07:10");
  assert.equal(shown("2026-10-08T08:05:00"), "RISE 2026-10-08 07:10");
  // ...then today's sunset (18:31) until an hour after that...
  assert.equal(shown("2026-10-08T08:15:00"), "SET 2026-10-08 18:31");
  assert.equal(shown("2026-10-08T19:25:00"), "SET 2026-10-08 18:31");
  // ...then tomorrow's sunrise.
  assert.equal(shown("2026-10-08T19:40:00"), "RISE 2026-10-09 07:11");
});
