# LED-Central

LED-Central is a Linux-hosted control plane for multiple NightDriverStrip LED
controllers. It provides one browser interface for controller registration,
canvas layout, effect selection, playback, and live output status.

NightDriverStrip controllers receive timestamped RGB frames over raw TCP,
normally on port `49152`. LED-Central renders effects in a logical canvas,
maps that canvas to physical strips, and sends the resulting frames to the
configured controllers. The controller firmware remains in the sibling
`../NightDriverStrip` project.

## Current Features

- SQLite-backed controller, canvas, and effect configuration.
- Canvas layouts supporting series, parallel, serpentine, rotation, reversal,
  and multiple controllers.
- Built-in `solid`, `gradient`, and `wave` effects.
- Continuous playback with independent scheduling per canvas.
- A 100-frame look-ahead buffer, refilled with 50 frames while more than 50
   frames remain queued.
- Serialized TCP sends and reconnect handling per controller.
- Optional bearer-token authentication for the API and browser realtime socket.
- Status view showing each canvas, active effect, target FPS, mapped strips,
  queue depth, controller preview, receive FPS, draw FPS, and KiB/s.

## Project Structure

```text
LED-Central/
├── backend/       Node.js and Express API
├── frontend/      React and Vite operator UI
├── docs/          Architecture and Linux development notes
├── scripts/       Development helpers
├── Makefile
└── setup-linux.sh
```

## Requirements

- Linux, preferably Ubuntu or Debian
- Node.js and npm
- A NightDriverStrip controller reachable from the Linux host

## Setup

Run the automated setup:

```bash
./setup-linux.sh
```

Or install dependencies manually:

```bash
cd backend && npm install
cd ../frontend && npm install
```

## Development

Start both services:

```bash
make dev
```

The services are also available separately:

```bash
cd backend && npm run dev       # API on http://localhost:3001
cd frontend && npm run dev      # UI on http://localhost:5173
```

The helper script writes backend and frontend logs to
`/tmp/led-central-backend.log` and `/tmp/led-central-frontend.log`.

Run checks and builds:

```bash
make test
make build
```

For a LAN installation, configure the backend `HOST` as `0.0.0.0` and open
the frontend using the Linux host's LAN address. The frontend derives its API
host from the browser hostname unless `VITE_API_URL` is configured.

## Main UI Areas

The application opens on **Effect selection**. Tabs are ordered:

1. Effect selection: choose a canvas and effect, edit parameters, and start or
   stop playback.
2. Status: inspect active effects and controller output telemetry. This view
   refreshes once per second.
3. Canvas definition: create and map logical canvases to controller strips.
4. Controllers: register devices, edit strip counts, and connect or disconnect.

## Documentation

- [Backend API and configuration](backend/README.md)
- [Frontend development](frontend/README.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Linux development](docs/LINUX-DEVELOPMENT.md)
- [Quick start](QUICKSTART.md)
