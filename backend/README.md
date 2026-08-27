# LED-Central Backend

The backend is a Node.js/Express service that stores LED-Central configuration,
renders effects, maps canvases to physical strips, and sends timestamped frames
to NightDriverStrip controllers.

## Install and Run

```bash
npm install
npm run dev       # nodemon development server
npm start         # production-style server
npm test          # Node test suite
```

The default API address is `http://localhost:3001/api`.

## Configuration

Copy the example environment file when present:

```bash
cp .env.example .env
```

Supported settings include:

```text
NODE_ENV=development
HOST=0.0.0.0
PORT=3001
API_TIMEOUT=30000
EFFECT_DATABASE_PATH=./data/led-central.db
AUTH_TOKEN=
LOG_LEVEL=info
CORS_ORIGIN=http://localhost:5173
```

Controllers are configured with their raw TCP pixel port, normally `49152`.
For Status-tab previews and controller statistics, the gateway also contacts
the controller HTTP server on port `80`, including `/statistics/static`,
`/statistics/dynamic`, and `/ws/frames`.

## API

### Health and status

- `GET /api/health` - process health check.
- `GET /api/status` - canvas playback state and per-strip telemetry.
- `GET /api/metrics` - request and response metrics.

`/api/status` reports canvas name, active effect, target FPS, controller and
strip identity, queue depth, preview RGB data, preview receive FPS, controller
draw FPS (`LED_FPS`), and preview throughput in KiB/s.

### Controllers

- `GET /api/controllers`
- `POST /api/controllers`
- `GET /api/controllers/:id`
- `PATCH /api/controllers/:id`
- `POST /api/controllers/:id/connect`
- `POST /api/controllers/:id/disconnect`
- `POST /api/controllers/:id/test` (reserved; not implemented)
- `DELETE /api/controllers/:id`

Controller configuration supports 1-16 strips and one LED count per strip.

### Canvases

- `GET /api/canvases`
- `POST /api/canvases`
- `GET /api/canvases/:id`
- `PUT /api/canvases/:id`
- `DELETE /api/canvases/:id`

Canvas mappings use zero-based `stripIndex` values and support `series`,
`parallel`, and `serpentine` layouts, positions, dimensions, rotation, and
reversal. A physical controller strip can belong to only one canvas.

### Effects and playback

- `GET /api/effects`
- `POST /api/effects`
- `GET /api/effects/:id`
- `PATCH /api/effects/:id`
- `DELETE /api/effects/:id`
- `GET /api/playback`
- `POST /api/playback/start`
- `POST /api/playback/:id/stop`

Playback sessions are independent per canvas. Starting another effect on a
canvas stops its current session. Each session renders and sends 100 timestamped
frames ahead, then refills with 50 frames while more than 50 frames remain in
the look-ahead queue.

Example:

```bash
curl -X POST http://localhost:3001/api/playback/start \
  -H 'Content-Type: application/json' \
  -d '{"canvasId":"canvas-id","effectId":"wave","parameters":{"color":"#00ffff"}}'
```

### Distribution and realtime

- `POST /api/distribution/frames` - distribute a supplied frame batch.
- WebSocket `ws://localhost:3001/api/realtime` - browser commands and events.

The TCP gateway serializes connection and send operations per controller,
handles closed sockets, retries failed writes, and bounds stalled writes with a
timeout. The fake gateway is used by automated tests.

## Persistence and Source Layout

SQLite stores controllers, canvases, and effect definitions in the configured
database path. The main source areas are:

```text
src/
├── api/             Express route adapters
├── application/     Playback, rendering, distribution, and services
├── domain/          Canvas mapping and effect definitions
├── infrastructure/  SQLite, TCP gateway, metrics, and realtime adapters
└── server.js        Application composition and startup
```

When authentication is enabled, every `/api` route requires
`Authorization: Bearer <AUTH_TOKEN>`. The browser realtime client passes its
token in the WebSocket handshake query parameter.
