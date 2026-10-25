# LED-Central Backend

Node.js (22 tested) and Express. It stores the configuration in SQLite,
renders every effect frame, maps canvases onto physical strips, and sends
timestamped frames to NightDriverStrip controllers. See
[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for how the pieces fit.

## Run

```bash
npm install
npm run dev       # nodemon, restarts on source changes
npm start         # plain node
npm test          # Node test suite (uses a fake controller gateway)
```

The API is at `http://<host>:3001/api`.

## Configuration

Settings come from the environment or `backend/.env` (copy `.env.example`):

| Variable | Default | Meaning |
| - | - | - |
| `HOST` | `0.0.0.0` | Address to bind to |
| `PORT` | `3001` | API port |
| `NODE_ENV` | `development` | |
| `API_TIMEOUT` | `30000` | Request timeout, ms |
| `EFFECT_DATABASE_PATH` | `./data/led-central.db` | SQLite database |
| `SOUNDS_DIRECTORY` | `./media/sounds` | Clips served at `/sounds/<file>` to network speakers |
| `PUBLIC_BASE_URL` | `http://<LAN IPv4>:<PORT>` | How speakers reach `/sounds`; set it if the automatic LAN address is wrong |
| `AUTH_TOKEN` | empty | When set, every `/api` route needs `Authorization: Bearer <token>` |
| `LOG_LEVEL` | `info` | |
| `CORS_ORIGIN` | `*` | Comma-separated allowed origins |

Controllers are reached on TCP port 49152 for frames and on their web server
(port 80) for `/statistics`, `/ws/frames` (previews) and `/ws/audio`
(microphone telemetry).

## API

### Health and status

| Method | Path | |
| - | - | - |
| GET | `/api/health` | `{"status":"ok"}` |
| GET | `/api/status` | Every canvas: effect, target fps, and per strip its controller, queue depth, preview, receive fps, controller draw fps and throughput |
| GET | `/api/metrics` | Request metrics |

### Controllers

| Method | Path | |
| - | - | - |
| GET, POST | `/api/controllers` | List, register |
| POST | `/api/controllers/detect` | `{"host": "deck1.local"}`: read strip count, LED counts, LED density and matrix size from the controller |
| GET, PATCH, DELETE | `/api/controllers/:id` | |
| POST | `/api/controllers/:id/connect`, `/disconnect` | |
| POST | `/api/controllers/:id/recheck-audio` | Probe again for a microphone |
| POST | `/api/controllers/:id/preview/start`, `/preview/stop` | Stream `/ws/frames` for the Status tab |
| POST | `/api/controllers/:id/test` | Reserved; returns 501 |

A controller has 1-16 strips, each with an LED count and LED density.

### Canvases

| Method | Path | |
| - | - | - |
| GET, POST | `/api/canvases` | |
| GET, PUT, PATCH, DELETE | `/api/canvases/:id` | |
| POST | `/api/canvases/:id/alert-sound` | Test the weather-alert sound: `{"seconds": 1-60, "volume": 0-100}` |

A canvas has `name`, `width`, `height`, `mappings`, `stripSpacingRatio` and
`soundStreamer`. Each mapping has `controllerId`, a zero-based `stripIndex`,
`layout` (`series`, `parallel`, `serpentine`), `x`, `y`, `width`, `height`,
`rotation`, `reversed`, and for serpentine `originCorner` and `axis`. A strip
can belong to only one canvas.

### Effects, playback and settings

| Method | Path | |
| - | - | - |
| GET, POST | `/api/effects` | |
| GET, PATCH, DELETE | `/api/effects/:id` | PATCH renames (`name`) or reorders (`sortOrder`) |
| GET | `/api/playback` | Running sessions |
| POST | `/api/playback/start` | `{"canvasId", "effectId", "parameters", "fps"}`; replaces the canvas's current session |
| POST | `/api/playback/:id/stop` | |
| GET, PATCH | `/api/settings` | `{"trueRandom": true}` |

```bash
curl -X POST http://localhost:3001/api/playback/start \
  -H 'Content-Type: application/json' \
  -d '{"canvasId":"<id>","effectId":"nds-fire","parameters":{"palette":"blue"},"fps":30}'
```

Sessions keep 1.5 s of timestamped frames queued (2 frames for audio
effects) and are restored when the backend restarts.

### Raw frames

| Method | Path | |
| - | - | - |
| POST | `/api/distribution/frames` | Send a supplied batch of controller frames |
| POST | `/api/distribution/canvases/:id/frames` | `{"frame": {"timestamp", "pixels"}}`: map one canvas frame and send it |

### Realtime

WebSocket at `/api/realtime` (with `?token=` when `AUTH_TOKEN` is set):
events on the `controller`, `playback` and `distribution` topics.

## Source layout

```text
src/
├── api/             Express routers
├── application/     Playback, rendering, distribution, audio, weather, thunder, alerts, settings
├── domain/          Canvas mapping, effect definitions, matrix display helpers
├── infrastructure/  SQLite repositories, TCP gateway, host resolver, realtime, metrics
└── server.js        Composition and startup
media/sounds/        Sound clips (see its README for sources and licenses)
```
