import { renderWeatherForecast } from "../domain/effects/weather-forecast-renderer.js";

export class EffectRenderError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function isRendererSupported(rendererId) {
  return Object.prototype.hasOwnProperty.call(renderers, rendererId);
}

export class EffectRenderService {
  render({ effect, canvas, parameters = {}, timestamp = Date.now() }) {
    const renderer = renderers[effect.renderer];
    if (!renderer) {
      throw new EffectRenderError(
        `Unsupported effect renderer: ${effect.renderer}`,
      );
    }

    const resolvedParameters = {
      ...defaultParameters(effect.parameters),
      ...parameters,
    };
    const pixels = renderCanvasEffect({
      renderer,
      canvas,
      parameters: resolvedParameters,
      timestamp,
    });
    return {
      timestamp,
      pixels: applyBrightness(pixels, resolvedParameters.brightness),
    };
  }
}

// Applied once, after rendering, to every effect's output - a uniform final
// scale rather than each renderer implementing its own, so every effect gets
// a brightness control for free (including ones whose schema doesn't declare
// a `brightness` parameter: it just defaults to 100/no-op here).
function applyBrightness(pixels, brightnessParameter) {
  const brightness = clamp(Number(brightnessParameter ?? 100), 0, 100) / 100;
  if (brightness === 1) return pixels;
  return pixels.map((pixel) =>
    pixel.map((channel) => Math.round(channel * brightness)),
  );
}

function renderCanvasEffect({ renderer, canvas, parameters, timestamp }) {
  const parallelMappings = (canvas.mappings ?? []).filter(
    (mapping) => mapping.layout === "parallel",
  );
  if (parallelMappings.length === 0) {
    return renderer({
      width: canvas.width,
      height: canvas.height,
      parameters: {
        ...parameters,
        stripSpacingRatio: canvas.stripSpacingRatio ?? 1,
        upIsPositiveY: matrixUpIsPositiveY(canvas.mappings?.[0]),
        ledsPerMeter: canvas.mappings?.[0]?.ledsPerMeter ?? null,
      },
      timestamp,
    });
  }

  const pixels = Array.from(
    { length: canvas.width * canvas.height },
    () => [0, 0, 0],
  );
  parallelMappings.forEach((mapping, mappingOrdinal) => {
    // Each strip gets a contiguous slice of the full band range - not a
    // single band - so e.g. 4 strips over 16 telemetry bands each cover 4
    // bands (see the spectrum-band renderer, which averages a strip's slice
    // for its level bar and takes the max for its peak marker). Indexed by
    // canvas-wide ordinal, not mapping.stripIndex, which is a per-controller
    // channel index and need not be contiguous canvas-wide.
    const bandTotal = parameters.audio?.bandCount ?? parallelMappings.length;
    const bandStart = Math.floor((mappingOrdinal / parallelMappings.length) * bandTotal);
    const bandEnd = Math.max(
      bandStart + 1,
      Math.floor(((mappingOrdinal + 1) / parallelMappings.length) * bandTotal),
    );
    const stripPixels = renderer({
      width: mapping.width || canvas.width,
      height: mapping.height || 1,
      parameters: {
        ...parameters,
        randomSeed: stableSeed(`${mapping.controllerId}:${mapping.stripIndex}`),
        bandStart,
        bandEnd,
        // For an effect (like spectrum-band) that needs to simulate every
        // parallel strip's row together in one pass - e.g. to correlate
        // neighboring bars the way `fire`'s neighborBlend does - rather than
        // each strip's independent render call only ever seeing its own
        // slice of the audio data.
        mappingOrdinal,
        stripCount: parallelMappings.length,
        stripSpacingRatio: canvas.stripSpacingRatio ?? 1,
        ledsPerMeter: mapping.ledsPerMeter ?? null,
      },
      timestamp,
    });
    parallelCoordinates(mapping).forEach(([x, y], index) => {
      if (x >= 0 && x < canvas.width && y >= 0 && y < canvas.height) {
        pixels[y * canvas.width + x] = stripPixels[index] ?? [0, 0, 0];
      }
    });
  });
  return pixels;
}

// Which way is "up" in canvas (x, y) space for a non-parallel (single
// matrix mapping) canvas, so matrix-aware effects (rocket-fireworks) can
// launch toward the physical top of the display regardless of wiring.
//
// HUB75 ("series" layout) always scans row 0 first, physically the top row
// - the same convention NightDriverStrip's own HUB75 effects rely on when
// drawing text top-down - so row 0 is always up, unconditionally.
//
// A single addressable strip wired as a grid ("serpentine") has no such
// hardware guarantee: canvas row 0 is physically wherever the installer
// told canvas.js LED 0 starts (originCorner), independent of axis (axis
// only controls the zigzag wire order within that starting point, not
// which corner it starts from). If originCorner names "top", row 0 is up,
// same as HUB75; if it names "bottom", row 0 is physically the *bottom*,
// so increasing y is up instead.
function matrixUpIsPositiveY(mapping) {
  if (mapping?.layout === "serpentine") {
    return Boolean(mapping.originCorner?.includes("bottom"));
  }
  return false;
}

// Shared by every effect that climbs/burns vertically on a matrix (rocket-
// fireworks, fire, classic-fire, ...): converts a position along the
// effect's own physical "ascend" axis - 0 at the ground/source end, axisSize
// - 1 at the far end away from it - into the canvas Y coordinate that's
// actually correct for this mapping's wiring, per upIsPositiveY (see
// matrixUpIsPositiveY() above). Centralized so every such effect picks
// "which way is up" the same way instead of re-deriving (and risking
// getting backwards) its own copy of this flip.
function matrixAscendToY(ascendPos, axisSize, upIsPositiveY) {
  return upIsPositiveY ? ascendPos : axisSize - 1 - ascendPos;
}

function parallelCoordinates(mapping) {
  const width = mapping.width;
  const height = mapping.height || 1;
  const originX = mapping.x ?? 0;
  const originY = mapping.y ?? 0;
  const rotation = ((mapping.rotation ?? 0) % 360 + 360) % 360;
  const coordinates = [];
  for (let row = 0; row < height; row += 1) {
    const currentRow = [];
    for (let column = 0; column < width; column += 1) {
      if (rotation === 90) {
        currentRow.push([originX + height - 1 - row, originY + column]);
      } else if (rotation === 180) {
        currentRow.push([originX + width - 1 - column, originY + height - 1 - row]);
      } else if (rotation === 270) {
        currentRow.push([originX + row, originY + width - 1 - column]);
      } else {
        currentRow.push([originX + column, originY + row]);
      }
    }
    if (mapping.layout === "serpentine" && row % 2 === 1) currentRow.reverse();
    coordinates.push(...currentRow);
  }
  return mapping.reversed ? coordinates.reverse() : coordinates;
}

function stableSeed(value) {
  let seed = 2166136261;
  for (const character of value) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
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
        const hue = (x + y) % 256;
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
    const waveWidth = Math.max(
      1,
      densityScaledMagnitude(Number(parameters.width) || 1, parameters.ledsPerMeter),
    );
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
    const elapsedSeconds = Number(parameters.timeSeconds ?? timestamp / 1000);
    const phase = (elapsedSeconds * speed) % 1;
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
    const density = Math.max(0.1, Number(parameters.density ?? 1));
    const scrollSpeed = densityScaledMagnitude(
      Number(parameters.ledScrollSpeed ?? 0),
      parameters.ledsPerMeter,
    );
    const colorRate = Number(parameters.ledColorPerSecond ?? 0);
    const everyNthDot = densityScaledSize(
      Math.max(1, Number(parameters.everyNthDot ?? 1)),
      parameters.ledsPerMeter,
    );
    const dotSize = densityScaledSize(
      Math.max(1, Number(parameters.dotSize ?? 1)),
      parameters.ledsPerMeter,
    );
    const mirrored = Boolean(parameters.mirrored);
    const totalPixels = width * height;
    const pixels = Array.from({ length: totalPixels }, () => [0, 0, 0]);
    const elapsedSeconds = Number(parameters.timeSeconds ?? timestamp / 1000);
    const length = mirrored ? Math.floor(totalPixels / 2) : totalPixels;
    const pixelOffset = (elapsedSeconds * scrollSpeed) % Math.max(1, length);
    const colorOffset = (elapsedSeconds * colorRate * density) % 1;
    const colorIncrement = density / Math.max(1, palette.length);
    const center = totalPixels / 2;

    for (let index = 0; index < length; index += everyNthDot) {
      const pixelIndex = Math.floor(
        (((index + pixelOffset) % length) + length) % length,
      );
      const palettePhase = (colorOffset + index * colorIncrement) % 1;
      const color = interpolatePalette(palette, palettePhase);

      for (let offset = 0; offset < dotSize; offset += 1) {
        const target = (pixelIndex + offset) % length;
        pixels[target + (mirrored ? Math.floor(center) : 0)] = color;
        if (mirrored) {
          const mirrorIndex = Math.floor(center - target);
          pixels[mirrorIndex] = color;
        }
      }
    }
    return pixels;
  },
  starfield: ({ width, height, parameters, timestamp }) => {
    const starCount = Math.max(0, Number(parameters.starCount ?? 0));
    const origin = parameters.origin ?? "center";
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    const elapsedSeconds = Number(parameters.timeSeconds ?? timestamp / 1000);
    const randomSeed = Number(parameters.randomSeed ?? 0);
    const originX = origin === "left" ? 0 : origin === "right" ? width - 1 : width / 2;
    const originY = height / 2;

    for (let i = 0; i < starCount; i += 1) {
      // Stable per-star identity: how long this star's journey from the
      // origin to the edge takes, and where in that cycle it starts (staggered
      // so stars don't all restart in lockstep) - independent of elapsedSeconds,
      // so it stays fixed across renders for a given star index.
      const starRng = mulberry32(randomSeed * 97 + i * 7919 + width + height);
      const lifespanSeconds = 3 + starRng() * 6;
      const phaseOffset = starRng() * lifespanSeconds;
      const cycle = elapsedSeconds + phaseOffset;
      const lifeIndex = Math.floor(cycle / lifespanSeconds);
      const cyclePosition =
        ((cycle % lifespanSeconds) + lifespanSeconds) % lifespanSeconds;

      // A star travels in a straight line from the origin out to the edge and
      // then instantly restarts on a fresh random heading/color instead of
      // traveling forever and vanishing once offscreen (the previous
      // behavior - once every star had flown off, none ever came back) -
      // keeps roughly `starCount` stars visible at any moment instead of the
      // display slowly emptying out to black. Its speed is derived (not
      // random) from its own heading so it reaches its own edge at a random
      // point in the back half of its lifespan - a random flat speed would
      // reach the edge almost instantly on a wide, short strip (the x/y
      // formula below stretches x distance by width/height) and sit
      // offscreen, invisible, for most of its cycle.
      const spawnRng = mulberry32(
        randomSeed * 97 + i * 7919 + lifeIndex * 104729 + width + height,
      );
      const angle = starfieldAngle(origin, spawnRng());
      const exitDistance = starfieldExitDistance(
        originX,
        originY,
        angle,
        width,
        height,
      );
      const exitFraction = 0.5 + spawnRng() * 0.5;
      const speed = exitDistance / (lifespanSeconds * exitFraction);
      const brightness = Math.floor(28 + spawnRng() * 227);
      const color =
        spawnRng() < 0.5
          ? saturatedColor(spawnRng)
          : [brightness, brightness, brightness];

      const distance = speed * cyclePosition;
      const x = Math.floor(
        originX +
          (Math.cos(angle) * distance * (width / Math.max(1, height))) / 2,
      );
      const y = Math.floor(
        height === 1 ? 0 : originY + Math.sin(angle) * distance,
      );
      if (x >= 0 && x < width && y >= 0 && y < height)
        pixels[y * width + x] = color;
    }
    return pixels;
  },
  fireworks: ({ width, height, parameters, timestamp }) =>
    renderNdsCppFireworks({ width, height, parameters, timestamp }),
  // An original design (not a NightDriverStrip port), built for a wall of
  // vertical parallel strips: each row is one physical strip, index 0 within
  // a row is the ground/launch point (near the controller, matching Fire's
  // own default direction) unless `reversed`. A rocket launches from one
  // random strip and its explosion genuinely spreads sideways into
  // neighboring strips - not just up/down its own strip - using the canvas's
  // own `stripSpacingRatio` (strip-to-strip spacing divided by LED-to-LED
  // spacing along one strip) to convert a real, physically circular 2D burst
  // into this grid's very different resolution on each axis (LEDs are
  // typically packed far more densely along a strip than strips are spaced
  // apart - a wall of strips 40.64cm apart with 1.667cm LED pitch has a ratio
  // of ~24.38). The ratio lives on the canvas (it's a fact about the
  // physical wall, not this effect) rather than as an effect parameter.
  //
  // Because a particle can end up on a different physical strip than the one
  // it launched from, every strip's independent render call (each parallel
  // mapping is dispatched separately, with no visibility into any other
  // mapping's data - see spectrum-band's neighborBlend for the same
  // constraint) must compute the *entire* canvas-wide explosion field and
  // then keep only the points landing on its own row - the same redundant-
  // recomputation approach spectrum-band uses, and memoized the same way
  // (computeFireworkPoints below) since it's identical across every one of
  // this tick's per-mapping calls.
  //
  // A direct matrix canvas (one real 2D grid - HUB75, or a single strip
  // wired serpentine) has no separate physical strips to spread across, so
  // it uses the exact same physics with the two axes swapped: rockets climb
  // the canvas's actual vertical extent instead of `width`, and spread
  // across its horizontal extent instead of `rows`. `computeFireworkPoints`
  // itself doesn't know or care which canvas axis is which - it just wants
  // "how many launch positions" and "how far to climb" - so only the
  // plotting step below (parallel vs matrix) needs to know the mapping.
  // "Up" is whichever canvas direction `renderCanvasEffect` determined is
  // physically up for this canvas's wiring (`upIsPositiveY` - see
  // matrixUpIsPositiveY), not always +y, since a serpentine strip can be
  // wired starting from either the top or the bottom.
  //
  // Everything is generated on demand from a deterministic per-event-index
  // RNG rather than any persisted state - the same "make an event, check
  // whether `elapsedSeconds` falls in one of its phases" approach
  // `fire`/Starfield already use for stateless, replayable rendering. A
  // rocket's own ascent is entirely predictable from its launch time, but
  // "pause at apogee until the next beat" is not - it reads the live
  // `audio.lastBeatAt` snapshot directly, the same way vu-meter/musical-
  // fire's beat flash does, capped at `MAX_APEX_WAIT_SECONDS` so a rocket
  // can't wait forever through a quiet passage (and so every event's active
  // window stays bounded, which the window scan below depends on).
  "rocket-fireworks": ({ width, height, parameters, timestamp }) => {
    const audio = parameters.audio;
    const palette = normalizePalette(
      parameters.palette ?? {
        colors: ["#ff0000", "#00ff00", "#0000ff", "#00ffff", "#ff00ff", "#ffff00"],
      },
    );
    const launchIntervalSeconds = Math.max(
      0.5,
      Number(parameters.launchIntervalSeconds ?? 3),
    );
    // A strip's own known density always wins over the ledSpacingCm parameter
    // (same "known density overrides the reference default" precedence fire
    // uses) - otherwise one canvas-wide ledSpacingCm can only be physically
    // correct for one strip type on a mixed-density canvas like Deck11 (60 vs
    // 30 LEDs/meter), since renderCanvasEffect dispatches this per mapping
    // with that mapping's own ledsPerMeter. Falls back to the parameter
    // (itself defaulting to 1.667cm, ~60 LEDs/meter) only when density is
    // unknown for this strip.
    const ledSpacingCm = Math.max(
      0.1,
      Number(parameters.ledsPerMeter) > 0
        ? 100 / Number(parameters.ledsPerMeter)
        : Number(parameters.ledSpacingCm ?? 1.667),
    );
    // renderCanvasEffect injects this from the canvas definition (default 1,
    // i.e. a regular matrix where strips are as far apart as LEDs).
    const stripSpacingRatio = Math.max(0.01, Number(parameters.stripSpacingRatio ?? 1));
    const stripSpacingCm = ledSpacingCm * stripSpacingRatio;
    const reversed = Boolean(parameters.reversed);
    // Set by renderCanvasEffect from the canvas mapping's own wiring
    // (matrixUpIsPositiveY) - which canvas y direction rockets should climb
    // toward. Only meaningful in matrix mode; parallel mode always climbs
    // along `width` regardless (each strip's own "up" is its own far end).
    const upIsPositiveY = Boolean(parameters.upIsPositiveY);
    // Deliberately *not* `parameters.randomSeed` - renderCanvasEffect
    // overwrites that per parallel mapping (stableSeed(controllerId:
    // stripIndex), so every strip's own strip gets independent flicker in
    // effects like `fire`) before this renderer ever sees it. Every strip's
    // independent call here must derive the exact same canvas-wide event
    // sequence to agree on which rows a particle should appear on, so it
    // needs its own, unclobbered parameter name instead.
    const randomSeed = Number(parameters.showSeed ?? 0);
    const elapsedSeconds = Number(parameters.timeSeconds ?? timestamp / 1000);
    const startedAtMs = timestamp - elapsedSeconds * 1000;
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);

    // A canvas made of parallel-mapped strips is one row per strip, and
    // rockets climb along each strip's own length (`width`), spreading
    // sideways onto neighboring strips (`rows` = stripCount). A direct
    // matrix canvas with an actual vertical extent (no parallel mappings,
    // height > 1 - a real 2D grid) has no separate strips to spread across,
    // so the two axes swap: rockets climb the canvas's vertical extent
    // (`height`) and spread across its horizontal extent (`width`) instead.
    // A matrix canvas with height <= 1 has no vertical extent to climb at
    // all (it's really a strip's worth of pixels laid out in one row), so
    // it keeps the original width-climbing behavior rather than trying to
    // climb a single pixel. `computeFireworkPoints` just takes "how many
    // launch positions" (physicsRows) and "how far to climb"
    // (physicsAscendLength) - it doesn't care which canvas axis either one
    // actually is, so only the plotting loop below needs to know the
    // difference.
    const isParallel = parameters.stripCount !== undefined;
    const climbsVertically = !isParallel && height > 1;
    const physicsRows = isParallel
      ? Math.max(1, Math.round(Number(parameters.stripCount)))
      : climbsVertically
        ? Math.max(1, width)
        : Math.max(1, height);
    const physicsAscendLength = climbsVertically ? Math.max(1, height) : width;
    const onlyRow = isParallel
      ? clamp(Math.round(Number(parameters.mappingOrdinal ?? 0)), 0, physicsRows - 1)
      : null;

    // The fixed MIN/MAX_EXPLOSION_RADIUS_CM range was tuned for the original
    // strip-wall design target, where the "canvas" spans however many real
    // strips there are times their spacing (e.g. 8 strips at a 24.38 ratio
    // is a ~195cm-tall virtual canvas) - comfortably larger than a 60-140cm
    // burst. A real matrix's physical extent is usually much smaller (e.g.
    // a 64-LED-tall panel at ~1cm pitch is only 64cm), so that same fixed
    // range can produce explosions bigger than the display. On a genuine
    // matrix, cap the max radius at 15% of its physical vertical extent (a
    // 30% diameter) instead, scaling the min radius down by the same ratio
    // as the original range so explosions keep some size variety rather
    // than all landing exactly on the cap.
    const maxExplosionRadiusCm = climbsVertically
      ? physicsAscendLength * ledSpacingCm * 0.15
      : MAX_EXPLOSION_RADIUS_CM;
    const minExplosionRadiusCm = climbsVertically
      ? maxExplosionRadiusCm * (MIN_EXPLOSION_RADIUS_CM / MAX_EXPLOSION_RADIUS_CM)
      : MIN_EXPLOSION_RADIUS_CM;

    const points = memoizedFireworkPoints(
      [physicsRows, physicsAscendLength, randomSeed, launchIntervalSeconds, stripSpacingCm, ledSpacingCm, minExplosionRadiusCm, maxExplosionRadiusCm, elapsedSeconds, audio?.available, audio?.lastBeatAt].join(":"),
      () =>
        computeFireworkPoints({
          rows: physicsRows,
          width: physicsAscendLength,
          palette,
          launchIntervalSeconds,
          stripSpacingCm,
          ledSpacingCm,
          minExplosionRadiusCm,
          maxExplosionRadiusCm,
          randomSeed,
          elapsedSeconds,
          startedAtMs,
          audio,
        }),
    );

    for (const point of points) {
      if (onlyRow !== null && point.row !== onlyRow) continue;
      if (climbsVertically) {
        // point.row is the spread position (0..width-1); point.col is the
        // ascend position (0..height-1, 0 = launch/ground, increasing =
        // climbing) - `reversed` mirrors the spread axis, same as the
        // non-climbing case's own launch-side flip, and `upIsPositiveY`
        // picks which canvas y direction "climbing" actually moves toward.
        const x = reversed ? width - 1 - point.row : point.row;
        const y = matrixAscendToY(point.col, physicsAscendLength, upIsPositiveY);
        plotBlended1DColumn(pixels, width, height, x, y, point.color);
      } else {
        const pixelRow = isParallel ? 0 : point.row;
        const displayCol = reversed ? width - 1 - point.col : point.col;
        plotBlended1DRow(pixels, width, pixelRow, displayCol, point.color);
      }
    }
    return pixels;
  },
  "fireworks-legacy": ({ width, height, parameters, timestamp }) => {
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    const maxSpeed = densityScaledMagnitude(
      Number(parameters.maxSpeed ?? 175),
      parameters.ledsPerMeter,
    );
    const particleSize = densityScaledSize(
      Math.max(1, Math.round(Number(parameters.particleSize ?? 1))),
      parameters.ledsPerMeter,
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
  "weather-forecast": renderWeatherForecast,
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
    const ballSize = densityScaledSize(
      Math.max(1, Math.round(Number(parameters.ballSize ?? 5))),
      parameters.ledsPerMeter,
    );
    const mirrored = Boolean(parameters.mirrored);
    // Only matters when `mirrored` is off (a single source): picks which end
    // of the strip the ball bounces from (non-matrix), or which side of the
    // width each ball's own lane starts from (matrix). Irrelevant when
    // mirrored, since both ends/lanes are drawn either way.
    const reversed = Boolean(parameters.reversed);
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);

    // Gravity has one objectively correct direction, so on a genuine matrix
    // (a single, non-parallel mapping taller than one row - same isMatrix
    // test as `fire`/`classic-fire`/rocket-fireworks) balls fall and bounce
    // vertically instead of sideways along the width, each in its own lane
    // (column) spread evenly across the width, using the same
    // matrixAscendToY() every other climbing/falling effect uses to pick
    // which screen direction is actually "up". Previously this only ever
    // wrote into row 0 of the pixel buffer regardless of height - harmless
    // for a real 1-row strip, but it meant nothing drew at all on any other
    // row of an actual matrix canvas.
    const isParallel = parameters.stripCount !== undefined;
    const isMatrix = !isParallel && height > 1;
    const upIsPositiveY = Boolean(parameters.upIsPositiveY);
    const bounceAxisSize = isMatrix ? height : width;
    const laneFor = (ball) => {
      if (ballCount <= 1) return Math.floor(width / 2);
      const lane = Math.round((ball / (ballCount - 1)) * (width - 1));
      return reversed ? width - 1 - lane : lane;
    };
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
      const position = (heightValue * (bounceAxisSize - 1)) / START_HEIGHT;

      if (isMatrix) {
        const lane = laneFor(ball);
        for (let x = 0; x < ballSize; x += 1) {
          const y = matrixAscendToY(position + x, bounceAxisSize, upIsPositiveY);
          plotBlended1DColumn(pixels, width, height, lane, y, color);
          if (mirrored) {
            plotBlended1DColumn(pixels, width, height, width - 1 - lane, y, color);
          }
        }
      } else {
        for (let x = 0; x < ballSize; x += 1) {
          const primaryPosition = reversed
            ? width - 1 - (position + x)
            : position + x;
          plotBlended1DAllRows(pixels, width, height, primaryPosition, color);
          if (mirrored) {
            plotBlended1DAllRows(pixels, width, height, width - 1 - primaryPosition, color);
          }
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
    const color = kelvinToRgb(kelvin);
    return Array.from({ length: width * height }, () => color);
  },
  fire: ({ width: canvasWidth, height: canvasHeight, parameters, timestamp }) => {
    // Ported from NightDriverStrip's FireEffect::DrawFire() (fireeffect.h):
    // per-cell cooling, then heat diffused in from higher-index neighbors
    // (BlendNeighbor1=1, BlendNeighbor2=2, over BlendTotal=3), then random
    // sparks near the high-index end. There's no closed-form solution for a
    // random cellular automaton, so we simulate a bounded recent window of
    // steps (deterministic per elapsed-time bucket) instead of the whole
    // effect history, which keeps render cost constant no matter how long
    // the effect has been running.
    //
    // Extended 2026-09-06 for a canvas of parallel vertical strips (one row
    // per strip, single source at index 0/near the controller, no mirrored
    // second source): a height envelope keeps the flame from constantly
    // reaching the far end (which otherwise reads as a second, permanently-lit
    // source on a long strip at low cooling), and a lateral blend pass
    // correlates neighboring rows so multiple strips read as one connected
    // fire instead of independent, uncorrelated flames.
    //
    // Extended again for a genuine matrix (a single, non-parallel mapping
    // taller than one row - the same test rocket-fireworks uses for
    // climbsVertically): the flame axis runs vertically instead of across
    // the width, so it rises like a real fire instead of running sideways.
    // "Lanes" (previously "rows") become the matrix's columns, each its own
    // correlated flame; upIsPositiveY (from the canvas/mapping orientation,
    // same convention rocket-fireworks launches against) picks which screen
    // direction is actually up.
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
    const heatRamp = FIRE_HEAT_RAMPS[parameters.palette] ?? FIRE_HEAT_RAMPS.red;

    const isParallel = parameters.stripCount !== undefined;
    const isMatrix = !isParallel && canvasHeight > 1;
    const upIsPositiveY = Boolean(parameters.upIsPositiveY);

    // The flame axis is whichever canvas dimension the fire actually climbs
    // along - height on a matrix, width otherwise (a strip, or the parallel
    // per-row canvases this was originally built for). Lanes are the other
    // dimension: independent-but-correlated flames running side by side.
    const flameAxisCanvasSize = isMatrix ? canvasHeight : canvasWidth;
    const laneAxisSize = isMatrix ? canvasWidth : canvasHeight;

    // Simulate at a larger virtual size on a too-short or too-sparse flame axis (see
    // flameAxisSimSizeFor above), downsampling back down at the end.
    const flameAxisSimSize = flameAxisSimSizeFor(flameAxisCanvasSize, parameters.ledsPerMeter);
    const ledCount = mirrored
      ? Math.max(1, Math.floor(flameAxisSimSize / 2))
      : flameAxisSimSize;
    const randomSeed = Number(parameters.randomSeed ?? 0);
    const seedSalt = 11 + randomSeed;

    const minHeightFraction = clamp(
      Number(parameters.minHeightFraction ?? 0.2),
      0,
      1,
    );
    const maxHeightFraction = clamp(
      Number(parameters.maxHeightFraction ?? 1),
      0,
      1,
    );
    const averageHeightFraction = clamp(
      Number(parameters.averageHeightFraction ?? 0.7),
      minHeightFraction,
      maxHeightFraction,
    );
    const heightWaveSeconds = Math.max(
      1,
      Number(parameters.heightWaveSeconds ?? 25),
    );
    // Only matters once multiple lanes (parallel strips, or matrix columns)
    // share this canvas.
    const neighborBlend = clamp(Number(parameters.neighborBlend ?? 0.2), 0, 1);
    const falloffWidth = Math.max(3, Math.round(ledCount * 0.05));

    const lanes = Math.max(1, laneAxisSize);
    const grid = simulateFireGrid({
      rows: lanes,
      cellCount: ledCount,
      elapsedSeconds,
      seedSalt,
      neighborBlend,
      falloffWidth,
      // Lanes get distinct per-lane randomness for cooling, diffusion and
      // sparking, and for the height envelope's own two minor texture waves
      // (see fireHeightFraction) - only its dominant, slowest wave stays
      // keyed off the shared seedSalt so every lane breathes together on the
      // big cycle.
      rowStep: (h, rng) => {
        for (let i = 0; i < ledCount; i += 1) {
          const coolAmount = Math.floor(rng() * cooling);
          h[i] = Math.max(0, h[i] - coolAmount);
        }
        for (let i = 0; i < ledCount; i += 1) {
          const a = h[(i + 1) % ledCount];
          const b = h[(i + 2) % ledCount];
          h[i] = Math.min(255, Math.floor((a + b * 2) / 3));
        }
        for (let spark = 0; spark < sparks; spark += 1) {
          if (rng() * 255 < sparking) {
            const y = ledCount - 1 - Math.floor(rng() * sparkHeight);
            if (y >= 0) h[y] = Math.min(255, Math.floor(rng() * 56) + 200);
          }
        }
      },
      ceilingFractionForRow: (lane, stepSeconds) =>
        fireHeightFraction(stepSeconds, seedSalt, seedSalt + lane * 97, {
          min: minHeightFraction,
          averageFraction: averageHeightFraction,
          max: maxHeightFraction,
          waveSeconds: heightWaveSeconds,
        }),
    });

    // Position along the flame axis's simulated (possibly supersampled)
    // buffer, after `reversed` has been applied. axisPos runs from the
    // flame's cool tip (0) to its hot, spark-fed base (flameAxisSimSize-1),
    // so its "ascend progress" (0 = the base) is the axis run in reverse.
    // Unreversed (the default), that base is LED 0 on a strip - the end
    // nearest the controller - and the physical bottom on a matrix
    // (matrixAscendToY). A parallel mapping's own `reversed` can't stand in
    // for this: it flips the strip's place on the canvas and its LED order
    // together, which cancel out on the strip itself.
    const flameAxisIndex = (pos) => {
      const ascendPos = flameAxisSimSize - 1 - pos;
      return isMatrix
        ? matrixAscendToY(ascendPos, flameAxisSimSize, upIsPositiveY)
        : ascendPos;
    };

    const simWidth = isMatrix ? laneAxisSize : flameAxisSimSize;
    const simHeight = isMatrix ? flameAxisSimSize : laneAxisSize;
    const pixels = Array.from({ length: simWidth * simHeight }, () => [0, 0, 0]);
    const plot = (axisPos, lane, color) => {
      const pos = flameAxisIndex(axisPos);
      if (isMatrix) pixels[pos * simWidth + lane] = color;
      else pixels[lane * simWidth + pos] = color;
    };

    for (let lane = 0; lane < lanes; lane += 1) {
      const heat = grid[lane];
      for (let i = 0; i < ledCount; i += 1) {
        const color = heatToFireColor(heat[i], heatRamp);
        const j = reversed ? ledCount - 1 - i : i;
        plot(j, lane, color);
        if (mirrored) {
          const mirrorIndex = !reversed ? 2 * ledCount - 1 - i : ledCount + i;
          plot(mirrorIndex, lane, color);
        }
      }
    }
    if (isMatrix) {
      return flameAxisSimSize === canvasHeight
        ? pixels
        : downsampleColumnHeight(pixels, canvasWidth, flameAxisSimSize, canvasHeight);
    }
    return flameAxisSimSize === canvasWidth
      ? pixels
      : downsampleRowWidth(pixels, flameAxisSimSize, canvasWidth, canvasHeight);
  },
  "classic-fire": ({ width: canvasWidth, height: canvasHeight, parameters, timestamp }) => {
    // Ported from NightDriverStrip's ClassicFireEffect::Fire() (fireeffect.h):
    // the classic Fire2012-style automaton, diffusing from *lower*-index
    // neighbors (opposite direction from FireEffect) with sparks igniting
    // near the low-index end, plus its own hard-banded heat-to-color ramp.
    //
    // On a genuine matrix (a single, non-parallel mapping taller than one
    // row - same isMatrix test as `fire` and rocket-fireworks'
    // climbsVertically), the flame axis runs vertically instead of across
    // the width, so it rises like a real fire instead of running sideways.
    const cooling = Math.max(0, Math.round(Number(parameters.cooling ?? 5)));
    const reversed = Boolean(parameters.reversed);
    const mirrored = Boolean(parameters.mirrored);
    const elapsedSeconds = Number(parameters.timeSeconds ?? timestamp / 1000);
    const heatRamp = FIRE_HEAT_RAMPS[parameters.palette] ?? FIRE_HEAT_RAMPS.red;

    const isParallel = parameters.stripCount !== undefined;
    const isMatrix = !isParallel && canvasHeight > 1;
    const upIsPositiveY = Boolean(parameters.upIsPositiveY);

    // The flame axis is whichever canvas dimension the fire actually climbs
    // along - height on a matrix, width otherwise. Simulate at a larger
    // virtual size on a too-short flame axis (see FIRE_SUPERSAMPLE_MIN_WIDTH
    // above - same trick `fire` uses), downsampling back down at the end:
    // this automaton is tuned for the same 100+-cell strip scale and reads
    // as a lit sliver rather than a graded flame on a matrix no wider than a
    // typical panel's height (64 or less).
    const flameAxisCanvasSize = isMatrix ? canvasHeight : canvasWidth;
    const laneAxisSize = isMatrix ? canvasWidth : canvasHeight;
    const flameAxisSimSize = flameAxisSimSizeFor(flameAxisCanvasSize, parameters.ledsPerMeter);
    const ledCount = flameAxisSimSize;
    const SPARKING = 180;
    const SPARKS = 5;

    const heat = simulateFireHeat({
      cellCount: ledCount,
      elapsedSeconds,
      seedSalt: 23 + Number(parameters.randomSeed ?? 0),
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

    const simWidth = isMatrix ? laneAxisSize : flameAxisSimSize;
    const simHeight = isMatrix ? flameAxisSimSize : laneAxisSize;
    const pixels = Array.from({ length: simWidth * simHeight }, () => [0, 0, 0]);
    // The spark end is the *low* index here (opposite of `fire`), which
    // physically belongs at the ground on a matrix - so axisPos is already
    // matrixAscendToY's own "ascend progress" convention (0 = ground),
    // unlike `fire`, which has to invert it first.
    const plot = (axisPos, color) => {
      if (isMatrix) {
        setPixelAllColumns(
          pixels,
          simWidth,
          simHeight,
          matrixAscendToY(axisPos, flameAxisSimSize, upIsPositiveY),
          color,
        );
      } else {
        setPixelAllRows(pixels, simWidth, simHeight, axisPos, color);
      }
    };

    for (let i = 0; i < ledCount; i += 1) {
      const color = heatToFireColor(heat[i]);
      if (mirrored) {
        const middle = Math.floor(ledCount / 2);
        plot(middle - i, color);
        plot(middle + i, color);
      } else {
        const j = reversed ? ledCount - 1 - i : i;
        plot(j, color);
      }
    }
    if (isMatrix) {
      return flameAxisSimSize === canvasHeight
        ? pixels
        : downsampleColumnHeight(pixels, canvasWidth, flameAxisSimSize, canvasHeight);
    }
    return flameAxisSimSize === canvasWidth
      ? pixels
      : downsampleRowWidth(pixels, flameAxisSimSize, canvasWidth, canvasHeight);
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
    const meteorSize = densityScaledSize(
      Math.max(1, Math.round(Number(parameters.meteorSize ?? 4))),
      parameters.ledsPerMeter,
    );
    const decay = clamp(Number(parameters.decay ?? 3), 1, 255);
    const minSpeed = densityScaledMagnitude(
      Math.max(0.01, Number(parameters.minSpeed ?? 0.2)),
      parameters.ledsPerMeter,
    );
    const maxSpeed = Math.max(
      minSpeed,
      densityScaledMagnitude(
        Number(parameters.maxSpeed ?? 0.2),
        parameters.ledsPerMeter,
      ),
    );
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    const elapsedSeconds = Number(parameters.timeSeconds ?? timestamp / 1000);
    const minPos = meteorSize - 1;
    const maxPos = width - 1;
    const range = Math.max(0.001, maxPos - minPos);
    const period = 2 * range;
    const trailLength = Math.max(
      meteorSize,
      densityScaledSize(Math.round((255 / decay) * 2), parameters.ledsPerMeter),
    );
    const isRedPair = meteorCount === 2;

    const positionAt = (m, t, speed, phase0, direction) => {
      const u = phase0 + direction * speed * t;
      const wrapped = ((u % period) + period) % period;
      const reflected = wrapped <= range ? wrapped : period - wrapped;
      return minPos + reflected;
    };

    for (let m = 0; m < meteorCount; m += 1) {
      const rng = mulberry32(m * 733 + 1 + Number(parameters.randomSeed ?? 0));
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
    const everyNth = densityScaledSize(
      Math.max(1, Number(parameters.everyNth ?? 12)),
      parameters.ledsPerMeter,
    );
    const speedDivisor = Math.max(1, Number(parameters.speedDivisor ?? 8));
    const seconds = timestamp / 1000;
    const hueBase = (seconds * (255 / speedDivisor)) % 256;
    const huePerCell = densityScaledPerCell(4, parameters.ledsPerMeter);
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    for (let index = 0; index < width * height; index += 1) {
      if (index % everyNth !== 0) continue;
      pixels[index] = hsvToRgb(hueBase + index * huePerCell, 255, 255);
    }
    return pixels;
  },
  "rainbow-twinkle": ({ width, height, parameters, timestamp }) => {
    const speedDivisor = Math.max(1, Number(parameters.speedDivisor ?? 12));
    const deltaHue = densityScaledPerCell(
      Number(parameters.deltaHue ?? 14),
      parameters.ledsPerMeter,
    );
    const seconds = timestamp / 1000;
    const hueBase = (seconds * (255 / speedDivisor)) % 256;
    const totalPixels = width * height;
    const pixels = Array.from({ length: totalPixels }, (_, index) =>
      hsvToRgb(hueBase + index * deltaHue, 255, 255),
    );
    const twinkleCount = Math.max(1, Math.round(totalPixels * 0.03));
    const tick = Math.floor(seconds * 4);
    for (let i = 0; i < twinkleCount; i += 1) {
      const rng = mulberry32(
        i * 97531 + tick * 8191 + 3 + Number(parameters.randomSeed ?? 0),
      );
      pixels[Math.floor(rng() * totalPixels)] = [255, 255, 255];
    }
    return pixels;
  },
  rainbowfill: ({ width, height, parameters, timestamp }) => {
    const speedDivisor = Math.max(1, Number(parameters.speedDivisor ?? 12));
    const deltaHue = densityScaledPerCell(
      Number(parameters.deltaHue ?? 14),
      parameters.ledsPerMeter,
    );
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
    const everyNth = densityScaledSize(
      Math.max(1, Number(parameters.everyNth ?? 10)),
      parameters.ledsPerMeter,
    );
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
      const rng = mulberry32(
        (tick - i) * 7919 + i * 104729 + 17 + Number(parameters.randomSeed ?? 0),
      );
      const index = Math.floor(rng() * totalPixels);
      const color = TWINKLE_COLORS[Math.floor(rng() * TWINKLE_COLORS.length)];
      const brightness = clamp(1 - i / countToDraw, 0, 1);
      blendChannel(pixels, index, color, brightness);
    }
    return pixels;
  },
  cylon: ({ width, height, parameters, timestamp }) => {
    // Time to cross the strip once (end to end), not a raw speed multiplier -
    // independent of strip length, so the same setting means the same real
    // transit time on any strip instead of a "speed" whose actual crossing
    // time used to vary with width.
    const transitSeconds = clamp(Number(parameters.transitSeconds ?? 3), 1, 30);
    const eyeCount = clamp(Math.round(Number(parameters.eyeCount ?? 2)), 1, 6);
    const eyeSize = clamp(
      densityScaledSize(
        Math.round(Number(parameters.eyeSize ?? 1)),
        parameters.ledsPerMeter,
      ),
      1,
      10,
    );
    const colors = normalizePalette(parameters.eyeColors);
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    const span = Math.max(1, width - 1);
    const period = span * 2;
    const seconds = timestamp / 1000;
    const pixelsPerSecond = span / transitSeconds;
    const baseCycle = (seconds * pixelsPerSecond) % period;
    // Each eye rides the same back-and-forth sweep, evenly staggered around
    // the cycle - eyeCount:2 exactly reproduces the original two-eye Silon
    // scanner (a phase shift of half the period turns one eye's sweep into
    // the mirror image of the other's).
    for (let eye = 0; eye < eyeCount; eye += 1) {
      const cycle = (baseCycle + (eye * period) / eyeCount) % period;
      const offset = cycle < period / 2 ? cycle : period - cycle;
      const pos = clamp(Math.round(offset), 0, width - 1);
      const color = colors[eye % colors.length];
      // Centered on `pos`; sizes over 2 fade their two end pixels to 50% so
      // the eye reads as one smooth-edged blob in motion rather than a hard
      // block that "pops" a full pixel wider/narrower as it moves.
      const startPos = pos - Math.floor((eyeSize - 1) / 2);
      for (let k = 0; k < eyeSize; k += 1) {
        const idx = clamp(startPos + k, 0, width - 1);
        const isEdge = eyeSize > 2 && (k === 0 || k === eyeSize - 1);
        const weight = isEdge ? 0.5 : 1;
        for (let y = 0; y < height; y += 1) {
          blendChannel(pixels, y * width + idx, color, weight);
        }
      }
    }
    return pixels;
  },
  snake: ({ width, height, parameters, timestamp }) => {
    const snakeSize = densityScaledSize(
      Math.max(1, Number(parameters.snakeSize ?? 3)),
      parameters.ledsPerMeter,
    );
    const speed = densityScaledMagnitude(
      Math.max(0.5, Number(parameters.speed ?? 4)),
      parameters.ledsPerMeter,
    );
    const totalPixels = width * height;
    const pixels = Array.from({ length: totalPixels }, () => [0, 0, 0]);
    const seconds = timestamp / 1000;
    const head = Math.floor(seconds * speed) % totalPixels;
    for (let i = 0; i < snakeSize; i += 1) {
      pixels[(head - i + totalPixels) % totalPixels] = [0, 200, 40];
    }
    const foodRng = mulberry32(
      Math.floor((seconds * speed) / totalPixels) + 5 + Number(parameters.randomSeed ?? 0),
    );
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
      const rng = mulberry32(
        slot * 2654435761 + 29 + Number(parameters.randomSeed ?? 0),
      );
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
      const rng = mulberry32(i * 97 + 13 + Number(parameters.randomSeed ?? 0));
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
    // A star's drift is computed as one scalar position moved by velocity*age
    // and plotted through a flat buffer index. That's a fine "wrap around
    // the strip" motion for a genuine 1D strip, but on a real 2D matrix
    // (height > 1) a flat index crossing a row boundary teleports from the
    // right edge of one row to the left edge of the next - looked like the
    // star took a U-turn. On a matrix, constrain each star's own drift to
    // one axis (chosen per star below) so it only ever moves along a single
    // row or column and clamps at that axis's own edge instead.
    const isMatrix = height > 1;
    const probability = Math.max(0.01, Number(parameters.probability ?? 1));
    const starSize = densityScaledSize(
      Math.max(1, Math.round(Number(parameters.starSize ?? 1))),
      parameters.ledsPerMeter,
    );
    const maxSpeed = densityScaledMagnitude(
      Number(parameters.maxSpeed ?? 2),
      parameters.ledsPerMeter,
    );
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
      const rng = mulberry32(
        slot * 2654435761 + 17 + Number(parameters.randomSeed ?? 0),
      );
      const birthTime = (slot + rng()) * avgInterval;
      const age = elapsedSeconds - birthTime;
      const startIndex = rng() * totalPixels;
      const startX = Math.floor(rng() * width);
      const startY = Math.floor(rng() * height);
      const horizontal = rng() < 0.5;
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
      const shade = starColor.map((channel) =>
        Math.round(channel * brightness),
      );

      if (isMatrix) {
        const axisPosition =
          (horizontal ? startX : startY) + velocity * age;
        for (let s = 0; s < starSize; s += 1) {
          if (horizontal) {
            plotBlended1DRow(pixels, width, startY, axisPosition + s, shade);
          } else {
            plotBlended1DColumn(
              pixels,
              width,
              height,
              startX,
              axisPosition + s,
              shade,
            );
          }
        }
      } else {
        const position = startIndex + velocity * age;
        for (let s = 0; s < starSize; s += 1) {
          plotBlended1D(pixels, totalPixels, position + s, shade);
        }
      }
    }
    return pixels;
  },
  "palette-effect": ({ width, height, parameters, timestamp }) => {
    const palette = normalizePalette(parameters.palette);
    const density = Math.max(0.1, Number(parameters.density ?? 1));
    const speed = Number(parameters.speed ?? 1);
    const ledsPerSecond = densityScaledMagnitude(
      Number(parameters.ledsPerSecond ?? 0),
      parameters.ledsPerMeter,
    );
    const lightSize = densityScaledSize(
      Math.max(1, Number(parameters.lightSize ?? 1)),
      parameters.ledsPerMeter,
    );
    const gapSize = densityScaledSize(
      Math.max(0, Number(parameters.gapSize ?? 1)),
      parameters.ledsPerMeter,
      { min: 0 },
    );
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
  // Ported from NightDriverStrip's VUMeterEffect/VUMeterVerticalEffect
  // (spectrumeffects.h): a symmetric bar driven by the live VURatioFade
  // telemetry, with a brief flash on the outer tip when a beat lands.
  "vu-meter": ({ width, height, parameters, timestamp }) => {
    const audio = parameters.audio;
    const origin = parameters.origin ?? "center";
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    // vuRatioFade is the firmware's own self-normalized ratio against a
    // running min/max loudness envelope (range 0-2, where 1.0 means "at the
    // middle of the recently observed range") - not a linear amplitude
    // against a fixed full scale, so it must not be run through
    // amplitudeToDbFraction (built for FFT magnitude vs. a fixed reference
    // level). Doing that was double-normalizing an already-normalized value,
    // which flattened most of its dynamic range before it ever reached the
    // display - the fix is to use it directly once scaled to 0..1.
    const level = clamp(Number(audio?.vuRatioFade ?? 0) / 2, 0, 1);
    const lastBeatAt = audio?.lastBeatAt;
    const msSinceBeat = Number.isFinite(lastBeatAt) ? timestamp - lastBeatAt : Infinity;
    const beatFading = msSinceBeat >= 0 && msSinceBeat < 120;
    const flashColor = beatFading
      ? [255, 255, 255].map((channel) => Math.round(channel * (1 - msSinceBeat / 120)))
      : null;

    // NightDriverStrip has this as two separate classes - VUMeterEffect
    // (horizontal) and VUMeterVerticalEffect - unified here behind one
    // renderer: on a genuine matrix (a single, non-parallel mapping taller
    // than one row - same isMatrix test as `fire`/rocket-fireworks/bouncing
    // balls), the bar grows vertically instead of across the width, the same
    // shape drawn into every column via setPixelAllColumns (setPixelAllRows'
    // transpose). "left" becomes the ground (bar grows up, the usual VU
    // meter shape) and "right" becomes the ceiling (bar hangs down) via
    // matrixAscendToY, same as every other climbing/falling effect picks
    // "up"; "center" needs no such flip, since growing symmetrically out
    // from the middle looks the same regardless of which physical direction
    // is up.
    const isParallel = parameters.stripCount !== undefined;
    const isMatrix = !isParallel && height > 1;
    const upIsPositiveY = Boolean(parameters.upIsPositiveY);
    const barAxisSize = isMatrix ? height : width;
    const plotAt = (pos, color) => {
      if (isMatrix) setPixelAllColumns(pixels, width, height, pos, color);
      else setPixelAllRows(pixels, width, height, pos, color);
    };

    if (origin === "center") {
      const half = Math.max(1, Math.floor(barAxisSize / 2));
      const center = Math.floor(barAxisSize / 2);
      const litCount = Math.round(level * half);
      for (let i = 0; i < litCount; i += 1) {
        const heat = Math.round((i / Math.max(1, half - 1)) * 255);
        const color = heatToFireColor(heat);
        plotAt(center + i, color);
        plotAt(center - 1 - i, color);
      }
      if (litCount > 0 && flashColor) {
        plotAt(center + litCount - 1, flashColor);
        plotAt(center - litCount, flashColor);
      }
    } else {
      const litCount = Math.round(level * barAxisSize);
      const groundOrigin = origin === "left";
      for (let i = 0; i < litCount; i += 1) {
        const heat = Math.round((i / Math.max(1, barAxisSize - 1)) * 255);
        const color = heatToFireColor(heat);
        const ascendPos = groundOrigin ? i : barAxisSize - 1 - i;
        const pos = isMatrix ? matrixAscendToY(ascendPos, barAxisSize, upIsPositiveY) : ascendPos;
        plotAt(pos, color);
      }
      if (litCount > 0 && flashColor) {
        const tipAscendPos = groundOrigin ? litCount - 1 : barAxisSize - litCount;
        const tip = isMatrix ? matrixAscendToY(tipAscendPos, barAxisSize, upIsPositiveY) : tipAscendPos;
        plotAt(tip, flashColor);
      }
    }
    return pixels;
  },
  // Ported from NightDriverStrip's SpectrumAnalyzerEffect/SpectrumBarEffect
  // (spectrumeffects.h), then reworked 2026-09-08 for pixel-resolution display
  // and to auto-adapt to whatever canvas shape it's given, rather than a
  // fixed bandCount of same-height blocks:
  //  - The frequency axis is continuously interpolated across every column
  //    (interpolateSeries below) from the 16 native Mel-spaced bands, instead
  //    of dividing the strip into bandCount discrete same-height segments -
  //    "coarse blocky bars" become a smooth per-pixel curve, and there's no
  //    longer a bandCount to manually tune to the canvas width.
  //  - On a real matrix (height > 1), that per-column level still drives a
  //    vertical bar height and red peak-hold cap, same as before.
  //  - On a single-row strip (height === 1) a "bar height" of exactly 0 or 1
  //    LED is all that's geometrically possible there, which read as "no
  //    dynamic range/low gain" - there's no missing row to grow into, so
  //    instead the level itself drives brightness/color intensity along the
  //    strip's length (heatToFireColor(level*255) per pixel), the same way
  //    VU Meter and Spectrum Band already express level as color/extent
  //    rather than vertical height on a 1-row strip.
  "spectrum-bars": ({ width, height, parameters }) => {
    const audio = parameters.audio;
    const peaks = audio?.peaks ?? [];
    const peaksDecayed = audio?.peaksDecayed ?? [];
    const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
    const levelAt = (x) =>
      amplitudeToDbFraction(clamp(interpolateSeries(peaks, x, width), 0, 1));

    if (height === 1) {
      for (let x = 0; x < width; x += 1) {
        pixels[x] = heatToFireColor(Math.round(levelAt(x) * 255));
      }
      return pixels;
    }

    // row is "how far up the bar has grown" (0 = baseline). Was assuming
    // canvas row 0 is always physically the top (height-1-row) regardless of
    // wiring - correct for HUB75, wrong for a bottom-origin serpentine
    // matrix. matrixAscendToY() picks the right canvas row per upIsPositiveY
    // the same way rocket-fireworks/fire/classic-fire already do.
    const upIsPositiveY = Boolean(parameters.upIsPositiveY);
    const peakAt = (x) =>
      amplitudeToDbFraction(clamp(interpolateSeries(peaksDecayed, x, width), 0, 1));
    for (let x = 0; x < width; x += 1) {
      const barHeight = Math.round(levelAt(x) * height);
      const peakRow = Math.round(peakAt(x) * height) - 1;
      for (let row = 0; row < barHeight; row += 1) {
        const heat = Math.round((row / Math.max(1, height - 1)) * 255);
        pixels[matrixAscendToY(row, height, upIsPositiveY) * width + x] = heatToFireColor(heat);
      }
      for (const row of peakMarkerPositions(peakRow, height)) {
        if (row >= barHeight && row < height) {
          pixels[matrixAscendToY(row, height, upIsPositiveY) * width + x] = PEAK_MARKER_COLOR;
        }
      }
    }
    return pixels;
  },
  // Ported from NightDriverStrip's MusicalPaletteFire (fireeffect.h): the same
  // fire automaton as `fire`, but a beat landing within the last 200ms injects
  // extra sparks (scaled by live VU) on top of the normal spark rate. Each
  // simulated step derives its beat-boost from its own reconstructed
  // wall-clock instant (`startedAtMs + stepIndex * stepMs` vs `audio.lastBeatAt`)
  // rather than any external mutable flag, so simulateFireHeat's
  // determinism-from-elapsed-time property still holds on replay.
  "musical-fire": ({ width, height, parameters, timestamp }) => {
    const cooling = Math.max(0, Math.round(Number(parameters.cooling ?? 3)));
    const sparking = clamp(Number(parameters.sparking ?? 100), 0, 255);
    const sparks = Math.max(0, Math.round(Number(parameters.sparks ?? 3)));
    const sparkHeight = Math.max(
      1,
      Math.round(Number(parameters.sparkHeight ?? 4)),
    );
    const beatSparkBoost = Math.max(
      0,
      Math.round(Number(parameters.beatSparkBoost ?? 60)),
    );
    const reversed = Boolean(parameters.reversed);
    const mirrored = Boolean(parameters.mirrored);
    const elapsedSeconds = Number(parameters.timeSeconds ?? 0);
    const startedAtMs = timestamp - elapsedSeconds * 1000;
    // Same too-short/too-sparse simulation-buffer correction `fire` uses (see
    // flameAxisSimSizeFor) - this is the same cellular automaton, just 1D
    // (no lanes/matrix concept), so it's tuned against the same reference
    // strip and needs the same fix.
    const flameAxisSimSize = flameAxisSimSizeFor(width, parameters.ledsPerMeter);
    const ledCount = mirrored
      ? Math.max(1, Math.floor(flameAxisSimSize / 2))
      : flameAxisSimSize;
    const audio = parameters.audio;
    const lastBeatAt = audio?.lastBeatAt;
    const vu = clamp(Number(audio?.vu ?? 0), 0, 1);

    const heat = simulateFireHeat({
      cellCount: ledCount,
      elapsedSeconds,
      seedSalt: 31 + Number(parameters.randomSeed ?? 0),
      step: (h, rng, stepIndex, stepMs) => {
        for (let i = 0; i < ledCount; i += 1) {
          const coolAmount = Math.floor(rng() * cooling);
          h[i] = Math.max(0, h[i] - coolAmount);
        }
        for (let i = 0; i < ledCount; i += 1) {
          const a = h[(i + 1) % ledCount];
          const b = h[(i + 2) % ledCount];
          h[i] = Math.min(255, Math.floor((a + b * 2) / 3));
        }
        const stepWallTime = startedAtMs + stepIndex * stepMs;
        const msSinceBeat = Number.isFinite(lastBeatAt)
          ? stepWallTime - lastBeatAt
          : Infinity;
        const beatBoost =
          msSinceBeat >= 0 && msSinceBeat < 200 ? beatSparkBoost * (1 + vu) : 0;
        for (let s = 0; s < sparks; s += 1) {
          if (rng() * 255 < sparking + beatBoost) {
            const y = ledCount - 1 - Math.floor(rng() * sparkHeight);
            if (y >= 0) h[y] = Math.min(255, Math.floor(rng() * 56) + 200);
          }
        }
      },
    });

    const simPixels = Array.from(
      { length: flameAxisSimSize * height },
      () => [0, 0, 0],
    );
    for (let i = 0; i < ledCount; i += 1) {
      const color = heatToFireColor(heat[i]);
      const j = reversed ? ledCount - 1 - i : i;
      setPixelAllRows(simPixels, flameAxisSimSize, height, j, color);
      if (mirrored) {
        const mirrorIndex = !reversed ? 2 * ledCount - 1 - i : ledCount + i;
        setPixelAllRows(simPixels, flameAxisSimSize, height, mirrorIndex, color);
      }
    }
    return flameAxisSimSize === width
      ? simPixels
      : downsampleRowWidth(simPixels, flameAxisSimSize, width, height);
  },
  // New effect: one group of frequency bands per parallel-mapped strip -
  // assign several `layout: 'parallel'` strips to this effect to build a
  // physical multi-band VU wall. The live level bar is the *average* of the
  // strip's band group (a steadier amplitude reading), while the peak-hold
  // marker (from CanvasAudioService's peaksDecayed) takes the *max* across
  // the same group, so a spike in any one band still registers.
  //
  // The level bar is the Fire effect, not a static color ramp - literally
  // the same simulateFireGrid() helper `fire` uses, just with each row's
  // ceiling driven by that row's own live audio level instead of a slow
  // breathing wave, so a bar's fire-lit *extent* is the VU reading. This
  // also means bars affect their neighbors via the exact same neighborBlend
  // pass `fire` uses - important since each of this effect's parallel-mapped
  // strips is otherwise rendered by an independent call (renderCanvasEffect
  // calls the renderer once per strip, with no visibility into any other
  // strip's data or output). To correlate bars anyway, every call
  // redundantly re-simulates *every* row from the full `stripCount`/
  // `mappingOrdinal` it's given (cheap - benchmarked well under render
  // budget even at 8 rows) and then keeps only its own row.
  //
  // Sparks stay anchored at the strip's physical end (width - 1), same as
  // `fire`, but diffusion here feeds from *lower*-index neighbors (with
  // wraparound) instead of higher ones, so heat flows index-upward: from the
  // spark at width-1, one wraparound hop lands it at index 0, and from there
  // it climbs through the visible window (0..litCount-1) toward the peak.
  // `fire` doesn't care which direction it flows since the whole strip is
  // always shown, but here it matters: the old higher-to-lower flow made the
  // flame visibly travel from the peak down toward the start, backwards from
  // a VU wall's usual "grows up from the base toward the peak" look. This
  // also sets `distanceFromBase` to count *up* from index 0 (the visible
  // base) rather than simulateFireGrid's default of counting down from the
  // far end - the ceiling here caps how far the flame climbs past the
  // current level, not how far it reaches back from the spark end.
  "spectrum-band": ({ width, height, parameters, timestamp }) => {
    const audio = parameters.audio;
    const peaks = audio?.peaks ?? [];
    const peaksDecayed = audio?.peaksDecayed ?? [];
    const bandStart = Math.max(0, Math.round(Number(parameters.bandStart ?? 0)));
    const bandEnd = Math.max(
      bandStart + 1,
      Math.round(Number(parameters.bandEnd ?? audio?.bandCount ?? bandStart + 1)),
    );
    const peak = amplitudeToDbFraction(clamp(maxOf(peaksDecayed.slice(bandStart, bandEnd)), 0, 1));

    const stripCount = Math.max(1, Math.round(Number(parameters.stripCount ?? 1)));
    const myRow = clamp(Math.round(Number(parameters.mappingOrdinal ?? 0)), 0, stripCount - 1);
    const bandTotal = Math.max(1, Math.round(Number(audio?.bandCount ?? stripCount)));
    // Matches renderCanvasEffect's own per-mapping band split exactly, so
    // every row's level here lines up with what that row's own real call
    // would compute for bandStart/bandEnd.
    const levelForRow = (row) => {
      const start = Math.floor((row / stripCount) * bandTotal);
      const end = Math.max(start + 1, Math.floor(((row + 1) / stripCount) * bandTotal));
      return amplitudeToDbFraction(clamp(average(peaks.slice(start, end)), 0, 1));
    };

    const elapsedSeconds = Number(parameters.timeSeconds ?? timestamp / 1000);
    const neighborBlend = clamp(Number(parameters.neighborBlend ?? 0.2), 0, 1);
    // Same simulation-buffer density correction `fire`/`musical-fire` use
    // (see flameAxisSimSizeFor) - this is the same automaton. On a
    // mixed-density canvas like Deck11 (60 vs 30 LEDs/meter strips), two
    // different strip types now key/compute genuinely separate grids below
    // instead of both keying off raw `width` (which the memo below already
    // has to key on regardless, since different-width strips could never
    // have shared one grid anyway - simulateFireGrid's rows all share one
    // cellCount). Density correction can only make same-density strips'
    // grids agree with each other more often, never less, so this doesn't
    // regress the "every call recomputes the shared grid" cost this effect
    // already accepts (see the comment above simulateFireGrid below).
    const flameAxisSimSize = flameAxisSimSizeFor(width, parameters.ledsPerMeter);
    const cooling = 3;
    const sparking = 100;
    const sparks = 3;
    const sparkHeight = 4;
    // No ceiling here (unlike `fire`'s breathing one): sparks are anchored
    // at width-1 so wraparound diffusion always reaches the visible base at
    // index 0 within one hop (see the direction note above) - a ceiling
    // measured from index 0 would suppress the spark's own origin before it
    // could ignite at all, since width-1 sits far on the wrong side of any
    // level below 100%. Instead the full, unbounded automaton runs (as
    // before this was ever unified with `fire`), correlated across rows via
    // neighborBlend, and the live level only decides how much of each row's
    // result is actually windowed into view below.
    // The grid depends on nothing but (stripCount, width, elapsedSeconds,
    // neighborBlend) - not on any per-mapping data - so every one of this
    // tick's `stripCount` independent per-mapping calls would otherwise
    // redundantly recompute the exact same grid just to keep its own row
    // (measured ~8x cost on a real 8-strip canvas). Memoize the single most
    // recent grid instead of caching per key indefinitely, since only ever
    // one (stripCount, width, elapsedSeconds, neighborBlend) combination is
    // in flight at a time within one render tick.
    const grid = memoizedFireGrid(
      `${stripCount}:${flameAxisSimSize}:${elapsedSeconds}:${neighborBlend}`,
      () =>
        simulateFireGrid({
          rows: stripCount,
          cellCount: flameAxisSimSize,
          elapsedSeconds,
          // A fixed salt, deliberately *not* the per-mapping
          // `parameters.randomSeed` renderCanvasEffect assigns each strip
          // (stableSeed(controllerId:stripIndex)) - every strip's
          // independent call must derive an identical grid to blend
          // correctly; varying the base seed per mapping would make each
          // call simulate a different random universe for the "same"
          // neighbor rows, breaking the correlation instead of producing it.
          seedSalt: 47,
          neighborBlend,
          rowStep: (h, rng) => {
            for (let i = 0; i < flameAxisSimSize; i += 1) {
              const coolAmount = Math.floor(rng() * cooling);
              h[i] = Math.max(0, h[i] - coolAmount);
            }
            // Iterate high-to-low (unlike `fire`'s low-to-high) since this
            // diffusion reads *lower*-index neighbors (i-1, i-2) - going
            // high-to-low means those neighbors haven't been overwritten yet
            // this step, same as `fire` reading not-yet-touched higher
            // neighbors in its low-to-high loop. Iterating low-to-high here
            // instead (forward loop, backward reads) would read *freshly
            // updated* neighbors at nearly every cell, cascading heat clear
            // across the row within a single 20ms step - saturating to
            // near-255 everywhere and rendering solid white instead of a
            // graded flame.
            for (let i = flameAxisSimSize - 1; i >= 0; i -= 1) {
              const a = h[(i - 1 + flameAxisSimSize) % flameAxisSimSize];
              const b = h[(i - 2 + flameAxisSimSize) % flameAxisSimSize];
              h[i] = Math.min(255, Math.floor((a + b * 2) / 3));
            }
            for (let s = 0; s < sparks; s += 1) {
              if (rng() * 255 < sparking) {
                const y = flameAxisSimSize - 1 - Math.floor(rng() * sparkHeight);
                if (y >= 0) h[y] = Math.min(255, Math.floor(rng() * 56) + 200);
              }
            }
          },
        }),
    );
    const heat = grid[myRow];
    const litCount = Math.round(levelForRow(myRow) * flameAxisSimSize);

    const simPixels = Array.from(
      { length: flameAxisSimSize * height },
      () => [0, 0, 0],
    );
    for (let i = 0; i < litCount; i += 1) {
      setPixelAllRows(simPixels, flameAxisSimSize, height, i, heatToFireColor(heat[i]));
    }
    const pixels =
      flameAxisSimSize === width
        ? simPixels
        : downsampleRowWidth(simPixels, flameAxisSimSize, width, height);

    // Plotted onto the real (post-downsample) width, not the sim buffer -
    // it's a sharp 1-2px indicator, not a graded fire, so box-downsampling
    // it alongside the level bar would dilute it toward black instead of
    // leaving it a solid marker (most of a downsample bucket's source cells
    // wouldn't be the marker itself).
    const peakPixel = Math.round(peak * width) - 1;
    for (const index of peakMarkerPositions(peakPixel, width)) {
      setPixelAllRows(pixels, width, height, index, PEAK_MARKER_COLOR);
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

function average(values) {
  return values.length
    ? values.reduce((total, value) => total + Number(value ?? 0), 0) / values.length
    : 0;
}

function maxOf(values) {
  return values.reduce((max, value) => Math.max(max, Number(value ?? 0)), 0);
}

// Linearly interpolates `values` (e.g. 16 Mel-spaced telemetry bands) at
// column `x` of a `width`-pixel display, mapping x=0..width-1 onto control
// points 0..values.length-1 - used to give a smooth per-pixel curve across
// however many LEDs the canvas actually has, rather than dividing them into
// a fixed number of discrete same-value blocks.
export function interpolateSeries(values, x, width) {
  if (!values.length) return 0;
  if (values.length === 1) return Number(values[0] ?? 0);
  const position = width > 1 ? (x / (width - 1)) * (values.length - 1) : 0;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(values.length - 1, lowerIndex + 1);
  const fraction = position - lowerIndex;
  const lower = Number(values[lowerIndex] ?? 0);
  const upper = Number(values[upperIndex] ?? 0);
  return lower + (upper - lower) * fraction;
}

// Peak-hold markers (spectrum-bars, spectrum-band) render red rather than
// heat-palette white, so they read as a distinct indicator against the fire
// colors underneath rather than blending into a hot tip.
const PEAK_MARKER_COLOR = [255, 0, 0];
// On a strip longer than this, a single lit LED is hard to spot from a
// distance, so the marker widens to 2 pixels.
const WIDE_STRIP_PEAK_MARKER_LEDS = 100;

// The LED index/row positions a peak-hold marker should light, given the
// strip has `stripLength` LEDs: just `index` normally, or `index` plus the
// one below it (toward the base, so it never runs past the strip's end at
// full scale) once the strip is long enough that a single pixel marker
// would be hard to see.
function peakMarkerPositions(index, stripLength) {
  if (index < 0) return [];
  return stripLength > WIDE_STRIP_PEAK_MARKER_LEDS && index > 0
    ? [index, index - 1]
    : [index];
}

// A VU-style bar needs to be linear in dB - not raw amplitude - across
// whatever range it displays, or most of a strip's LEDs would sit unlit
// except at the very loudest instants (amplitude is exponential relative to
// perceived loudness/dB). The raw telemetry has ~130dB of theoretical span
// (RMS FFT magnitude of roughly 0 to a few million), but most of that is
// noise floor, not meaningfully "quiet" audio - realistically the mics will
// see at most ~100dB and as little as ~50dB, so AUDIO_DYNAMIC_RANGE_DB spans
// that realistic 50dB window instead of guessing at the mic's own spec.
// Adjust this (and CanvasAudioService's copy, which it must stay in sync
// with - the AGC targets the middle of it) if real testing suggests a
// different usable range.
const AUDIO_DYNAMIC_RANGE_DB = 50;

// Rather than the bottom of that range going fully dark, this fraction of
// the strip stays lit even in silence - like a real VU meter's needle
// resting slightly above zero rather than pinned at the bottom. Adjust to
// taste.
const SILENCE_FLOOR_FRACTION = 0.15;

// `amplitude` is a normalized 0..1 full-scale value (1 == 0dB); this returns
// where it should land on the strip, 0..1, across the last
// AUDIO_DYNAMIC_RANGE_DB decibels below full scale, remapped into
// [SILENCE_FLOOR_FRACTION, 1] so silence still shows a baseline glow instead
// of nothing.
function amplitudeToDbFraction(amplitude, dynamicRangeDb = AUDIO_DYNAMIC_RANGE_DB) {
  if (!(amplitude > 0)) return SILENCE_FLOOR_FRACTION;
  const db = 20 * Math.log10(amplitude);
  const rawFraction = clamp((db + dynamicRangeDb) / dynamicRangeDb, 0, 1);
  return SILENCE_FLOOR_FRACTION + (1 - SILENCE_FLOOR_FRACTION) * rawFraction;
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

// `fire`'s cooling/sparking/diffusion constants are tuned for a strip with
// well over a hundred cells; on a canvas narrower than this, the automaton
// barely gets going before it hits the far end, reading as a lit sliver (or,
// confirmed live on a real 64-tall matrix, a harsh on/off cliff instead of a
// graded flame) rather than a graded flame. At or below the threshold, the
// whole simulation runs at FIRE_SUPERSAMPLE_WIDTH instead (same trick as
// downsampling any oversampled signal) and the result is box-downsampled
// back down to the canvas's real width - inclusive of the threshold itself,
// since 64 is also a common full HUB75 panel height and needs the same
// treatment as anything narrower.
const FIRE_SUPERSAMPLE_MIN_WIDTH = 64;
const FIRE_SUPERSAMPLE_WIDTH = 256;

// Reference density (LEDs/meter) fire's cell-scale constants (sparkHeight, cooling/diffusion
// neighbor spread, falloffWidth, ...) are implicitly tuned against - a common WS2812 density and
// this project's own default new-controller strip (215 LEDs over ~3.58m, see
// controller-service.js's `215` default). A strip whose actual density is known (from
// detectCapabilities()'s ACTIVE_LEDS_PER_METER, snapshotted onto its canvas mapping - see
// canvas.js's normalizeCanvas) is simulated at the cell count this reference density would
// produce for the *same physical length*, then box-resampled (downsampleRowWidth /
// downsampleColumnHeight below) down to the strip's real LED count - so a strip with fewer,
// sparser LEDs over the same physical run gets a sim buffer with proportionally more cells
// instead of stretching each cell's physical size. This is a strict generalization of the
// too-narrow-strip supersample trick above (same downstream mechanism, reused unchanged) rather
// than a parallel code path. A strip with no known density (older firmware, or a canvas mapping
// built before density detection existed) falls back to today's unmodified 1:1 cell-per-LED
// behavior.
const FIRE_REFERENCE_LEDS_PER_METER = 60;

export function flameAxisSimSizeFor(flameAxisCanvasSize, ledsPerMeter) {
  const knownDensity = Number(ledsPerMeter) > 0 ? Number(ledsPerMeter) : null;
  const densityCorrectedSize = knownDensity
    ? (flameAxisCanvasSize * FIRE_REFERENCE_LEDS_PER_METER) / knownDensity
    : flameAxisCanvasSize;
  return densityCorrectedSize <= FIRE_SUPERSAMPLE_MIN_WIDTH
    ? FIRE_SUPERSAMPLE_WIDTH
    : Math.max(1, Math.round(densityCorrectedSize));
}

// Every other effect below with an absolute LED-count or LEDs/second constant
// (a size, a spacing, a speed) is tuned the same way fire's cooling/sparking
// constants are: against this project's own default new-controller strip
// (~60 LEDs/meter, see FIRE_REFERENCE_LEDS_PER_METER above). A strip with a
// different known density needs that constant converted so it represents the
// same physical size/speed, not the same cell count - these three helpers do
// that conversion (falling back to the constant unchanged, today's behavior,
// when density is unknown) for the three shapes such a constant comes in.
export function densityScaledSize(referenceCellCount, ledsPerMeter, { min = 1 } = {}) {
  const knownDensity = Number(ledsPerMeter) > 0 ? Number(ledsPerMeter) : null;
  if (!knownDensity) return referenceCellCount;
  return Math.max(
    min,
    Math.round(referenceCellCount * (knownDensity / FIRE_REFERENCE_LEDS_PER_METER)),
  );
}

// Same conversion, unrounded - for a continuous magnitude (a speed in
// cells/second) where snapping to an integer would be wrong.
export function densityScaledMagnitude(referenceMagnitude, ledsPerMeter) {
  const knownDensity = Number(ledsPerMeter) > 0 ? Number(ledsPerMeter) : null;
  if (!knownDensity) return referenceMagnitude;
  return referenceMagnitude * (knownDensity / FIRE_REFERENCE_LEDS_PER_METER);
}

// Inverse of the above two - for a constant expressed "per cell" (e.g.
// degrees of hue shift per LED), where the goal is to hold the total change
// per physical meter constant rather than the change per cell.
export function densityScaledPerCell(referencePerCell, ledsPerMeter) {
  const knownDensity = Number(ledsPerMeter) > 0 ? Number(ledsPerMeter) : null;
  if (!knownDensity) return referencePerCell;
  return referencePerCell * (FIRE_REFERENCE_LEDS_PER_METER / knownDensity);
}

// Box-filters each row from sourceWidth cells down to targetWidth, averaging
// per channel so a bright one-cell spark contributes its share to the output
// cell it lands in rather than being skipped (as nearest-neighbor sampling
// would risk for a source much wider than the target).
function downsampleRowWidth(pixels, sourceWidth, targetWidth, height) {
  const result = new Array(targetWidth * height);
  for (let row = 0; row < height; row += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const start = Math.floor((x / targetWidth) * sourceWidth);
      const end = Math.max(start + 1, Math.floor(((x + 1) / targetWidth) * sourceWidth));
      let r = 0, g = 0, b = 0;
      for (let sourceX = start; sourceX < end; sourceX += 1) {
        const color = pixels[row * sourceWidth + sourceX];
        r += color[0];
        g += color[1];
        b += color[2];
      }
      const count = end - start;
      result[row * targetWidth + x] = [
        Math.round(r / count),
        Math.round(g / count),
        Math.round(b / count),
      ];
    }
  }
  return result;
}

// downsampleRowWidth's transpose: box-filters each column from sourceHeight
// cells down to targetHeight. Used by fire's matrix orientation, where the
// flame axis runs vertically instead of across the width.
function downsampleColumnHeight(pixels, width, sourceHeight, targetHeight) {
  const result = new Array(width * targetHeight);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < targetHeight; y += 1) {
      const start = Math.floor((y / targetHeight) * sourceHeight);
      const end = Math.max(start + 1, Math.floor(((y + 1) / targetHeight) * sourceHeight));
      let r = 0, g = 0, b = 0;
      for (let sourceY = start; sourceY < end; sourceY += 1) {
        const color = pixels[sourceY * width + x];
        r += color[0];
        g += color[1];
        b += color[2];
      }
      const count = end - start;
      result[y * width + x] = [
        Math.round(r / count),
        Math.round(g / count),
        Math.round(b / count),
      ];
    }
  }
  return result;
}

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

function bouncingBallPosition(elapsedSeconds, dampening, width) {
  const gravity = 0.25;
  const impactVelocityStart = Math.sqrt(2 * gravity);
  const velocities = [];
  let velocity = impactVelocityStart;
  for (let i = 0; i < 2000; i += 1) {
    velocities.push(velocity);
    const nextVelocity = velocity * dampening;
    if (nextVelocity < impactVelocityStart / 2) break;
    velocity = nextVelocity;
  }
  const physicsPeriod = velocities.reduce(
    (total, currentVelocity) => total + (2 * currentVelocity) / gravity,
    0,
  );
  let remaining =
    ((elapsedSeconds % physicsPeriod) + physicsPeriod) % physicsPeriod;
  for (const currentVelocity of velocities) {
    const bounceDuration = (2 * currentVelocity) / gravity;
    if (remaining <= bounceDuration) {
      const height = Math.max(
        0,
        currentVelocity * remaining - 0.5 * gravity * remaining * remaining,
      );
      return height * Math.max(0, width - 1);
    }
    remaining -= bounceDuration;
  }
  return 0;
}

// A "left"/"right" origin restricts stars to the hemisphere that actually
// moves them into the visible canvas (a star born at x=0 heading further
// left would just be invisible forever) - "center" keeps the full circle.
export function starfieldAngle(origin, unitRandom) {
  if (origin === "left") return -Math.PI / 2 + unitRandom * Math.PI;
  if (origin === "right") return Math.PI / 2 + unitRandom * Math.PI;
  return unitRandom * Math.PI * 2;
}

// How far (in the same "distance" units the position formula above scales
// into x/y pixels) a star travels along `angle` from the origin before it
// exits the canvas - i.e. the exact distance at which its x or y coordinate
// first reaches an edge. Used to derive a star's speed from its own heading
// rather than picking a flat random speed, since the position formula's
// width/height aspect correction makes near-horizontal headings exit far
// sooner (in distance terms) than near-vertical ones on a wide, short strip.
export function starfieldExitDistance(originX, originY, angle, width, height) {
  const vx = (Math.cos(angle) * (width / Math.max(1, height))) / 2;
  const vy = height === 1 ? 0 : Math.sin(angle);
  let best = Infinity;
  if (vx > 1e-9) best = Math.min(best, (width - 1 - originX) / vx);
  else if (vx < -1e-9) best = Math.min(best, (0 - originX) / vx);
  if (vy > 1e-9) best = Math.min(best, (height - 1 - originY) / vy);
  else if (vy < -1e-9) best = Math.min(best, (0 - originY) / vy);
  return Number.isFinite(best) && best > 0 ? best : 1;
}

function saturatedColor(rng) {
  const color = [
    Math.floor(rng() * 256),
    Math.floor(rng() * 256),
    Math.floor(rng() * 256),
  ];
  color[color.indexOf(Math.max(...color))] = 255;
  return color;
}

function renderNdsCppFireworks({ width, height, parameters, timestamp }) {
  const pixels = Array.from({ length: width * height }, () => [0, 0, 0]);
  const maxSpeed = densityScaledMagnitude(
    Number(parameters.maxSpeed ?? 175),
    parameters.ledsPerMeter,
  );
  const probability = Math.max(
    0,
    Number(parameters.newParticleProbability ?? 1),
  );
  const preignition = Math.max(
    0,
    Number(parameters.particlePreignitionTime ?? 0),
  );
  const ignition = Math.max(0.001, Number(parameters.particleIgnition ?? 0.2));
  const hold = Math.max(0, Number(parameters.particleHoldTime ?? 0));
  const fadeTime = Math.max(0.05, Number(parameters.particleFadeTime ?? 2));
  const particleSize = Math.max(1, Number(parameters.particleSize ?? 1));
  const lifetime = preignition + ignition + hold + fadeTime;
  const elapsedSeconds = Number(parameters.timeSeconds ?? timestamp / 1000);
  const randomSeed = Number(parameters.randomSeed ?? 0);
  const spawnRate =
    Math.max(5, Math.floor((width * height) / 50)) * probability * 0.005 * 20;
  if (spawnRate === 0) return pixels;

  const interval = 1 / spawnRate;
  const lastSlot = Math.floor(elapsedSeconds / interval);
  const firstSlot = lastSlot - Math.ceil(lifetime / interval) - 1;
  for (let slot = firstSlot; slot <= lastSlot; slot += 1) {
    const rng = mulberry32(slot * 2654435761 + 47 + randomSeed);
    const bornAt = (slot + rng()) * interval;
    const age = elapsedSeconds - bornAt;
    if (age < 0 || age >= lifetime) continue;

    const origin = rng() * width;
    const color = hsvToRgb(rng() * 255, 255, 255);
    const count = 10 + Math.floor(rng() * 41);
    const multiplier = 1 + rng() * 2;
    const fadeStart = preignition + ignition + hold;
    for (let particle = 0; particle < count; particle += 1) {
      const velocity = (rng() * 2 - 1) * maxSpeed * multiplier;
      // NDSCPP updates velocity as v -= 2*v*dt, whose continuous form is
      // v(t)=v0*e^(-2t), producing this integrated position.
      const position = origin + (velocity / 2) * (1 - Math.exp(-2 * age));
      const fade =
        age > fadeStart ? clamp((age - fadeStart) / fadeTime, 0, 1) : 0;
      const shade =
        age < preignition + ignition
          ? [255, 255, 255]
          : color.map((channel) =>
              Math.round(channel * Math.exp(-age) * (1 - fade)),
            );
      const size = Math.max(
        1,
        (1 - fade) * ((width * height) / 500) * particleSize,
      );
      for (let pixel = 0; pixel < size; pixel += 1) {
        plotBlended1DAllRows(pixels, width, height, position + pixel, shade);
      }
    }
  }
  return pixels;
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

// Same anti-aliased column blend as plotBlended1D, but into one specific row
// of a taller buffer - used by rocket-fireworks, where (unlike
// plotBlended1DAllRows) every row runs its own independent show rather than
// mirroring the same thing onto every row.
function plotBlended1DRow(pixels, width, row, x, color) {
  const clamped = Math.max(0, Math.min(width - 1, x));
  const lower = Math.floor(clamped);
  const upper = Math.min(width - 1, lower + 1);
  const frac = clamped - lower;
  const rowOffset = row * width;
  blendChannel(pixels, rowOffset + lower, color, 1 - frac);
  blendChannel(pixels, rowOffset + upper, color, frac);
}

// plotBlended1DRow's transpose: anti-aliased blend between the two rows
// straddling a fractional y, at one fixed integer column - used by
// rocket-fireworks in matrix mode, where the smooth (sub-pixel) motion runs
// vertically (climbing) rather than horizontally (along a strip).
function plotBlended1DColumn(pixels, width, height, x, y, color) {
  const clampedX = Math.max(0, Math.min(width - 1, Math.round(x)));
  const clampedY = Math.max(0, Math.min(height - 1, y));
  const lower = Math.floor(clampedY);
  const upper = Math.min(height - 1, lower + 1);
  const frac = clampedY - lower;
  blendChannel(pixels, lower * width + clampedX, color, 1 - frac);
  blendChannel(pixels, upper * width + clampedX, color, frac);
}

const ROCKET_GRAVITY_CM = 100; // cm/sec^2 - tuned for a ~2-3s ascent up a real ~300-360cm strip
const PARTICLE_GRAVITY_CM = 15; // gentler fall for a lingering "willow" droop on particles
const MAX_APEX_WAIT_SECONDS = 0.75; // cap on pausing at apogee for a beat, so a quiet passage can't strand a rocket forever
const MIN_PARTICLE_LIFE_SECONDS = 1.3;
const MAX_PARTICLE_LIFE_SECONDS = 2.5;
const MIN_EXPLOSION_RADIUS_CM = 60;
const MAX_EXPLOSION_RADIUS_CM = 140;
const PARTICLE_IGNITE_FRACTION = 0.15; // fraction of a particle's life spent ramping up from dark to full brightness
const PARTICLE_TRAIL_STEPS = 3; // dimmer echoes behind each particle, in addition to its current position
const PARTICLE_TRAIL_STEP_SECONDS = 0.035; // time between each trail echo

// Single-entry memo for computeFireworkPoints (see rocket-fireworks' use of
// it): every render tick has exactly one set of inputs in flight across all
// of that tick's per-mapping calls (one per parallel strip), so caching only
// the most recent key/result fully dedupes the otherwise-redundant
// recomputation, the same approach memoizedFireGrid uses for spectrum-band.
let fireworkPointsCache = null;
function memoizedFireworkPoints(key, compute) {
  if (fireworkPointsCache?.key === key) return fireworkPointsCache.points;
  const points = compute();
  fireworkPointsCache = { key, points };
  return points;
}

// Deterministically builds one rocket-and-its-explosion event from nothing
// but its own index `n` and a canvas-wide seed - no dependency on any other
// event, so `n`'s active window can be checked in isolation (see the window
// scan in computeFireworkPoints below) rather than needing every earlier
// event's history to know where this one starts. All physical distances are
// in real centimeters (converted to strip/LED grid coordinates only at the
// very end, in collectFireworkPoints) so a burst is genuinely circular in
// real space despite strips and LEDs being spaced completely differently.
export function makeFireworkEvent(
  n,
  canvasSeed,
  rows,
  width,
  palette,
  launchIntervalSeconds,
  ledSpacingCm,
  minExplosionRadiusCm = MIN_EXPLOSION_RADIUS_CM,
  maxExplosionRadiusCm = MAX_EXPLOSION_RADIUS_CM,
) {
  const rng = mulberry32(canvasSeed + n * 104729 + 11);
  const jitter = (rng() - 0.5) * launchIntervalSeconds * 0.8;
  const launchTime = n * launchIntervalSeconds + jitter;
  const originRow = Math.floor(rng() * rows);
  // How high this rocket climbs before exploding - most reach near the top,
  // some noticeably lower, for visual variety.
  const apexFraction = 0.55 + rng() * 0.45;
  const apexHeightLed = apexFraction * (width - 1);
  const apexHeightCm = apexHeightLed * ledSpacingCm;
  const v0Cm = Math.sqrt(2 * ROCKET_GRAVITY_CM * apexHeightCm);
  const tApex = v0Cm / ROCKET_GRAVITY_CM;

  const particleCount = 10 + Math.floor(rng() * 91); // 10-100
  // Usually one color; occasionally 2-4 for a multi-color burst.
  const colorRoll = rng();
  const colorCount =
    colorRoll < 0.85 ? 1 : colorRoll < 0.95 ? 2 : colorRoll < 0.99 ? 3 : 4;
  const colors = [];
  for (let i = 0; i < colorCount; i += 1) {
    colors.push(palette[Math.floor(rng() * palette.length)]);
  }
  // Phase 4: a minority of explosions have particles that flash white right
  // as they burn out instead of just fading away.
  const hasCrackle = rng() < 0.12;
  const lifeSeconds =
    MIN_PARTICLE_LIFE_SECONDS +
    rng() * (MAX_PARTICLE_LIFE_SECONDS - MIN_PARTICLE_LIFE_SECONDS);
  const explosionRadiusCm =
    minExplosionRadiusCm + rng() * (maxExplosionRadiusCm - minExplosionRadiusCm);
  const explosionSpeedCm = explosionRadiusCm / lifeSeconds;

  const particles = [];
  for (let i = 0; i < particleCount; i += 1) {
    // Angles evenly spread around the full circle, then jittered - "dividing
    // 360 degrees by the particle count, then adding some randomness".
    const baseAngle = (i / particleCount) * Math.PI * 2;
    const angle = baseAngle + (rng() - 0.5) * ((Math.PI * 2) / particleCount);
    // Initial velocities random, but close to each other.
    const speedCm = explosionSpeedCm * (0.85 + rng() * 0.3);
    const color = colors[Math.floor(rng() * colors.length)];
    // Phase 3: most particles just dim at a constant rate; some flare up
    // brighter for their first stretch before dimming out.
    const flareUp = rng() < 0.18;
    const life = lifeSeconds * (0.8 + rng() * 0.4);
    particles.push({ angle, speedCm, color, flareUp, life });
  }

  return { launchTime, originRow, apexHeightLed, apexHeightCm, v0Cm, tApex, particles, hasCrackle };
}

// Runs the deterministic window scan over candidate event indices and
// collects every currently-visible point (rocket, waiting apex, or burst
// particle) canvas-wide, in (row, col) grid coordinates - the "row" a point
// ends up on is not necessarily the event's own originRow, since a particle
// can drift sideways onto a neighboring strip.
function computeFireworkPoints({
  rows,
  width,
  palette,
  launchIntervalSeconds,
  stripSpacingCm,
  ledSpacingCm,
  randomSeed,
  elapsedSeconds,
  startedAtMs,
  audio,
  minExplosionRadiusCm = MIN_EXPLOSION_RADIUS_CM,
  maxExplosionRadiusCm = MAX_EXPLOSION_RADIUS_CM,
}) {
  // A rocket event's own worst-case duration (bounded so the window scan
  // only ever has to check a handful of candidate events, the same trick
  // simulateFireHeat uses to keep a stateless replay's cost constant
  // regardless of how long the effect has been running).
  const maxTApex = Math.sqrt((2 * (width - 1) * ledSpacingCm) / ROCKET_GRAVITY_CM);
  const maxEventDuration = maxTApex + MAX_APEX_WAIT_SECONDS + MAX_PARTICLE_LIFE_SECONDS;
  const windowStart =
    Math.floor((elapsedSeconds - maxEventDuration) / launchIntervalSeconds) - 1;
  const windowEnd = Math.ceil(elapsedSeconds / launchIntervalSeconds) + 1;

  const points = [];
  for (let n = windowStart; n <= windowEnd; n += 1) {
    const event = makeFireworkEvent(
      n,
      randomSeed,
      rows,
      width,
      palette,
      launchIntervalSeconds,
      ledSpacingCm,
      minExplosionRadiusCm,
      maxExplosionRadiusCm,
    );
    collectFireworkPoints(event, {
      elapsedSeconds,
      startedAtMs,
      audio,
      rows,
      width,
      stripSpacingCm,
      ledSpacingCm,
      points,
    });
  }
  return points;
}

// Determines whichever phase (ascending / paused at apogee / exploded
// particles) `event` is in at `elapsedSeconds` and pushes its visible
// point(s) into `points`, or pushes nothing if this event hasn't launched
// yet or has completely finished.
function collectFireworkPoints(
  event,
  { elapsedSeconds, startedAtMs, audio, rows, width, stripSpacingCm, ledSpacingCm, points },
) {
  const t = elapsedSeconds - event.launchTime;
  if (t < 0) return;

  // Phase 1: launch/ascent - a bright point climbing and slowing under
  // gravity, dimming as it nears apogee. Stays on its own launch strip.
  if (t < event.tApex) {
    const velocityCm = event.v0Cm - ROCKET_GRAVITY_CM * t;
    const positionCm = event.v0Cm * t - 0.5 * ROCKET_GRAVITY_CM * t * t;
    const brightness = clamp(velocityCm / event.v0Cm, 0.15, 1);
    const color = [255, 255, 255].map((channel) => Math.round(channel * brightness));
    points.push({ row: event.originRow, col: positionCm / ledSpacingCm, color });
    return;
  }

  // At or past apogee: with no audio, explode immediately; with audio,
  // pause here until the next beat (or MAX_APEX_WAIT_SECONDS, whichever
  // comes first).
  let explodeAtElapsed;
  const apexAtElapsed = event.launchTime + event.tApex;
  if (!audio?.available) {
    explodeAtElapsed = apexAtElapsed;
  } else {
    const apexAtMs = startedAtMs + apexAtElapsed * 1000;
    const nowMs = startedAtMs + elapsedSeconds * 1000;
    // The beat must fall within this event's own valid wait window - at or
    // after its own apogee, and no later than its own MAX_APEX_WAIT_SECONDS
    // deadline (capped again by "now", since a future beat obviously hasn't
    // happened yet - guards against clock skew between the controller's
    // beat-detector timestamp and this render's own timestamp, which would
    // otherwise compute a negative tSinceExplosion below and render nothing
    // at all instead of the waiting state). Without the upper bound, a
    // single stale global "most recent beat" timestamp could wrongly
    // satisfy some *other*, much older event's window too (any beat at or
    // after that old event's own long-past apogee trivially satisfies a
    // bare ">= apexAtMs" check), reviving an event that should have already
    // timed out.
    const waitDeadlineMs = apexAtMs + MAX_APEX_WAIT_SECONDS * 1000;
    const beatArrived =
      Number.isFinite(audio.lastBeatAt) &&
      audio.lastBeatAt >= apexAtMs &&
      audio.lastBeatAt <= Math.min(nowMs, waitDeadlineMs);
    if (beatArrived) {
      explodeAtElapsed = (audio.lastBeatAt - startedAtMs) / 1000;
    } else if (t - event.tApex > MAX_APEX_WAIT_SECONDS) {
      explodeAtElapsed = apexAtElapsed + MAX_APEX_WAIT_SECONDS;
    } else {
      // Still waiting - a dim, steady point held at apogee.
      points.push({
        row: event.originRow,
        col: event.apexHeightLed,
        color: [90, 90, 90],
      });
      return;
    }
  }

  const tSinceExplosion = elapsedSeconds - explodeAtElapsed;
  if (tSinceExplosion < 0) return; // waiting for the beat-triggered explosion

  // Phases 2/3/4: burst particles traveling sideways (possibly onto
  // neighboring strips) and along their own strip's length, burning, and
  // occasionally flashing white right at the end. Each particle's own
  // radial position at a given time-since-explosion is reused below both
  // for its current position and for a short trail of earlier positions
  // (particlePositionAt), so the trail always traces back along the exact
  // same path the particle itself is following.
  const particlePositionAt = (particle, t) => {
    const xCm = Math.cos(particle.angle) * particle.speedCm * t;
    const yCm =
      Math.sin(particle.angle) * particle.speedCm * t -
      0.5 * PARTICLE_GRAVITY_CM * t * t;
    return {
      row: Math.round(event.originRow + xCm / stripSpacingCm),
      col: event.apexHeightLed + yCm / ledSpacingCm,
    };
  };

  for (const particle of event.particles) {
    if (tSinceExplosion > particle.life) continue;

    const lifeFraction = tSinceExplosion / particle.life;
    let brightness = particle.flareUp
      ? lifeFraction < 0.35
        ? lifeFraction / 0.35
        : 1 - (lifeFraction - 0.35) / 0.65
      : 1 - lifeFraction;
    let color = particle.color;
    if (event.hasCrackle && lifeFraction > 0.85) {
      color = [255, 255, 255];
      brightness = 1;
    }
    // Ramps from dark to full brightness over the particle's first
    // PARTICLE_IGNITE_FRACTION of life, on top of whatever the fade/flare
    // envelope above already gives it - makes a particle visibly detach
    // from the rocket and "light up" as it clears the burst point, instead
    // of appearing instantly at full brightness right on top of it.
    brightness *= Math.min(1, lifeFraction / PARTICLE_IGNITE_FRACTION);
    brightness = clamp(brightness, 0, 1);

    // The particle's own current position, plus a short trail of dimmer
    // echoes at slightly earlier times along the same path - a lit particle
    // with nothing behind it read as popping into existence mid-air rather
    // than tracing out from the rocket.
    for (let step = 0; step <= PARTICLE_TRAIL_STEPS; step += 1) {
      const trailT = tSinceExplosion - step * PARTICLE_TRAIL_STEP_SECONDS;
      if (trailT < 0) break;
      const { row, col } = particlePositionAt(particle, trailT);
      if (row < 0 || row >= rows || col < 0 || col > width - 1) continue;
      const trailBrightness =
        brightness * (1 - step / (PARTICLE_TRAIL_STEPS + 1));
      const finalColor = color.map((channel) =>
        Math.round(channel * trailBrightness),
      );
      points.push({ row, col, color: finalColor });
    }
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

// setPixelAllRows' transpose: sets an exact pixel index on every column,
// wrapping/clamping the row into range - used by classic-fire's matrix
// orientation, where the flame axis runs vertically instead of across rows.
function setPixelAllColumns(pixels, width, height, y, color) {
  const index = ((Math.round(y) % height) + height) % height;
  for (let x = 0; x < width; x += 1) {
    pixels[index * width + x] = color;
  }
}

// FastLED's HeatColor() gradient (black -> red -> orange/yellow -> white),
// used by both FireEffect (via GetBlackBodyHeatColor/HeatColors_p) and
// ClassicFireEffect (via its own bit-shifted setPixelHeatColor).
// Selectable color families for `fire`'s heat ramp: black -> cool -> mid ->
// white as heat rises. "red" is the original NightDriverStrip HeatColor
// ramp (red -> yellow -> white) and reproduces it exactly; the others swap
// in different cool/mid colors for the same three-segment shape.
const FIRE_HEAT_RAMPS = {
  red: { cool: [255, 0, 0], mid: [255, 255, 0] },
  green: { cool: [0, 255, 0], mid: [255, 255, 0] },
  blue: { cool: [0, 0, 255], mid: [0, 255, 255] },
};

function heatToFireColor(heat, ramp = FIRE_HEAT_RAMPS.red) {
  const t192 = Math.round((clamp(heat, 0, 255) / 255) * 191);
  let heatramp = t192 & 0x3f;
  heatramp <<= 2;
  const t = heatramp / 255;
  const lerp = (from, to) =>
    from.map((channel, index) => Math.round(channel + (to[index] - channel) * t));
  if (t192 & 0x80) return lerp(ramp.mid, [255, 255, 255]);
  if (t192 & 0x40) return lerp(ramp.cool, ramp.mid);
  return lerp([0, 0, 0], ramp.cool);
}

// Cross-call state for simulateFireHeat, keyed by the one thing that
// identifies a single continuous simulation stream across repeated calls at
// (usually) closely-spaced elapsedSeconds - its own (seedSalt, cellCount).
// seedSalt is already effectively unique per physical strip (fire/
// classic-fire/musical-fire salt a per-mapping randomSeed derived from
// stableSeed(controllerId:stripIndex); spectrum-band salts a fixed per-row
// offset) and per row within one call (simulateFireGrid below adds row*97),
// so no separate playback-session id is needed to disambiguate one strip's
// stream from another's - and a session restart (or any caller jumping
// elapsedSeconds backward for this key) is handled by falling back to a
// fresh bounded simulate below, the same as a cold start. Capped defensively
// since it's a plain Map with no natural eviction - the real key space
// (distinct physical strips x cell counts in use) is tiny in practice, so
// this cap is insurance against misuse, not an expected ceiling.
const fireHeatCache = new Map();
const FIRE_HEAT_CACHE_MAX_ENTRIES = 1000;

function cacheFireHeat(key, lastStep, heat) {
  if (fireHeatCache.size >= FIRE_HEAT_CACHE_MAX_ENTRIES && !fireHeatCache.has(key)) {
    fireHeatCache.clear();
  }
  fireHeatCache.set(key, { lastStep, heat });
}

// Runs a fire cellular automaton forward in fixed 20ms steps, deterministically
// seeded per step so the same elapsed time always reproduces the same frame.
// A live playback tick only ever advances elapsedSeconds by about one frame
// interval, so this picks up wherever this (seedSalt, cellCount) stream last
// left off (fireHeatCache above) and simulates just the handful of new steps
// since then, instead of replaying the last several seconds from scratch on
// every single call - the dominant render cost this was measured to be (see
// playback-service.js's scheduleFrames). A cold start, a gap bigger than the
// window, or elapsedSeconds running backward for this key (a session
// restarted, most likely) all fall back to the original behavior: replay
// just the last few seconds from an all-zero heat array, since the automaton
// mixes/cools out any earlier state within a couple of seconds anyway - this
// keeps a cold call's cost bounded no matter how long the effect has
// actually been running. The cached array is mutated in place as the shared
// "master" state; callers always get their own copy back, so anything a
// caller does to its result (simulateFireGrid's neighbor-blend, for
// instance) can never corrupt the next call's starting point.
function simulateFireHeat({ cellCount, elapsedSeconds, seedSalt, step }) {
  const stepMs = 20;
  const windowSteps = Math.ceil(3000 / stepMs);
  const currentStep = Math.floor((elapsedSeconds * 1000) / stepMs);
  const key = `${seedSalt}:${cellCount}`;
  const cached = fireHeatCache.get(key);
  const canContinue =
    cached && cached.lastStep <= currentStep && currentStep - cached.lastStep <= windowSteps;
  const startStep = canContinue
    ? cached.lastStep + 1
    : Math.max(0, currentStep - windowSteps);
  const heat = canContinue ? cached.heat : new Array(cellCount).fill(0);
  for (let s = startStep; s <= currentStep; s += 1) {
    const rng = mulberry32(seedSalt * 2654435761 + s * 40503);
    step(heat, rng, s, stepMs);
  }
  cacheFireHeat(key, currentStep, heat);
  return heat.slice();
}

// Runs `simulateFireHeat` once per row (each with its own row-derived
// seedSalt), applies an optional per-row height ceiling every simulated
// step (a soft attenuation past `ceilingFractionForRow(row, stepSeconds) *
// cellCount`, measured as `distanceFromBase(i)` - defaults to counting down
// from the far end, matching `fire`'s own spark-at-the-end convention), then
// blends each row's final heat with its immediate neighbor rows so multiple
// rows read as one connected fire instead of independent, uncorrelated
// ones. Shared by `fire` (ceiling driven by a slow breathing wave) and
// `spectrum-band` (ceiling driven by that row's own live audio level).
// Single-entry memo for simulateFireGrid results (see spectrum-band's use of
// it): each render tick has exactly one (stripCount, width, elapsedSeconds,
// neighborBlend) combination in flight across all of that tick's per-mapping
// calls, so caching only the most recent key/result is enough to fully
// dedupe the redundant recomputation without an unbounded/leaking cache.
let fireGridCache = null;
function memoizedFireGrid(key, compute) {
  if (fireGridCache?.key === key) return fireGridCache.grid;
  const grid = compute();
  fireGridCache = { key, grid };
  return grid;
}

// Both caches above are module-level (persisting across EffectRenderService
// instances, matching real usage - the caching only pays off if it survives
// between playback ticks). Tests that need a clean slate for a specific
// (seedSalt, cellCount) - e.g. comparing a cold simulate against an
// incrementally-built one - call this rather than relying on luck to avoid
// colliding with another test's leftover state.
export function __resetSimulationCachesForTests() {
  fireHeatCache.clear();
  fireGridCache = null;
}

function simulateFireGrid({
  rows,
  cellCount,
  elapsedSeconds,
  seedSalt,
  neighborBlend,
  rowStep,
  ceilingFractionForRow,
  distanceFromBase = (i) => cellCount - 1 - i,
  falloffWidth = Math.max(3, Math.round(cellCount * 0.05)),
}) {
  const grid = [];
  for (let row = 0; row < rows; row += 1) {
    const heat = simulateFireHeat({
      cellCount,
      elapsedSeconds,
      seedSalt: seedSalt + row * 97,
      step: (h, rng, s, stepMs) => {
        rowStep(h, rng, s, stepMs, row);
        if (!ceilingFractionForRow) return;
        const heightFraction = ceilingFractionForRow(row, (s * stepMs) / 1000);
        const ceilingDistance = heightFraction * cellCount;
        for (let i = 0; i < cellCount; i += 1) {
          const over = distanceFromBase(i) - ceilingDistance;
          if (over > 0) {
            h[i] = Math.floor(h[i] * Math.max(0, 1 - over / falloffWidth));
          }
        }
      },
    });
    grid.push(heat);
  }

  if (neighborBlend > 0 && rows > 1) {
    const previous = grid.map((row) => row.slice());
    for (let row = 0; row < rows; row += 1) {
      const above = previous[row - 1];
      const below = previous[row + 1];
      const neighborCount = (above ? 1 : 0) + (below ? 1 : 0);
      if (neighborCount === 0) continue;
      for (let i = 0; i < cellCount; i += 1) {
        const neighborHeat =
          ((above ? above[i] : 0) + (below ? below[i] : 0)) / neighborCount;
        grid[row][i] = Math.min(
          255,
          Math.round(grid[row][i] * (1 - neighborBlend) + neighborHeat * neighborBlend),
        );
      }
    }
  }

  return grid;
}

// A smooth, deterministic wander between `min` and `max` that rests near
// `averageFraction`, used by `fire` to vary how tall the flame reaches over
// time. Built from a few incommensurate sine waves (rather than per-step
// randomness) so the height breathes gradually - like a real fire responding
// to slow shifts in airflow - instead of changing every frame. The mapping is
// asymmetric around `averageFraction` so the full [min, max] range gets used
// even though the resting point usually isn't centered between them.
// `waveSeconds`'s own term is weighted well above the two shorter, faster
// terms (which just add subtle texture) so the requested period actually
// reads as one clear, dominant breath rather than being washed out by them.
// `sharedSeed` phases that dominant term identically across every row on a
// multi-strip canvas, so they all breathe together on the big cycle; `rowSeed`
// phases only the two texture terms, so each strip still varies individually
// rather than being a perfect copy of its neighbors.
function fireHeightFraction(
  seconds,
  sharedSeed,
  rowSeed,
  { min, averageFraction, max, waveSeconds },
) {
  const phase = (seed, n) => (((seed * n) % 997) / 997) * Math.PI * 2;
  const wave =
    0.7 * Math.sin((2 * Math.PI * seconds) / waveSeconds + phase(sharedSeed, 3)) +
    0.2 *
      Math.sin(
        (2 * Math.PI * seconds) / (waveSeconds * 0.37) + phase(rowSeed, 7),
      ) +
    0.1 *
      Math.sin(
        (2 * Math.PI * seconds) / (waveSeconds * 0.13) + phase(rowSeed, 13),
      );
  return wave >= 0
    ? averageFraction + wave * (max - averageFraction)
    : averageFraction + wave * (averageFraction - min);
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
