// Minimal drawing primitives over a row-major [r, g, b] pixel array, the
// frame format every renderer returns. Everything is clipped to the canvas.

export function createCanvas(width, height, fill = [0, 0, 0]) {
  return {
    width,
    height,
    pixels: Array.from({ length: width * height }, () => fill),
  };
}

export function setPixel(canvas, x, y, color) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return;
  canvas.pixels[py * canvas.width + px] = color;
}

export function fillRect(canvas, x, y, w, h, color) {
  for (let py = Math.round(y); py < Math.round(y + h); py += 1) {
    for (let px = Math.round(x); px < Math.round(x + w); px += 1) setPixel(canvas, px, py, color);
  }
}

export function hLine(canvas, x0, x1, y, color) {
  for (let x = Math.round(Math.min(x0, x1)); x <= Math.round(Math.max(x0, x1)); x += 1) {
    setPixel(canvas, x, y, color);
  }
}

// Bresenham line between integer-rounded endpoints.
export function line(canvas, x0, y0, x1, y1, color) {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xEnd = Math.round(x1);
  const yEnd = Math.round(y1);
  const dx = Math.abs(xEnd - x);
  const dy = -Math.abs(yEnd - y);
  const sx = x < xEnd ? 1 : -1;
  const sy = y < yEnd ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    setPixel(canvas, x, y, color);
    if (x === xEnd && y === yEnd) break;
    const e2 = 2 * error;
    if (e2 >= dy) {
      error += dy;
      x += sx;
    }
    if (e2 <= dx) {
      error += dx;
      y += sy;
    }
  }
}

// Fills every pixel whose centre lies within `radius` of (cx, cy); the
// centre may be fractional, which keeps small circles symmetric.
export function fillCircle(canvas, cx, cy, radius, color, keep = () => true) {
  const r2 = radius * radius;
  for (let py = Math.floor(cy - radius); py <= Math.ceil(cy + radius); py += 1) {
    for (let px = Math.floor(cx - radius); px <= Math.ceil(cx + radius); px += 1) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      if (dx * dx + dy * dy <= r2 && keep(px, py)) setPixel(canvas, px, py, color);
    }
  }
}
