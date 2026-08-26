import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteEffectRepository } from './sqlite-effect-repository.js';

test('seeds, persists, updates, and removes effect definitions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'led-central-effects-'));
  const databasePath = path.join(directory, 'effects.db');
  const repository = new SqliteEffectRepository({
    databasePath,
    seedEffects: [{
      id: 'solid',
      name: 'Solid Color',
      description: 'One color',
      renderer: 'solid',
      parameters: { color: { type: 'color' } },
      tags: ['basic']
    }]
  });

  assert.equal(repository.list().length, 1);
  assert.deepEqual(repository.get('solid').parameters, { color: { type: 'color' } });

  repository.save({
    id: 'wave',
    name: 'Wave',
    description: 'Moving color',
    renderer: 'wave',
    parameters: { speed: { type: 'number' } },
    tags: ['animated'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  });
  assert.equal(repository.get('wave').name, 'Wave');

  repository.save({
    ...repository.get('wave'),
    name: 'Fast Wave',
    updatedAt: '2026-01-02T00:00:00.000Z'
  });
  assert.equal(repository.get('wave').name, 'Fast Wave');
  assert.equal(repository.remove('wave'), true);
  assert.equal(repository.get('wave'), null);
  assert.equal(repository.remove('wave'), false);

  repository.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
