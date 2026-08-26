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

test('creates canvases and rejects stale revisions', async t => {
  const canvases = new Map();
  const canvasService = {
    list: () => [...canvases.values()],
    get: id => canvases.get(id) ?? null,
    create: input => { const canvas = { id: 'front', revision: 1, ...input }; canvases.set(canvas.id, canvas); return canvas; },
    update: (id, input, revision) => {
      if (!canvases.has(id)) return null;
      if (revision !== undefined && revision !== canvases.get(id).revision) {
        const error = new Error('Canvas revision conflict'); error.statusCode = 409; throw error;
      }
      const canvas = { ...canvases.get(id), ...input, revision: canvases.get(id).revision + 1 };
      canvases.set(id, canvas); return canvas;
    },
    remove: id => canvases.delete(id)
  };
  const server = createServer(createApp({ canvasService })).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());

  const created = await request(server, '/api/canvases', {
    method: 'POST',
    body: JSON.stringify({ name: 'Front', width: 20, height: 4, mappings: [] })
  });
  assert.equal(created.status, 201);
  const conflict = await request(server, '/api/canvases/front', {
    method: 'PUT',
    headers: { 'if-match-revision': '0' },
    body: JSON.stringify({ name: 'Stale', width: 20, height: 4, mappings: [] })
  });
  assert.equal(conflict.status, 409);

  const invalidBounds = await request(server, '/api/canvases', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Invalid bounds',
      width: 215,
      height: 2,
      mappings: [{ controllerId: 'deck-1', stripIndex: 0, x: 107, y: 1, width: 215, height: 1 }]
    })
  });
  assert.equal(invalidBounds.status, 400);
  assert.equal(invalidBounds.body.details.mappings, 'must fit within the declared canvas width and height');
});
