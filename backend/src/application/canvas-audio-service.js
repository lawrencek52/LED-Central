const DEFAULT_BAND_COUNT = 16; // matches the firmware's fixed RAW_BAND_COUNT (Mel-spaced)

// The realistic acoustic range we expect to actually see, not the mic's raw
// telemetry range (raw band magnitude runs roughly 0 to a few million,
// ~130dB of theoretical span if you took 20*log10 of it directly - but most
// of that is noise floor, not meaningful quiet audio). Per testing/judgment
// on 2026-09-05: realistically as loud as ~100dB and as quiet as ~50dB, so
// 50dB is what should actually span the LED strip's full length - not a
// guessed SNR figure. Must stay in sync with effect-render-service.js's own
// AUDIO_DYNAMIC_RANGE_DB, which the renderers use to map amplitude onto
// LEDs linearly in dB across that same range.
const AUDIO_DYNAMIC_RANGE_DB = 50;

// Calibrates `rawBands` (unbounded RMS FFT magnitude, see below) to a
// 0..1-ish linear amplitude where 1.0 == 0dB/full-scale. The base value is
// derived from the firmware's own sampling math (soundanalyzer.cpp): int16
// samples (max 32767) over a MAX_SAMPLES=256 Hann-windowed FFT give a single
// dominant bin a magnitude of roughly amplitude * MAX_SAMPLES/2 * 0.5 (Hann
// coherent gain) = 32767 * 64 ~= 2.1M for a full-scale tone; a raw band's
// RMS over several bins reads lower than that for a narrowband signal. On
// top of that starting point, testing against the real display on
// 2026-09-05 found it needed to be *more* sensitive (a lower reference
// requires less actual signal to reach full scale) - an initial pass that
// day moved it the wrong way (+10dB, less sensitive) and was corrected the
// same day to -10dB. Keep tuning this against the real hardware rather than
// the math, which is why it's a plain constructor parameter.
const DEFAULT_REFERENCE_MAGNITUDE = 2_000_000 * 10 ** (-10 / 20); // ~632k, -10dB

// Peak-hold marker: jumps instantly to a new peak, holds there for a brief
// moment (just long enough to be visible as a hold rather than a flicker -
// 1000ms read as a full second's stall on real hardware on 2026-09-05, cut
// down to a few frames), then falls at a constant rate *in dB* (matching how
// loudness is actually perceived and how the renderers map amplitude onto
// LEDs - linear in dB, not in raw amplitude) rather than exponentially or
// linearly in amplitude - either of which would look non-uniform (barely
// moving near the top of the range, then suddenly diving near the bottom)
// once mapped through that same dB-linear LED scale. The fall rate has been
// doubled twice on real-hardware feedback: 1 -> 6 -> 12dB/sec (a full 50dB
// range now falls in ~4.2s).
const DEFAULT_PEAK_HOLD_MS = 100;
const DEFAULT_PEAK_DECAY_DB_PER_SECOND = 12;

// Our own AGC (fast-attack/slow-release, like a broadcast compressor),
// off by default: with the mic's ~64dB useful range spread across 80-200+
// LEDs, a fixed calibration (DEFAULT_REFERENCE_MAGNITUDE) may already give
// good-looking results without adaptive gain. The hooks stay wired up
// (agcEnabled: true) in case testing shows otherwise.
const DEFAULT_AGC_ENABLED = false;
const DEFAULT_AGC_TARGET_FRACTION = 0.5; // aim for the middle of the dB range, not 50% linear amplitude
const DEFAULT_AGC_ATTACK_PER_SECOND = 5; // fast: ~0.2s to duck gain down
const DEFAULT_AGC_RELEASE_PER_SECOND = 1 / 30; // slow: ~30s to climb back up
const DEFAULT_AGC_MIN_GAIN = 0.25;
const DEFAULT_AGC_MAX_GAIN = 8;

const DEFAULT_UPDATE_RATE_HZ = 20;
const STALE_TELEMETRY_MS = 2000;
const STALE_BEAT_SOURCE_MS = 4000;

// Aggregates per-controller audio telemetry (from `telemetrySource.getAudioTelemetry`)
// into one canvas-level snapshot for driving multi-band LED VU meters, averaging
// across every controller a canvas straddles.
//
// The source data is `rawBands`: unprocessed RMS FFT magnitude in a fixed 16
// Mel-spaced bands (grouped the way the ear groups frequencies), sent alongside
// the firmware's own on-device-effects `peaks` field but carrying none of that
// field's noise-floor subtraction, AGC, or decay smoothing - by design, so this
// service owns the entire metering pipeline instead of layering on top of the
// firmware's own visual tuning. That pipeline is:
//   1. Calibrate: divide by `referenceMagnitude` to get a 0..1-ish linear amplitude.
//   2. Optional AGC (see `agcEnabled` above).
//   3. Peak-hold: instant rise, hold, then a constant-dB-per-second fall -
//      like a hardware peak-hold LED.
// Exposed as `peaks` (this tick's instantaneous level - the bar itself reads
// live, un-damped, the way a spectrum display should) and `peaksDecayed` (the
// peak-hold marker), the same field names/shapes the renderers already expect.
//
// `telemetrySource` only needs to expose getAudioTelemetry/getAudioTelemetryRate
// (the TcpControllerGateway satisfies this), but keeping it as a named dependency
// leaves room for a future in-app music-playback source to stand in for it.
export class CanvasAudioService {
  constructor({
    telemetrySource,
    bandCount = DEFAULT_BAND_COUNT,
    referenceMagnitude = DEFAULT_REFERENCE_MAGNITUDE,
    dynamicRangeDb = AUDIO_DYNAMIC_RANGE_DB,
    peakHoldMs = DEFAULT_PEAK_HOLD_MS,
    peakDecayDbPerSecond = DEFAULT_PEAK_DECAY_DB_PER_SECOND,
    agcEnabled = DEFAULT_AGC_ENABLED,
    agcTargetFraction = DEFAULT_AGC_TARGET_FRACTION,
    agcAttackRatePerSecond = DEFAULT_AGC_ATTACK_PER_SECOND,
    agcReleaseRatePerSecond = DEFAULT_AGC_RELEASE_PER_SECOND,
    agcMinGain = DEFAULT_AGC_MIN_GAIN,
    agcMaxGain = DEFAULT_AGC_MAX_GAIN,
    defaultUpdateRateHz = DEFAULT_UPDATE_RATE_HZ,
    now = () => Date.now(),
  }) {
    this.telemetrySource = telemetrySource;
    this.bandCount = bandCount;
    this.referenceMagnitude = referenceMagnitude;
    this.dynamicRangeDb = dynamicRangeDb;
    this.peakHoldMs = peakHoldMs;
    this.peakDecayDbPerSecond = peakDecayDbPerSecond;
    this.agcEnabled = agcEnabled;
    // The linear-amplitude equivalent of sitting at `agcTargetFraction` of the
    // way up the dB display range (e.g. 0.5 -> -32dB -> ~0.0251 amplitude),
    // not a raw linear target - so "the AGC aims for bars at ~50%" stays true
    // now that the LED mapping itself is linear in dB, not in amplitude.
    this.agcTargetAmplitude = dbFractionToAmplitude(agcTargetFraction, dynamicRangeDb);
    this.agcAttackRatePerSecond = agcAttackRatePerSecond;
    this.agcReleaseRatePerSecond = agcReleaseRatePerSecond;
    this.agcMinGain = agcMinGain;
    this.agcMaxGain = agcMaxGain;
    this.defaultUpdateRateHz = defaultUpdateRateHz;
    this.now = now;
    this.canvasStates = new Map();
  }

  getCanvasAudio(canvas) {
    const now = this.now();
    const controllerIds = this.controllerIdsFor(canvas);
    const state = this.stateFor(canvas.id);
    const elapsedSeconds = Math.max(0, (now - state.lastUpdateAt) / 1000);

    const entries = controllerIds
      .map((controllerId) => [controllerId, this.telemetrySource.getAudioTelemetry(controllerId)])
      .filter(([, telemetry]) => telemetry && now - telemetry.receivedAt <= STALE_TELEMETRY_MS);

    this.pruneBeatSources(state, controllerIds, now);

    const available = entries.length > 0;
    const calibrated = available
      ? averageArrays(
          entries.map(([, telemetry]) => resample(telemetry.rawBands ?? [], this.bandCount)),
        ).map((magnitude) => magnitude / this.referenceMagnitude)
      : new Array(this.bandCount).fill(0);

    if (this.agcEnabled && available) {
      this.updateGain(state, calibrated, elapsedSeconds);
    }
    const peaks = calibrated.map((value) => clamp(value * state.gain, 0, 1));

    this.updatePeakHold(state, peaks, now);
    state.lastUpdateAt = now;

    if (!available) {
      return this.snapshot(state, { available: false });
    }

    const vu = average(entries.map(([, telemetry]) => Number(telemetry.vu ?? 0)));
    const vuRatio = average(entries.map(([, telemetry]) => Number(telemetry.vuRatio ?? 0)));
    const vuRatioFade = average(
      entries.map(([, telemetry]) => Number(telemetry.vuRatioFade ?? 0)),
    );

    let beatFired = false;
    let beatConfidence = 0;
    const firedBpm = [];
    for (const [controllerId, telemetry] of entries) {
      const beatSeq = Number(telemetry.beatSeq);
      const previous = state.lastBeatSeqByController.get(controllerId)?.beatSeq;
      if (Number.isInteger(beatSeq)) {
        if (previous === undefined || beatSeq > previous) {
          beatFired = true;
          beatConfidence = Math.max(beatConfidence, Number(telemetry.beatConfidence ?? 0));
          firedBpm.push(Number(telemetry.bpm ?? 0));
        }
        state.lastBeatSeqByController.set(controllerId, {
          beatSeq,
          seenAt: now,
        });
      }
    }
    if (beatFired) {
      state.beatSeq += 1;
      state.lastBeatAt = now;
    }
    const bpm = firedBpm.length
      ? average(firedBpm)
      : average(entries.map(([, telemetry]) => Number(telemetry.bpm ?? 0)));

    return this.snapshot(state, {
      available: true,
      peaks,
      vu,
      vuRatio,
      vuRatioFade,
      bpm,
      beatConfidence,
    });
  }

  // The fastest rate any currently-live controller on this canvas is actually
  // pushing telemetry at - playback for audio-tagged effects paces its render
  // rate off this instead of a fixed default, so it neither over-renders
  // (repeating stale data) nor under-samples (missing fast telemetry updates).
  getUpdateRateHz(canvas) {
    const rates = this.controllerIdsFor(canvas)
      .map((controllerId) => this.telemetrySource.getAudioTelemetryRate?.(controllerId) ?? 0)
      .filter((rate) => rate > 0);
    return rates.length ? Math.max(...rates) : this.defaultUpdateRateHz;
  }

  controllerIdsFor(canvas) {
    return [...new Set((canvas.mappings ?? []).map((mapping) => mapping.controllerId))];
  }

  stateFor(canvasId) {
    let state = this.canvasStates.get(canvasId);
    if (!state) {
      state = {
        peakHold: new Array(this.bandCount).fill(0),
        peakHeldAt: new Array(this.bandCount).fill(-Infinity),
        gain: 1,
        lastUpdateAt: this.now(),
        lastBeatSeqByController: new Map(),
        lastBeatAt: null,
        beatSeq: 0,
      };
      this.canvasStates.set(canvasId, state);
    }
    return state;
  }

  pruneBeatSources(state, controllerIds, now) {
    const known = new Set(controllerIds);
    for (const [controllerId, entry] of state.lastBeatSeqByController) {
      if (!known.has(controllerId) || now - entry.seenAt > STALE_BEAT_SOURCE_MS) {
        state.lastBeatSeqByController.delete(controllerId);
      }
    }
  }

  // Slews `state.gain` toward whatever multiplier would bring this tick's
  // mean band level to the target (~50% of the way up the dB display range),
  // using a fast attack when gain needs to fall (a loud transient arrived -
  // duck quickly so it doesn't clip at full brightness for a second or more)
  // and a slow release when gain needs to rise (settle on overall loudness
  // during quiet passages rather than pumping with every beat). Only called
  // when `agcEnabled`.
  updateGain(state, calibrated, elapsedSeconds) {
    const meanLevel = average(calibrated);
    const desiredGain = clamp(
      this.agcTargetAmplitude / Math.max(meanLevel, 1e-6),
      this.agcMinGain,
      this.agcMaxGain,
    );
    const rate =
      desiredGain < state.gain ? this.agcAttackRatePerSecond : this.agcReleaseRatePerSecond;
    const adaptAmount = clamp(rate * elapsedSeconds, 0, 1);
    state.gain += (desiredGain - state.gain) * adaptAmount;
  }

  // Advances the peak-hold marker toward this tick's per-band level: an
  // instant rise on a new peak, then it holds at that level for `peakHoldMs`
  // before falling at a constant rate *in dB* (`peakDecayDbPerSecond`) - the
  // classic hardware peak-hold LED behavior, unlike `peaks` itself (the bar),
  // which reads live every tick with no damping. Falling at a constant dB
  // rate (i.e. a constant multiplicative factor per second in this linear
  // amplitude domain) is what makes it move down the LED strip at a constant
  // *visual* rate - the renderers map amplitude onto LEDs linearly in dB, so
  // a linear-amplitude (or exponential-in-dB) fall would look non-uniform:
  // barely moving near the top of the range, then suddenly diving near the
  // bottom.
  //
  // Decay only counts the portion of [state.lastUpdateAt, now] that falls
  // after the hold deadline (peakHeldAt + peakHoldMs) - using the full
  // inter-tick gap would over-decay whenever a tick straddles the moment the
  // hold expires (most visible with sparse ticks, but a real source of drift
  // at any tick rate).
  updatePeakHold(state, peaks, now) {
    for (let i = 0; i < this.bandCount; i += 1) {
      const level = peaks[i] ?? 0;
      if (level >= state.peakHold[i]) {
        state.peakHold[i] = level;
        state.peakHeldAt[i] = now;
        continue;
      }
      const holdDeadline = state.peakHeldAt[i] + this.peakHoldMs;
      const decaySeconds = Math.max(0, (now - Math.max(state.lastUpdateAt, holdDeadline)) / 1000);
      if (decaySeconds > 0) {
        const decayFactor = 10 ** (-(this.peakDecayDbPerSecond * decaySeconds) / 20);
        state.peakHold[i] *= decayFactor;
      }
    }
  }

  snapshot(state, overrides) {
    return {
      bandCount: this.bandCount,
      peaks: [],
      peaksDecayed: [...state.peakHold],
      vu: 0,
      vuRatio: 0,
      vuRatioFade: 0,
      bpm: 0,
      beatConfidence: 0,
      lastBeatAt: state.lastBeatAt,
      beatSeq: state.beatSeq,
      updatedAt: state.lastUpdateAt,
      ...overrides,
    };
  }
}

function resample(values, targetCount) {
  if (values.length === 0) return new Array(targetCount).fill(0);
  if (values.length === targetCount) return values.map(Number);
  const result = new Array(targetCount);
  for (let i = 0; i < targetCount; i += 1) {
    const position = (i / Math.max(1, targetCount - 1)) * (values.length - 1);
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.min(values.length - 1, lowerIndex + 1);
    const fraction = position - lowerIndex;
    const lower = Number(values[lowerIndex] ?? 0);
    const upper = Number(values[upperIndex] ?? 0);
    result[i] = lower + (upper - lower) * fraction;
  }
  return result;
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function averageArrays(arrays) {
  const length = arrays[0]?.length ?? 0;
  return Array.from({ length }, (_, index) => average(arrays.map((array) => array[index] ?? 0)));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Inverse of effect-render-service.js's amplitudeToDbFraction: converts a
// 0..1 position within the dB display range back to a linear amplitude, so
// the AGC's target (expressed as "how far up the range", matching what the
// renderers display) can drive a linear gain multiplier.
function dbFractionToAmplitude(fraction, dynamicRangeDb) {
  const db = dynamicRangeDb * (clamp(fraction, 0, 1) - 1);
  return Math.pow(10, db / 20);
}
