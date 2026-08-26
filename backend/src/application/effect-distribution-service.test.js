import test from 'node:test';
import assert from 'node:assert/strict';
import { ControllerService } from './controller-service.js';
import {
  EffectDistributionError,
  EffectDistributionService
} from './effect-distribution-service.js';

test('fans out frames and reports partial gateway failures', async () => {
  const controllerService = new ControllerService({
    idFactory: (() => {
      const ids = ['one', 'two'];
      return () => ids.shift();
    })()
  });
  const one = controllerService.create({ name: 'One', host: 'one', port: 1 });
  const two = controllerService.create({ name: 'Two', host: 'two', port: 2 });
  const calls = [];
  const distributionService = new EffectDistributionService({
    controllerService,
    gateway: {
      async sendFrames(controller, frames) {
        calls.push({ controller, frames });
        if (controller.id === two.id) {
          throw new Error('socket unavailable');
        }
      }
    }
  });

  const frames = [{ timestamp: 1000, pixels: [[255, 0, 0]] }];
  const result = await distributionService.distribute({
    controllerIds: [one.id, two.id],
    frames
  });

  assert.equal(result.status, 'partial');
  assert.deepEqual(result.sent.map(item => item.controllerId), [one.id]);
  assert.deepEqual(result.failed, [{
    controllerId: two.id,
    error: 'socket unavailable'
  }]);
  assert.deepEqual(calls, [
    { controller: one, frames },
    { controller: two, frames }
  ]);
});

test('rejects unknown target controllers before sending', async () => {
  const controllerService = new ControllerService();
  let sent = false;
  const distributionService = new EffectDistributionService({
    controllerService,
    gateway: { sendFrames: async () => { sent = true; } }
  });

  await assert.rejects(
    () => distributionService.distribute({
      controllerIds: ['missing'],
      frames: [{ timestamp: 1000, pixels: [] }]
    }),
    error => {
      assert.ok(error instanceof EffectDistributionError);
      assert.equal(error.statusCode, 404);
      assert.deepEqual(error.details, { controllerIds: ['missing'] });
      return true;
    }
  );
  assert.equal(sent, false);
});
