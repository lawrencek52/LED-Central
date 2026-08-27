# LED-Central Frontend

React and Vite operator interface for LED-Central. The UI communicates with
the backend API; it does not connect directly to LED controllers.

## Install and Run

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production bundle in dist/
npm run preview   # serve the production bundle locally
npm run lint      # Oxlint
```

The backend should be running on port `3001`. The development UI can be opened
from another device on the LAN using the Linux host's address when the backend
is bound to `0.0.0.0`.

## Environment

The API client derives the backend host from the browser hostname by default.
These variables can override that behavior:

```text
VITE_API_URL=http://localhost:3001/api
VITE_WS_URL=ws://localhost:3001/api/realtime
VITE_API_TOKEN=
VITE_WS_TOKEN=
```

## UI Workflows

The page opens on **Effect selection**. The tabs are ordered Effect selection,
Status, Canvas definition, and Controllers.

- **Effect selection** chooses a canvas and effect, edits renderer parameters,
  and starts or stops playback.
- **Status** shows every canvas, its active effect and target FPS, plus each
  mapped strip's controller identity, address, preview, receive FPS, draw FPS,
  KiB/s, and queued frames. Status data refreshes every second and strip
  details stack on narrow displays.
- **Canvas definition** creates logical surfaces and maps them to physical
  controller strips with series, parallel, or serpentine layouts.
- **Controllers** registers devices, manages strip counts and LED counts, and
  connects or disconnects devices.

## Source Layout

```text
src/
├── App.jsx             Main shell, tabs, dashboard loading, and errors
├── CanvasBuilder.jsx   Canvas and strip mapping editor
├── EffectSelector.jsx  Effect selection and playback controls
├── Status.jsx          Live canvas, strip, preview, and telemetry view
├── api/
│   ├── client.js       REST client
│   └── realtime.js     Browser WebSocket client
├── App.css             Application layout and responsive styles
└── main.jsx            React entry point
```

The API client includes controller, canvas, effect, playback, health, and
status operations. The realtime client receives backend events and reconnects
with bounded backoff.
