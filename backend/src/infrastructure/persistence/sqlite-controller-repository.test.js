import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteControllerRepository } from './sqlite-controller-repository.js';

test('persists controller configuration across repository instances', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'led-central-controllers-'));
  const databasePath = path.join(directory, 'led-central.db');
  const controller = {
    id: 'deck-one', name: 'Deck One', host: 'deck1.local', port: 49152,
    connected: false, strips: 4, lastSeen: '2026-01-01T00:00:00.000Z'
  };
  const first = new SqliteControllerRepository({ databasePath });
  first.save(controller);
  first.close();

  const second = new SqliteControllerRepository({ databasePath });
  assert.deepEqual(second.get(controller.id), {
    ...controller,
    ledCounts: [215, 215, 215, 215],
    audioAvailable: 'unknown',
    audioCheckedAt: null,
    createdAt: controller.lastSeen,
    updatedAt: controller.lastSeen
  });
  assert.equal(second.remove(controller.id), true);
  second.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
