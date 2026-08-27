import { v4 as uuidv4 } from "uuid";
import { EffectRenderError } from "./effect-render-service.js";

export class PlaybackService {
  constructor({
    canvasService,
    effectService,
    renderService,
    distributionService,
    eventHub = null,
    idFactory = uuidv4,
    now = () => Date.now(),
    frameRate = 20,
    bufferFrames = 100,
    refillFrames = Math.floor(bufferFrames / 2),
    refillLeadFrames = Math.min(bufferFrames - 1, refillFrames + 10),
  }) {
    this.canvasService = canvasService;
    this.effectService = effectService;
    this.renderService = renderService;
    this.distributionService = distributionService;
    this.eventHub = eventHub;
    this.idFactory = idFactory;
    this.now = now;
    this.frameRate = frameRate;
    this.bufferFrames = bufferFrames;
    this.refillFrames = refillFrames;
    this.refillLeadFrames = refillLeadFrames;
    this.sessions = new Map();
    this.timers = new Map();
    this.activeByCanvas = new Map();
  }

  list() {
    return [...this.sessions.values()];
  }

  async start({ canvasId, effectId, parameters = {}, fps }) {
    const canvas = this.canvasService.get(canvasId);
    const effect = this.effectService.get(effectId);
    if (!canvas) throw new EffectRenderError("Canvas not found", 404);
    if (!effect) throw new EffectRenderError("Effect not found", 404);

    const previousSession = this.activeByCanvas.get(canvasId);
    if (previousSession) this.stop(previousSession.id);

    const frameRate =
      fps === undefined ? this.frameRate : this.normalizeFrameRate(fps);
    const intervalMs = this.frameIntervalMs(frameRate);
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
      count: this.bufferFrames,
      frameRate,
    });
    const distribution = await this.distributeFrames({ canvas, frames });
    const session = {
      id: this.idFactory(),
      status: "playing",
      canvasId,
      effectId,
      parameters,
      startedAt: new Date(startedAt).toISOString(),
      lastFrameAt: frames[frames.length - 1].timestamp,
      distribution,
      frameCount: frames.length,
      frameRate,
    };
    this.scheduleFrames({ session, canvas, effect });
    this.sessions.set(session.id, session);
    this.activeByCanvas.set(canvasId, session);
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
    this.eventHub?.publish({
      topic: "playback",
      type: "playback.stopped",
      payload: session,
    });
    return session;
  }

  renderFrame({
    effect,
    canvas,
    parameters,
    startedAt,
    timestamp = this.now(),
  }) {
    return this.renderService.render({
      effect,
      canvas,
      parameters: {
        ...parameters,
        timeSeconds: (timestamp - startedAt) / 1000,
      },
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
    const tick = async () => {
      if (session.status !== "playing") return;
      try {
        const frames = this.renderFrames({
          effect,
          canvas,
          parameters: session.parameters,
          startedAt: Date.parse(session.startedAt),
          firstFrameAt:
            session.lastFrameAt + this.frameIntervalMs(session.frameRate),
          count: this.refillFrames,
          frameRate: session.frameRate,
        });
        session.lastFrameAt = frames[frames.length - 1].timestamp;
        const distribution = await this.distributeFrames({ canvas, frames });
        session.frameCount += frames.length;
        session.distribution = distribution;
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
      this.timers.set(
        session.id,
        setTimeout(
          tick,
          Math.max(
            0,
            session.lastFrameAt -
              this.now() -
              this.refillLeadFrames * this.frameIntervalMs(session.frameRate),
          ),
        ),
      );
    };
    this.timers.set(
      session.id,
      setTimeout(
        tick,
        Math.max(
          0,
          session.lastFrameAt -
            this.now() -
            this.refillLeadFrames * this.frameIntervalMs(session.frameRate),
        ),
      ),
    );
  }
}
