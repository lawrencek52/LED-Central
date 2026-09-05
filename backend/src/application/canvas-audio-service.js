const DEFAULT_BAND_COUNT = 16;
const DEFAULT_DECAY_PER_SECOND = 1 / 3; // full-scale peak falls back to the live level in ~3s
// Matches the mics' ~64dB signal-to-noise ratio - must stay in sync with
// effect-render-service.js's own AUDIO_DYNAMIC_RANGE_DB, which the renderers
// use to map amplitude onto LEDs linearly in dB across that same range.
const AUDIO_DYNAMIC_RANGE_DB = 64;
const DEFAULT_AGC_TARGET_FRACTION = 0.5; // aim for the middle of the dB range, not 50% linear amplitude
// Asymmetric like a broadcast compressor: gain must duck down fast when a
// loud transient (e.g. a clap) hits, or it stays high long enough to clip
// the transient's own decay at full brightness for a second or more - but
// should climb back up slowly during quiet so it settles on the track's
// overall loudness instead of pumping with every beat.
const DEFAULT_AGC_ATTACK_PER_SECOND = 5; // fast: ~0.2s to duck gain down
const DEFAULT_AGC_RELEASE_PER_SECOND = 1 / 30; // slow: ~30s to climb back up
const DEFAULT_AGC_MIN_GAIN = 0.25;
const DEFAULT_AGC_MAX_GAIN = 8;
const DEFAULT_UPDATE_RATE_HZ = 20;
const STALE_TELEMETRY_MS = 2000;
const STALE_BEAT_SOURCE_MS = 4000;

// Aggregates per-controller audio telemetry (from `telemetrySource.getAudioTelemetry`)
// into one canvas-level snapshot, averaging across every controller a canvas straddles
// and maintaining a slowly-decaying per-band peak-hold, plus a fast-attack/slow-release
// automatic-gain control (like a broadcast compressor) so bars settle around the target
// level instead of sitting dark during quiet passages, while still ducking down quickly
// enough that a loud transient doesn't clip at full brightness for a second or more.
// `telemetrySource` only needs to expose
// the TcpControllerGateway, but keeping it as a named dependency (rather than depending
// on the gateway class directly) leaves room for a future in-app music-playback source
// to stand in for it.
export class CanvasAudioService {
  constructor({
    telemetrySource,
    bandCount = DEFAULT_BAND_COUNT,
    decayRatePerSecond = DEFAULT_DECAY_PER_SECOND,
    dynamicRangeDb = AUDIO_DYNAMIC_RANGE_DB,
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
    this.decayRatePerSecond = decayRatePerSecond;
    this.dynamicRangeDb = dynamicRangeDb;
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

    if (entries.length === 0) {
      this.decay(state, elapsedSeconds, null);
      state.lastUpdateAt = now;
      return this.snapshot(state, { available: false });
    }

    const rawPeaks = averageArrays(
      entries.map(([, telemetry]) => resample(telemetry.peaks ?? [], this.bandCount)),
    );
    this.updateGain(state, rawPeaks, elapsedSeconds);
    const peaks = rawPeaks.map((value) => clamp(value * state.gain, 0, 1));

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

    this.decay(state, elapsedSeconds, peaks);
    state.lastUpdateAt = now;

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
        peaksDecayed: new Array(this.bandCount).fill(0),
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
  // during quiet passages rather than pumping with every beat).
  updateGain(state, peaks, elapsedSeconds) {
    const meanLevel = average(peaks);
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

  decay(state, elapsedSeconds, peaks) {
    for (let i = 0; i < this.bandCount; i += 1) {
      const decayed = Math.max(0, state.peaksDecayed[i] - elapsedSeconds * this.decayRatePerSecond);
      state.peaksDecayed[i] = peaks ? Math.max(decayed, peaks[i] ?? 0) : decayed;
    }
  }

  snapshot(state, overrides) {
    return {
      bandCount: this.bandCount,
      peaks: [],
      peaksDecayed: [...state.peaksDecayed],
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

function resample(peaks, targetCount) {
  if (peaks.length === 0) return new Array(targetCount).fill(0);
  if (peaks.length === targetCount) return peaks.map(Number);
  const result = new Array(targetCount);
  for (let i = 0; i < targetCount; i += 1) {
    const position = (i / Math.max(1, targetCount - 1)) * (peaks.length - 1);
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.min(peaks.length - 1, lowerIndex + 1);
    const fraction = position - lowerIndex;
    const lower = Number(peaks[lowerIndex] ?? 0);
    const upper = Number(peaks[upperIndex] ?? 0);
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
