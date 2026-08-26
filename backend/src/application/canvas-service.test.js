import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasService } from './canvas-service.js';

function repositoryWith(canvases) {
  return {
    list: () => canvases,
    save: canvas => canvas,
    get: id => canvases.find(canvas => canvas.id === id) || null,
    remove: () => true
  };
}

test('rejects a strip already assigned to another canvas', () => {
  const service = new CanvasService({
    repository: repositoryWith([{
      id: 'existing',
      name: 'Existing',
      mappings: [{ controllerId: 'deck1', stripIndex: 0 }]
    }]),
    idFactory: () => 'new-canvas'
  });

  assert.throws(
    () => service.create({
      name: 'Duplicate',
      width: 10,
      height: 1,
      mappings: [{ controllerId: 'deck1', stripIndex: 0 }]
    }),
    error => error.statusCode === 409 && error.details.mappings[0].reason.includes('Existing')
  );
});

test('allows a canvas to retain its own strip assignments during update', () => {
  const existing = {
    id: 'existing',
    name: 'Existing',
    width: 10,
    height: 1,
    mappings: [{ controllerId: 'deck1', stripIndex: 0 }],
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
  const service = new CanvasService({
    repository: repositoryWith([existing]),
    now: () => new Date('2026-01-02T00:00:00.000Z')
  });

  const updated = service.update('existing', {
    name: 'Updated',
    width: 10,
    height: 1,
    mappings: existing.mappings
  });
  assert.equal(updated.name, 'Updated');
});

test('accepts canvas bounds that include parallel row offsets', () => {
  const service = new CanvasService({
    repository: repositoryWith([]),
    idFactory: () => 'out-of-bounds'
  });

  assert.doesNotThrow(() => service.create({
    name: 'Bounded parallel canvas',
    width: 322,
    height: 2,
    mappings: [{ controllerId: 'deck1', stripIndex: 0, x: 107, y: 1, width: 215, height: 1 }]
  }));
});
