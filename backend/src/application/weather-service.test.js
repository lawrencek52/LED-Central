import test from "node:test";
import assert from "node:assert/strict";
import {
  WeatherService,
  forwardSortationArea,
  parseCityPage,
} from "./weather-service.js";

const bilingual = (value) => ({ en: value, fr: value });

// A trimmed citypageweather-realtime feature with the fields the display uses.
function cityFeature() {
  const period = (name, day, icon, summary, temperature, temperatureClass) => ({
    period: { textForecastName: bilingual(name), value: bilingual(day) },
    abbreviatedForecast: { icon: { format: "gif", value: icon }, textSummary: bilingual(summary) },
    temperatures: {
      temperature: [{ class: bilingual(temperatureClass), value: bilingual(temperature) }],
    },
  });
  return {
    id: "on-118",
    geometry: { type: "Point", coordinates: [-75.69, 45.4] },
    properties: {
      name: bilingual("Ottawa (Kanata - Orléans)"),
      lastUpdated: "2026-10-09T01:01:44Z",
      currentConditions: {
        iconCode: { format: "gif", value: 31 },
        condition: bilingual("Mainly Clear"),
        temperature: { value: bilingual(9.4) },
        relativeHumidity: { value: bilingual(71) },
        wind: {
          speed: { value: bilingual(12) },
          gust: { value: bilingual(37) },
          direction: { value: bilingual("W") },
        },
      },
      forecastGroup: {
        forecasts: [
          period("Tonight", "Thursday night", 39, "Chance of showers", 6, "low"),
          period("Friday", "Friday", 6, "Chance of showers", 14, "high"),
          period("Friday night", "Friday night", 35, "Clearing", 2, "low"),
          period("Saturday", "Saturday", 2, "A mix of sun and cloud", 16, "high"),
        ],
      },
      warnings: [
        {
          type: bilingual("warning"),
          description: bilingual("SEVERE THUNDERSTORM WARNING"),
          expiryTime: bilingual("2026-10-09T13:43:40Z"),
        },
        { type: bilingual("ended"), description: bilingual("HEAT WARNING ENDED") },
      ],
      riseSet: {
        sunrise: bilingual("2026-10-09T11:11:00Z"),
        sunset: bilingual("2026-10-09T22:29:00Z"),
      },
    },
  };
}

test("forwardSortationArea takes the first three characters of a Canadian postal code", () => {
  assert.equal(forwardSortationArea("k2l 1a1"), "K2L");
  assert.equal(forwardSortationArea("K2L"), "K2L");
  assert.equal(forwardSortationArea(" k2l-1a1 "), "K2L");
  assert.equal(forwardSortationArea("12345"), null);
  assert.equal(forwardSortationArea(""), null);
});

test("parseCityPage flattens current conditions and pairs each day with the following night's low", () => {
  const parsed = parseCityPage(cityFeature());
  assert.equal(parsed.cityId, "on-118");
  assert.deepEqual(parsed.current, {
    temperature: 9.4,
    iconCode: 31,
    condition: "Mainly Clear",
    humidity: 71,
    windDirection: "W",
    windSpeed: 12,
    windGust: 37,
  });
  // An evening forecast's leading "Tonight" gets a column of its own.
  assert.deepEqual(parsed.days, [
    { day: "Thursday", night: true, iconCode: 39, summary: "Chance of showers", high: null, low: 6 },
    { day: "Friday", night: false, iconCode: 6, summary: "Chance of showers", high: 14, low: 2 },
    { day: "Saturday", night: false, iconCode: 2, summary: "A mix of sun and cloud", high: 16, low: null },
  ]);
  assert.equal(parsed.sunset, "2026-10-09T22:29:00Z");
  assert.deepEqual(parsed.alerts, [
    { type: "warning", description: "SEVERE THUNDERSTORM WARNING", expiresAt: "2026-10-09T13:43:40Z" },
  ]);
});

function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) return { ok: false, status: 404, json: async () => ({}) };
    const body = typeof route[1] === "function" ? route[1]() : route[1];
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetchImpl, calls };
}

async function settle(service, postalCode) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    const weather = service.getWeather(postalCode);
    if (weather.status !== "loading") return weather;
  }
  return service.getWeather(postalCode);
}

test("WeatherService locates the postal code, picks the nearest city and caches its forecast", async () => {
  let clock = 0;
  const far = { ...cityFeature(), id: "on-999", geometry: { coordinates: [-76.3, 45.8] } };
  const { fetchImpl, calls } = fakeFetch([
    [/geolocator/, [{ title: "K2L", geometry: { coordinates: [-75.88, 45.31] } }]],
    [/items\?.*bbox=/, { features: [far, cityFeature()] }],
    [/items\/on-118/, cityFeature()],
  ]);
  const service = new WeatherService({ fetchImpl, now: () => clock, logger: {} });

  assert.equal(service.getWeather("K2L 1A1").status, "loading");
  const weather = await settle(service, "K2L");
  assert.equal(weather.status, "ok");
  assert.equal(weather.data.city, "Ottawa (Kanata - Orléans)");
  assert.equal(calls.filter((url) => /items\/on-118/.test(url)).length, 1);

  // Within the refresh interval: served from cache, no new requests.
  clock = 5 * 60 * 1000;
  service.getWeather("K2L");
  await settle(service, "K2L");
  assert.equal(calls.length, 3);

  // After it: only the city page is refetched (location and city are kept).
  clock = 11 * 60 * 1000;
  service.getWeather("K2L");
  await settle(service, "K2L");
  assert.equal(calls.length, 4);
  assert.match(calls[3], /items\/on-118/);
});

test("WeatherService keeps the last forecast when a refresh fails", async () => {
  let clock = 0;
  let failing = false;
  const { fetchImpl } = fakeFetch([
    [/geolocator/, [{ title: "K2L", geometry: { coordinates: [-75.88, 45.31] } }]],
    [/items\?.*bbox=/, { features: [cityFeature()] }],
    [/items\/on-118/, () => {
      if (failing) throw new Error("network down");
      return cityFeature();
    }],
  ]);
  const service = new WeatherService({ fetchImpl, now: () => clock, logger: {} });
  service.getWeather("K2L");
  assert.equal((await settle(service, "K2L")).status, "ok");

  failing = true;
  clock = 11 * 60 * 1000;
  service.getWeather("K2L");
  await settle(service, "K2L");
  const weather = service.getWeather("K2L");
  assert.equal(weather.status, "ok");
  assert.equal(weather.data.current.temperature, 9.4);
  assert.equal(weather.error, "network down");
});

test("WeatherService reports an invalid postal code without fetching", () => {
  const { fetchImpl, calls } = fakeFetch([]);
  const service = new WeatherService({ fetchImpl, logger: {} });
  assert.equal(service.getWeather("90210").status, "invalid");
  assert.equal(calls.length, 0);
});
