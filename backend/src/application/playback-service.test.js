import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackService } from './playback-service.js';
import { EffectRenderService } from './effect-render-service.js';

test('renders and distributes an effect frame on playback start', async () => {
  const sent = [];
  const service = new PlaybackService({
    canvasService: { get: id => id === 'canvas-1' ? { id, width: 1, height: 1, mappings: [{ controllerId: 'deck-1', stripIndex: 0 }] } : null },
    effectService: { get: id => id === 'solid' ? { id, renderer: 'solid', parameters: { color: { default: '#ffffff' } } } : null },
    renderService: new EffectRenderService(),
    distributionService: { distributeCanvasFrame: async payload => { sent.push(payload); return { status: 'sent', frameCount: 1, sent: [], failed: [] }; } },
    idFactory: () => 'session-1', now: () => 1700000000000
  });
  const session = await service.start({ canvasId: 'canvas-1', effectId: 'solid' });
  assert.equal(session.status, 'playing');
  assert.deepEqual(sent[0].frame.pixels, [[255, 255, 255]]);
  service.stop(session.id);
});
