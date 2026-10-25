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

The page opens on **Effects**. The tabs are Effects, Status, Canvases and
Controllers.

- **Effects**: under *Run effects*, one row per canvas to pick an effect and
  start, restart or stop it. The effect library beside it selects an effect to
  edit: its parameters and frame rate (kept in the browser's localStorage, per
  effect), its display name, and its place in the list (drag to reorder). The
  *True random* / *Pseudo random* setting is here too.
- **Status** shows every canvas, its active effect and target FPS, plus each
  mapped strip's controller identity, address, live preview, receive FPS,
  draw FPS, KiB/s and queued frames. It refreshes every second; strip details
  stack on narrow displays.
- **Canvases** creates logical surfaces and maps controller strips onto them
  in series, parallel or serpentine layouts, with the strip spacing ratio and
  an optional sound streamer.
- **Controllers** registers devices (*Detect from device* reads their strips
  from the controller), edits strip and LED counts, rechecks audio, and
  connects or disconnects them.

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
