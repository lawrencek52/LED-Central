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
    mappings: [{ controllerId: 'deck-one', stripIndex: 0, reversed: true }],
    revision: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  };

  repository.save(canvas);
  assert.deepEqual(repository.get(canvas.id), {
    ...canvas,
    mappings: [{ controllerId: 'deck-one', stripIndex: 0, rotation: 0, reversed: true }]
  });
  repository.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
