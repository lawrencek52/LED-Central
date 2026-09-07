export const defaultEffects = [
  {
    id: "solid",
    name: "Solid Color",
    description: "Render one color across the selected canvas.",
    renderer: "solid",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      color: { type: "color", default: "#ffffff" },
    },
    tags: ["basic", "static"],
  },
  {
    id: "dave-debug",
    name: "Dave Debug",
    description:
      "Rainbow debug swatch used in the original NightDriver firmware.",
    renderer: "dave-debug",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
    },
    tags: ["debug", "rainbow"],
  },
  {
    id: "gradient",
    name: "Gradient",
    description: "Render a linear gradient across the selected canvas.",
    renderer: "gradient",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      startColor: { type: "color", default: "#ff0000" },
      endColor: { type: "color", default: "#0000ff" },
      angle: { type: "number", min: 0, max: 360, default: 0 },
    },
    tags: ["color", "static"],
  },
  {
    id: "palette-scroll",
    name: "Palette Scroll",
    description:
      "Scroll a palette of colors across the canvas with configurable density and brightness.",
    renderer: "palette-scroll",
    parameters: {
      palette: {
        type: "palette",
        default: {
          colors: ["#ff0000", "#00ff00", "#0000ff"],
          blend: true,
        },
      },
      ledColorPerSecond: { type: "number", min: 0, max: 120, default: 3 },
      ledScrollSpeed: { type: "number", min: 0, max: 60, default: 0 },
      density: { type: "number", min: 0.1, max: 10, default: 1 },
      everyNthDot: { type: "number", min: 1, max: 10, default: 1 },
      dotSize: { type: "number", min: 1, max: 10, default: 1 },
      rampedColor: { type: "boolean", default: false },
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      mirrored: { type: "boolean", default: false },
    },
    tags: ["animated", "palette", "motion"],
  },
  {
    id: "color-wave",
    name: "Color Wave",
    description: "Animate a moving hue wave across the selected canvas.",
    renderer: "color-wave",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      speed: { type: "number", min: 0, max: 5, default: 0.5 },
      waveFrequency: { type: "number", min: 0.1, max: 50, default: 10 },
    },
    tags: ["animated", "color", "wave"],
  },
  {
    id: "wave",
    name: "Wave",
    description: "Animate a moving color wave across the selected canvas.",
    renderer: "wave",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      color: { type: "color", default: "#00ccff" },
      speed: { type: "number", min: 0, max: 10, default: 1 },
      width: { type: "number", min: 1, max: 100, default: 25 },
    },
    tags: ["animated", "motion"],
  },
  {
    id: "starfield",
    name: "Starfield",
    description:
      "Traveling starfield effect inspired by the NightDriver Starfield implementation. Stars continuously respawn from the origin so roughly starCount stars are visible at any moment.",
    renderer: "starfield",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      starCount: { type: "number", min: 0, max: 500, default: 100 },
      origin: {
        type: "select",
        options: ["center", "left", "right"],
        default: "center",
      },
    },
    tags: ["animated", "space", "particles"],
  },
  {
    id: "stock-banner",
    name: "Stock Banner",
    description:
      "Render a scrolling stock ticker-style marquee similar to the stock banner effect.",
    renderer: "stock-banner",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      symbols: { type: "array", default: ["NDS", "AAPL", "MSFT"] },
      stockServerHost: { type: "string", default: "localhost" },
      stockServerPort: { type: "number", min: 1, max: 65535, default: 8888 },
      minQuoteWidth: { type: "number", min: 32, max: 256, default: 64 },
      compactQuoteWidth: { type: "number", min: 64, max: 256, default: 96 },
      refreshSeconds: { type: "number", min: 15, max: 3600, default: 60 },
    },
    tags: ["ticker", "text", "networked"],
  },
  {
    id: "fireworks",
    name: "Fireworks",
    description:
      "Particle bursts that ignite, hold, then fade - physics and timing ported from NightDriverStrip's FireworksEffect (with synthetic periodic launches replacing its beat trigger).",
    renderer: "fireworks",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      maxSpeed: { type: "number", min: 10, max: 300, default: 175 },
      newParticleProbability: { type: "number", min: 0.1, max: 3, default: 1 },
      particlePreignitionTime: { type: "number", min: 0, max: 2, default: 0 },
      particleIgnition: { type: "number", min: 0.01, max: 2, default: 0.14 },
      particleHoldTime: { type: "number", min: 0, max: 2, default: 0.03 },
      particleFadeTime: { type: "number", min: 0.05, max: 10, default: 0.95 },
      particleSize: { type: "number", min: 1, max: 5, default: 1 },
    },
    tags: ["animated", "particles", "explosion"],
  },
  {
    id: "rocket-fireworks",
    name: "Rocket Fireworks",
    description:
      "A rocket launches on a random strip, climbs and slows under gravity, then bursts into 10-100 particles that spread sideways onto neighboring strips as well as along the strip - genuinely circular in real space, using the canvas's strip spacing ratio to convert it onto the grid. Particles drift, burn and fade, occasionally flaring brighter first or (rarely) flashing white right as they burn out. With audio available, a rocket pauses at apogee for the next beat before exploding. Several overlapping shows can be in flight across the wall at once.",
    renderer: "rocket-fireworks",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      launchIntervalSeconds: { type: "number", min: 0.5, max: 15, default: 3 },
      reversed: { type: "boolean", default: false },
      ledSpacingCm: { type: "number", min: 0.1, max: 50, default: 1.667 },
      showSeed: { type: "number", min: 0, max: 1000, default: 0 },
      palette: {
        type: "palette",
        default: {
          colors: [
            "#ff0000",
            "#00ff00",
            "#0000ff",
            "#00ffff",
            "#ff00ff",
            "#ffff00",
          ],
        },
      },
    },
    tags: ["animated", "particles", "explosion", "audio-optional"],
  },
  // --- Effects ported from NightDriverStrip (https://github.com/PlummersSoftwareLLC/NightDriverStrip) ---
  // Audio/microphone-reactive effects (beat detection, VU meter driven) were intentionally excluded.
  // Names that collided with existing effects above are prefixed with "NDS-".
  {
    id: "nds-bouncing-balls-a",
    name: "NDS-Bouncing Balls-A",
    description:
      "Gravity-and-dampening bounce simulation ported from NightDriverStrip's BouncingBallEffect (3 balls). Bounces from the start of the strip (near the controller) by default; set mirrored for a second, mirrored source at the far end, or reversed to bounce from the far end instead.",
    renderer: "nds-bouncing-balls",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      ballCount: { type: "number", min: 1, max: 20, default: 3 },
      ballSize: { type: "number", min: 1, max: 10, default: 1 },
      mirrored: { type: "boolean", default: false },
      reversed: { type: "boolean", default: false },
    },
    tags: ["animated", "motion", "nds"],
  },
  {
    id: "nds-bouncing-balls-b",
    name: "NDS-Bouncing Balls-B",
    description:
      "Gravity-and-dampening bounce simulation ported from NightDriverStrip's BouncingBallEffect (8 balls). Bounces from the start of the strip (near the controller) by default; set mirrored for a second, mirrored source at the far end, or reversed to bounce from the far end instead.",
    renderer: "nds-bouncing-balls",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      ballCount: { type: "number", min: 1, max: 20, default: 8 },
      ballSize: { type: "number", min: 1, max: 10, default: 1 },
      mirrored: { type: "boolean", default: false },
      reversed: { type: "boolean", default: false },
    },
    tags: ["animated", "motion", "nds"],
  },
  {
    id: "nds-double-palette",
    name: "Double Palette",
    description:
      "Two palettes scrolling in opposite directions and blended together.",
    renderer: "double-palette",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      paletteA: {
        type: "palette",
        default: {
          colors: [
            "#ff0000",
            "#ffff00",
            "#00ff00",
            "#00ffff",
            "#0000ff",
            "#ff00ff",
          ],
        },
      },
      paletteB: {
        type: "palette",
        default: {
          colors: [
            "#ff0000",
            "#ffff00",
            "#00ff00",
            "#00ffff",
            "#0000ff",
            "#ff00ff",
          ],
        },
      },
      speedA: { type: "number", min: -20, max: 20, default: 4 },
      speedB: { type: "number", min: -20, max: 20, default: -4 },
      density: { type: "number", min: 0.1, max: 10, default: 1 },
    },
    tags: ["animated", "palette", "nds"],
  },
  {
    id: "nds-warm-glow",
    name: "Warm Glow",
    description:
      "Fill the canvas with the RGB approximation of a color temperature.",
    renderer: "warm-glow",
    parameters: {
      kelvin: { type: "number", min: 1000, max: 9000, default: 4000 },
      brightness: { type: "number", min: 0, max: 100, default: 100 },
    },
    tags: ["static", "white", "nds"],
  },
  {
    id: "nds-fire",
    name: "Fire",
    description:
      'Heat-diffusion fire simulation ported from NightDriverStrip\'s FireEffect ("Medium Fire"). A single source burns from the start of the strip (near the controller); on a canvas with several parallel strips, neighboring rows blend together into one connected fire.',
    renderer: "fire",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      cooling: { type: "number", min: 0, max: 100, default: 3 },
      sparking: { type: "number", min: 0, max: 255, default: 100 },
      sparks: { type: "number", min: 0, max: 20, default: 3 },
      sparkHeight: { type: "number", min: 1, max: 20, default: 4 },
      reversed: { type: "boolean", default: true },
      mirrored: { type: "boolean", default: false },
      minHeightFraction: { type: "number", min: 0, max: 1, default: 0.2 },
      averageHeightFraction: { type: "number", min: 0, max: 1, default: 0.7 },
      maxHeightFraction: { type: "number", min: 0, max: 1, default: 1 },
      heightWaveSeconds: { type: "number", min: 1, max: 300, default: 120 },
      neighborBlend: { type: "number", min: 0, max: 1, default: 0.3 },
    },
    tags: ["animated", "fire", "nds"],
  },
  {
    id: "nds-classic-fire",
    name: "Classic Fire",
    description:
      "The classic Fire2012-style automaton ported from NightDriverStrip's ClassicFireEffect, diffusing in the opposite direction from Fire with its own heat-color ramp.",
    renderer: "classic-fire",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      cooling: { type: "number", min: 0, max: 100, default: 5 },
      reversed: { type: "boolean", default: false },
      mirrored: { type: "boolean", default: false },
    },
    tags: ["animated", "fire", "nds"],
  },
  {
    id: "nds-color-meteors-a",
    name: "Color Meteors-A",
    description:
      "Meteors streak across the canvas leaving a fading trail, ported from NightDriverStrip's MeteorEffect (4 meteors).",
    renderer: "meteor",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      meteorCount: { type: "number", min: 1, max: 10, default: 4 },
      meteorSize: { type: "number", min: 1, max: 20, default: 4 },
      decay: { type: "number", min: 1, max: 10, default: 10 },
      minSpeed: { type: "number", min: 0.05, max: 2, default: 2.0 },
      maxSpeed: { type: "number", min: 0.05, max: 2, default: 2.0 },
    },
    tags: ["animated", "motion", "nds"],
  },
  {
    id: "nds-color-meteors-b",
    name: "Color Meteors-B",
    description:
      "Meteors streak across the canvas leaving a fading trail, ported from NightDriverStrip's MeteorEffect (2 meteors).",
    renderer: "meteor",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      meteorCount: { type: "number", min: 1, max: 10, default: 2 },
      meteorSize: { type: "number", min: 1, max: 20, default: 4 },
      decay: { type: "number", min: 1, max: 10, default: 10 },
      minSpeed: { type: "number", min: 0.05, max: 2, default: 2.0 },
      maxSpeed: { type: "number", min: 0.05, max: 2, default: 2.0 },
    },
    tags: ["animated", "motion", "nds"],
  },
  {
    id: "nds-simple-rainbow",
    name: "Simple Rainbow",
    description: "A rainbow fill that skips every Nth pixel.",
    renderer: "simple-rainbow",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      everyNth: { type: "number", min: 1, max: 20, default: 12 },
      speedDivisor: { type: "number", min: 1, max: 30, default: 8 },
    },
    tags: ["animated", "rainbow", "nds"],
  },
  {
    id: "nds-rainbow-twinkle",
    name: "Rainbow Twinkle",
    description: "A drifting rainbow overlaid with random white twinkles.",
    renderer: "rainbow-twinkle",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      speedDivisor: { type: "number", min: 1, max: 30, default: 12 },
      deltaHue: { type: "number", min: 1, max: 60, default: 14 },
    },
    tags: ["animated", "rainbow", "sparkle", "nds"],
  },
  {
    id: "nds-rainbowfill",
    name: "RainbowFill",
    description: "A continuously scrolling rainbow fill.",
    renderer: "rainbowfill",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      speedDivisor: { type: "number", min: 1, max: 30, default: 12 },
      deltaHue: { type: "number", min: 1, max: 60, default: 14 },
      mirrored: { type: "boolean", default: false },
    },
    tags: ["animated", "rainbow", "nds"],
  },
  {
    id: "nds-color-fill",
    name: "Color Fill",
    description: "Fill every Nth pixel with a solid color.",
    renderer: "color-fill",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      color: { type: "color", default: "#f6c8a0" },
      everyNth: { type: "number", min: 1, max: 20, default: 10 },
    },
    tags: ["basic", "static", "nds"],
  },
  {
    id: "nds-twinkle",
    name: "Twinkle",
    description:
      "Randomly colored pixels appear and fade like sparkling lights.",
    renderer: "twinkle",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      countToDraw: { type: "number", min: 1, max: 500, default: 60 },
      updateSpeedMs: { type: "number", min: 10, max: 200, default: 40 },
    },
    tags: ["animated", "sparkle", "nds"],
  },
  {
    id: "nds-silon",
    name: "Cylon",
    description:
      "Battlestar Galactica inspired scanner - configurable number of eyes, each sweeping back and forth in its own color.",
    renderer: "cylon",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      transitSeconds: { type: "number", min: 1, max: 30, default: 3 },
      eyeCount: { type: "number", min: 1, max: 6, default: 2 },
      eyeSize: { type: "number", min: 1, max: 10, default: 1 },
      eyeColors: {
        type: "palette",
        default: {
          colors: [
            "#ff0000",
            "#00ff00",
            "#0000ff",
            "#00ffff",
            "#ff00ff",
            "#ffff00",
          ],
        },
      },
    },
    tags: ["animated", "scanner", "nds"],
  },
  {
    id: "nds-snake",
    name: "Snake",
    description: "The game of Snake visualized as a moving strip effect.",
    renderer: "snake",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      snakeSize: { type: "number", min: 2, max: 30, default: 3 },
      speed: { type: "number", min: 0.5, max: 20, default: 4 },
    },
    tags: ["animated", "game", "nds"],
  },
  {
    id: "nds-night-twinkle",
    name: "Night Twinkle",
    description:
      "A base night-sky color overlaid with randomly igniting white stars, ported from NightDriverStrip's NightTwinkleEffect.",
    renderer: "night-twinkle",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      baseColor: { type: "color", default: "#0000ff" },
      density: { type: "number", min: 0, max: 5, default: 1 },
      starsPerFrame: { type: "number", min: 1, max: 100, default: 10 },
    },
    tags: ["animated", "sparkle", "night", "nds"],
  },
  {
    id: "nds-twinkle-star",
    name: "Twinkle Star",
    description: "Randomly colored dots blink on and off across the canvas.",
    renderer: "twinkle-star",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      density: { type: "number", min: 0.1, max: 5, default: 1 },
    },
    tags: ["animated", "sparkle", "nds"],
  },
  {
    id: "nds-red-twinkle-stars",
    name: "Red Twinkle Stars",
    description:
      "A field of fading-in-then-out red stars, ported from NightDriverStrip's StarEffect<QuietStar>.",
    renderer: "twinkle-stars",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      palette: {
        type: "palette",
        default: {
          colors: [
            "#ff0000",
            "#8b0000",
            "#8b0000",
            "#8b0000",
            "#ff0000",
            "#8b0000",
            "#8b0000",
            "#8b0000",
            "#ff0000",
            "#8b0000",
            "#8b0000",
            "#8b0000",
            "#ff0000",
            "#8b0000",
            "#8b0000",
            "#ff4500",
          ],
        },
      },
      variant: { type: "string", default: "quiet" },
      probability: { type: "number", min: 0.1, max: 5, default: 1 },
      starSize: { type: "number", min: 1, max: 5, default: 1 },
      maxSpeed: { type: "number", min: 0, max: 20, default: 2 },
    },
    tags: ["animated", "sparkle", "stars", "nds"],
  },
  {
    id: "nds-green-twinkle-stars",
    name: "Green Twinkle Stars",
    description:
      "A field of fading-in-then-out green stars, ported from NightDriverStrip's StarEffect<QuietStar>.",
    renderer: "twinkle-stars",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      palette: {
        type: "palette",
        default: {
          colors: [
            "#008000",
            "#006400",
            "#006400",
            "#006400",
            "#008000",
            "#006400",
            "#006400",
            "#006400",
            "#008000",
            "#006400",
            "#006400",
            "#006400",
            "#008000",
            "#006400",
            "#006400",
            "#32cd32",
          ],
        },
      },
      variant: { type: "string", default: "quiet" },
      probability: { type: "number", min: 0.1, max: 5, default: 1 },
      starSize: { type: "number", min: 1, max: 5, default: 1 },
      maxSpeed: { type: "number", min: 0, max: 20, default: 2 },
    },
    tags: ["animated", "sparkle", "stars", "nds"],
  },
  {
    id: "nds-blue-sparkle-stars",
    name: "Blue Sparkle Stars",
    description:
      "A field of blue stars that flash white on ignition, hold, then fade - ported from NightDriverStrip's StarEffect<Star>.",
    renderer: "twinkle-stars",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      palette: {
        type: "palette",
        default: {
          colors: ["#00008b", "#0000cd", "#0000ff", "#0000cd"],
        },
      },
      variant: { type: "string", default: "flash" },
      probability: { type: "number", min: 0.1, max: 5, default: 1 },
      starSize: { type: "number", min: 1, max: 5, default: 1 },
      maxSpeed: { type: "number", min: 0, max: 20, default: 2 },
    },
    tags: ["animated", "sparkle", "stars", "nds"],
  },
  {
    id: "nds-rainbow-twinkle-stars",
    name: "Rainbow Twinkle Stars",
    description:
      "A field of fading-in-then-out rainbow-colored stars, ported from NightDriverStrip's StarEffect<QuietStar>.",
    renderer: "twinkle-stars",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      rainbow: { type: "boolean", default: true },
      variant: { type: "string", default: "quiet" },
      probability: { type: "number", min: 0.1, max: 5, default: 1 },
      starSize: { type: "number", min: 1, max: 5, default: 1 },
      maxSpeed: { type: "number", min: 0, max: 20, default: 2 },
    },
    tags: ["animated", "sparkle", "stars", "rainbow", "nds"],
  },
  {
    id: "nds-palette-effect",
    name: "Palette Effect",
    description:
      "Discrete light segments spaced by gaps that move along a color palette.",
    renderer: "palette-effect",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      palette: {
        type: "palette",
        default: {
          colors: [
            "#ff0000",
            "#ffff00",
            "#00ff00",
            "#00ffff",
            "#0000ff",
            "#ff00ff",
          ],
        },
      },
      density: { type: "number", min: 0.1, max: 10, default: 1 },
      speed: { type: "number", min: -10, max: 10, default: 1 },
      ledsPerSecond: { type: "number", min: -60, max: 60, default: 0 },
      lightSize: { type: "number", min: 1, max: 20, default: 1 },
      gapSize: { type: "number", min: 0, max: 20, default: 1 },
    },
    tags: ["animated", "palette", "nds"],
  },
  // --- Audio-reactive effects, driven by controller-reported Audio Telemetry ---
  // Require a canvas whose controllers currently advertise audio support (see
  // CanvasAudioService); ported effects use the NightDriverStrip name, the new
  // multi-band wall effect does not since it wasn't part of that port.
  {
    id: "vu-meter",
    name: "VU Meter",
    description:
      "VU bar driven by live beat/volume telemetry, with a beat flash - ported from NightDriverStrip's VUMeterEffect. Grows from the center by default (both directions), or from either end.",
    renderer: "vu-meter",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      origin: {
        type: "select",
        options: ["center", "left", "right"],
        default: "center",
      },
    },
    tags: ["animated", "audio"],
  },
  {
    id: "spectrum-bars",
    name: "Spectrum Analyzer",
    description:
      "Smooth pixel-resolution frequency curve driven by live FFT telemetry, auto-adapting to the canvas - a vertical bar graph with a peak-hold cap on a matrix, or level-as-brightness along the strip on a single row - ported from NightDriverStrip's SpectrumAnalyzerEffect.",
    renderer: "spectrum-bars",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
    },
    tags: ["animated", "audio"],
  },
  {
    id: "musical-fire",
    name: "Musical Fire",
    description:
      "Heat-diffusion fire that throws extra sparks on each detected beat - ported from NightDriverStrip's MusicalPaletteFire. Bounces from the start of the strip (near the controller) by default, same as Fire; set mirrored for a second, mirrored source at the far end, or reversed to burn from the far end instead.",
    renderer: "musical-fire",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      cooling: { type: "number", min: 0, max: 100, default: 3 },
      sparking: { type: "number", min: 0, max: 255, default: 100 },
      sparks: { type: "number", min: 0, max: 20, default: 3 },
      sparkHeight: { type: "number", min: 1, max: 20, default: 4 },
      beatSparkBoost: { type: "number", min: 0, max: 200, default: 60 },
      reversed: { type: "boolean", default: true },
      mirrored: { type: "boolean", default: false },
    },
    tags: ["animated", "fire", "audio"],
  },
  {
    id: "spectrum-band",
    name: "Spectrum Band (per-strip)",
    description:
      "One group of frequency bands per parallel strip mapping - the level bar is the Fire effect, whose lit extent shows the group's average amplitude, while a peak-hold marker tracks the group's loudest band, briefly holding before falling. Neighboring strips' bars blend together the same way Fire's do. Assign several parallel strips to build a multi-band VU wall.",
    renderer: "spectrum-band",
    parameters: {
      brightness: { type: "number", min: 0, max: 100, default: 100 },
      neighborBlend: { type: "number", min: 0, max: 1, default: 0.2 },
    },
    tags: ["animated", "audio"],
  },
  // {
  //   id: 'mp4-playback',
  //   name: 'MP4 Playback',
  //   description: 'Playback a video file on the canvas. Requires a valid media path in the runtime environment.',
  //   renderer: 'mp4-playback',
  //   parameters: {
  //     filePath: { type: 'string', default: './media/mp4/goldendollars.mp4' }
  //   },
  //   tags: ['video', 'media']
  // }
];
