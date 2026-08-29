export class EffectRenderError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class EffectRenderService {
  render({ effect, canvas, parameters = {}, timestamp = Date.now() }) {
    const renderer = renderers[effect.renderer];
    if (!renderer) {
      throw new EffectRenderError(`Unsupported effect renderer: ${effect.renderer}`);
    }

    return {
      timestamp,
      pixels: renderer({
        width: canvas.width,
        height: canvas.height,
        parameters: { ...defaultParameters(effect.parameters), ...parameters },
        timestamp
      })
    };
  }
}

const renderers = {
  solid: ({ width, height, parameters }) => {
    const color = parseColor(parameters.color);
    return Array.from({ length: width * height }, () => color);
  },
  'dave-debug': ({ width, height }) => {
    const pixels = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const hue = ((x + y) * 255) / Math.max(1, width + height - 2);
        pixels.push(hsvToRgb(hue, 255, 255));
      }
    }
    return pixels;
  },
  gradient: ({ width, height, parameters }) => {
    const start = parseColor(parameters.startColor);
    const end = parseColor(parameters.endColor);
    const angle = (Number(parameters.angle) * Math.PI) / 180;
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const denominator = Math.max(1, Math.abs(directionX) * (width - 1) + Math.abs(directionY) * (height - 1));
    return Array.from({ length: width * height }, (_, index) => {
      const x = index % width;
      const y = Math.floor(index / width);
      const position = Math.max(0, Math.min(1, (x * directionX + y * directionY) / denominator));
      return start.map((channel, channelIndex) => Math.round(channel + (end[channelIndex] - channel) * position));
    });
  },
  wave: ({ width, height, parameters, timestamp }) => {
    const color = parseColor(parameters.color);
    const speed = Number(parameters.speed) || 0;
    const waveWidth = Math.max(1, Number(parameters.width) || 1);
    const phaseOffset = (timestamp / 1000) * speed;
    return Array.from({ length: width * height }, (_, index) => {
      const x = index % width;
      const intensity = (Math.sin((x / waveWidth) * Math.PI * 2 + phaseOffset) + 1) / 2;
      return color.map(channel => Math.round(channel * intensity));
    });
  },
  'color-wave': ({ width, height, parameters, timestamp }) => {
    const speed = Number(parameters.speed) || 0.5;
    const waveFrequency = Number(parameters.waveFrequency) || 10;
    const phase = ((timestamp / 1000) * speed) % 1;
    const pixels = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const localHue = (phase + (x / Math.max(1, width)) * waveFrequency) % 1;
        pixels.push(hsvToRgb(localHue * 255, 255, 255));
      }
    }
    return pixels;
  },
  'palette-scroll': ({ width, height, parameters, timestamp }) => {
    const palette = normalizePalette(parameters.palette);
    const brightness = clamp(Number(parameters.brightness ?? 1), 0, 1);
    const density = Math.max(0.1, Number(parameters.density ?? 1));
    const scrollSpeed = Number(parameters.ledScrollSpeed ?? 0);
    const colorRate = Number(parameters.ledColorPerSecond ?? 0);
    const everyNthDot = Math.max(1, Number(parameters.everyNthDot ?? 1));
    const dotSize = Math.max(1, Number(parameters.dotSize ?? 1));
    const mirrored = Boolean(parameters.mirrored);
    const totalPixels = width * height;
    const pixels = Array.from({ length: totalPixels }, () => [0, 0, 0]);
    const seconds = timestamp / 1000;
    const phase = seconds * (scrollSpeed + colorRate * 0.25) * density;

    for (let index = 0; index < totalPixels; index += 1) {
      if ((index % everyNthDot) !== 0) continue;

      const travel = (index / Math.max(1, totalPixels - 1)) + (phase / Math.max(1, totalPixels));
      const palettePhase = (travel + (index % Math.max(1, palette.length)) / Math.max(1, palette.length)) % 1;
      const color = interpolatePalette(palette, palettePhase);
      const brightened = color.map(channel => Math.round(channel * brightness));

      for (let offset = 0; offset < dotSize; offset += 1) {
        const pixelIndex = (index + offset) % totalPixels;
        pixels[pixelIndex] = brightened;
        if (mirrored) {
          const mirrorIndex = (totalPixels - 1 - pixelIndex + totalPixels) % totalPixels;
          pixels[mirrorIndex] = brightened;
        }
      }
    }
    return pixels;
  },
  starfield: ({ width, height, parameters }) => {
    const starCount = Math.max(0, Number(parameters.starCount ?? 0));
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    const rng = mulberry32((starCount * 97) + width + height);
    for (let i = 0; i < starCount; i += 1) {
      const x = Math.floor(rng() * width);
      const y = Math.floor(rng() * height);
      const base = [255, 255, 255];
      const accent = [Math.random() * 255, Math.random() * 255, Math.random() * 255];
      pixels[y * width + x] = i % 2 === 0 ? base : accent;
    }
    return pixels;
  },
  'bouncing-balls': ({ width, height, parameters, timestamp }) => {
    const ballCount = Math.max(1, Number(parameters.ballCount ?? 5));
    const ballSize = Math.max(1, Number(parameters.ballSize ?? 1));
    const mirrored = Boolean(parameters.mirrored);
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    const phase = timestamp / 1000;

    for (let ball = 0; ball < ballCount; ball += 1) {
      const offset = (ball + 1) * 0.9;
      const movement = (Math.sin(phase * (1.2 + ball * 0.2) + offset) + 1) / 2;
      const amplitude = Math.max(0, width - ballSize - 1);
      const position = Math.round(movement * amplitude);
      const color = paletteFromIndex(ball, ballCount);

      for (let x = 0; x < ballSize; x += 1) {
        const px = Math.min(width - 1, position + x);
        pixels[px] = color;
        if (mirrored) {
          const mirroredX = Math.max(0, width - 1 - px);
          pixels[mirroredX] = color;
        }
      }
    }
    return pixels;
  },
  fireworks: ({ width, height, parameters, timestamp }) => {
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    const maxSpeed = Number(parameters.maxSpeed ?? 175);
    const particleSize = Number(parameters.particleSize ?? 1);
    const phase = timestamp / 1000;
    const burstCount = 4;
    for (let burst = 0; burst < burstCount; burst += 1) {
      const cx = Math.floor(((burst + 1) / (burstCount + 1)) * width);
      const cy = Math.floor((Math.sin(phase * 0.9 + burst) + 1) * (height / 2));
      const color = paletteFromIndex(burst, burstCount);
      for (let offset = 0; offset < 8; offset += 1) {
        const x = Math.round(cx + Math.sin((offset + burst) * 1.4 + phase) * (maxSpeed / 20));
        const y = Math.round(cy + Math.cos((offset + burst) * 1.2 + phase) * (maxSpeed / 25));
        if (x >= 0 && x < width && y >= 0 && y < height) {
          const start = (y * width) + x;
          for (let radius = 0; radius < particleSize; radius += 1) {
            const idx = start + radius;
            if (idx >= 0 && idx < pixels.length) pixels[idx] = color;
          }
        }
      }
    }
    return pixels;
  },
  'stock-banner': ({ width, height, parameters }) => {
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    const symbols = Array.isArray(parameters.symbols) && parameters.symbols.length > 0
      ? parameters.symbols
      : ['NDS', 'AAPL', 'MSFT'];
    const label = symbols.join('  ');
    const wrap = label.padEnd(Math.max(label.length, width / 2), ' ');
    const offset = Math.floor((Date.now() / 600) % wrap.length);
    for (let x = 0; x < width; x += 1) {
      const charIndex = offset + x;
      const char = wrap[charIndex % wrap.length] ?? ' ';
      if (char !== ' ') {
        const color = (char.charCodeAt(0) % 3 === 0) ? [255, 128, 0] : [0, 255, 200];
        pixels[(height / 2) * width + x] = color;
      }
    }
    return pixels;
  },
  'mp4-playback': ({ width, height, parameters, timestamp }) => {
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    const filePath = String(parameters.filePath ?? './media/mp4/goldendollars.mp4');
    const banner = filePath.includes('golden') ? 'GOLD' : 'VIDEO';
    const timeScale = timestamp / 1000;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const phase = (x * 0.45) + (y * 0.2) + (timeScale * 3.1);
        const hue = ((Math.sin(phase) + 1) / 2) * 255;
        const char = banner[(x + Math.floor(timeScale * 2)) % banner.length];
        const color = char === 'G' ? [255, 215, 0] : [115, 220, 255];
        const shimmer = hsvToRgb(hue, 180, 220);
        const pixel = (Math.sin(phase * 1.8) + 1) > 0.4 ? color : shimmer;
        pixels[y * width + x] = pixel;
      }
    }
    return pixels;
  }
};

function defaultParameters(schema = {}) {
  return Object.fromEntries(Object.entries(schema).map(([name, definition]) => [name, definition.default]));
}

function parseColor(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new EffectRenderError(`Invalid color: ${value}`);
  }
  return [1, 3, 5].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hsvToRgb(h, s, v) {
  const hue = ((h % 256) + 256) % 256;
  const sNorm = clamp(s / 255, 0, 1);
  const vNorm = clamp(v / 255, 0, 1);
  const c = vNorm * sNorm;
  const x = c * (1 - Math.abs(((hue / 255) * 6) % 2 - 1));
  const m = vNorm - c;
  let r = 0;
  let g = 0;
  let b = 0;
  const sector = (hue / 255) * 6;
  if (sector >= 0 && sector < 1) [r, g, b] = [c, x, 0];
  else if (sector < 2) [r, g, b] = [x, c, 0];
  else if (sector < 3) [r, g, b] = [0, c, x];
  else if (sector < 4) [r, g, b] = [0, x, c];
  else if (sector < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function normalizePalette(palette) {
  if (Array.isArray(palette)) {
    return palette.map(color => parseColor(color));
  }
  const values = Array.isArray(palette?.colors) ? palette.colors : ['#ff0000', '#00ff00', '#0000ff'];
  return values.map(color => parseColor(color));
}

function interpolatePalette(palette, t) {
  if (!palette.length) return [0, 0, 0];
  if (palette.length === 1) return palette[0];
  const scaled = (t % 1 + 1) % 1;
  const segment = scaled * (palette.length - 1);
  const lowerIndex = Math.floor(segment);
  const upperIndex = Math.min(palette.length - 1, lowerIndex + 1);
  const localT = segment - lowerIndex;
  const lower = palette[lowerIndex];
  const upper = palette[upperIndex];
  return lower.map((channel, index) => Math.round(channel + (upper[index] - channel) * localT));
}

function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function paletteFromIndex(index, total) {
  const palette = [[255, 50, 50], [50, 200, 255], [255, 180, 50], [180, 100, 255], [80, 255, 110], [255, 255, 255]];
  return palette[index % palette.length];
}
