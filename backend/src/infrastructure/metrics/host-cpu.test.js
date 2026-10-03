import test from "node:test";
import assert from "node:assert/strict";
import { HostCpuSampler } from "./host-cpu.js";

test("reports each core's busy share of the time since the previous sample", () => {
  let time = 0;
  let snapshot = [
    { times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
    { times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
  ];
  const sampler = new HostCpuSampler({ cpus: () => snapshot, now: () => time });
  time = 1000;
  snapshot = [
    { times: { user: 200, nice: 0, sys: 50, idle: 750, irq: 0 } },
    { times: { user: 900, nice: 0, sys: 100, idle: 0, irq: 0 } },
  ];
  assert.deepEqual(sampler.sample(), [25, 100]);
  // Within minIntervalMs: the previous result is reused, not a near-empty window.
  time = 1100;
  assert.deepEqual(sampler.sample(), [25, 100]);
});
