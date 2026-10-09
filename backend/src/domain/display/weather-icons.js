import { moonElongation } from "./moon-phase.js";
import { fillCircle, hLine, line, setPixel } from "./raster.js";

// Weather icons drawn procedurally from a few parts (sun or moon, cloud,
// precipitation, lightning, fog, wind) so one design works at any size - a
// large current-conditions icon and small forecast icons alike - and ports to
// the firmware as the same handful of primitives instead of a sprite sheet.

// Greys keep their three channels equal: a HUB75 panel at reduced colour
// depth quantizes each channel separately, so a slightly bluish grey can come
// out visibly tinted (an earlier cloud colour read as magenta on the panel).
const COLORS = {
  sun: [255, 255, 0],
  sunRay: [255, 190, 0],
  moon: [230, 230, 220],
  moonDark: [55, 55, 55],
  cloud: [128, 128, 128],
  cloudShade: [90, 90, 90],
  darkCloud: [80, 80, 80],
  darkCloudShade: [55, 55, 55],
  rain: [60, 130, 255],
  freezing: [120, 230, 255],
  snow: [235, 240, 255],
  hail: [200, 220, 255],
  bolt: [255, 235, 60],
  fog: [150, 150, 160],
  wind: [170, 200, 220],
};

// weather.gc.ca icon codes (0-28 day, 30-39 night, 40+ special) to the parts
// that make up each icon. sky: "sun" | "moon" | null; cloud: "few" (a small
// cloud in front of the sky), "partly", "mostly" (the sky just peeking out),
// "overcast" or "dark"; precip: "rain" | "heavyRain" | "drizzle" | "freezing"
// | "mix" | "snow" | "heavySnow" | "hail". Mapping follows Environment
// Canada's condition groups (as used by Home Assistant's integration).
const ICONS = {
  0: { sky: "sun" },
  1: { sky: "sun", cloud: "few" },
  2: { sky: "sun", cloud: "partly" },
  3: { sky: "sun", cloud: "mostly" },
  4: { sky: "sun", cloud: "mostly" },
  5: { sky: "sun", cloud: "partly" },
  6: { sky: "sun", cloud: "partly", precip: "rain" },
  7: { sky: "sun", cloud: "partly", precip: "mix" },
  8: { sky: "sun", cloud: "partly", precip: "snow" },
  9: { sky: "sun", cloud: "partly", precip: "rain", bolt: true },
  10: { cloud: "overcast" },
  11: { cloud: "overcast", precip: "rain" },
  12: { cloud: "overcast", precip: "rain" },
  13: { cloud: "dark", precip: "heavyRain" },
  14: { cloud: "overcast", precip: "freezing" },
  15: { cloud: "overcast", precip: "mix" },
  16: { cloud: "overcast", precip: "snow" },
  17: { cloud: "overcast", precip: "snow" },
  18: { cloud: "dark", precip: "heavySnow" },
  19: { cloud: "dark", precip: "rain", bolt: true },
  20: { fog: true },
  21: { fog: true },
  22: { sky: "sun", cloud: "partly" },
  23: { sky: "sun", fog: true },
  24: { fog: true },
  25: { precip: "snow", wind: true },
  26: { cloud: "overcast", precip: "snow" },
  27: { cloud: "overcast", precip: "hail" },
  28: { cloud: "overcast", precip: "drizzle" },
  30: { sky: "moon" },
  31: { sky: "moon", cloud: "few" },
  32: { sky: "moon", cloud: "partly" },
  33: { sky: "moon", cloud: "mostly" },
  34: { sky: "moon", cloud: "mostly" },
  35: { sky: "moon", cloud: "partly" },
  36: { sky: "moon", cloud: "partly", precip: "rain" },
  37: { sky: "moon", cloud: "partly", precip: "mix" },
  38: { sky: "moon", cloud: "partly", precip: "snow" },
  39: { sky: "moon", cloud: "partly", precip: "rain", bolt: true },
  40: { precip: "heavySnow", wind: true },
  41: { cloud: "dark", wind: true },
  42: { cloud: "dark", wind: true },
  43: { wind: true },
  44: { fog: true },
  45: { fog: true, wind: true },
  46: { cloud: "dark", precip: "hail", bolt: true },
  47: { cloud: "dark", bolt: true },
  48: { cloud: "dark", wind: true },
};

export function weatherIconParts(iconCode) {
  return ICONS[Number(iconCode)] ?? { cloud: "overcast" };
}

function drawSun(canvas, cx, cy, radius) {
  const rayStart = radius + Math.max(1, radius * 0.35);
  const rayEnd = radius + Math.max(2, radius * 0.8);
  for (let ray = 0; ray < 8; ray += 1) {
    const angle = (ray * Math.PI) / 4;
    line(
      canvas,
      cx - 0.5 + Math.cos(angle) * rayStart,
      cy - 0.5 + Math.sin(angle) * rayStart,
      cx - 0.5 + Math.cos(angle) * rayEnd,
      cy - 0.5 + Math.sin(angle) * rayEnd,
      COLORS.sunRay,
    );
  }
  fillCircle(canvas, cx, cy, radius, COLORS.sun);
}

// The Moon as it actually looks at `elongation` (see moon-phase.js), as seen
// from the northern hemisphere: lit from the right while waxing, the left
// while waning, the terminator an ellipse across the disc. The dark part is
// drawn grey so the disc still reads as a moon, and at least one column on
// the lit limb stays lit, so a new moon shows which side of new it's on.
function drawMoon(canvas, cx, cy, radius, elongation) {
  const waxing = elongation < 180;
  const terminator = Math.cos((elongation * Math.PI) / 180);
  const limbByRow = new Map();
  let litCount = 0;
  for (let py = Math.floor(cy - radius); py <= Math.ceil(cy + radius); py += 1) {
    for (let px = Math.floor(cx - radius); px <= Math.ceil(cx + radius); px += 1) {
      const dx = (px + 0.5 - cx) / radius;
      const dy = (py + 0.5 - cy) / radius;
      if (dx * dx + dy * dy > 1) continue;
      const halfWidth = Math.sqrt(1 - dy * dy);
      const lit = waxing ? dx > halfWidth * terminator : dx < -halfWidth * terminator;
      if (lit) litCount += 1;
      setPixel(canvas, px, py, lit ? COLORS.moon : COLORS.moonDark);
      const limb = limbByRow.get(py);
      if (limb === undefined || (waxing ? px > limb : px < limb)) limbByRow.set(py, px);
    }
  }
  if (litCount === 0) {
    for (const [py, px] of limbByRow) setPixel(canvas, px, py, COLORS.moon);
  }
}

// A cloud filling the box (x, y, w, h): three overlapping puffs on a flat
// base, with a darker underside so it reads as a shape and not a blob.
function drawCloud(canvas, x, y, w, h, dark) {
  const body = dark ? COLORS.darkCloud : COLORS.cloud;
  const shade = dark ? COLORS.darkCloudShade : COLORS.cloudShade;
  const puffs = [
    [x + w * 0.27, y + h * 0.62, h * 0.38],
    [x + w * 0.52, y + h * 0.45, h * 0.47],
    [x + w * 0.77, y + h * 0.64, h * 0.36],
  ];
  const inside = (px, py) =>
    puffs.some(([cx, cy, r]) => (px + 0.5 - cx) ** 2 + (py + 0.5 - cy) ** 2 <= r * r) ||
    (py + 0.5 >= y + h * 0.62 && py + 0.5 <= y + h && px + 0.5 >= x + w * 0.27 && px + 0.5 <= x + w * 0.77);
  for (let py = Math.floor(y); py < Math.ceil(y + h); py += 1) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px += 1) {
      if (!inside(px, py)) continue;
      setPixel(canvas, px, py, inside(px, py + 1) ? body : shade);
    }
  }
}

// Precipitation within the box (x, y, w, h): columns of drops or flakes on a
// staggered grid, so even a small icon shows a few distinct particles.
function drawPrecip(canvas, x, y, w, h, kind) {
  const step = w >= 14 ? 4 : 3;
  const columns = Math.max(2, Math.floor((w - 1) / step));
  const left = Math.round(x + (w - (columns - 1) * step) / 2) - 1;
  for (let column = 0; column < columns; column += 1) {
    const px = left + column * step;
    const stagger = column % 2 === 0 ? 0 : Math.max(1, Math.round(h / 3));
    for (let py = Math.round(y) + stagger; py < y + h; py += Math.max(3, Math.round(h * 0.6))) {
      const flake =
        kind === "snow" ||
        kind === "heavySnow" ||
        (kind === "mix" && column % 2 === 1);
      if (flake) {
        setPixel(canvas, px, py, COLORS.snow);
        if (kind === "heavySnow" || w >= 14) {
          setPixel(canvas, px - 1, py + 1, COLORS.snow);
          setPixel(canvas, px + 1, py + 1, COLORS.snow);
          setPixel(canvas, px, py + 2, COLORS.snow);
        }
      } else if (kind === "hail") {
        setPixel(canvas, px, py, COLORS.hail);
        setPixel(canvas, px + 1, py, COLORS.hail);
        setPixel(canvas, px, py + 1, COLORS.hail);
        setPixel(canvas, px + 1, py + 1, COLORS.hail);
      } else {
        const color = kind === "freezing" ? COLORS.freezing : COLORS.rain;
        const length = kind === "drizzle" ? 1 : kind === "heavyRain" ? 3 : 2;
        line(canvas, px + 1, py, px + 1 - (length - 1), py + length - 1, color);
        if (kind === "freezing") setPixel(canvas, px - length + 1, py + length + 1, COLORS.snow);
      }
    }
  }
}

// A simple sawtooth bolt on whole pixels (anti-aliased diagonals come out
// ragged at this size): one pixel per row stepping down-left, a three-pixel
// jog back to the right, then down-left again.
function drawBolt(canvas, x, y, w, h) {
  const top = Math.round(y);
  const rows = Math.max(4, Math.round(h));
  const jogRow = Math.floor((rows - 1) / 2);
  const start = Math.round(x + w / 2) + 1;
  for (let row = 0; row < rows; row += 1) {
    if (row < jogRow) {
      setPixel(canvas, start - row, top + row, COLORS.bolt);
    } else if (row === jogRow) {
      hLine(canvas, start - jogRow, start - jogRow + 2, top + row, COLORS.bolt);
    } else {
      setPixel(canvas, start - jogRow + 1 - (row - jogRow - 1), top + row, COLORS.bolt);
    }
  }
}

function drawFog(canvas, x, y, w, h) {
  const rows = Math.max(2, Math.floor(h / 3));
  for (let row = 0; row < rows; row += 1) {
    const py = Math.round(y + row * 3);
    const inset = row % 2 === 0 ? 0 : Math.round(w * 0.15);
    hLine(canvas, x + inset, x + w - 1 - Math.round(w * 0.15) + inset, py, COLORS.fog);
  }
}

function drawWind(canvas, x, y, w, h) {
  const rows = [0.2, 0.5, 0.8];
  rows.forEach((fraction, index) => {
    const py = Math.round(y + h * fraction);
    const end = x + w * (index === 1 ? 0.95 : 0.75);
    hLine(canvas, x + (index === 1 ? 0 : w * 0.1), end - 1, py, COLORS.wind);
    setPixel(canvas, end, py - 1, COLORS.wind);
  });
}

// Draws the icon for `iconCode` in the size x size square at (x, y). The
// moon's phase is drawn for `timestamp`.
export function drawWeatherIcon(canvas, iconCode, x, y, size, { timestamp = Date.now() } = {}) {
  const parts = weatherIconParts(iconCode);
  const elongation = moonElongation(timestamp);
  const hasLower = Boolean(parts.precip || parts.bolt);
  const dark = parts.cloud === "dark";

  if (parts.fog && !parts.cloud) {
    if (parts.sky) {
      drawSun(canvas, x + size * 0.5, y + size * 0.32, size * 0.2);
      drawFog(canvas, x, y + size * 0.62, size, size * 0.38);
    } else {
      drawFog(canvas, x, y + size * 0.15, size, size * 0.8);
    }
    if (parts.wind) drawWind(canvas, x, y, size, size * 0.3);
    return;
  }

  if (!parts.cloud && !parts.sky) {
    if (parts.precip) {
      drawPrecip(canvas, x, y + size * 0.05, size, size * 0.55, parts.precip);
      if (parts.wind) drawWind(canvas, x, y + size * 0.62, size, size * 0.35);
    } else if (parts.wind) {
      drawWind(canvas, x, y + size * 0.15, size, size * 0.7);
    }
    return;
  }

  // Region the cloud (or a lone sun/moon) occupies: the top part when there
  // is precipitation or lightning beneath it, otherwise the whole square.
  const skyHeight = hasLower ? size * 0.62 : size;

  if (parts.sky && !parts.cloud) {
    const radius = size * (hasLower ? 0.2 : 0.24);
    if (parts.sky === "sun") drawSun(canvas, x + size / 2, y + skyHeight / 2, radius);
    else drawMoon(canvas, x + size / 2, y + skyHeight / 2, size * 0.34, elongation);
  } else {
    if (parts.sky) {
      const peeking = parts.cloud === "mostly";
      const scale = hasLower ? 0.7 : 1;
      const radius = size * (peeking ? 0.15 : 0.19) * scale;
      const cx = x + size * (peeking ? 0.33 : 0.36);
      const cy = y + size * (peeking ? 0.3 : 0.34) * scale;
      if (parts.sky === "sun") drawSun(canvas, cx, cy, radius);
      else drawMoon(canvas, cx, cy, radius * 1.35, elongation);
    }
    const cloudBox = {
      few: [0.42, 0.5, 0.58, 0.38],
      partly: [0.18, 0.4, 0.82, 0.5],
      mostly: [0.08, 0.3, 0.92, 0.6],
      overcast: [0.02, 0.18, 0.96, 0.7],
      dark: [0.02, 0.18, 0.96, 0.7],
    }[parts.cloud];
    const [bx, by, bw, bh] = cloudBox;
    drawCloud(canvas, x + size * bx, y + skyHeight * by, size * bw, skyHeight * bh, dark);
  }

  // Beneath the cloud: precipitation across the width, or - with lightning
  // too - precipitation on the left and the bolt beside it on the right.
  const lowerTop = y + skyHeight * 0.88;
  const lowerHeight = y + size - lowerTop;
  if (parts.precip && parts.bolt) {
    drawPrecip(canvas, x + size * 0.04, lowerTop, size * 0.58, lowerHeight, parts.precip);
    drawBolt(canvas, x + size * 0.55, lowerTop - 1, size * 0.4, lowerHeight + 1);
  } else if (parts.precip) {
    drawPrecip(canvas, x + size * 0.08, lowerTop, size * 0.84, lowerHeight, parts.precip);
  } else if (parts.bolt) {
    drawBolt(canvas, x + size * 0.2, lowerTop - 1, size * 0.6, lowerHeight + 1);
  }
}
