import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteCanvasRepository } from './sqlite-canvas-repository.js';

test('persists canvas mappings and revisions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'led-central-canvases-'));
  const repository = new SqliteCanvasRepository({ databasePath: path.join(directory, 'led-central.db') });
  const canvas = {
    id: 'front', name: 'Front of house', width: 20, height: 4,
    mappings: [{ controllerId: 'deck-one', stripIndex: 0, reversed: true, layout: 'series', x: 0, y: 0, width: 20, height: 1, rotation: 0 }],
    revision: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  };

  repository.save(canvas);
  assert.deepEqual(repository.get(canvas.id), {
    ...canvas,
    stripSpacingRatio: 1,
    mappings: [{
      controllerId: 'deck-one',
      stripIndex: 0,
      reversed: true,
      layout: 'series',
      x: 0,
      y: 0,
      width: 20,
      height: 1,
      ledsPerMeter: null,
      rotation: 0
    }]
  });
  repository.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('persists a custom strip spacing ratio, defaulting to 1 when unset', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'led-central-canvases-'));
  const repository = new SqliteCanvasRepository({ databasePath: path.join(directory, 'led-central.db') });

  repository.save({
    id: 'wall', name: 'Deck8', width: 215, height: 8, mappings: [],
    stripSpacingRatio: 24.38,
    revision: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  });
  assert.equal(repository.get('wall').stripSpacingRatio, 24.38);

  repository.save({
    id: 'matrix', name: 'Matrix', width: 16, height: 16, mappings: [],
    revision: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  });
  assert.equal(repository.get('matrix').stripSpacingRatio, 1);

  repository.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
