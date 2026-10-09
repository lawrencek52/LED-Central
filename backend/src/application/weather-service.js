// Weather for display effects, from Environment and Climate Change Canada's
// free, key-less APIs:
//
//   1. NRCan Geolocator turns a postal code's first three characters (its
//      forward sortation area) into a latitude/longitude. Full postal codes
//      aren't in any free key-less service, and an FSA's centroid is within a
//      few km - plenty for picking a forecast city.
//   2. The nearest api.weather.gc.ca "citypageweather" city (the same data as
//      the weather.gc.ca city pages) is found with a bounding-box search
//      around that point, widened until it finds one.
//   3. That city's page - current conditions, ~6 days of day/night forecast
//      periods, sunrise/sunset - is fetched and refreshed periodically.
//
// Renderers are synchronous and run every frame, so getWeather() never waits
// on the network: it returns whatever is cached and starts a background
// refresh when that's stale, the same approach the controller gateway uses
// for controller stats.

const GEOLOCATOR_URL = "https://geolocator.api.geo.ca/geolocation/en/locate";
const CITY_PAGE_URL = "https://api.weather.gc.ca/collections/citypageweather-realtime/items";
const SEARCH_RADII_DEGREES = [0.5, 1, 2, 4];

export function forwardSortationArea(postalCode) {
  const compact = String(postalCode ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return /^[A-Z][0-9][A-Z]/.test(compact) ? compact.slice(0, 3) : null;
}

const en = (value) =>
  value && typeof value === "object" && "en" in value ? value.en : value;

const numberOrNull = (value) => {
  const parsed = Number(en(value));
  return en(value) === undefined || en(value) === null || en(value) === "" || !Number.isFinite(parsed)
    ? null
    : parsed;
};

// Icon codes come as { format, value, url } rather than bilingual values.
const iconCodeOf = (icon) => numberOrNull(icon && typeof icon === "object" && "value" in icon ? icon.value : icon);

// The parts of a city page the display uses, flattened out of the API's
// bilingual { en, fr } values.
export function parseCityPage(feature) {
  const properties = feature?.properties ?? {};
  const current = properties.currentConditions ?? {};
  const periods = (properties.forecastGroup?.forecasts ?? []).map((forecast) => {
    const temperatures = forecast.temperatures?.temperature;
    const temperature = Array.isArray(temperatures) ? temperatures[0] : temperatures;
    const name = en(forecast.period?.textForecastName) ?? "";
    const day = en(forecast.period?.value) ?? name;
    return {
      name,
      day: day.replace(/ night$/i, ""),
      night: /night/i.test(day) || /^tonight$/i.test(name),
      iconCode: iconCodeOf(forecast.abbreviatedForecast?.icon),
      summary: en(forecast.abbreviatedForecast?.textSummary) ?? "",
      temperature: numberOrNull(temperature?.value),
      temperatureClass: en(temperature?.class) ?? null,
    };
  });

  // Daily columns: each daytime period, with the low from the night that
  // follows it. A leading "Tonight" (an evening forecast) has no daytime
  // period left to pair with, so it gets a column of its own.
  const days = [];
  if (periods[0]?.night) {
    days.push({
      day: periods[0].day,
      night: true,
      iconCode: periods[0].iconCode,
      summary: periods[0].summary,
      high: null,
      low: periods[0].temperature,
    });
  }
  periods.forEach((period, index) => {
    if (period.night) return;
    const next = periods[index + 1];
    days.push({
      day: period.day,
      night: false,
      iconCode: period.iconCode,
      summary: period.summary,
      high: period.temperature,
      low: next?.night ? next.temperature : null,
    });
  });

  return {
    cityId: feature?.id ?? en(properties.identifier) ?? null,
    city: en(properties.name) ?? "",
    updatedAt: properties.lastUpdated ?? null,
    current: {
      temperature: numberOrNull(current.temperature?.value),
      iconCode: iconCodeOf(current.iconCode),
      condition: en(current.condition) ?? "",
      humidity: numberOrNull(current.relativeHumidity?.value),
      windDirection: en(current.wind?.direction?.value) ?? "",
      windSpeed: numberOrNull(current.wind?.speed?.value),
      windGust: numberOrNull(current.wind?.gust?.value),
    },
    periods,
    days,
    sunrise: en(properties.riseSet?.sunrise) ?? null,
    sunset: en(properties.riseSet?.sunset) ?? null,
    // Active alerts for the city (warnings, watches, advisories, statements).
    alerts: (properties.warnings ?? [])
      .map((warning) => ({
        type: String(en(warning.type) ?? "").toLowerCase(),
        description: String(en(warning.description) ?? ""),
        expiresAt: en(warning.expiryTime) ?? null,
      }))
      .filter((alert) => alert.description && alert.type !== "ended" && !/\bENDED\b/i.test(alert.description)),
  };
}

function distanceSquared([lon1, lat1], [lon2, lat2]) {
  const dLon = (lon1 - lon2) * Math.cos((lat1 * Math.PI) / 180);
  return dLon * dLon + (lat1 - lat2) * (lat1 - lat2);
}

export class WeatherService {
  constructor({
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    refreshMs = 10 * 60 * 1000,
    retryMs = 60 * 1000,
    timeoutMs = 20000,
    logger = console,
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.refreshMs = refreshMs;
    this.retryMs = retryMs;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    // Per FSA: { location: [lon, lat], cityId, data, nextRefreshAt, inFlight, error }
    this.states = new Map();
  }

  // Cached weather for `postalCode` (or an FSA), never blocking: { status,
  // data, error }, where data is parseCityPage()'s shape or null until the
  // first fetch completes. status is "ok", "loading", "error" or "invalid".
  getWeather(postalCode) {
    const fsa = forwardSortationArea(postalCode);
    if (!fsa) return { status: "invalid", data: null, error: "Set a Canadian postal code" };

    let state = this.states.get(fsa);
    if (!state) {
      state = { location: null, cityId: null, data: null, nextRefreshAt: 0, inFlight: null, error: null };
      this.states.set(fsa, state);
    }
    if (!state.inFlight && this.now() >= state.nextRefreshAt) {
      state.inFlight = this.refresh(fsa, state).finally(() => {
        state.inFlight = null;
      });
    }
    return {
      status: state.data ? "ok" : state.error ? "error" : "loading",
      data: state.data,
      error: state.error,
    };
  }

  async refresh(fsa, state) {
    try {
      state.location ??= await this.locate(fsa);
      state.cityId ??= await this.nearestCityId(state.location);
      const feature = await this.fetchJson(
        `${CITY_PAGE_URL}/${encodeURIComponent(state.cityId)}?f=json&lang=en`,
      );
      // The postal code's own location, for sunrise/sunset at the display
      // rather than at the forecast city's reference point.
      state.data = { ...parseCityPage(feature), location: state.location };
      state.error = null;
      state.nextRefreshAt = this.now() + this.refreshMs;
    } catch (error) {
      // Keep showing the last good forecast; retry sooner than a normal refresh.
      state.error = error.message;
      state.nextRefreshAt = this.now() + this.retryMs;
      this.logger.warn?.(`[weather] ${fsa}: ${error.message}`);
    }
  }

  async locate(fsa) {
    const results = await this.fetchJson(`${GEOLOCATOR_URL}?q=${encodeURIComponent(fsa)}`);
    const match = (Array.isArray(results) ? results : []).find(
      (result) => String(result.title).toUpperCase() === fsa && result.geometry?.coordinates,
    );
    if (!match) throw new Error(`No location found for postal code ${fsa}`);
    return match.geometry.coordinates;
  }

  async nearestCityId(location) {
    const [lon, lat] = location;
    for (const radius of SEARCH_RADII_DEGREES) {
      const bbox = [lon - radius, lat - radius, lon + radius, lat + radius]
        .map((value) => value.toFixed(3))
        .join(",");
      const collection = await this.fetchJson(`${CITY_PAGE_URL}?f=json&lang=en&limit=100&bbox=${bbox}`);
      const cities = (collection?.features ?? []).filter((feature) => feature.geometry?.coordinates);
      if (cities.length) {
        cities.sort(
          (a, b) =>
            distanceSquared(a.geometry.coordinates, location) -
            distanceSquared(b.geometry.coordinates, location),
        );
        return cities[0].id ?? en(cities[0].properties?.identifier);
      }
    }
    throw new Error("No weather.gc.ca city found near this postal code");
  }

  async fetchJson(url) {
    const response = await this.fetchImpl(url, {
      headers: { "User-Agent": "LED-Central weather display" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
    return response.json();
  }
}
