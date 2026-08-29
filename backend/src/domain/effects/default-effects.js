export const defaultEffects = [
  {
    id: 'solid',
    name: 'Solid Color',
    description: 'Render one color across the selected canvas.',
    renderer: 'solid',
    parameters: {
      color: { type: 'color', default: '#ffffff' }
    },
    tags: ['basic', 'static']
  },
  {
    id: 'dave-debug',
    name: 'Dave Debug',
    description: 'Rainbow debug swatch used in the original NightDriver firmware.',
    renderer: 'dave-debug',
    parameters: {},
    tags: ['debug', 'rainbow']
  },
  {
    id: 'gradient',
    name: 'Gradient',
    description: 'Render a linear gradient across the selected canvas.',
    renderer: 'gradient',
    parameters: {
      startColor: { type: 'color', default: '#ff0000' },
      endColor: { type: 'color', default: '#0000ff' },
      angle: { type: 'number', min: 0, max: 360, default: 0 }
    },
    tags: ['color', 'static']
  },
  {
    id: 'palette-scroll',
    name: 'Palette Scroll',
    description: 'Scroll a palette of colors across the canvas with configurable density and brightness.',
    renderer: 'palette-scroll',
    parameters: {
      palette: {
        type: 'palette',
        default: {
          colors: ['#ff0000', '#00ff00', '#0000ff'],
          blend: true
        }
      },
      ledColorPerSecond: { type: 'number', min: 0, max: 120, default: 3 },
      ledScrollSpeed: { type: 'number', min: 0, max: 60, default: 0 },
      density: { type: 'number', min: 0.1, max: 10, default: 1 },
      everyNthDot: { type: 'number', min: 1, max: 10, default: 1 },
      dotSize: { type: 'number', min: 1, max: 10, default: 1 },
      rampedColor: { type: 'boolean', default: false },
      brightness: { type: 'number', min: 0, max: 1, default: 1 },
      mirrored: { type: 'boolean', default: false }
    },
    tags: ['animated', 'palette', 'motion']
  },
  {
    id: 'color-wave',
    name: 'Color Wave',
    description: 'Animate a moving hue wave across the selected canvas.',
    renderer: 'color-wave',
    parameters: {
      speed: { type: 'number', min: 0, max: 5, default: 0.5 },
      waveFrequency: { type: 'number', min: 0.1, max: 50, default: 10 }
    },
    tags: ['animated', 'color', 'wave']
  },
  {
    id: 'wave',
    name: 'Wave',
    description: 'Animate a moving color wave across the selected canvas.',
    renderer: 'wave',
    parameters: {
      color: { type: 'color', default: '#00ccff' },
      speed: { type: 'number', min: 0, max: 10, default: 1 },
      width: { type: 'number', min: 1, max: 100, default: 25 }
    },
    tags: ['animated', 'motion']
  },
  {
    id: 'starfield',
    name: 'Starfield',
    description: 'Traveling starfield effect inspired by the NightDriver Starfield implementation.',
    renderer: 'starfield',
    parameters: {
      starCount: { type: 'number', min: 0, max: 500, default: 100 }
    },
    tags: ['animated', 'space', 'particles']
  },
  {
    id: 'stock-banner',
    name: 'Stock Banner',
    description: 'Render a scrolling stock ticker-style marquee similar to the stock banner effect.',
    renderer: 'stock-banner',
    parameters: {
      symbols: { type: 'array', default: ['NDS', 'AAPL', 'MSFT'] },
      stockServerHost: { type: 'string', default: 'localhost' },
      stockServerPort: { type: 'number', min: 1, max: 65535, default: 8888 },
      minQuoteWidth: { type: 'number', min: 32, max: 256, default: 64 },
      compactQuoteWidth: { type: 'number', min: 64, max: 256, default: 96 },
      refreshSeconds: { type: 'number', min: 15, max: 3600, default: 60 }
    },
    tags: ['ticker', 'text', 'networked']
  },
  {
    id: 'bouncing-balls',
    name: 'Bouncing Balls',
    description: 'Simulate bouncing colored balls with optional mirrored motion.',
    renderer: 'bouncing-balls',
    parameters: {
      ballCount: { type: 'number', min: 1, max: 20, default: 5 },
      ballSize: { type: 'number', min: 1, max: 10, default: 1 },
      mirrored: { type: 'boolean', default: true },
      erase: { type: 'boolean', default: true }
    },
    tags: ['animated', 'motion']
  },
  {
    id: 'fireworks',
    name: 'Fireworks',
    description: 'Launch particle bursts with fading trails and color variation.',
    renderer: 'fireworks',
    parameters: {
      maxSpeed: { type: 'number', min: 10, max: 300, default: 175 },
      newParticleProbability: { type: 'number', min: 0.1, max: 3, default: 1 },
      particlePreignitionTime: { type: 'number', min: 0, max: 2, default: 0 },
      particleIgnition: { type: 'number', min: 0, max: 2, default: 0.2 },
      particleHoldTime: { type: 'number', min: 0, max: 2, default: 0 },
      particleFadeTime: { type: 'number', min: 0.1, max: 10, default: 2 },
      particleSize: { type: 'number', min: 0.1, max: 5, default: 1 }
    },
    tags: ['animated', 'particles', 'explosion']
  },
  {
    id: 'mp4-playback',
    name: 'MP4 Playback',
    description: 'Playback a video file on the canvas. Requires a valid media path in the runtime environment.',
    renderer: 'mp4-playback',
    parameters: {
      filePath: { type: 'string', default: './media/mp4/goldendollars.mp4' }
    },
    tags: ['video', 'media']
  }
];
