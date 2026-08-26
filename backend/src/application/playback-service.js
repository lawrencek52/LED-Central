import { v4 as uuidv4 } from 'uuid';
import { EffectRenderError } from './effect-render-service.js';

export class PlaybackService {
  constructor({ canvasService, effectService, renderService, distributionService, eventHub = null, idFactory = uuidv4, now = () => Date.now() }) {
    this.canvasService = canvasService;
    this.effectService = effectService;
    this.renderService = renderService;
    this.distributionService = distributionService;
    this.eventHub = eventHub;
    this.idFactory = idFactory;
    this.now = now;
    this.sessions = new Map();
  }

  list() { return [...this.sessions.values()]; }

  async start({ canvasId, effectId, parameters = {} }) {
    const canvas = this.canvasService.get(canvasId);
    const effect = this.effectService.get(effectId);
    if (!canvas) throw new EffectRenderError('Canvas not found', 404);
    if (!effect) throw new EffectRenderError('Effect not found', 404);

    const frame = this.renderService.render({ effect, canvas, parameters, timestamp: this.now() });
    const distribution = await this.distributionService.distributeCanvasFrame({ canvas, frame });
    const session = {
      id: this.idFactory(), status: 'playing', canvasId, effectId, parameters,
      startedAt: new Date(frame.timestamp).toISOString(), lastFrameAt: frame.timestamp, distribution
    };
    this.sessions.set(session.id, session);
    this.eventHub?.publish({ topic: 'playback', type: 'playback.started', payload: session });
    return session;
  }

  stop(id) {
    const session = this.sessions.get(id);
    if (!session) return null;
    session.status = 'stopped';
    this.eventHub?.publish({ topic: 'playback', type: 'playback.stopped', payload: session });
    return session;
  }
}
