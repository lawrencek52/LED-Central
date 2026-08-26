import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from './server.js';
import { Metrics } from './infrastructure/metrics/metrics.js';

async function request(server, path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
  return { status: response.status, body: await response.json() };
}

test('records request metrics and protects the API with a bearer token', async t => {
  const metrics = new Metrics();
  const server = createServer(createApp({ metrics })).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());

  const health = await request(server, '/api/health');
  assert.equal(health.status, 200);
  assert.equal(metrics.snapshot().requests, 1);

  const metricsResponse = await request(server, '/api/metrics');
  assert.equal(metricsResponse.status, 200);
  assert.equal(metricsResponse.body.responses, 1);
  assert.equal(metricsResponse.body.requests, 2);
});
