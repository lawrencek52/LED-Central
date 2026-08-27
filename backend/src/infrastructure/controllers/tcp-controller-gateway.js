import net from "node:net";
import WebSocket from "ws";

const PIXEL_DATA_COMMAND = 3;
const PIXEL_HEADER_SIZE = 24;

export class TcpControllerGateway {
  constructor({ connectionTimeoutMs = 5000, webPort = 80 } = {}) {
    this.connectionTimeoutMs = connectionTimeoutMs;
    this.connections = new Map();
    this.connectionPromises = new Map();
    this.sendQueues = new Map();
    this.queueStates = new Map();
    this.statuses = new Map();
    this.webPort = webPort;
    this.previewStates = new Map();
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
              this.recordSent(controller.id, frame);
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

  recordSent(controllerId, frame) {
    const now = Date.now();
    const state = this.queueStates.get(controllerId) ?? {
      frames: [],
      sentAt: [],
    };
    state.frames = state.frames.filter((item) => item.timestamp > now);
    const channelMask = frame.channelMask ?? 1;
    state.frames.push({ timestamp: frame.timestamp, channelMask });
    state.sentAt = state.sentAt.filter((item) => item.at >= now - 1000);
    state.sentAt.push({ at: now, channelMask });
    this.queueStates.set(controllerId, state);
  }

  getQueueStatus(controllerId, channelMask = 1) {
    const now = Date.now();
    const state = this.queueStates.get(controllerId) ?? {
      frames: [],
      sentAt: [],
    };
    state.frames = state.frames.filter((item) => item.timestamp > now);
    state.sentAt = state.sentAt.filter((item) => item.at >= now - 1000);
    const sentAt = state.sentAt.filter(
      (item) => (item.channelMask & channelMask) !== 0,
    );
    return {
      queuedFrames: state.frames.filter(
        (item) => (item.channelMask & channelMask) !== 0,
      ).length,
      framesPerSecond: sentAt.length,
    };
  }

  getPreviewStatus(controller) {
    let state = this.previewStates.get(controller.id);
    if (!state) {
      state = {
        socket: null,
        width: 0,
        height: 0,
        frame: null,
        received: [],
        bytes: [],
        drawFps: 0,
        statsAt: 0,
      };
      this.previewStates.set(controller.id, state);
      this.connectPreview(controller, state);
    }
    if (Date.now() - state.statsAt >= 1000)
      this.refreshDynamicStats(controller, state);
    const now = Date.now();
    state.received = state.received.filter((at) => at >= now - 1000);
    state.bytes = state.bytes.filter((item) => item.at >= now - 1000);
    return {
      connected: state.socket?.readyState === WebSocket.OPEN,
      width: state.width,
      height: state.height,
      frame: state.frame?.toString("base64") ?? null,
      recvFps: state.received.length,
      drawFps: state.drawFps,
      kibPerSecond: Number(
        (
          state.bytes.reduce((total, item) => total + item.bytes, 0) / 1024
        ).toFixed(1),
      ),
    };
  }

  refreshDynamicStats(controller, state) {
    state.statsAt = Date.now();
    fetch(`http://${controller.host}:${this.webPort}/statistics/dynamic`)
      .then((response) => (response.ok ? response.json() : null))
      .then((stats) => {
        if (stats) state.drawFps = Number(stats.LED_FPS || 0);
      })
      .catch(() => {});
  }

  connectPreview(controller, state) {
    const socket = new WebSocket(
      `ws://${controller.host}:${this.webPort}/ws/frames`,
    );
    state.socket = socket;
    Promise.all([
      fetch(`http://${controller.host}:${this.webPort}/statistics/static`).then(
        (response) => (response.ok ? response.json() : null),
      ),
      fetch(
        `http://${controller.host}:${this.webPort}/statistics/dynamic`,
      ).then((response) => (response.ok ? response.json() : null)),
    ])
      .then(([staticStats, dynamicStats]) => {
        if (staticStats) {
          state.width = Number(
            staticStats.ACTIVE_MATRIX_WIDTH ||
              staticStats.CONFIGURED_MATRIX_WIDTH ||
              0,
          );
          state.height = Number(
            staticStats.ACTIVE_MATRIX_HEIGHT ||
              staticStats.CONFIGURED_MATRIX_HEIGHT ||
              0,
          );
        }
        if (dynamicStats) {
          state.drawFps = Number(dynamicStats.LED_FPS || 0);
          state.statsAt = Date.now();
        }
      })
      .catch(() => {});
    socket.binaryType = "arraybuffer";
    socket.on("message", (data) => {
      const frame = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (frame.length < 3) return;
      state.frame = frame;
      state.received.push(Date.now());
      state.bytes.push({ at: Date.now(), bytes: frame.length });
    });
    socket.on("close", () => {
      if (state.socket === socket) {
        state.socket = null;
        setTimeout(() => {
          if (!state.socket) this.connectPreview(controller, state);
        }, 1000);
      }
    });
    socket.on("error", () => {});
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
    const onClose = () => finish(new Error("Controller connection closed"));
    const finish = (error) => {
      clearTimeout(timeout);
      socket.removeListener("close", onClose);
      error ? reject(error) : resolve();
    };
    socket.once("close", onClose);
    socket.write(data, finish);
  });
}
