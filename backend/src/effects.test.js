import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from './server.js';

async function request(server, path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) }
  });
  return { status: response.status, body: await response.json() };
}

test('exposes effect library CRUD over HTTP', async t => {
  const effects = new Map();
  const effectService = {
    list: () => [...effects.values()],
    get: id => effects.get(id) ?? null,
    create: input => {
      const effect = { id: 'pulse', ...input };
      effects.set(effect.id, effect);
      return effect;
    },
    update: (id, input) => {
      if (!effects.has(id)) return null;
      const effect = { ...effects.get(id), ...input };
      effects.set(id, effect);
      return effect;
    },
    remove: id => effects.delete(id)
  };
  const server = createServer(createApp({ effectService })).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());

  const invalid = await request(server, '/api/effects', {
    method: 'POST',
    body: JSON.stringify({ name: 'Pulse' })
  });
  assert.equal(invalid.status, 400);

  const created = await request(server, '/api/effects', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Pulse',
      renderer: 'pulse',
      parameters: { speed: { type: 'number', default: 1 } },
      tags: ['animated']
    })
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.id, 'pulse');

  const updated = await request(server, '/api/effects/pulse', {
    method: 'PATCH',
    body: JSON.stringify({ description: 'A pulse effect' })
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.description, 'A pulse effect');

  const deleted = await request(server, '/api/effects/pulse', { method: 'DELETE' });
  assert.deepEqual(deleted.body, { success: true });
});
