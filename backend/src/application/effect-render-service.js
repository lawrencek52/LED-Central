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
        parameters: { ...defaultParameters(effect.parameters), ...parameters }
      })
    };
  }
}

const renderers = {
  solid: ({ width, height, parameters }) => {
    const color = parseColor(parameters.color);
    return Array.from({ length: width * height }, () => color);
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
  wave: ({ width, height, parameters }) => {
    const color = parseColor(parameters.color);
    const speed = Number(parameters.speed) || 0;
    const waveWidth = Math.max(1, Number(parameters.width) || 1);
    const phaseOffset = Number(parameters.timeSeconds) || 0;
    return Array.from({ length: width * height }, (_, index) => {
      const intensity = Math.max(0, Math.min(1, (Math.sin((index % width) / waveWidth * Math.PI * 2 + phaseOffset * speed) + 1) / 2));
      return color.map(channel => Math.round(channel * intensity));
    });
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
