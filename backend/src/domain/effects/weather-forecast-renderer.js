import { FONT_4X5, FONT_5X7, drawText, fitText, textWidth } from "../display/bitmap-fonts.js";
import { createCanvas } from "../display/raster.js";
import { sunTimes } from "../display/sun-times.js";
import { drawWeatherIcon } from "../display/weather-icons.js";

// Weather display for HUB75-sized matrices: time and date, current
// conditions (icon, large temperature, condition, wind, humidity) and a row
// of daily forecast columns. Weather data arrives as `parameters.weather` -
// WeatherService.getWeather()'s { status, data, error } - injected by
// playback, so this stays a pure function of its inputs like every renderer.
//
// Two layouts: "wide" (128x64 and up) shows the condition text, wind and
// humidity beside the temperature and five forecast days; "compact" (64x64)
// stacks a shorter condition under the temperature and shows three days.

const COLORS = {
  time: [235, 235, 235],
  meridiem: [150, 150, 150],
  date: [90, 190, 255],
  temperature: [255, 255, 255],
  condition: [235, 235, 235],
  detail: [150, 150, 150],
  dayName: [215, 205, 120],
  high: [255, 150, 60],
  low: [90, 160, 255],
  message: [180, 180, 180],
  divider: [35, 35, 45],
  sunrise: [255, 200, 0],
  sunset: [255, 120, 40],
  alertText: [255, 255, 255],
};

// Alert boxes follow weather.gc.ca's colours: red warnings, yellow watches,
// grey advisories and statements. Most severe first.
const ALERT_STYLES = {
  warning: { label: "WARNING", border: [255, 0, 0], fill: [50, 0, 0], rank: 0 },
  watch: { label: "WATCH", border: [255, 200, 0], fill: [45, 35, 0], rank: 1 },
  advisory: { label: "ADVISORY", border: [128, 128, 128], fill: [25, 25, 25], rank: 2 },
  statement: { label: "STATEMENT", shortLabel: "NOTICE", border: [128, 128, 128], fill: [25, 25, 25], rank: 3 },
};
const ALERT_CYCLE_MS = 5000;

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// Wall-clock parts of `timestamp` in `timeZone` (IANA name; empty or invalid
// falls back to the host's own zone).
export function clockParts(timestamp, timeZone) {
  const options = {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    month: "short",
    day: "numeric",
    hourCycle: "h23",
  };
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-US", { ...options, timeZone: timeZone || undefined });
  } catch {
    formatter = new Intl.DateTimeFormat("en-US", options);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );
  return {
    hour: Number(parts.hour) % 24,
    minute: parts.minute,
    second: parts.second,
    weekday: parts.weekday,
    month: parts.month,
    day: parts.day,
  };
}

function formatTime(clock, use24Hour, withSeconds = false) {
  const seconds = withSeconds ? `:${clock.second}` : "";
  if (use24Hour) {
    return { time: `${String(clock.hour).padStart(2, "0")}:${clock.minute}${seconds}`, meridiem: "" };
  }
  const hour12 = clock.hour % 12 === 0 ? 12 : clock.hour % 12;
  return { time: `${hour12}:${clock.minute}${seconds}`, meridiem: clock.hour < 12 ? "AM" : "PM" };
}

const degrees = (value) => (value === null || value === undefined ? "--" : `${Math.round(value)}°`);

// Progressively shorter wordings for ECCC condition text, tried in order
// until it fits; fitText() trims whatever still doesn't.
const ABBREVIATIONS = [
  [/a mix of sun and cloud/i, "Sun and cloud"],
  [/thunderstorms?/i, "T-storms"],
  [/chance of /i, "Chc "],
  [/periods of /i, ""],
  [/ and /i, " & "],
  [/mostly /i, "Mstly "],
  [/partly /i, "Ptly "],
  [/showers/i, "Shwrs"],
  [/flurries/i, "Flurr"],
];

function shortenToFit(text, font, maxWidth) {
  let value = String(text);
  for (const [pattern, replacement] of ABBREVIATIONS) {
    if (textWidth(value, font) <= maxWidth) break;
    value = value.replace(pattern, replacement);
  }
  return fitText(value, font, maxWidth);
}

// Local calendar date of `timestamp` as "YYYY-MM-DD".
function localIsoDate(timestamp, timeZone) {
  const options = { year: "numeric", month: "2-digit", day: "2-digit" };
  try {
    return new Intl.DateTimeFormat("en-CA", { ...options, timeZone: timeZone || undefined }).format(timestamp);
  } catch {
    return new Intl.DateTimeFormat("en-CA", options).format(timestamp);
  }
}

// Sunrise/sunset for a local calendar date, at the postal code's own
// location (weather.gc.ca's times are for the forecast city's reference
// point, a minute or so off).
function sunTimesOn(date, data) {
  const [longitude, latitude] = data.location ?? [];
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return sunTimes(date, latitude, longitude);
}

const nextIsoDate = (date) => new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);

// How long a sunrise or sunset stays on screen after it happens before the
// display moves on to the next one.
const SUN_EVENT_LINGER_MS = 60 * 60 * 1000;

// The sun event to show: today's sunrise until an hour after it, then
// today's sunset until an hour after that, then tomorrow's sunrise. Falls
// back to the city page's times when the postal code's location is unknown.
export function sunEventToShow(data, timestamp, timeZone) {
  const today = localIsoDate(timestamp, timeZone);
  const todays = sunTimesOn(today, data);
  const tomorrows = sunTimesOn(nextIsoDate(today), data);
  const events = todays && tomorrows
    ? [
        { label: "RISE", at: todays.sunrise },
        { label: "SET", at: todays.sunset },
        { label: "RISE", at: tomorrows.sunrise },
      ]
    : [
        { label: "RISE", at: Date.parse(data.sunrise) },
        { label: "SET", at: Date.parse(data.sunset) },
      ].filter((event) => Number.isFinite(event.at)).sort((x, y) => x.at - y.at);
  return events.find((event) => event.at + SUN_EVENT_LINGER_MS > timestamp) ?? events[events.length - 1] ?? null;
}

// The alerts still in effect at `timestamp`, most severe first.
export function activeAlerts(data, timestamp) {
  return (data.alerts ?? [])
    .filter((alert) => !alert.expiresAt || Date.parse(alert.expiresAt) > timestamp)
    .sort((a, b) => (ALERT_STYLES[a.type]?.rank ?? 9) - (ALERT_STYLES[b.type]?.rank ?? 9));
}

// Words of `text` wrapped into lines no wider than `maxWidth`, shortening
// any single word that can't fit on a line of its own.
function wrapText(text, font, maxWidth) {
  const lines = [];
  for (const rawWord of String(text).split(/\s+/).filter(Boolean)) {
    const word = shortenToFit(rawWord.replace(/THUNDERSTORM/i, "T-STORM"), font, maxWidth);
    const candidate = lines.length ? `${lines[lines.length - 1]} ${word}` : word;
    if (lines.length && textWidth(candidate, font) <= maxWidth) lines[lines.length - 1] = candidate;
    else lines.push(word);
  }
  return lines;
}

// An alert box over the area (x, y, w, h): a border in the alert's colour,
// its type as a heading, and the description (without the type word).
function drawAlert(canvas, alert, x, y, w, h) {
  const style = ALERT_STYLES[alert.type] ?? ALERT_STYLES.statement;
  for (let py = y; py < y + h; py += 1) {
    for (let px = x; px < x + w; px += 1) {
      const edge = py === y || py === y + h - 1 || px === x || px === x + w - 1;
      if (px >= 0 && px < canvas.width && py >= 0 && py < canvas.height) {
        canvas.pixels[py * canvas.width + px] = edge ? style.border : style.fill;
      }
    }
  }
  const inner = w - 4;
  const heading = textWidth(style.label, FONT_4X5) <= inner ? style.label : (style.shortLabel ?? style.label);
  drawCentered(canvas, heading, x + w / 2, y + 2, FONT_4X5, style.border);
  const body = alert.description.replace(new RegExp(`\\s*\\b${style.label}\\b`, "i"), "").trim() || alert.description;
  const maxLines = Math.floor((h - 9) / 7);
  wrapText(body.toUpperCase(), FONT_4X5, inner)
    .slice(0, maxLines)
    .forEach((line, index) => {
      drawCentered(canvas, line, x + w / 2, y + 9 + index * 7, FONT_4X5, COLORS.alertText);
    });
}

function windText(current) {
  if (current.windSpeed === null) return "";
  if (current.windSpeed === 0) return "CALM";
  const gust = current.windGust ? `G${Math.round(current.windGust)}` : "";
  return `${current.windDirection} ${Math.round(current.windSpeed)}${gust ? ` ${gust}` : ""} KM/H`;
}

function drawCentered(canvas, text, centerX, y, font, color) {
  drawText(canvas.pixels, canvas.width, canvas.height, text, Math.round(centerX - textWidth(text, font) / 2), y, font, color);
}

function drawRightAligned(canvas, text, right, y, font, color) {
  drawText(canvas.pixels, canvas.width, canvas.height, text, right - textWidth(text, font), y, font, color);
}

function drawHeader(canvas, clock, use24Hour, compact) {
  const { time, meridiem } = formatTime(clock, use24Hour, !compact);
  const end = drawText(canvas.pixels, canvas.width, canvas.height, time, 1, 0, FONT_5X7, COLORS.time);
  if (meridiem) drawText(canvas.pixels, canvas.width, canvas.height, meridiem, end + 2, 2, FONT_4X5, COLORS.meridiem);
  if (compact) {
    drawRightAligned(canvas, `${clock.month} ${clock.day}`, canvas.width - 1, 2, FONT_4X5, COLORS.date);
  } else {
    drawRightAligned(canvas, `${clock.weekday} ${clock.month} ${clock.day}`, canvas.width - 1, 0, FONT_5X7, COLORS.date);
  }
}

// Forecast columns, with the furthest `alertColumns` of them given over to
// the current alert (cycling through several) when there is one.
function drawForecastColumns(canvas, days, top, columnCount, timestamp, alerts = []) {
  const columnWidth = Math.floor(canvas.width / columnCount);
  const left = Math.floor((canvas.width - columnWidth * columnCount) / 2);
  const alertColumns = alerts.length ? Math.min(2, columnCount) : 0;
  if (alertColumns) {
    const alert = alerts[Math.floor(timestamp / ALERT_CYCLE_MS) % alerts.length];
    const alertLeft = left + columnWidth * (columnCount - alertColumns);
    drawAlert(canvas, alert, alertLeft, top, canvas.width - alertLeft, canvas.height - top);
  }
  days.slice(0, columnCount - alertColumns).forEach((day, index) => {
    const centerX = left + columnWidth * index + columnWidth / 2;
    const name = day.night
      ? "NITE"
      : (WEEKDAYS.find((weekday) => day.day.toUpperCase().startsWith(weekday)) ?? day.day.slice(0, 3));
    drawCentered(canvas, name, centerX, top, FONT_4X5, COLORS.dayName);
    drawWeatherIcon(canvas, day.iconCode, Math.round(centerX - 6), top + 6, 12, { timestamp });
    if (day.high !== null) drawCentered(canvas, degrees(day.high), centerX + 1, top + 19, FONT_4X5, COLORS.high);
    if (day.low !== null) drawCentered(canvas, degrees(day.low), centerX + 1, top + 25, FONT_4X5, COLORS.low);
  });
}

function drawMessage(canvas, text, top) {
  const words = String(text).toUpperCase().split(/\s+/);
  const lines = [];
  for (const word of words) {
    const candidate = lines.length ? `${lines[lines.length - 1]} ${word}` : word;
    if (lines.length && textWidth(candidate, FONT_4X5) <= canvas.width - 2) lines[lines.length - 1] = candidate;
    else lines.push(word);
  }
  lines.slice(0, 5).forEach((line, index) => {
    drawCentered(canvas, fitText(line, FONT_4X5, canvas.width - 2), canvas.width / 2, top + index * 7, FONT_4X5, COLORS.message);
  });
}

export function renderWeatherForecast({ width, height, parameters, timestamp }) {
  const canvas = createCanvas(width, height);
  const compact = width < 96;
  const clock = clockParts(timestamp, parameters.timeZone);
  drawHeader(canvas, clock, Boolean(parameters.use24Hour), compact);

  const weather = parameters.weather;
  const data = weather?.data;
  if (!data) {
    const message =
      weather?.status === "invalid"
        ? weather.error
        : weather?.error
          ? `Weather unavailable: ${weather.error}`
          : "Loading weather...";
    drawMessage(canvas, message, 20);
    return canvas.pixels;
  }

  const current = data.current;
  const alerts = activeAlerts(data, timestamp);
  drawWeatherIcon(canvas, current.iconCode, compact ? 0 : 1, 9, 16, { timestamp });
  // The number at double size, its degree sign at normal size beside it.
  const temperature = current.temperature === null ? "--" : String(Math.round(current.temperature));
  let temperatureEnd = drawText(
    canvas.pixels, canvas.width, canvas.height, temperature, compact ? 19 : 20, 10, FONT_5X7, COLORS.temperature, 2,
  );
  if (current.temperature !== null) {
    temperatureEnd = drawText(canvas.pixels, canvas.width, canvas.height, "°", temperatureEnd + 1, 10, FONT_5X7, COLORS.temperature);
  }

  if (compact) {
    drawText(
      canvas.pixels, canvas.width, canvas.height,
      shortenToFit(current.condition, FONT_4X5, width - 2), 1, 27, FONT_4X5, COLORS.condition,
    );
    drawForecastColumns(canvas, data.days, 34, Math.max(1, Math.floor(width / 21)), timestamp, alerts);
  } else {
    const textLeft = Math.max(temperatureEnd + 4, 50);
    const textWidthAvailable = width - textLeft - 1;
    drawText(
      canvas.pixels, canvas.width, canvas.height,
      shortenToFit(current.condition, FONT_5X7, textWidthAvailable), textLeft, 9, FONT_5X7, COLORS.condition,
    );
    drawText(
      canvas.pixels, canvas.width, canvas.height,
      fitText(windText(current), FONT_4X5, textWidthAvailable), textLeft, 19, FONT_4X5, COLORS.detail,
    );
    if (current.humidity !== null) {
      drawText(canvas.pixels, canvas.width, canvas.height, `HUM ${Math.round(current.humidity)}%`, textLeft, 26, FONT_4X5, COLORS.detail);
    }
    const sunEvent = sunEventToShow(data, timestamp, parameters.timeZone);
    if (sunEvent) {
      const { time } = formatTime(clockParts(sunEvent.at, parameters.timeZone), Boolean(parameters.use24Hour));
      drawRightAligned(
        canvas, `${sunEvent.label} ${time}`, width - 1, 26, FONT_4X5,
        sunEvent.label === "RISE" ? COLORS.sunrise : COLORS.sunset,
      );
    }
    for (let x = 1; x < width - 1; x += 1) canvas.pixels[32 * width + x] = COLORS.divider;
    drawForecastColumns(canvas, data.days, 34, Math.max(1, Math.floor(width / 25)), timestamp, alerts);
  }
  return canvas.pixels;
}
