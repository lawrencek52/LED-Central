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
      throw new EffectRenderError(
        `Unsupported effect renderer: ${effect.renderer}`,
      );
    }

    return {
      timestamp,
      pixels: renderer({
        width: canvas.width,
        height: canvas.height,
        parameters: { ...defaultParameters(effect.parameters), ...parameters },
        timestamp,
      }),
    };
  }
}

const renderers = {
  solid: ({ width, height, parameters }) => {
    const color = parseColor(parameters.color);
    return Array.from({ length: width * height }, () => color);
  },
  "dave-debug": ({ width, height }) => {
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
    const denominator = Math.max(
      1,
      Math.abs(directionX) * (width - 1) + Math.abs(directionY) * (height - 1),
    );
    return Array.from({ length: width * height }, (_, index) => {
      const x = index % width;
      const y = Math.floor(index / width);
      const position = Math.max(
        0,
        Math.min(1, (x * directionX + y * directionY) / denominator),
      );
      return start.map((channel, channelIndex) =>
        Math.round(channel + (end[channelIndex] - channel) * position),
      );
    });
  },
  wave: ({ width, height, parameters, timestamp }) => {
    const color = parseColor(parameters.color);
    const speed = Number(parameters.speed) || 0;
    const waveWidth = Math.max(1, Number(parameters.width) || 1);
    const phaseOffset = (timestamp / 1000) * speed;
    return Array.from({ length: width * height }, (_, index) => {
      const x = index % width;
      const intensity =
        (Math.sin((x / waveWidth) * Math.PI * 2 + phaseOffset) + 1) / 2;
      return color.map((channel) => Math.round(channel * intensity));
    });
  },
  "color-wave": ({ width, height, parameters, timestamp }) => {
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
  "palette-scroll": ({ width, height, parameters, timestamp }) => {
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
    // phase is a pixel offset (not a fraction of the strip), so it must stay in
    // the same units as `index` before normalizing - otherwise the scroll speed
    // is divided down by totalPixels twice and the effect never appears to move.
    const phase = seconds * (scrollSpeed + colorRate * 0.25) * density;

    for (let index = 0; index < totalPixels; index += 1) {
      if (index % everyNthDot !== 0) continue;

      const travel = (index + phase) / Math.max(1, totalPixels - 1);
      const palettePhase =
        (travel +
          (index % Math.max(1, palette.length)) / Math.max(1, palette.length)) %
        1;
      const color = interpolatePalette(palette, palettePhase);
      const brightened = color.map((channel) =>
        Math.round(channel * brightness),
      );

      for (let offset = 0; offset < dotSize; offset += 1) {
        const pixelIndex = (index + offset) % totalPixels;
        pixels[pixelIndex] = brightened;
        if (mirrored) {
          const mirrorIndex =
            (totalPixels - 1 - pixelIndex + totalPixels) % totalPixels;
          pixels[mirrorIndex] = brightened;
        }
      }
    }
    return pixels;
  },
  starfield: ({ width, height, parameters, timestamp }) => {
    const starCount = Math.max(0, Number(parameters.starCount ?? 0));
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    // Seed is fixed per star so each one keeps a stable lane/speed, but its
    // position and twinkle are derived from timestamp so the field actually drifts.
    const rng = mulberry32(starCount * 97 + width + height);
    const seconds = timestamp / 1000;
    for (let i = 0; i < starCount; i += 1) {
      const startX = rng() * width;
      const y = Math.floor(rng() * height);
      const speed = 2 + rng() * 6;
      const x = Math.floor((startX + seconds * speed) % width);
      const twinkle = (Math.sin(seconds * 3 + i * 12.9898) + 1) / 2;
      const base = [255, 255, 255];
      const accent = [
        Math.round(twinkle * 255),
        Math.round(((Math.sin(seconds * 2 + i * 78.233) + 1) / 2) * 255),
        Math.round(((Math.sin(seconds * 1.3 + i * 37.719) + 1) / 2) * 255),
      ];
      pixels[y * width + x] = i % 2 === 0 ? base : accent;
    }
    return pixels;
  },
  "bouncing-balls": ({ width, height, parameters, timestamp }) => {
    const ballCount = Math.max(1, Number(parameters.ballCount ?? 5));
    const ballSize = Math.max(1, Number(parameters.ballSize ?? 1));
    const mirrored = Boolean(parameters.mirrored);
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    const phase = timestamp / 1000;

    for (let ball = 0; ball < ballCount; ball += 1) {
      const offset = (ball + 1) * 0.9;
      const movement = (Math.sin(phase * (1.2 + ball * 0.2) + offset) + 1) / 2;
      const amplitude = Math.max(0, width - ballSize - 1);
      // Keep the fractional position and blend across neighboring pixels so
      // motion isn't quantized to whole-pixel jumps between frames.
      const position = movement * amplitude;
      const color = paletteFromIndex(ball, ballCount);

      for (let x = 0; x < ballSize; x += 1) {
        plotBlended1D(pixels, width, position + x, color);
        if (mirrored) {
          plotBlended1D(pixels, width, width - 1 - (position + x), color);
        }
      }
    }
    return pixels;
  },
  fireworks: ({ width, height, parameters, timestamp }) => {
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    const maxSpeed = Number(parameters.maxSpeed ?? 175);
    const particleSize = Math.max(
      1,
      Math.round(Number(parameters.particleSize ?? 1)),
    );
    const newParticleProbability = Math.max(
      0.1,
      Number(parameters.newParticleProbability ?? 1),
    );
    // Timing/physics ported from NightDriverStrip's FireworksEffect::Particle
    // (fireworkseffect.h): position integrates an exponentially-decaying
    // (drag) velocity rather than a ballistic arc, and there is no rocket
    // launch phase at all - real bursts ignite immediately at the beat.
    const preignition = Math.max(
      0,
      Number(parameters.particlePreignitionTime ?? 0),
    );
    const ignition = Math.max(
      0.001,
      Number(parameters.particleIgnition ?? 0.14),
    );
    const holdTime = Math.max(0, Number(parameters.particleHoldTime ?? 0.03));
    const fadeTime = Math.max(
      0.05,
      Number(parameters.particleFadeTime ?? 0.95),
    );
    const DRAG = 1.8;
    const totalLifetime = preignition + ignition + holdTime + fadeTime;
    const particleCount = Math.round(12 + newParticleProbability * 12);
    const burstCount = 4;
    // Small gap between a burst's death and the next one launching, purely so
    // consecutive bursts on the same synthetic launcher read as distinct events.
    const cycleSeconds = totalLifetime + 0.4;
    const elapsedSeconds = Number(parameters.timeSeconds ?? timestamp / 1000);

    for (let burst = 0; burst < burstCount; burst += 1) {
      const cycleOffset = (burst / burstCount) * cycleSeconds;
      const cyclePosition =
        (((elapsedSeconds + cycleOffset) % cycleSeconds) + cycleSeconds) %
        cycleSeconds;
      if (cyclePosition >= totalLifetime) continue;

      // Reseed per launch cycle so each burst's origin/spread differs from the last,
      // instead of replaying the exact same shape every period.
      const cycleIndex = Math.floor(
        (elapsedSeconds + cycleOffset) / cycleSeconds,
      );
      const rng = mulberry32(burst * 7919 + cycleIndex * 104729 + 1);
      const burstPosition = rng() * (width - 1);
      const color = paletteFromIndex(burst, burstCount);
      const age = cyclePosition;

      for (let p = 0; p < particleCount; p += 1) {
        const velocity = (rng() * 2 - 1) * maxSpeed;
        const drag = DRAG * (0.85 + rng() * 0.3);
        const position =
          burstPosition + (velocity / drag) * (1 - Math.exp(-drag * age));

        let shade;
        if (age < preignition + ignition) {
          const ignitionAge = Math.max(0, age - preignition);
          const ignitionBlend = clamp(ignitionAge / ignition, 0, 1);
          shade =
            ignitionBlend < 0.6
              ? [255, 255, 255]
              : (() => {
                  const t = (ignitionBlend - 0.6) / 0.4;
                  return [255, 255, 255].map((channel, i) =>
                    Math.round(channel + (color[i] - channel) * t),
                  );
                })();
        } else {
          const fadeStart = preignition + ignition + holdTime;
          shade =
            age > fadeStart
              ? color.map((channel) =>
                  Math.round(
                    channel * (1 - clamp((age - fadeStart) / fadeTime, 0, 1)),
                  ),
                )
              : color;
        }

        for (let r = 0; r < particleSize; r += 1) {
          plotBlended1DAllRows(pixels, width, height, position + r, shade);
        }
      }
    }
    return pixels;
  },
  "stock-banner": ({ width, height, parameters, timestamp }) => {
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    const symbols =
      Array.isArray(parameters.symbols) && parameters.symbols.length > 0
        ? parameters.symbols
        : ["NDS", "AAPL", "MSFT"];
    const label = symbols.join("  ");
    const wrap = label.padEnd(Math.max(label.length, width / 2), " ");
    const offset = Math.floor((timestamp / 600) % wrap.length);
    for (let x = 0; x < width; x += 1) {
      const charIndex = offset + x;
      const char = wrap[charIndex % wrap.length] ?? " ";
      if (char !== " ") {
        const color =
          char.charCodeAt(0) % 3 === 0 ? [255, 128, 0] : [0, 255, 200];
        pixels[(height / 2) * width + x] = color;
      }
    }
    return pixels;
  },
  // --- Effects ported from NightDriverStrip (https://github.com/PlummersSoftwareLLC/NightDriverStrip) ---
  // Audio/microphone-reactive effects (beat detection, VU-driven) were intentionally excluded.
  "nds-bouncing-balls": ({ width, height, parameters, timestamp }) => {
    const ballCount = Math.max(
      1,
      Math.round(Number(parameters.ballCount ?? 3)),
    );
    const ballSize = Math.max(1, Math.round(Number(parameters.ballSize ?? 5)));
    const mirrored = Boolean(parameters.mirrored);
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    // Ported directly from NightDriverStrip's BouncingBallEffect::Draw() kinematics
    // (h = v*t - 0.5*g*t^2, energy lost to `dampening` on each bounce) instead of
    // the earlier sine-decay approximation, which is what actually froze balls at
    // position 0 - see effect-render-service.test.js for the source formulas.
    const GRAVITY = 9.81;
    const START_HEIGHT = 1;
    const IMPACT_VELOCITY_START = Math.sqrt(2 * GRAVITY * START_HEIGHT);
    // NightDriverStrip divides real elapsed clock time by 10 before using it in
    // the kinematics formula, so the simulated physics runs at 1/10th wall-clock speed.
    const CLOCK_DIVISOR = 10;
    const elapsedSeconds = Number(parameters.timeSeconds ?? timestamp / 1000);

    for (let ball = 0; ball < ballCount; ball += 1) {
      const dampening = 1 - ball / (ballCount * ballCount);
      const color = NDS_BALL_COLORS[ball % NDS_BALL_COLORS.length];

      // A bounce that would drop below half the start velocity is re-kicked back
      // to full energy instead, so the velocity sequence per ball is periodic -
      // precompute that one repeating group of bounces (safety-capped).
      const cycleVelocities = [];
      let velocity = IMPACT_VELOCITY_START;
      for (let i = 0; i < 2000; i += 1) {
        cycleVelocities.push(velocity);
        const next = dampening * velocity;
        if (next < 0.5 * IMPACT_VELOCITY_START) break;
        velocity = next;
      }

      const physicsPeriod = cycleVelocities.reduce(
        (sum, v) => sum + (2 * v) / GRAVITY,
        0,
      );
      const realPeriod = physicsPeriod * CLOCK_DIVISOR;
      const realElapsedInPeriod =
        ((elapsedSeconds % realPeriod) + realPeriod) % realPeriod;
      const physicsElapsedInPeriod = realElapsedInPeriod / CLOCK_DIVISOR;

      let remaining = physicsElapsedInPeriod;
      let cycleVelocity = cycleVelocities[cycleVelocities.length - 1];
      let localTime = 0;
      for (const v of cycleVelocities) {
        const cycleDuration = (2 * v) / GRAVITY;
        if (remaining <= cycleDuration) {
          cycleVelocity = v;
          localTime = remaining;
          break;
        }
        remaining -= cycleDuration;
      }

      const heightValue = Math.max(
        0,
        cycleVelocity * localTime - 0.5 * GRAVITY * localTime * localTime,
      );
      const position = (heightValue * (width - 1)) / START_HEIGHT;

      for (let x = 0; x < ballSize; x += 1) {
        plotBlended1D(pixels, width, position + x, color);
        if (mirrored) {
          plotBlended1D(pixels, width, width - 1 - (position + x), color);
        }
      }
    }
    return pixels;
  },
  "double-palette": ({ width, height, parameters, timestamp }) => {
    const paletteA = normalizePalette(parameters.paletteA);
    const paletteB = normalizePalette(parameters.paletteB);
    const speedA = Number(parameters.speedA ?? 4);
    const speedB = Number(parameters.speedB ?? -4);
    const density = Math.max(0.1, Number(parameters.density ?? 1));
    const totalPixels = width * height;
    const seconds = timestamp / 1000;
    const pixels = [];
    for (let index = 0; index < totalPixels; index += 1) {
      const base = (index * density) / Math.max(1, totalPixels - 1);
      const tA = (((base + seconds * speedA * 0.05) % 1) + 1) % 1;
      const tB = (((base + seconds * speedB * 0.05) % 1) + 1) % 1;
      const colorA = interpolatePalette(paletteA, tA);
      const colorB = interpolatePalette(paletteB, tB);
      pixels.push(
        colorA.map((channel, i) =>
          Math.min(255, Math.round((channel + colorB[i]) / 1.4)),
        ),
      );
    }
    return pixels;
  },
  "warm-glow": ({ width, height, parameters }) => {
    const kelvin = clamp(Number(parameters.kelvin ?? 4000), 1000, 12000);
    const brightness = clamp(Number(parameters.brightness ?? 1), 0, 1);
    const color = kelvinToRgb(kelvin).map((channel) =>
      Math.round(channel * brightness),
    );
    return Array.from({ length: width * height }, () => color);
  },
  fire: ({ width, height, parameters, timestamp }) => {
    // Ported from NightDriverStrip's FireEffect::DrawFire() (fireeffect.h):
    // per-cell cooling, then heat diffused in from higher-index neighbors
    // (BlendNeighbor1=1, BlendNeighbor2=2, over BlendTotal=3), then random
    // sparks near the high-index end. There's no closed-form solution for a
    // random cellular automaton, so we simulate a bounded recent window of
    // steps (deterministic per elapsed-time bucket) instead of the whole
    // effect history, which keeps render cost constant no matter how long
    // the effect has been running.
    const cooling = Math.max(0, Math.round(Number(parameters.cooling ?? 3)));
    const sparking = clamp(Number(parameters.sparking ?? 100), 0, 255);
    const sparks = Math.max(0, Math.round(Number(parameters.sparks ?? 3)));
    const sparkHeight = Math.max(
      1,
      Math.round(Number(parameters.sparkHeight ?? 4)),
    );
    const reversed = Boolean(parameters.reversed);
    const mirrored = Boolean(parameters.mirrored);
    const elapsedSeconds = Number(parameters.timeSeconds ?? timestamp / 1000);
    const ledCount = mirrored ? Math.max(1, Math.floor(width / 2)) : width;

    const heat = simulateFireHeat({
      cellCount: ledCount,
      elapsedSeconds,
      seedSalt: 11,
      step: (h, rng) => {
        for (let i = 0; i < ledCount; i += 1) {
          const coolAmount = Math.floor(rng() * cooling);
          h[i] = Math.max(0, h[i] - coolAmount);
        }
        for (let i = 0; i < ledCount; i += 1) {
          const a = h[(i + 1) % ledCount];
          const b = h[(i + 2) % ledCount];
          h[i] = Math.min(255, Math.floor((a + b * 2) / 3));
        }
        for (let s = 0; s < sparks; s += 1) {
          if (rng() * 255 < sparking) {
            const y = ledCount - 1 - Math.floor(rng() * sparkHeight);
            if (y >= 0) h[y] = Math.min(255, Math.floor(rng() * 56) + 200);
          }
        }
      },
    });

    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    for (let i = 0; i < ledCount; i += 1) {
      const color = heatToFireColor(heat[i]);
      const j = reversed ? ledCount - 1 - i : i;
      setPixelAllRows(pixels, width, height, j, color);
      if (mirrored) {
        const mirrorIndex = !reversed ? 2 * ledCount - 1 - i : ledCount + i;
        setPixelAllRows(pixels, width, height, mirrorIndex, color);
      }
    }
    return pixels;
  },
  "classic-fire": ({ width, height, parameters, timestamp }) => {
    // Ported from NightDriverStrip's ClassicFireEffect::Fire() (fireeffect.h):
    // the classic Fire2012-style automaton, diffusing from *lower*-index
    // neighbors (opposite direction from FireEffect) with sparks igniting
    // near the low-index end, plus its own hard-banded heat-to-color ramp.
    const cooling = Math.max(0, Math.round(Number(parameters.cooling ?? 5)));
    const reversed = Boolean(parameters.reversed);
    const mirrored = Boolean(parameters.mirrored);
    const elapsedSeconds = Number(parameters.timeSeconds ?? timestamp / 1000);
    const ledCount = width;
    const SPARKING = 180;
    const SPARKS = 5;

    const heat = simulateFireHeat({
      cellCount: ledCount,
      elapsedSeconds,
      seedSalt: 23,
      step: (h, rng) => {
        for (let i = 0; i < ledCount; i += 1) {
          const cooldown = Math.floor(rng() * cooling);
          h[i] = cooldown > h[i] ? 0 : h[i] - cooldown;
        }
        for (let k = ledCount - 1; k >= 3; k -= 1) {
          h[k] = Math.floor((h[k - 1] + h[k - 2] + h[k - 3]) / 3);
        }
        for (let f = 0; f < SPARKS; f += 1) {
          if (rng() * 255 < SPARKING) {
            const y = Math.floor(rng() * 5);
            h[y] = Math.min(255, h[y] + Math.floor(rng() * 96) + 160);
          }
        }
      },
    });

    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    for (let i = 0; i < ledCount; i += 1) {
      const color = heatToFireColor(heat[i]);
      if (mirrored) {
        const middle = Math.floor(ledCount / 2);
        setPixelAllRows(pixels, width, height, middle - i, color);
        setPixelAllRows(pixels, width, height, middle + i, color);
      } else {
        const j = reversed ? ledCount - 1 - i : i;
        setPixelAllRows(pixels, width, height, j, color);
      }
    }
    return pixels;
  },
  meteor: ({ width, height, parameters, timestamp }) => {
    // Ported from NightDriverStrip's MeteorChannel::Draw() (meteoreffect.h):
    // meteors bounce back and forth between the strip's ends (not wrap
    // around) and each carries its own slowly-rotating rainbow hue. The
    // per-frame random fadePixelToBlackOnAllChannelsBy() trail persistence is
    // stateful and can't be replicated by a stateless renderer, so it's
    // approximated with a fixed-length exponential fade instead.
    const meteorCount = Math.max(
      1,
      Math.round(Number(parameters.meteorCount ?? 4)),
    );
    const meteorSize = Math.max(
      1,
      Math.round(Number(parameters.meteorSize ?? 4)),
    );
    const decay = clamp(Number(parameters.decay ?? 3), 1, 255);
    const minSpeed = Math.max(0.01, Number(parameters.minSpeed ?? 0.2));
    const maxSpeed = Math.max(minSpeed, Number(parameters.maxSpeed ?? 0.2));
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    const elapsedSeconds = Number(parameters.timeSeconds ?? timestamp / 1000);
    const minPos = meteorSize - 1;
    const maxPos = width - 1;
    const range = Math.max(0.001, maxPos - minPos);
    const period = 2 * range;
    const trailLength = Math.max(meteorSize, Math.round((255 / decay) * 2));
    const isRedPair = meteorCount === 2;

    const positionAt = (m, t, speed, phase0, direction) => {
      const u = phase0 + direction * speed * t;
      const wrapped = ((u % period) + period) % period;
      const reflected = wrapped <= range ? wrapped : period - wrapped;
      return minPos + reflected;
    };

    for (let m = 0; m < meteorCount; m += 1) {
      const rng = mulberry32(m * 733 + 1);
      // meteorSpeed is pixels-per-*frame* in the source at its assumed 30fps
      // default, not pixels-per-second, so scale it up to match real motion.
      const speed = (minSpeed + rng() * (maxSpeed - minSpeed)) * 30;
      const startPos = isRedPair
        ? m === 0
          ? 0
          : maxPos
        : meteorCount <= 1
          ? 0
          : (width / (meteorCount - 1)) * m;
      const direction = (m & 2) !== 0 ? -1 : 1;
      const phase0 = clamp(startPos - minPos, 0, range);
      const baseHue = isRedPair ? 0 : (48 * m) % 256;
      const hueRotationRate = 8;
      const hue = (baseHue + hueRotationRate * elapsedSeconds) % 256;
      const color = hsvToRgb(hue, 255, 255);

      const headPos = positionAt(m, elapsedSeconds, speed, phase0, direction);
      const headPosPrev = positionAt(
        m,
        elapsedSeconds - 0.02,
        speed,
        phase0,
        direction,
      );
      const movingRight = headPos >= headPosPrev;

      for (let t = 0; t < trailLength; t += 1) {
        const pos = Math.round(movingRight ? headPos - t : headPos + t);
        if (pos < 0 || pos >= width) continue;
        const fade = Math.max(0, 1 - t / trailLength);
        for (let y = 0; y < height; y += 1) {
          blendChannel(pixels, y * width + pos, color, fade);
        }
      }
    }

    return pixels;
  },
  "simple-rainbow": ({ width, height, parameters, timestamp }) => {
    const everyNth = Math.max(1, Number(parameters.everyNth ?? 12));
    const speedDivisor = Math.max(1, Number(parameters.speedDivisor ?? 8));
    const seconds = timestamp / 1000;
    const hueBase = (seconds * (255 / speedDivisor)) % 256;
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    for (let index = 0; index < width * height; index += 1) {
      if (index % everyNth !== 0) continue;
      pixels[index] = hsvToRgb(hueBase + index * 4, 255, 255);
    }
    return pixels;
  },
  "rainbow-twinkle": ({ width, height, parameters, timestamp }) => {
    const speedDivisor = Math.max(1, Number(parameters.speedDivisor ?? 12));
    const deltaHue = Number(parameters.deltaHue ?? 14);
    const seconds = timestamp / 1000;
    const hueBase = (seconds * (255 / speedDivisor)) % 256;
    const totalPixels = width * height;
    const pixels = Array.from({ length: totalPixels }, (_, index) =>
      hsvToRgb(hueBase + index * deltaHue, 255, 255),
    );
    const twinkleCount = Math.max(1, Math.round(totalPixels * 0.03));
    const tick = Math.floor(seconds * 4);
    for (let i = 0; i < twinkleCount; i += 1) {
      const rng = mulberry32(i * 97531 + tick * 8191 + 3);
      pixels[Math.floor(rng() * totalPixels)] = [255, 255, 255];
    }
    return pixels;
  },
  rainbowfill: ({ width, height, parameters, timestamp }) => {
    const speedDivisor = Math.max(1, Number(parameters.speedDivisor ?? 12));
    const deltaHue = Number(parameters.deltaHue ?? 14);
    const mirrored = Boolean(parameters.mirrored);
    const seconds = timestamp / 1000;
    const hueBase = (seconds * (255 / speedDivisor)) % 256;
    const totalPixels = width * height;
    const pixels = Array.from({ length: totalPixels }, () => [0, 0, 0]);
    for (let index = 0; index < totalPixels; index += 1) {
      const color = hsvToRgb(hueBase + index * deltaHue, 255, 255);
      pixels[index] = color;
      if (mirrored) pixels[totalPixels - 1 - index] = color;
    }
    return pixels;
  },
  "color-fill": ({ width, height, parameters }) => {
    const color = parseColor(parameters.color ?? "#f6c8a0");
    const everyNth = Math.max(1, Number(parameters.everyNth ?? 10));
    return Array.from({ length: width * height }, (_, index) =>
      index % everyNth === 0 ? color : [0, 0, 0],
    );
  },
  twinkle: ({ width, height, parameters, timestamp }) => {
    const totalPixels = width * height;
    const countToDraw = Math.max(
      1,
      Math.min(
        totalPixels,
        Number(parameters.countToDraw ?? Math.floor(totalPixels / 2)),
      ),
    );
    const updateSpeedMs = Math.max(10, Number(parameters.updateSpeedMs ?? 40));
    const pixels = Array.from({ length: totalPixels }, () => [0, 0, 0]);
    const tick = Math.floor(timestamp / updateSpeedMs);
    for (let i = 0; i < countToDraw; i += 1) {
      const rng = mulberry32((tick - i) * 7919 + i * 104729 + 17);
      const index = Math.floor(rng() * totalPixels);
      const color = TWINKLE_COLORS[Math.floor(rng() * TWINKLE_COLORS.length)];
      const brightness = clamp(1 - i / countToDraw, 0, 1);
      blendChannel(pixels, index, color, brightness);
    }
    return pixels;
  },
  silon: ({ width, height, parameters, timestamp }) => {
    const speed = Math.max(0.1, Number(parameters.speed ?? 1));
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    const period = Math.max(1, width - 1) * 2;
    const seconds = timestamp / 1000;
    const cycle = (seconds * speed * 20) % period;
    const offset = cycle < period / 2 ? cycle : period - cycle;
    const pos = Math.round(offset);
    for (let y = 0; y < height; y += 1) {
      blendChannel(
        pixels,
        y * width + Math.min(width - 1, pos),
        [255, 0, 0],
        1,
      );
      blendChannel(
        pixels,
        y * width + Math.max(0, width - 1 - pos),
        [0, 255, 0],
        1,
      );
    }
    return pixels;
  },
  snake: ({ width, height, parameters, timestamp }) => {
    const snakeSize = Math.max(1, Number(parameters.snakeSize ?? 3));
    const speed = Math.max(0.5, Number(parameters.speed ?? 4));
    const totalPixels = width * height;
    const pixels = Array.from({ length: totalPixels }, () => [0, 0, 0]);
    const seconds = timestamp / 1000;
    const head = Math.floor(seconds * speed) % totalPixels;
    for (let i = 0; i < snakeSize; i += 1) {
      pixels[(head - i + totalPixels) % totalPixels] = [0, 200, 40];
    }
    const foodRng = mulberry32(Math.floor((seconds * speed) / totalPixels) + 5);
    pixels[Math.floor(foodRng() * totalPixels)] = [220, 30, 30];
    return pixels;
  },
  "night-twinkle": ({ width, height, parameters, timestamp }) => {
    const baseColor = parseColor(parameters.baseColor ?? "#0000ff");
    const density = Math.max(0, Number(parameters.density ?? 1));
    const totalPixels = width * height;
    const pixels = Array.from({ length: totalPixels }, () => baseColor.slice());
    const elapsedSeconds = Number(parameters.timeSeconds ?? timestamp / 1000);
    // Ported from NightDriverStrip's NightTwinkleEffect / NightTwinkleStar
    // (particles.h, stareffect.h): preignition 0s, ignition 0.05s, hold 0.10s,
    // fade 0.30s, always white. CreateStars() spawns starsPerFrame*density stars
    // on every Draw() call; NightTwinkleEffect doesn't override the base class's
    // default 30fps, so that's the assumed spawn cadence here.
    const preignition = 0;
    const ignition = 0.05;
    const hold = 0.1;
    const fadeTime = 0.3;
    const totalLifetime = preignition + ignition + hold + fadeTime;
    const starsPerFrame = Math.max(0, Number(parameters.starsPerFrame ?? 10));
    const assumedFps = 30;
    const spawnRate =
      starsPerFrame * (totalPixels / 144) * density * assumedFps;
    if (spawnRate <= 0) return pixels;
    const avgInterval = 1 / spawnRate;
    const lookbackSlots = Math.ceil(totalLifetime / avgInterval) + 2;
    const currentSlot = Math.floor(elapsedSeconds / avgInterval);

    for (
      let slot = currentSlot - lookbackSlots;
      slot <= currentSlot;
      slot += 1
    ) {
      const rng = mulberry32(slot * 2654435761 + 29);
      const birthTime = (slot + rng()) * avgInterval;
      const age = elapsedSeconds - birthTime;
      const index = Math.floor(rng() * totalPixels);
      if (age < 0 || age >= totalLifetime) continue;

      const { brightness } = starFadeEnvelope(
        age,
        preignition,
        ignition,
        hold,
        fadeTime,
      );
      blendChannel(pixels, index, [255, 255, 255], brightness);
    }
    return pixels;
  },
  "twinkle-star": ({ width, height, parameters, timestamp }) => {
    const density = Math.max(0.1, Number(parameters.density ?? 1));
    const totalPixels = width * height;
    const pixels = Array.from({ length: totalPixels }, () => [0, 0, 0]);
    const seconds = timestamp / 1000;
    const count = Math.max(1, Math.round(totalPixels * 0.08 * density));
    for (let i = 0; i < count; i += 1) {
      const rng = mulberry32(i * 97 + 13);
      const cycleLength = 1.5 + rng() * 2;
      const cycleOffset = rng() * cycleLength;
      const phase = ((seconds + cycleOffset) % cycleLength) / cycleLength;
      if (phase > 0.4) continue;
      const brightness = 1 - phase / 0.4;
      const index = Math.floor(rng() * totalPixels);
      const color = TWINKLE_COLORS[Math.floor(rng() * TWINKLE_COLORS.length)];
      blendChannel(pixels, index, color, brightness);
    }
    return pixels;
  },
  "twinkle-stars": ({ width, height, parameters, timestamp }) => {
    const totalPixels = width * height;
    const pixels = Array.from({ length: totalPixels }, () => [0, 0, 0]);
    const probability = Math.max(0.01, Number(parameters.probability ?? 1));
    const starSize = Math.max(1, Math.round(Number(parameters.starSize ?? 1)));
    const maxSpeed = Number(parameters.maxSpeed ?? 2);
    const rainbow = Boolean(parameters.rainbow);
    const palette = rainbow
      ? null
      : normalizePalette(parameters.palette ?? ["#ffffff"]);
    // "flash" == plain Star (white ignition flash, then hold, then fade).
    // "quiet" == QuietStar (fade in, no flash, straight into a fade out).
    const isFlashVariant = parameters.variant === "flash";
    const preignition = isFlashVariant ? 0 : 1.0;
    const ignition = isFlashVariant ? 0.5 : 0;
    const hold = isFlashVariant ? 1.0 : 0;
    const fadeTime = isFlashVariant ? 1.5 : 2.0;
    const totalLifetime = preignition + ignition + hold + fadeTime;
    const elapsedSeconds = Number(parameters.timeSeconds ?? timestamp / 1000);

    // NightDriverStrip rolls up to 144 spawn attempts per frame, each firing with
    // probability (probability/100) * frameDeltaSeconds - which averages out to
    // ~1.44 * probability new stars per second, independent of actual frame rate.
    const spawnRate = 1.44 * probability;
    const avgInterval = 1 / spawnRate;
    const lookbackSlots = Math.ceil(totalLifetime / avgInterval) + 2;
    const currentSlot = Math.floor(elapsedSeconds / avgInterval);

    for (
      let slot = currentSlot - lookbackSlots;
      slot <= currentSlot;
      slot += 1
    ) {
      const rng = mulberry32(slot * 2654435761 + 17);
      const birthTime = (slot + rng()) * avgInterval;
      const age = elapsedSeconds - birthTime;
      const startIndex = rng() * totalPixels;
      const velocity = (rng() * 2 - 1) * maxSpeed;
      if (age < 0 || age >= totalLifetime) continue;

      const { brightness, isFlash } = starFadeEnvelope(
        age,
        preignition,
        ignition,
        hold,
        fadeTime,
      );
      const starColor = isFlash
        ? [255, 255, 255]
        : rainbow
          ? hsvToRgb(rng() * 255, 255, 255)
          : palette[Math.floor(rng() * palette.length)];
      const position = startIndex + velocity * age;
      const shade = starColor.map((channel) =>
        Math.round(channel * brightness),
      );

      for (let s = 0; s < starSize; s += 1) {
        plotBlended1D(pixels, totalPixels, position + s, shade);
      }
    }
    return pixels;
  },
  "palette-effect": ({ width, height, parameters, timestamp }) => {
    const palette = normalizePalette(parameters.palette);
    const density = Math.max(0.1, Number(parameters.density ?? 1));
    const speed = Number(parameters.speed ?? 1);
    const ledsPerSecond = Number(parameters.ledsPerSecond ?? 0);
    const lightSize = Math.max(1, Number(parameters.lightSize ?? 1));
    const gapSize = Math.max(0, Number(parameters.gapSize ?? 1));
    const totalPixels = width * height;
    const pixels = Array.from({ length: totalPixels }, () => [0, 0, 0]);
    const seconds = timestamp / 1000;
    const period = lightSize + gapSize;
    const shift = seconds * ledsPerSecond;
    const paletteIndex = seconds * speed;
    for (let index = 0; index < totalPixels; index += 1) {
      const cell = (index + shift) / Math.max(1, period);
      const withinCell = ((cell % 1) + 1) % 1;
      if (withinCell >= lightSize / period) continue;
      const t =
        ((index * density) / Math.max(1, totalPixels - 1) + paletteIndex) % 1;
      pixels[index] = interpolatePalette(palette, ((t % 1) + 1) % 1);
    }
    return pixels;
  },
  // 'mp4-playback': ({ width, height, parameters, timestamp }) => {
  //   const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
  //   const filePath = String(parameters.filePath ?? './media/mp4/goldendollars.mp4');
  //   const banner = filePath.includes('golden') ? 'GOLD' : 'VIDEO';
  //   const timeScale = timestamp / 1000;
  //
  //   for (let y = 0; y < height; y += 1) {
  //     for (let x = 0; x < width; x += 1) {
  //       const phase = (x * 0.45) + (y * 0.2) + (timeScale * 3.1);
  //       const hue = ((Math.sin(phase) + 1) / 2) * 255;
  //       const char = banner[(x + Math.floor(timeScale * 2)) % banner.length];
  //       const color = char === 'G' ? [255, 215, 0] : [115, 220, 255];
  //       const shimmer = hsvToRgb(hue, 180, 220);
  //       const pixel = (Math.sin(phase * 1.8) + 1) > 0.4 ? color : shimmer;
  //       pixels[y * width + x] = pixel;
  //     }
  //   }
  //   return pixels;
  // }
};

function defaultParameters(schema = {}) {
  return Object.fromEntries(
    Object.entries(schema).map(([name, definition]) => [
      name,
      definition.default,
    ]),
  );
}

function parseColor(value) {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new EffectRenderError(`Invalid color: ${value}`);
  }
  return [1, 3, 5].map((offset) =>
    Number.parseInt(value.slice(offset, offset + 2), 16),
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hsvToRgb(h, s, v) {
  const hue = ((h % 256) + 256) % 256;
  const sNorm = clamp(s / 255, 0, 1);
  const vNorm = clamp(v / 255, 0, 1);
  const c = vNorm * sNorm;
  const x = c * (1 - Math.abs((((hue / 255) * 6) % 2) - 1));
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
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function normalizePalette(palette) {
  if (Array.isArray(palette)) {
    return palette.map((color) => parseColor(color));
  }
  const values = Array.isArray(palette?.colors)
    ? palette.colors
    : ["#ff0000", "#00ff00", "#0000ff"];
  return values.map((color) => parseColor(color));
}

function interpolatePalette(palette, t) {
  if (!palette.length) return [0, 0, 0];
  if (palette.length === 1) return palette[0];
  const scaled = ((t % 1) + 1) % 1;
  const segment = scaled * (palette.length - 1);
  const lowerIndex = Math.floor(segment);
  const upperIndex = Math.min(palette.length - 1, lowerIndex + 1);
  const localT = segment - lowerIndex;
  const lower = palette[lowerIndex];
  const upper = palette[upperIndex];
  return lower.map((channel, index) =>
    Math.round(channel + (upper[index] - channel) * localT),
  );
}

const FIRE_PALETTE = [
  [0, 0, 0],
  [128, 0, 0],
  [255, 80, 0],
  [255, 180, 20],
  [255, 255, 200],
];

const TWINKLE_COLORS = [
  [255, 255, 255],
  [64, 64, 255],
  [255, 64, 64],
  [255, 255, 64],
  [64, 255, 255],
];

// FastLED CRGB named colors used by NightDriverStrip's BouncingBallEffect, in
// the same order/index as its `ballColors` array.
const NDS_BALL_COLORS = [
  [0, 128, 0],
  [255, 0, 0],
  [0, 0, 255],
  [255, 165, 0],
  [128, 0, 128],
  [255, 255, 0],
  [75, 0, 130],
];

// 16-entry CRGBPalette16 patterns from NightDriverStrip's effectsupport.cpp
// (BlueColors_p / RedColors_p / GreenColors_p), used verbatim by the twinkle
// star effects since RandomPaletteColorStar always samples on exact entry
// boundaries (no inter-entry blending ever actually occurs).
const NDS_BLUE_STAR_PALETTE = [
  [0, 0, 139],
  [0, 0, 205],
  [0, 0, 255],
  [0, 0, 205],
];
const NDS_RED_STAR_PALETTE = [
  [255, 0, 0],
  [139, 0, 0],
  [139, 0, 0],
  [139, 0, 0],
  [255, 0, 0],
  [139, 0, 0],
  [139, 0, 0],
  [139, 0, 0],
  [255, 0, 0],
  [139, 0, 0],
  [139, 0, 0],
  [139, 0, 0],
  [255, 0, 0],
  [139, 0, 0],
  [139, 0, 0],
  [255, 69, 0],
];
const NDS_GREEN_STAR_PALETTE = [
  [0, 128, 0],
  [0, 100, 0],
  [0, 100, 0],
  [0, 100, 0],
  [0, 128, 0],
  [0, 100, 0],
  [0, 100, 0],
  [0, 100, 0],
  [0, 128, 0],
  [0, 100, 0],
  [0, 100, 0],
  [0, 100, 0],
  [0, 128, 0],
  [0, 100, 0],
  [0, 100, 0],
  [50, 205, 50],
];

// Ported from NightDriverStrip's FadingObject::FadeoutAmount() (particles.h):
// pre-ignition fade-in, an optional ignition white-flash, a steady hold, then
// a fade to black. Returns the 0-1 brightness multiplier and whether the
// particle is currently in its (always-white) ignition flash phase.
function starFadeEnvelope(age, preignition, ignition, hold, fadeTime) {
  const clampedAge = Math.max(0, age);
  if (clampedAge < preignition && preignition > 0) {
    return { brightness: clampedAge / preignition, isFlash: false };
  }
  let a = clampedAge - preignition;
  if (a < ignition && ignition > 0) {
    return { brightness: 1 - a / ignition, isFlash: true };
  }
  a -= ignition;
  if (a < hold) {
    return { brightness: 1, isFlash: false };
  }
  a -= hold;
  return { brightness: clamp(1 - a / fadeTime, 0, 1), isFlash: false };
}

function kelvinToRgb(kelvinInput) {
  const kelvin = clamp(kelvinInput, 1000, 40000) / 100;
  let r;
  let g;
  let b;
  if (kelvin <= 66) {
    r = 255;
    g = clamp(99.4708025861 * Math.log(kelvin) - 161.1195681661, 0, 255);
  } else {
    r = clamp(329.698727446 * Math.pow(kelvin - 60, -0.1332047592), 0, 255);
    g = clamp(288.1221695283 * Math.pow(kelvin - 60, -0.0755148492), 0, 255);
  }
  if (kelvin >= 66) b = 255;
  else if (kelvin <= 19) b = 0;
  else
    b = clamp(138.5177312231 * Math.log(kelvin - 10) - 305.0447927307, 0, 255);
  return [Math.round(r), Math.round(g), Math.round(b)];
}

function plotBlended1D(pixels, width, x, color) {
  const clamped = Math.max(0, Math.min(width - 1, x));
  const lower = Math.floor(clamped);
  const upper = Math.min(width - 1, lower + 1);
  const frac = clamped - lower;
  blendChannel(pixels, lower, color, 1 - frac);
  blendChannel(pixels, upper, color, frac);
}

// Same anti-aliased column blend as plotBlended1D, but repeated on every row so
// strip effects (which only reason about a single dimension) still light up
// every row of a taller canvas instead of just row 0.
function plotBlended1DAllRows(pixels, width, height, x, color) {
  const clamped = Math.max(0, Math.min(width - 1, x));
  const lower = Math.floor(clamped);
  const upper = Math.min(width - 1, lower + 1);
  const frac = clamped - lower;
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    blendChannel(pixels, rowOffset + lower, color, 1 - frac);
    blendChannel(pixels, rowOffset + upper, color, frac);
  }
}

// Sets an exact (non-blended) pixel index on every row, wrapping/clamping the
// column into range - used by the fire effects, which address whole LED cells.
function setPixelAllRows(pixels, width, height, x, color) {
  const index = ((Math.round(x) % width) + width) % width;
  for (let y = 0; y < height; y += 1) {
    pixels[y * width + index] = color;
  }
}

// FastLED's HeatColor() gradient (black -> red -> orange/yellow -> white),
// used by both FireEffect (via GetBlackBodyHeatColor/HeatColors_p) and
// ClassicFireEffect (via its own bit-shifted setPixelHeatColor).
function heatToFireColor(heat) {
  const t192 = Math.round((clamp(heat, 0, 255) / 255) * 191);
  let heatramp = t192 & 0x3f;
  heatramp <<= 2;
  if (t192 & 0x80) return [255, 255, heatramp];
  if (t192 & 0x40) return [255, heatramp, 0];
  return [heatramp, 0, 0];
}

// Runs a fire cellular automaton forward in fixed 20ms steps, deterministically
// seeded per step so the same elapsed time always reproduces the same frame.
// Only the last few seconds of steps are replayed (from an all-zero heat
// array) rather than the whole effect history, since the automaton mixes/cools
// out any earlier state within a couple of seconds - this keeps render cost
// bounded no matter how long the effect has been running.
function simulateFireHeat({ cellCount, elapsedSeconds, seedSalt, step }) {
  const stepMs = 20;
  const windowSteps = Math.ceil(3000 / stepMs);
  const currentStep = Math.floor((elapsedSeconds * 1000) / stepMs);
  const startStep = Math.max(0, currentStep - windowSteps);
  const heat = new Array(cellCount).fill(0);
  for (let s = startStep; s <= currentStep; s += 1) {
    const rng = mulberry32(seedSalt * 2654435761 + s * 40503);
    step(heat, rng);
  }
  return heat;
}

function plotBlended2D(pixels, width, height, x, y, color) {
  const clampedX = Math.max(0, Math.min(width - 1, x));
  const clampedY = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(clampedX);
  const x1 = Math.min(width - 1, x0 + 1);
  const y0 = Math.floor(clampedY);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = clampedX - x0;
  const fy = clampedY - y0;
  blendChannel(pixels, y0 * width + x0, color, (1 - fx) * (1 - fy));
  blendChannel(pixels, y0 * width + x1, color, fx * (1 - fy));
  blendChannel(pixels, y1 * width + x0, color, (1 - fx) * fy);
  blendChannel(pixels, y1 * width + x1, color, fx * fy);
}

function blendChannel(pixels, index, color, weight) {
  if (weight <= 0 || index < 0 || index >= pixels.length) return;
  const current = pixels[index];
  pixels[index] = color.map((channel, i) =>
    Math.min(255, Math.round(current[i] + channel * weight)),
  );
}

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paletteFromIndex(index, total) {
  const palette = [
    [255, 50, 50],
    [50, 200, 255],
    [255, 180, 50],
    [180, 100, 255],
    [80, 255, 110],
    [255, 255, 255],
  ];
  return palette[index % palette.length];
}
