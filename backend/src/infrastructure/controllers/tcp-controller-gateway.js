import net from "node:net";

const PIXEL_DATA_COMMAND = 3;
const PIXEL_HEADER_SIZE = 24;

export class TcpControllerGateway {
  constructor({ connectionTimeoutMs = 5000 } = {}) {
    this.connectionTimeoutMs = connectionTimeoutMs;
    this.connections = new Map();
    this.connectionPromises = new Map();
    this.sendQueues = new Map();
    this.statuses = new Map();
  }

  async connect(controller) {
    const existing = this.connections.get(controller.id);
    if (
      existing?.readyState === "open" &&
      !existing.destroyed &&
      existing.writable
    ) {
      return existing;
    }

    const pending = this.connectionPromises.get(controller.id);
    if (pending) return pending;

    const socket = net.createConnection({
      host: controller.host,
      port: controller.port,
    });
    socket.setNoDelay(true);
    this.connections.set(controller.id, socket);
    this.statuses.set(controller.id, {
      controllerId: controller.id,
      connected: false,
    });
    socket.on("error", () => {
      if (this.connections.get(controller.id) === socket) {
        this.connections.delete(controller.id);
        this.statuses.set(controller.id, {
          controllerId: controller.id,
          connected: false,
        });
      }
    });
    socket.on("close", () => {
      if (this.connections.get(controller.id) === socket) {
        this.connections.delete(controller.id);
        this.statuses.set(controller.id, {
          controllerId: controller.id,
          connected: false,
        });
      }
    });

    const connection = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.destroy();
        this.statuses.set(controller.id, {
          controllerId: controller.id,
          connected: false,
        });
        reject(
          new Error(`Connection timed out for controller ${controller.id}`),
        );
      }, this.connectionTimeoutMs);

      socket.once("connect", () => {
        clearTimeout(timeout);
        this.statuses.set(controller.id, {
          controllerId: controller.id,
          connected: true,
        });
        resolve(socket);
      });
      socket.once("error", (error) => {
        clearTimeout(timeout);
        this.statuses.set(controller.id, {
          controllerId: controller.id,
          connected: false,
        });
        reject(error);
      });
    }).finally(() => this.connectionPromises.delete(controller.id));
    this.connectionPromises.set(controller.id, connection);
    return connection;
  }

  getStatus(controllerId) {
    return (
      this.statuses.get(controllerId) ?? {
        controllerId,
        connected: false,
      }
    );
  }

  async sendFrame(controller, frame) {
    return this.sendFrames(controller, [frame]);
  }

  async sendFrames(controller, frames) {
    const previous = this.sendQueues.get(controller.id) ?? Promise.resolve();
    const send = previous
      .catch(() => {})
      .then(async () => {
        let socket = await this.connect(controller);
        for (const frame of frames) {
          const packet = encodePixelFrame(frame);
          for (let attempt = 0; attempt < 2; attempt += 1) {
            if (socket.destroyed || !socket.writable) {
              socket = await this.connect(controller);
            }
            try {
              await write(socket, packet);
              break;
            } catch (error) {
              socket.destroy();
              if (attempt === 1) throw error;
              socket = await this.connect(controller);
            }
          }
        }
      });
    this.sendQueues.set(controller.id, send);
    await send;
  }

  disconnect(controllerId) {
    const socket = this.connections.get(controllerId);
    if (socket) {
      socket.end();
      this.connections.delete(controllerId);
    }
    this.connectionPromises.delete(controllerId);
    this.statuses.set(controllerId, { controllerId, connected: false });
  }
}

export function encodePixelFrame(frame) {
  if (!Number.isFinite(frame.timestamp) || !Array.isArray(frame.pixels)) {
    throw new Error("Frame requires a numeric timestamp and pixel array");
  }

  const pixels = Buffer.alloc(frame.pixels.length * 3);
  frame.pixels.forEach((pixel, index) => {
    if (
      !Array.isArray(pixel) ||
      pixel.length !== 3 ||
      pixel.some(
        (channel) => !Number.isInteger(channel) || channel < 0 || channel > 255,
      )
    ) {
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
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Controller write timed out"));
    }, 5000);
    const finish = (error) => {
      clearTimeout(timeout);
      error ? reject(error) : resolve();
    };
    socket.once("close", () =>
      finish(new Error("Controller connection closed")),
    );
    socket.write(data, finish);
  });
}
