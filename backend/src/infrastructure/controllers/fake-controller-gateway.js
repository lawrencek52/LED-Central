export class FakeControllerGateway {
  constructor({ failures = new Set() } = {}) {
    this.failures = failures;
    this.connections = new Map();
    this.sent = [];
  }

  async connect(controller) {
    if (this.failures.has(controller.id)) {
      throw new Error(`Connection failed for controller ${controller.id}`);
    }
    this.connections.set(controller.id, controller);
    return { controllerId: controller.id, readyState: 'open' };
  }

  async getStatus(controllerId) {
    return {
      controllerId,
      connected: this.connections.has(controllerId)
    };
  }

  async sendFrame(controller, frame) {
    return this.sendFrames(controller, [frame]);
  }

  async sendFrames(controller, frames) {
    await this.connect(controller);
    this.sent.push({
      controller,
      frames: JSON.parse(JSON.stringify(frames))
    });
  }

  disconnect(controllerId) {
    this.connections.delete(controllerId);
  }

  startPreview(controller) {
    this.previewActive ??= new Set();
    this.previewActive.add(controller.id);
  }

  stopPreview(controllerId) {
    this.previewActive?.delete(controllerId);
  }

  getPreviewStatus(controller) {
    const active = Boolean(this.previewActive?.has(controller.id));
    return {
      active,
      connected: active,
      width: 0,
      height: 0,
      frame: null,
      recvFps: 0,
      drawFps: 0,
      kibPerSecond: 0,
    };
  }

  async detectCapabilities(host) {
    if (this.failures.has(host)) {
      throw new Error(`Detection failed for host ${host}`);
    }
    return (
      this.capabilities?.get?.(host) ?? {
        driver: "ws281x",
        layout: "individualStrips",
        numChannels: 1,
        ledCounts: [215],
        matrixWidth: null,
        matrixHeight: null,
      }
    );
  }
}
