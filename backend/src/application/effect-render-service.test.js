import test from 'node:test';
import assert from 'node:assert/strict';
import { EffectRenderService } from './effect-render-service.js';

test('renders a solid effect across the canvas', () => {
  const frame = new EffectRenderService().render({
    effect: { renderer: 'solid', parameters: { color: { default: '#12abef' } } },
    canvas: { width: 2, height: 2 }
  });
  assert.deepEqual(frame.pixels, [[18, 171, 239], [18, 171, 239], [18, 171, 239], [18, 171, 239]]);
});

test('renders gradient endpoints', () => {
  const frame = new EffectRenderService().render({
    effect: { renderer: 'gradient', parameters: { startColor: { default: '#ff0000' }, endColor: { default: '#0000ff' }, angle: { default: 0 } } },
    canvas: { width: 3, height: 1 }
  });
  assert.deepEqual(frame.pixels, [[255, 0, 0], [128, 0, 128], [0, 0, 255]]);
});
