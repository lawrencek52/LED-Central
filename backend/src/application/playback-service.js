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
  }) {
    this.canvasService = canvasService;
    this.effectService = effectService;
    this.renderService = renderService;
    this.distributionService = distributionService;
    this.eventHub = eventHub;
    this.idFactory = idFactory;
    this.now = now;
    this.frameRate = frameRate;
    this.sessions = new Map();
    this.timers = new Map();
    this.activeByCanvas = new Map();
  }

  list() {
    return [...this.sessions.values()];
  }

  async start({ canvasId, effectId, parameters = {} }) {
    const canvas = this.canvasService.get(canvasId);
    const effect = this.effectService.get(effectId);
    if (!canvas) throw new EffectRenderError("Canvas not found", 404);
    if (!effect) throw new EffectRenderError("Effect not found", 404);

    const previousSession = this.activeByCanvas.get(canvasId);
    if (previousSession) this.stop(previousSession.id);

    const intervalMs = this.frameIntervalMs();
    const startedAt = this.now();
    const firstFrameAt = Math.max(
      startedAt + intervalMs,
      (previousSession?.lastFrameAt ?? 0) + intervalMs,
    );
    const frame = this.renderFrame({
      effect,
      canvas,
      parameters,
      startedAt,
      timestamp: firstFrameAt,
    });
    const distribution = await this.distributionService.distributeCanvasFrame({
      canvas,
      frame,
    });
    const session = {
      id: this.idFactory(),
      status: "playing",
      canvasId,
      effectId,
      parameters,
      startedAt: new Date(startedAt).toISOString(),
      lastFrameAt: frame.timestamp,
      distribution,
      frameCount: 1,
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

  frameIntervalMs() {
    return Math.ceil(1000 / this.frameRate);
  }

  scheduleFrames({ session, canvas, effect }) {
    const tick = async () => {
      if (session.status !== "playing") return;
      try {
        const frame = this.renderFrame({
          effect,
          canvas,
          parameters: session.parameters,
          startedAt: Date.parse(session.startedAt),
          timestamp: session.lastFrameAt + this.frameIntervalMs(),
        });
        session.lastFrameAt = frame.timestamp;
        const distribution =
          await this.distributionService.distributeCanvasFrame({
            canvas,
            frame,
          });
        session.frameCount += 1;
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
        setTimeout(tick, Math.max(0, session.lastFrameAt - this.now())),
      );
    };
    this.timers.set(
      session.id,
      setTimeout(tick, Math.max(0, session.lastFrameAt - this.now())),
    );
  }
}
