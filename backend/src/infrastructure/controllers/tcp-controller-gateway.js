import net from "node:net";
import zlib from "node:zlib";
import WebSocket from "ws";

const PIXEL_DATA_COMMAND = 3;
const PIXEL_HEADER_SIZE = 24;
// Matches SocketServer::ProcessCompletePacket's compressed-packet framing in
// the firmware (src/socketserver.cpp): a 16-byte wrapper - magic, compressed
// size, expanded size, then 4 reserved/padding bytes - around a zlib stream
// (uzlib on the receiving end only understands zlib's own header/checksum
// format, not raw deflate or gzip) that inflates back to exactly the
// standard, uncompressed packet built by encodePixelFrame().
const COMPRESSED_HEADER = 0x44415645; // ASCII "DAVE", read back little-endian
const COMPRESSED_HEADER_SIZE = 16;
// SocketServer::SendResponsePacket's SocketResponse (include/socketserver.h in
// the firmware): a packed little-endian struct sent back once per received
// pixel packet, size first. wifiSignal is the controller's own RSSI (dBm).
const SOCKET_RESPONSE_SIZE = 72;
const SOCKET_RESPONSE_WIFI_SIGNAL_OFFSET = 48;

// Consumes whole SocketResponse packets from `buffer`, calling onResponse for
// each, and returns the unconsumed tail. A size field that isn't a
// SocketResponse means the stream is out of step, so the rest is discarded
// rather than misread - the next packet boundary resyncs it.
export function consumeSocketResponses(buffer, onResponse) {
  let offset = 0;
  while (buffer.length - offset >= 4) {
    if (buffer.readUInt32LE(offset) !== SOCKET_RESPONSE_SIZE) {
      return Buffer.alloc(0);
    }
    if (buffer.length - offset < SOCKET_RESPONSE_SIZE) break;
    onResponse({
      wifiSignal: buffer.readDoubleLE(offset + SOCKET_RESPONSE_WIFI_SIGNAL_OFFSET),
    });
    offset += SOCKET_RESPONSE_SIZE;
  }
  return buffer.subarray(offset);
}

function logControllerEvent(message) {
  console.log(`${new Date().toISOString()} [controller] ${message}`);
}

export class TcpControllerGateway {
  constructor({
    connectionTimeoutMs = 5000,
    webPort = 80,
    reconnectDelayMs = 1000,
  } = {}) {
    this.connectionTimeoutMs = connectionTimeoutMs;
    this.reconnectDelayMs = reconnectDelayMs;
    // Connection keys whose last connect attempt failed, mapped to the
    // earliest time another background attempt may start - see
    // sendChannelFrames().
    this.offlineUntil = new Map();
    this.connections = new Map();
    this.connectionPromises = new Map();
    this.sendQueues = new Map();
    this.queueStates = new Map();
    this.statuses = new Map();
    this.webPort = webPort;
    this.previewStates = new Map();
    this.audioStates = new Map();
    this.controllerStats = new Map();
    // Latest RSSI each controller reported in its SocketResponses.
    this.wifiSignals = new Map();
    // Controllers currently in an outage (a connect or socket error since
    // their last successful connect), mapped to { since, error } - only used
    // to log each outage once, when it starts and when it ends.
    this.outages = new Map();
  }

  describeController(controller) {
    return `${controller.name ?? controller.id} (${controller.host})`;
  }

  recordFailure(controller, error) {
    if (this.outages.has(controller.id)) return;
    const reason = error?.code ?? error?.message ?? "unknown error";
    this.outages.set(controller.id, { since: Date.now() });
    const signal = this.wifiSignals.get(controller.id);
    logControllerEvent(
      `${this.describeController(controller)} unreachable: ${reason}` +
        (signal ? `; last WiFi signal ${signal.rssi} dBm` : ""),
    );
  }

  recordConnected(controller) {
    const outage = this.outages.get(controller.id);
    if (!outage) return;
    this.outages.delete(controller.id);
    const seconds = Math.round((Date.now() - outage.since) / 1000);
    logControllerEvent(
      `${this.describeController(controller)} reconnected after ${seconds}s`,
    );
  }

  getWifiSignal(controllerId) {
    return this.wifiSignals.get(controllerId)?.rssi ?? null;
  }

  // Connections are keyed per (controller, channel) rather than per controller
  // alone, so each strip gets its own TCP connection. The firmware's
  // SocketServer already multiplexes independent clients (MAX_CLIENTS =
  // NUM_CHANNELS + 2, see socketserver.h) - one connection per channel lets a
  // stall reading/acking one strip's frames (seen live on 2026-09-06: ~1.5-2%
  // of writes stalling 100ms-1.6s, plausibly a WiFi-side hiccup rather than a
  // firmware one) freeze just that strip instead of blocking every other
  // strip on the same controller behind it in one shared FIFO. `channelKey`
  // defaults to a "probe" pseudo-channel for plain connectivity checks
  // (startup bring-up, manual reconnect) that aren't tied to any strip.
  connectionKey(controllerId, channelKey) {
    return `${controllerId}::${channelKey}`;
  }

  async connect(controller, channelKey = "probe") {
    const key = this.connectionKey(controller.id, channelKey);
    const existing = this.connections.get(key);
    if (
      existing?.readyState === "open" &&
      !existing.destroyed &&
      existing.writable
    ) {
      return existing;
    }

    const pending = this.connectionPromises.get(key);
    if (pending) return pending;

    const socket = net.createConnection({
      host: controller.host,
      port: controller.port,
    });
    socket.setNoDelay(true);
    // The firmware sends a small SocketResponse packet back on this same
    // socket for every pixel frame it receives ("this is how it paces
    // itself" - see NightDriverStrip's SendResponsePacket). Not used for
    // pacing here, only for the controller's reported WiFi signal - but it
    // must be read regardless: left in Node's default paused mode (no 'data'
    // listener), those bytes just accumulate unread.
    let unparsed = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      unparsed = consumeSocketResponses(
        unparsed.length ? Buffer.concat([unparsed, chunk]) : chunk,
        ({ wifiSignal }) => {
          if (Number.isFinite(wifiSignal) && wifiSignal !== 0) {
            this.wifiSignals.set(controller.id, {
              rssi: Math.round(wifiSignal),
              at: Date.now(),
            });
          }
        },
      );
    });
    this.connections.set(key, socket);
    this.statuses.set(key, {
      controllerId: controller.id,
      connected: false,
    });
    socket.on("error", (error) => {
      this.recordFailure(controller, error);
      if (this.connections.get(key) === socket) {
        this.connections.delete(key);
        this.statuses.set(key, {
          controllerId: controller.id,
          connected: false,
        });
      }
    });
    socket.on("close", () => {
      if (this.connections.get(key) === socket) {
        this.connections.delete(key);
        this.statuses.set(key, {
          controllerId: controller.id,
          connected: false,
        });
      }
    });

    const connection = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.destroy();
        this.statuses.set(key, {
          controllerId: controller.id,
          connected: false,
        });
        const error = new Error(
          `Connection timed out for controller ${controller.id}`,
        );
        error.code = "ETIMEDOUT";
        this.recordFailure(controller, error);
        reject(error);
      }, this.connectionTimeoutMs);

      socket.once("connect", () => {
        clearTimeout(timeout);
        this.offlineUntil.delete(key);
        this.recordConnected(controller);
        this.statuses.set(key, {
          controllerId: controller.id,
          connected: true,
        });
        resolve(socket);
      });
      socket.once("error", (error) => {
        clearTimeout(timeout);
        this.statuses.set(key, {
          controllerId: controller.id,
          connected: false,
        });
        reject(error);
      });
    })
      .catch((error) => {
        this.offlineUntil.set(key, Date.now() + this.reconnectDelayMs);
        throw error;
      })
      .finally(() => this.connectionPromises.delete(key));
    this.connectionPromises.set(key, connection);
    return connection;
  }

  // Connected if any of this controller's connections (probe or per-channel)
  // is currently up - callers only care whether the controller is reachable
  // at all, not which specific channel socket is open.
  getStatus(controllerId) {
    const prefix = this.connectionKey(controllerId, "");
    for (const [key, status] of this.statuses) {
      if (key.startsWith(prefix) && status.connected) {
        return { controllerId, connected: true };
      }
    }
    return { controllerId, connected: false };
  }

  async sendFrame(controller, frame) {
    return this.sendFrames(controller, [frame]);
  }

  // Frames are grouped by channel and sent concurrently, one dedicated
  // connection and FIFO queue per channel, instead of one shared connection
  // serializing every strip's writes. See connect() above for why.
  async sendFrames(controller, frames) {
    const byChannel = new Map();
    for (const frame of frames) {
      const channelMask = frame.channelMask ?? 1;
      if (!byChannel.has(channelMask)) byChannel.set(channelMask, []);
      byChannel.get(channelMask).push(frame);
    }
    await Promise.all(
      [...byChannel.entries()].map(([channelMask, channelFrames]) =>
        this.sendChannelFrames(controller, channelMask, channelFrames),
      ),
    );
  }

  // Once a channel's connect has failed (controller rebooting, off the
  // network, etc.), later sends fail fast while a reconnect runs in the
  // background, rather than each one awaiting a fresh connect attempt. A
  // playback tick awaits every controller on the canvas, so blocking here for
  // up to connectionTimeoutMs per tick froze every *other* controller on the
  // canvas for as long as the missing one stayed down (seen live on
  // 2026-10-03 rebooting Deck1: repeated 5-8s whole-canvas freezes).
  async sendChannelFrames(controller, channelMask, frames) {
    const key = this.connectionKey(controller.id, channelMask);
    const previous = this.sendQueues.get(key) ?? Promise.resolve();
    const send = previous
      .catch(() => {})
      .then(async () => {
        if (this.offlineUntil.has(key)) {
          if (
            Date.now() >= this.offlineUntil.get(key) &&
            !this.connectionPromises.has(key)
          ) {
            this.connect(controller, channelMask).catch(() => {});
          }
          throw new Error(
            `Controller ${controller.id} is offline, reconnecting`,
          );
        }
        let socket = await this.connect(controller, channelMask);
        for (const frame of frames) {
          const raw = encodePixelFrame(frame);
          const compressed = encodeCompressedPacket(raw);
          const packet = compressed.length < raw.length ? compressed : raw;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            if (socket.destroyed || !socket.writable) {
              socket = await this.connect(controller, channelMask);
            }
            try {
              await write(socket, packet);
              this.recordSent(controller.id, frame, packet.length);
              break;
            } catch (error) {
              socket.destroy();
              if (attempt === 1) throw error;
              socket = await this.connect(controller, channelMask);
            }
          }
        }
      });
    this.sendQueues.set(key, send);
    await send;
  }

  recordSent(controllerId, frame, bytes = 0) {
    const now = Date.now();
    const state = this.queueStates.get(controllerId) ?? {
      frames: [],
      sentAt: [],
      latestFrames: new Map(),
    };
    state.latestFrames ??= new Map();
    state.frames = state.frames.filter((item) => item.timestamp > now);
    const channelMask = frame.channelMask ?? 1;
    state.frames.push({ timestamp: frame.timestamp, channelMask });
    state.latestFrames.set(channelMask, {
      timestamp: frame.timestamp,
      pixels: frame.pixels,
    });
    state.sentAt = state.sentAt.filter((item) => item.at >= now - 1000);
    state.sentAt.push({ at: now, channelMask, bytes });
    this.queueStates.set(controllerId, state);
  }

  getQueueStatus(controllerId, channelMask = 1) {
    const now = Date.now();
    const state = this.queueStates.get(controllerId) ?? {
      frames: [],
      sentAt: [],
      latestFrames: new Map(),
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
      kibPerSecond: Number(
        (sentAt.reduce((total, item) => total + item.bytes, 0) / 1024).toFixed(1),
      ),
      // Distinct channels this controller has been sent frames on in the
      // last second - its PACKETS_RX counter is shared across all of them.
      activeChannels: new Set(state.sentAt.map((item) => item.channelMask)).size,
      latestFrame: state.latestFrames.get(channelMask) ?? null,
    };
  }

  // The controller's own view of playback, from its /statistics/dynamic:
  // how many pixel packets it's actually receiving per second (PACKETS_RX is
  // a running total across every channel, so this is a delta between polls)
  // and how fast it's drawing (LED_FPS). Unlike the preview stats below this
  // needs no WebSocket, so it's available whether or not a preview is open.
  // Pure read of the last poll; a refresh is kicked off in the background at
  // most once a second, only while something (the Status page) is asking.
  // Asks the controller to ring its speaker (the Mitel warble - see the
  // firmware's /speaker/warble). Controllers without a speaker answer 404.
  async ringAlert(controller, seconds = 12) {
    const response = await fetch(
      `http://${controller.host}:${this.webPort}/speaker/warble?seconds=${encodeURIComponent(seconds)}`,
      { method: "POST", signal: AbortSignal.timeout(this.connectionTimeoutMs) },
    );
    return response.status;
  }

  getControllerStats(controller) {
    const state = this.controllerStats.get(controller.id) ?? {
      fetchedAt: 0,
      inFlight: false,
      packetsRx: null,
      receivedPerSecond: null,
      drawFps: null,
    };
    this.controllerStats.set(controller.id, state);
    if (!state.inFlight && Date.now() - state.fetchedAt >= 1000) {
      state.inFlight = true;
      fetch(`http://${controller.host}:${this.webPort}/statistics/dynamic`, {
        signal: AbortSignal.timeout(this.connectionTimeoutMs),
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((stats) => {
          const now = Date.now();
          const packetsRx = Number(stats?.PACKETS_RX);
          if (!stats || !Number.isFinite(packetsRx)) {
            state.receivedPerSecond = null;
            state.drawFps = stats ? Number(stats.LED_FPS || 0) : null;
            state.packetsRx = null;
          } else {
            // A counter that went backwards means the controller rebooted.
            state.receivedPerSecond =
              state.packetsRx !== null && packetsRx >= state.packetsRx
                ? ((packetsRx - state.packetsRx) * 1000) /
                  Math.max(1, now - state.fetchedAt)
                : state.receivedPerSecond;
            state.packetsRx = packetsRx;
            state.drawFps = Number(stats.LED_FPS || 0);
          }
          state.fetchedAt = now;
        })
        .catch(() => {
          state.fetchedAt = Date.now();
          state.packetsRx = null;
          state.receivedPerSecond = null;
          state.drawFps = null;
        })
        .finally(() => {
          state.inFlight = false;
        });
    }
    return {
      receivedPerSecond: state.receivedPerSecond,
      drawFps: state.drawFps,
      wifiSignal: this.getWifiSignal(controller.id),
    };
  }

  // Previews are opt-in: getPreviewStatus() is a pure read that no longer
  // has the side effect of opening a connection. Something must call
  // startPreview() first (mirroring the firmware's own web UI, which only
  // opens /ws/frames while its preview panel is actually visible) - without
  // that, this was keeping a frame-preview WebSocket open to every
  // controller with an active canvas mapping for the lifetime of the
  // backend process, regardless of whether anyone was looking, since the
  // 1s status poll (Status.jsx) called this unconditionally for every strip.
  getPreviewStatus(controller) {
    const state = this.previewStates.get(controller.id);
    if (!state) {
      return {
        active: false,
        connected: false,
        width: 0,
        height: 0,
        frame: null,
        recvFps: 0,
        drawFps: 0,
        kibPerSecond: 0,
      };
    }
    if (Date.now() - state.statsAt >= 1000)
      this.refreshDynamicStats(controller, state);
    const now = Date.now();
    state.received = state.received.filter((at) => at >= now - 1000);
    state.bytes = state.bytes.filter((item) => item.at >= now - 1000);
    return {
      active: true,
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

  // Idempotent: safe to call repeatedly while a preview panel stays open.
  startPreview(controller) {
    let state = this.previewStates.get(controller.id);
    if (state?.active) return;
    state = {
      active: true,
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

  stopPreview(controllerId) {
    const state = this.previewStates.get(controllerId);
    if (!state) return;
    state.active = false;
    this.previewStates.delete(controllerId);
    state.socket?.close();
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
          if (!state.socket && state.active) this.connectPreview(controller, state);
        }, 1000);
      }
    });
    socket.on("error", () => {});
  }

  // Reads a device's actual topology from its own /statistics/static so the
  // "add controller" form can be prefilled instead of asking the user to
  // guess strip count/LED count - especially important for HUB75 boards,
  // where "LEDs per strip" doesn't map to anything the firmware has (the
  // whole matrix is one channel; see ACTIVE_OUTPUT_DRIVER === "hub75").
  async detectCapabilities(host) {
    const response = await fetch(
      `http://${host}:${this.webPort}/statistics/static`,
      { signal: AbortSignal.timeout(this.connectionTimeoutMs) },
    );
    if (!response.ok)
      throw new Error(`Device responded with HTTP ${response.status}`);

    const stats = await response.json();
    const ledCounts =
      Array.isArray(stats.ACTIVE_STRIP_LENGTHS) &&
      stats.ACTIVE_STRIP_LENGTHS.length > 0
        ? stats.ACTIVE_STRIP_LENGTHS.map(Number)
        : [Number(stats.ACTIVE_NUM_LEDS) || 0];
    // Older firmware doesn't report this stat at all - every strip gets 0 ("unknown density"),
    // which every downstream consumer (canvas mapping snapshot, effect-render-service) already
    // treats as "no physical-scale correction, today's behavior".
    const ledsPerMeter = Array.isArray(stats.ACTIVE_LEDS_PER_METER)
      ? ledCounts.map((_, index) => Number(stats.ACTIVE_LEDS_PER_METER[index]) || 0)
      : ledCounts.map(() => 0);

    return {
      driver: stats.ACTIVE_OUTPUT_DRIVER ?? null,
      layout: stats.ACTIVE_LAYOUT ?? null,
      numChannels: Number(stats.ACTIVE_NUM_CHANNELS) || ledCounts.length,
      ledCounts,
      ledsPerMeter,
      matrixWidth:
        stats.ACTIVE_MATRIX_WIDTH != null
          ? Number(stats.ACTIVE_MATRIX_WIDTH)
          : null,
      matrixHeight:
        stats.ACTIVE_MATRIX_HEIGHT != null
          ? Number(stats.ACTIVE_MATRIX_HEIGHT)
          : null,
    };
  }

  probeAudioSupport(controller) {
    return fetch(`http://${controller.host}:${this.webPort}/statistics/static`)
      .then((response) => (response.ok ? response.json() : null))
      .then((stats) => {
        const available = Boolean(stats?.AUDIO_SOCKET);
        this.setAudioAvailable(controller.id, available);
        if (available) this.connectAudioSocket(controller);
        return available;
      })
      .catch(() => {
        this.setAudioAvailable(controller.id, false);
        return false;
      });
  }

  setAudioAvailable(controllerId, available) {
    const state = this.audioStates.get(controllerId) ?? {};
    state.available = available;
    state.checkedAt = Date.now();
    this.audioStates.set(controllerId, state);
  }

  connectAudioSocket(controller) {
    const socket = new WebSocket(
      `ws://${controller.host}:${this.webPort}/ws/audio`,
    );
    const state = this.audioStates.get(controller.id) ?? {
      available: true,
      checkedAt: Date.now(),
    };
    state.socket = socket;
    state.received ??= [];
    this.audioStates.set(controller.id, state);
    socket.on("message", (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        const receivedAt = Date.now();
        state.latest = { ...parsed, receivedAt };
        state.received.push(receivedAt);
        state.received = state.received.filter((at) => at >= receivedAt - 1000);
      } catch {
        // Ignore malformed telemetry frames.
      }
    });
    socket.on("close", () => {
      if (state.socket === socket) {
        state.socket = null;
        setTimeout(() => {
          if (!state.socket && state.available) this.connectAudioSocket(controller);
        }, 1000);
      }
    });
    socket.on("error", () => {});
  }

  getAudioStatus(controllerId) {
    const state = this.audioStates.get(controllerId);
    return {
      available: state?.available ?? "unknown",
      checkedAt: state?.checkedAt ?? null,
    };
  }

  getAudioTelemetry(controllerId) {
    return this.audioStates.get(controllerId)?.latest ?? null;
  }

  // Messages received in roughly the last second, i.e. the controller's
  // actual measured telemetry push rate (up to ~60Hz per the firmware, but
  // varies with its own AUDIO_FPS) - used to pace playback so audio-reactive
  // effects render at the same cadence the data is actually arriving at,
  // rather than a fixed default that could over- or under-sample it.
  getAudioTelemetryRate(controllerId) {
    const state = this.audioStates.get(controllerId);
    if (!state?.received) return 0;
    const now = Date.now();
    state.received = state.received.filter((at) => at >= now - 1000);
    return state.received.length;
  }

  disconnect(controllerId) {
    const prefix = this.connectionKey(controllerId, "");
    for (const [key, socket] of this.connections) {
      if (key.startsWith(prefix)) {
        socket.end();
        this.connections.delete(key);
      }
    }
    for (const key of [...this.connectionPromises.keys()]) {
      if (key.startsWith(prefix)) this.connectionPromises.delete(key);
    }
    for (const key of [...this.statuses.keys()]) {
      if (key.startsWith(prefix)) this.statuses.delete(key);
    }
    for (const key of [...this.offlineUntil.keys()]) {
      if (key.startsWith(prefix)) this.offlineUntil.delete(key);
    }
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

// Wraps an already-encoded packet (as built by encodePixelFrame) in the
// firmware's compressed-packet framing, so a mostly-uniform frame (a mostly
// black canvas, a solid-color wash, etc.) costs a fraction of its raw RGB
// size on the wire. Only worth it above the wrapper's own fixed overhead, so
// callers should fall back to the raw packet when the packet is tiny (e.g. a
// near-empty canvas) or when compression didn't actually help (already
// high-entropy pixel data can come back slightly larger than the input).
export function encodeCompressedPacket(packet) {
  const compressed = zlib.deflateSync(packet);
  const wrapper = Buffer.alloc(COMPRESSED_HEADER_SIZE);
  wrapper.writeUInt32LE(COMPRESSED_HEADER, 0);
  wrapper.writeUInt32LE(compressed.length, 4);
  wrapper.writeUInt32LE(packet.length, 8);
  return Buffer.concat([wrapper, compressed]);
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
