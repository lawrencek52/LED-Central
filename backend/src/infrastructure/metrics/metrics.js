export class Metrics {
  constructor() {
    this.startedAt = Date.now();
    this.requests = 0;
    this.responses = 0;
    this.errors = 0;
    this.totalResponseTimeMs = 0;
  }

  recordRequest() { this.requests += 1; }

  recordResponse({ durationMs, statusCode }) {
    this.responses += 1;
    this.totalResponseTimeMs += durationMs;
    if (statusCode >= 500) this.errors += 1;
  }

  snapshot() {
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      requests: this.requests,
      responses: this.responses,
      errors: this.errors,
      averageResponseTimeMs: this.responses === 0 ? 0 : Number((this.totalResponseTimeMs / this.responses).toFixed(2))
    };
  }
}
