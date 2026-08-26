import net from 'node:net';

const PIXEL_DATA_COMMAND = 3;
const PIXEL_HEADER_SIZE = 24;

export class TcpControllerGateway {
  constructor({ connectionTimeoutMs = 5000 } = {}) {
    this.connectionTimeoutMs = connectionTimeoutMs;
    this.connections = new Map();
    this.statuses = new Map();
  }

  async connect(controller) {
    const existing = this.connections.get(controller.id);
    if (existing?.readyState === 'open') {
      return existing;
    }

    const socket = net.createConnection({ host: controller.host, port: controller.port });
    socket.setNoDelay(true);
    this.connections.set(controller.id, socket);
    this.statuses.set(controller.id, { controllerId: controller.id, connected: false });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.destroy();
        this.statuses.set(controller.id, { controllerId: controller.id, connected: false });
        reject(new Error(`Connection timed out for controller ${controller.id}`));
      }, this.connectionTimeoutMs);

      socket.once('connect', () => {
        clearTimeout(timeout);
        this.statuses.set(controller.id, { controllerId: controller.id, connected: true });
        resolve();
      });
      socket.once('error', error => {
        clearTimeout(timeout);
        this.statuses.set(controller.id, { controllerId: controller.id, connected: false });
        reject(error);
      });
    });

    socket.on('close', () => {
      if (this.connections.get(controller.id) === socket) {
        this.connections.delete(controller.id);
        this.statuses.set(controller.id, { controllerId: controller.id, connected: false });
      }
    });

    return socket;
  }

  getStatus(controllerId) {
    return this.statuses.get(controllerId) ?? {
      controllerId,
      connected: false
    };
  }

  async sendFrame(controller, frame) {
    return this.sendFrames(controller, [frame]);
  }

  async sendFrames(controller, frames) {
    const socket = await this.connect(controller);
    for (const frame of frames) {
      await write(socket, encodePixelFrame(frame));
    }
  }

  disconnect(controllerId) {
    const socket = this.connections.get(controllerId);
    if (socket) {
      socket.end();
      this.connections.delete(controllerId);
    }
    this.statuses.set(controllerId, { controllerId, connected: false });
  }
}

export function encodePixelFrame(frame) {
  if (!Number.isFinite(frame.timestamp) || !Array.isArray(frame.pixels)) {
    throw new Error('Frame requires a numeric timestamp and pixel array');
  }

  const pixels = Buffer.alloc(frame.pixels.length * 3);
  frame.pixels.forEach((pixel, index) => {
    if (!Array.isArray(pixel) || pixel.length !== 3 || pixel.some(channel => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
      throw new Error(`Invalid RGB pixel at index ${index}`);
    }
    pixels[index * 3] = pixel[0];
    pixels[index * 3 + 1] = pixel[1];
    pixels[index * 3 + 2] = pixel[2];
  });

  const timestampMs = Math.max(0, Math.trunc(frame.timestamp));
  const header = Buffer.alloc(PIXEL_HEADER_SIZE);
  header.writeUInt16LE(PIXEL_DATA_COMMAND, 0);
  header.writeUInt16LE(frame.channelMask ?? 1, 2);
  header.writeUInt32LE(frame.pixels.length, 4);
  header.writeBigUInt64LE(BigInt(Math.floor(timestampMs / 1000)), 8);
  header.writeBigUInt64LE(BigInt((timestampMs % 1000) * 1000), 16);
  return Buffer.concat([header, pixels]);
}

function write(socket, data) {
  return new Promise((resolve, reject) => {
    socket.write(data, error => (error ? reject(error) : resolve()));
  });
}