import { v4 as uuidv4 } from "uuid";
import { EffectRenderError } from "./effect-render-service.js";

export class PlaybackService {
  constructor({
    canvasService,
    effectService,
    renderService,
    distributionService,
    playbackRepository = null,
    eventHub = null,
    idFactory = uuidv4,
    now = () => Date.now(),
    frameRate = 20,
    targetQueueMs = 1500,
    audioService = null,
    audioQueueFrames = 2,
    maxCatchUpFrames = 4,
  }) {
    this.canvasService = canvasService;
    this.effectService = effectService;
    this.renderService = renderService;
    this.distributionService = distributionService;
    this.playbackRepository = playbackRepository;
    this.eventHub = eventHub;
    this.idFactory = idFactory;
    this.now = now;
    this.frameRate = frameRate;
    this.targetQueueMs = targetQueueMs;
    this.audioService = audioService;
    this.audioQueueFrames = audioQueueFrames;
    this.maxCatchUpFrames = maxCatchUpFrames;
    this.sessions = new Map();
    this.timers = new Map();
    this.activeByCanvas = new Map();
  }

  // Audio-tagged effects read live telemetry as a `parameters.audio` input (see
  // renderFrame) computed by audioService, rather than being stateful themselves.
  requiresAudio(effect) {
    return Boolean(effect.tags?.includes("audio"));
  }

  // Non-audio effects pre-render up to `targetQueueMs` (1500ms) ahead to smooth over
  // network jitter. That lookahead would make audio-reactive effects visibly lag the
  // live sound, so those sessions use a much shorter lookahead instead.
  queueDepthMs(effect, frameRate) {
    return this.requiresAudio(effect)
      ? this.audioQueueFrames * this.frameIntervalMs(frameRate)
      : this.targetQueueMs;
  }

  // Audio-tagged effects render at the rate telemetry is actually arriving at
  // (measured per-controller and re-checked live, since it can change as
  // controllers join/leave/reconnect) rather than a fixed default - matching
  // the source cadence instead of over- or under-sampling it. Non-audio
  // effects keep the caller-requested (or default) fps.
  effectiveFrameRate(effect, canvas, fps) {
    if (this.requiresAudio(effect)) {
      const measured = Math.round(
        this.audioService?.getUpdateRateHz?.(canvas) || this.frameRate,
      );
      // Clamp rather than reuse the throwing normalizeFrameRate - a measured
      // rate is an observation, not user input, so a transient out-of-range
      // reading should be tolerated instead of failing the render tick.
      return Math.min(60, Math.max(1, measured));
    }
    return fps === undefined ? this.frameRate : this.normalizeFrameRate(fps);
  }

  list() {
    return [...this.sessions.values()];
  }

  async start({ canvasId, effectId, parameters = {}, fps }) {
    const canvas = this.canvasService.get(canvasId);
    const effect = this.effectService.get(effectId);
    if (!canvas) throw new EffectRenderError("Canvas not found", 404);
    if (!effect) throw new EffectRenderError("Effect not found", 404);
    if (this.requiresAudio(effect) && !this.audioService?.hasAudioCapability(canvas)) {
      throw new EffectRenderError(
        "Canvas has no audio-capable controllers currently available",
        400,
      );
    }

    const previousSession = this.activeByCanvas.get(canvasId);
    if (previousSession) this.stop(previousSession.id);

    const frameRate = this.effectiveFrameRate(effect, canvas, fps);
    const intervalMs = this.frameIntervalMs(frameRate);
    const targetQueueMs = this.queueDepthMs(effect, frameRate);
    const startedAt = this.now();
    const firstFrameAt = Math.max(
      startedAt + intervalMs,
      (previousSession?.lastFrameAt ?? 0) + intervalMs,
    );
    const frames = this.renderFrames({
      effect,
      canvas,
      parameters,
      startedAt,
      firstFrameAt,
      count: this.queueFrameCount(frameRate, targetQueueMs),
      frameRate,
    });
    const distribution = await this.distributeFrames({ canvas, frames });
    const session = {
      id: this.idFactory(),
      status: "playing",
      canvasId,
      effectId,
      parameters,
      targetQueueMs,
      startedAt: new Date(startedAt).toISOString(),
      lastFrameAt: frames[frames.length - 1].timestamp,
      distribution,
      frameCount: frames.length,
      frameRate,
    };
    this.scheduleFrames({ session, canvas, effect });
    this.sessions.set(session.id, session);
    this.activeByCanvas.set(canvasId, session);
    this.playbackRepository?.save({
      canvasId,
      effectId,
      parameters,
      fps: frameRate,
    });
    this.eventHub?.publish({
      topic: "playback",
      type: "playback.started",
      payload: session,
    });
    return session;
  }

  stop(id) {
    const session = this.sessions.get(id);
    if (!session) return null;
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    session.status = "stopped";
    if (this.activeByCanvas.get(session.canvasId) === session) {
      this.activeByCanvas.delete(session.canvasId);
    }
    this.playbackRepository?.remove(session.canvasId);
    this.eventHub?.publish({
      topic: "playback",
      type: "playback.stopped",
      payload: session,
    });
    return session;
  }

  stopByCanvas(canvasId) {
    const session = this.activeByCanvas.get(canvasId);
    if (session) this.stop(session.id);
    else this.playbackRepository?.remove(canvasId);
  }

  async restore() {
    for (const intent of this.playbackRepository?.list() ?? []) {
      try {
        await this.start(intent);
      } catch (error) {
        this.playbackRepository.remove(intent.canvasId);
      }
    }
  }

  renderFrame({
    effect,
    canvas,
    parameters,
    startedAt,
    timestamp = this.now(),
  }) {
    const effectParameters = {
      ...parameters,
      timeSeconds: (timestamp - startedAt) / 1000,
    };
    if (this.requiresAudio(effect)) {
      effectParameters.audio = this.audioService.getCanvasAudio(canvas);
    }
    return this.renderService.render({
      effect,
      canvas,
      parameters: effectParameters,
      timestamp,
    });
  }

  normalizeFrameRate(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 60) {
      throw new EffectRenderError("FPS must be between 1 and 60", 400);
    }
    return Math.round(parsed);
  }

  frameIntervalMs(frameRate = this.frameRate) {
    return Math.ceil(1000 / frameRate);
  }

  queueFrameCount(frameRate = this.frameRate, targetQueueMs = this.targetQueueMs) {
    return Math.max(1, Math.round(targetQueueMs / this.frameIntervalMs(frameRate)));
  }

  renderFrames({
    effect,
    canvas,
    parameters,
    startedAt,
    firstFrameAt,
    count,
    frameRate = this.frameRate,
  }) {
    return Array.from({ length: count }, (_, index) =>
      this.renderFrame({
        effect,
        canvas,
        parameters,
        startedAt,
        timestamp: firstFrameAt + index * this.frameIntervalMs(frameRate),
      }),
    );
  }

  async distributeFrames({ canvas, frames }) {
    if (this.distributionService.distributeCanvasFrames) {
      return this.distributionService.distributeCanvasFrames({
        canvas,
        frames,
      });
    }
    let distribution;
    for (const frame of frames) {
      distribution = await this.distributionService.distributeCanvasFrame({
        canvas,
        frame,
      });
    }
    return distribution;
  }

  scheduleFrames({ session, canvas, effect }) {
    // Ticks are scheduled against a fixed wall-clock cadence (`nextTickAt`,
    // advanced by exactly one interval per tick) rather than "intervalMs
    // after this tick's work finishes". The latter looks equivalent when
    // rendering+distributing is instant, but distribution occasionally
    // stalls for real (a slow TCP write to a controller - measured live at
    // 100ms-1.6s on ~1.5-2% of writes even after parallelizing per-channel
    // writes, since one tick still awaits every channel via Promise.all). A
    // stall would otherwise push every subsequent tick later by that same
    // amount, compounding tick after tick instead of being a one-off blip -
    // and each catch-up response (below) sends a larger burst of frames,
    // which itself takes longer to distribute, is more likely to contain
    // another stalled write, and pushes the schedule later still. The
    // firmware discards all but the newest already-due frame it finds
    // buffered when it wakes up to draw (see NightDriverStrip's WiFiDraw()),
    // so a compounding delay doesn't just play late - whole bursts of
    // frames get silently dropped, which reads as broken/stuttering
    // playback and gets worse the tighter the frame budget is (a short
    // audio-effect queue, or simply a higher requested fps).
    let nextTickAt = this.now() + this.frameIntervalMs(session.frameRate);
    const tick = async () => {
      if (session.status !== "playing") return;
      if (this.requiresAudio(effect)) {
        session.frameRate = this.effectiveFrameRate(effect, canvas);
        session.targetQueueMs = this.queueDepthMs(effect, session.frameRate);
      }
      const intervalMs = this.frameIntervalMs(session.frameRate);
      try {
        // Top the queue back up to the target lookahead duration one tick's worth
        // at a time instead of waiting and sending a large burst, so delivery stays
        // paced close to the real playback frame rate.
        const targetLastFrameAt = this.now() + session.targetQueueMs;
        let framesNeeded = Math.round(
          (targetLastFrameAt - session.lastFrameAt) / intervalMs,
        );
        let firstFrameAt = session.lastFrameAt + intervalMs;
        if (framesNeeded > this.maxCatchUpFrames) {
          // Badly behind (one long stall, or several smaller ones that never
          // got a chance to recover) - sending every frame in between
          // wouldn't help: NightDriverStrip's WiFiDraw() discards all but the
          // newest already-due frame it finds buffered when it wakes up to
          // draw, so replaying the gap is mostly wasted TCP writes, and each
          // extra write is one more chance to hit another stall and fall
          // further behind. Skip straight to now and resume normal
          // single-frame pacing from there instead.
          framesNeeded = 1;
          firstFrameAt = targetLastFrameAt;
        }
        if (framesNeeded > 0) {
          const frames = this.renderFrames({
            effect,
            canvas,
            parameters: session.parameters,
            startedAt: Date.parse(session.startedAt),
            firstFrameAt,
            count: framesNeeded,
            frameRate: session.frameRate,
          });
          session.lastFrameAt = frames[frames.length - 1].timestamp;
          const distribution = await this.distributeFrames({
            canvas,
            frames,
          });
          session.frameCount += frames.length;
          session.distribution = distribution;
        }
      } catch (error) {
        session.status = "error";
        session.error = error.message;
        this.eventHub?.publish({
          topic: "playback",
          type: "playback.failed",
          payload: session,
        });
        return;
      }
      nextTickAt += intervalMs;
      const now = this.now();
      // Fallen behind by more than a full queue depth (e.g. after one very
      // long stall) - resync to "now" instead of firing a rapid burst of
      // overdue ticks trying to reclaim wall-clock time we can't get back.
      // The framesNeeded catch-up above already covers getting the queued
      // *content* back on schedule.
      if (now - nextTickAt > session.targetQueueMs) nextTickAt = now + intervalMs;
      this.timers.set(session.id, setTimeout(tick, Math.max(0, nextTickAt - now)));
    };
    this.timers.set(session.id, setTimeout(tick, nextTickAt - this.now()));
  }
}
