import { FONT_4X5, FONT_5X7, drawText, fitText, textWidth } from "../display/bitmap-fonts.js";
import { createCanvas } from "../display/raster.js";
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
};

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

// The next sunrise or sunset after `timestamp`, as e.g. "SET 6:29".
function nextSunEvent(data, timestamp, timeZone, use24Hour) {
  const events = [
    ["RISE", Date.parse(data.sunrise)],
    ["SET", Date.parse(data.sunset)],
  ]
    .filter(([, at]) => Number.isFinite(at) && at > timestamp)
    .sort((a, b) => a[1] - b[1]);
  if (!events.length) return "";
  const [label, at] = events[0];
  const { time } = formatTime(clockParts(at, timeZone), use24Hour);
  return `${label} ${time}`;
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

function drawForecastColumns(canvas, days, top, columnCount, timestamp) {
  const columnWidth = Math.floor(canvas.width / columnCount);
  const left = Math.floor((canvas.width - columnWidth * columnCount) / 2);
  days.slice(0, columnCount).forEach((day, index) => {
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
    drawForecastColumns(canvas, data.days, 34, Math.max(1, Math.floor(width / 21)), timestamp);
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
    const sunEvent = nextSunEvent(data, timestamp, parameters.timeZone, Boolean(parameters.use24Hour));
    if (sunEvent) drawRightAligned(canvas, sunEvent, width - 1, 26, FONT_4X5, COLORS.detail);
    for (let x = 1; x < width - 1; x += 1) canvas.pixels[32 * width + x] = COLORS.divider;
    drawForecastColumns(canvas, data.days, 34, Math.max(1, Math.floor(width / 25)), timestamp);
  }
  return canvas.pixels;
}
