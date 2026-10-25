# LED-Central Effects

LED-Central has 39 built-in effects. They render on a canvas, so the same
effect works on one strip, on several strips side by side, or on a matrix.
Effects whose name starts with **NDS-** or that are described as "ported
from NightDriverStrip" reproduce the look of Dave Plummer's NightDriverStrip
and NDSCPP effects, extended to span canvases. Every effect's definition,
including the exact ranges below, is in
`backend/src/domain/effects/default-effects.js`; the renderers are in
`backend/src/application/effect-render-service.js`.

## How effects behave

- **Brightness.** Every effect has `brightness` (0-100, default 100), applied
  on top of the controller's own brightness and nightly schedule.
- **Strips and matrices.** On a canvas of parallel strips, an effect that
  moves along a strip runs along every strip, usually starting from the
  controller end (LED 0) of a left-to-right strip; `reversed` starts it from
  the far end. On a matrix (a single mapping taller than one row), effects
  with a natural "up" (fire, bouncing balls, the candy cane) use the canvas
  vertically.
- **Real-world sizes.** Sizes and speeds are tuned in LEDs on a 60 LED/m
  strip and scaled by each strip's detected density, so a 30 LED/m strip
  shows the same physical size with half the LEDs.
- **Randomness.** With *True random* on (the Effects tab), each run gets a
  fresh seed and looks different; with *Pseudo random*, runs repeat exactly.
- **Audio.** Effects tagged audio need a controller with a microphone on the
  same canvas (deck3 and the matrices in the reference install). Rocket
  Fireworks uses audio when it's there and runs without it.

## Basic and static

| Effect | What it shows | Parameters |
| - | - | - |
| **Solid Color** | One color everywhere. | `color` (#ffffff) |
| **Color Fill** (NDS) | A solid color on every Nth LED, the rest off. | `color` (#f6c8a0), `everyNth` 1-20 (10) |
| **Gradient** | A linear blend between two colors across the canvas. | `startColor` (#ff0000), `endColor` (#0000ff), `angle` 0-360° (0) |
| **Warm Glow** (NDS) | The RGB approximation of a color temperature. | `kelvin` 1000-9000 K (4000) |
| **Dave Debug** | The rainbow test swatch from the original NightDriver firmware. | none |

## Color and palettes

| Effect | What it shows | Parameters |
| - | - | - |
| **Wave** | A single-color pulse travelling along the canvas. | `color` (#00ccff), `speed` 0-10 (1), `width` 1-100 LEDs (25) |
| **Color Wave** | A moving hue wave. | `speed` 0-5 (0.5), `waveFrequency` 0.1-50 (10) |
| **Palette Scroll** | A palette laid along the canvas, scrolling and cycling color. | `palette` (red, green, blue, blended), `ledColorPerSecond` 0-120 (3): color cycling rate, `ledScrollSpeed` 0-60 (0): LEDs per second, `density` 0.1-10 (1): palette repeats, `everyNthDot` 1-10 (1), `dotSize` 1-10 (1), `rampedColor` (off), `mirrored` (off) |
| **Double Palette** (NDS) | Two palettes scrolling in opposite directions, blended. | `paletteA`, `paletteB` (rainbow), `speedA` -20-20 (4), `speedB` -20-20 (-4), `density` 0.1-10 (1) |
| **Palette Effect** (NDS) | Lit segments separated by gaps, moving along a palette. | `palette` (rainbow), `density` 0.1-10 (1), `speed` -10-10 (1): color movement, `ledsPerSecond` -60-60 (0): segment movement, `lightSize` 1-20 (1), `gapSize` 0-20 (1) |
| **RainbowFill** (NDS) | A continuously scrolling rainbow. | `speedDivisor` 1-30 (12): higher is slower, `deltaHue` 1-60 (14): hue step per LED, `mirrored` (off) |
| **Simple Rainbow** (NDS) | A rainbow on every Nth LED. | `everyNth` 1-20 (12), `speedDivisor` 1-30 (8) |
| **Rainbow Twinkle** (NDS) | A drifting rainbow with random white twinkles. | `speedDivisor` 1-30 (12), `deltaHue` 1-60 (14) |

## Motion

| Effect | What it shows | Parameters |
| - | - | - |
| **NDS-Bouncing Balls-A** / **-B** | Balls bouncing under gravity with damping, re-kicked when they run low (3 and 8 balls). | `ballCount` 1-20 (3 / 8), `ballSize` 1-10 (1), `mirrored` (off): a second source at the far end, `reversed` (off): bounce from the far end |
| **Color Meteors-A** / **-B** (NDS) | Meteors with fading tails bouncing between the ends (4 and 2 meteors). | `meteorCount` 1-10 (4 / 2), `meteorSize` 1-20 (4), `decay` 1-10 (10): tail fade, `minSpeed` / `maxSpeed` 0.05-2 (2) |
| **Cylon** (NDS) | Scanner "eyes" sweeping back and forth, each in its own color. | `transitSeconds` 1-30 (3), `eyeCount` 1-6 (2), `eyeSize` 1-10 (1), `eyeColors` (palette) |
| **Snake** (NDS) | The game of Snake, played along the strip. | `snakeSize` 2-30 (3), `speed` 0.5-20 (4) |
| **Starfield** | Stars flying outward from an origin and respawning, so about `starCount` are always visible. | `starCount` 0-500 (100), `origin` center / left / right (center) |
| **Fireworks** | NightDriverStrip's particle bursts: ignite, hold, fade, launched on their own rather than on beats as in the firmware. | `maxSpeed` 10-300 (175), `newParticleProbability` 0.1-3 (1), `particlePreignitionTime` (0), `particleIgnition` (0.14 s), `particleHoldTime` (0.03 s), `particleFadeTime` (0.95 s), `particleSize` 1-5 (1) |

## Sparkle and stars

| Effect | What it shows | Parameters |
| - | - | - |
| **Twinkle** (NDS) | Random colored LEDs appearing and fading. | `countToDraw` 1-500 (60): LEDs lit at once, `updateSpeedMs` 10-200 (40) |
| **Twinkle Star** (NDS) | Random colored dots blinking on and off. | `density` 0.1-5 (1) |
| **Night Twinkle** (NDS) | A dim night-sky color with white stars igniting and fading. | `baseColor` (#0000ff), `density` 0-5 (1), `starsPerFrame` 1-100 (10) |
| **Red / Green / Rainbow Twinkle Stars** (NDS) | Stars that fade in and out in a palette, drifting slightly (NightDriverStrip's `StarEffect<QuietStar>`). | `palette` (reds / greens; Rainbow uses `rainbow`), `probability` 0.1-5 (1): how often stars appear, `starSize` 1-5 (1), `maxSpeed` 0-20 (2): drift |
| **Blue Sparkle Stars** (NDS) | Blue stars that flash white as they ignite, hold, then fade (`StarEffect<Star>`). | as above, blue palette |

On a matrix, each star drifts along a single row or column instead of
wrapping from one row to the next.

## Fire

| Effect | What it shows | Parameters |
| - | - | - |
| **Fire** (NDS) | NightDriverStrip's heat-diffusion fire ("Medium Fire"), sized to each strip's real length. It burns from LED 0 of each strip, or upward on a matrix, and "breathes" slowly between a minimum and maximum height. On parallel strips, neighboring rows blend into one connected fire. | `cooling` 0-100 (3), `sparking` 0-255 (100): spark ignition chance, `sparks` 0-20 (3), `sparkHeight` 1-20 (4), `palette` red / green / blue (red), `reversed`, `mirrored`, `minHeightFraction` (0.2), `averageHeightFraction` (0.7), `maxHeightFraction` (1), `heightWaveSeconds` 1-300 (120): breathing period, `neighborBlend` 0-1 (0.3) |
| **Classic Fire** (NDS) | The classic Fire2012 automaton, diffusing the other way with its own color ramp. | `cooling` 0-100 (5), `reversed`, `mirrored` |
| **Musical Fire** (audio) | The fire above, throwing extra sparks on every beat (NightDriverStrip's `MusicalPaletteFire`). | Fire's spark settings, `beatSparkBoost` 0-200 (60), `reversed` (on), `mirrored` |

## Audio-reactive

These need a microphone-equipped controller on the canvas.

| Effect | What it shows | Parameters |
| - | - | - |
| **VU Meter** | A level bar with a flash on each beat, growing from the center or either end. | `origin` center / left / right (center) |
| **Spectrum Analyzer** | A frequency curve: a bar graph with peak-hold caps on a matrix, or level as brightness along a single strip. | none |
| **Spectrum Band (per-strip)** | One group of frequency bands per parallel strip, drawn as a fire whose height is the group's level, with a peak-hold marker. Several strips make a multi-band VU wall. | `neighborBlend` 0-1 (0.2) |
| **Rocket Fireworks** (audio optional) | A rocket launches up a random strip, slows under gravity and bursts into 10-100 particles that spread onto neighboring strips, round in real space (using the canvas's strip spacing ratio). With audio, rockets wait at the top for the next beat. Several shows can overlap. | `launchIntervalSeconds` 0.5-15 (3), `palette` (six colors), `reversed`, `ledSpacingCm` 0.1-50 (1.667): only used when a strip's density is unknown, `showSeed` 0-1000 (0) |

## Holiday

| Effect | What it shows | Parameters |
| - | - | - |
| **CandyCane** | A spinning candy cane: white with a wide green and a narrow red helix stripe climbing the strip. Each parallel strip sees the cane from a different angle (spread over `viewSpread`), so the stripes step diagonally across a wall of strips; on a matrix the cane stands upright. | `twistsPerSecond` 0-5 (0.5), `twistLength` 4-300 LEDs per twist (40), `greenWidth` 0-60 % (30), `redWidth` 0-30 % (8), `viewSpread` 0-360° (360), `whiteColor`, `greenColor`, `redColor`, `reversed` |
| **Halloween** | Drifting pools of flickering jack-o'-lantern orange with darkness between, pairs of creepy eyes that open, stare, blink and fade, and lightning that flashes every strip at once. With `thunder` on, each strike plays a thunder clip on the canvas's sound streamer, following the nightly schedule (quieter while dimmed, silent while off). | `glowColor` (#ff5a00), `glowAmount` 0-100 % (55), `glowSize` 2-100 LEDs (16), `glowSpeed` 0-5 (0.4), `eyeCount` 0-6 pairs per strip (1), `eyeColor` (#7fff00), `eyeSize` 1-6 (2), `eyeGap` 1-12 (4), `lightningPerMinute` 0-30 (3), `lightningColor` (#d8ccff), `thunder` (on), `thunderLeadMs` 0-5000 (300): send the play command this early to cover the streamer's start-up delay |

CandyCane, Halloween and Fire also exist in the NightDriverStrip fork's
firmware, so a controller shows the same looks when LED-Central isn't
running.

## Information displays

| Effect | What it shows | Parameters |
| - | - | - |
| **Weather Forecast** | For HUB75 matrices: time, date, current conditions and a daily forecast for a Canadian postal code from Environment Canada (no API key). 128 wide shows five days with wind, humidity and sunrise/sunset; 64 x 64 shows three days. A new weather alert rings the matrix's speaker. | `postalCode` (K2L), `timeZone` (America/Toronto), `use24Hour` (off), `alertSound` (on), `alertVolume` 0-100 (100) |
| **Stock Banner** | A scrolling ticker of stock symbols. It currently scrolls the symbol names only; it does not fetch quotes yet, so the `stockServer*` settings are unused. | `symbols` (NDS, AAPL, MSFT), `stockServerHost`, `stockServerPort`, `minQuoteWidth`, `compactQuoteWidth`, `refreshSeconds` |
