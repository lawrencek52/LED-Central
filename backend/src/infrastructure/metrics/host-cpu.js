import os from "node:os";

// Per-core CPU utilization (0-100) of the host running the backend, measured
// as the busy share of each core's time between two samples of os.cpus().
// Samples closer together than `minIntervalMs` reuse the previous result, so
// several Status pages polling at once don't shrink the window to noise.
export class HostCpuSampler {
  constructor({ cpus = () => os.cpus(), now = () => Date.now(), minIntervalMs = 500 } = {}) {
    this.cpus = cpus;
    this.now = now;
    this.minIntervalMs = minIntervalMs;
    this.previous = this.read();
    this.sampledAt = this.now();
    this.percentages = this.previous.map(() => 0);
  }

  read() {
    return this.cpus().map(({ times }) => ({
      idle: times.idle,
      total: times.user + times.nice + times.sys + times.idle + times.irq,
    }));
  }

  sample() {
    if (this.now() - this.sampledAt < this.minIntervalMs) return this.percentages;
    const current = this.read();
    this.percentages = current.map((core, index) => {
      const before = this.previous[index] ?? { idle: 0, total: 0 };
      const total = core.total - before.total;
      if (total <= 0) return 0;
      return Math.round((100 * (total - (core.idle - before.idle))) / total);
    });
    this.previous = current;
    this.sampledAt = this.now();
    return this.percentages;
  }
}
