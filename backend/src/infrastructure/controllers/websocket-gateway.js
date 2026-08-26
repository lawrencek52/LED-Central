import WebSocket from 'ws';

export class WebSocketControllerGateway {
  constructor({ connectionTimeoutMs = 5000 } = {}) {
    this.connectionTimeoutMs = connectionTimeoutMs;
    this.connections = new Map();
  }

  async connect(controller) {
    const existing = this.connections.get(controller.id);
    if (existing?.readyState === WebSocket.OPEN) {
      return existing;
    }

    const socket = new WebSocket(`ws://${controller.host}:${controller.port}`);
    this.connections.set(controller.id, socket);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.terminate();
        reject(new Error(`Connection timed out for controller ${controller.id}`));
      }, this.connectionTimeoutMs);

      socket.once('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once('error', error => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    socket.once('close', () => {
      if (this.connections.get(controller.id) === socket) {
        this.connections.delete(controller.id);
      }
    });

    return socket;
  }

  async sendFrames(controller, frames) {
    const socket = await this.connect(controller);
    const message = JSON.stringify({
      type: 'led-central.frames.v1',
      frames
    });

    if (socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Controller ${controller.id} is not connected`);
    }

    await new Promise((resolve, reject) => {
      socket.send(message, error => (error ? reject(error) : resolve()));
    });
  }

  disconnect(controllerId) {
    const socket = this.connections.get(controllerId);
    if (socket) {
      socket.close();
      this.connections.delete(controllerId);
    }
  }
}
