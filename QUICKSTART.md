# LED-Central Quick Start

From a fresh Linux machine to an effect running across your controllers.

## 1. Requirements

- A Debian or Ubuntu machine on the same network as the controllers (tested
  on a Raspberry Pi 4 with Ubuntu 26.04 LTS and Node.js 22).
- One or more NightDriverStrip controllers on WiFi, with
  `INCOMING_WIFI_ENABLED` and the web server enabled (the default for the
  fork's builds). LED-Central sends frames to TCP port 49152 and reads
  statistics from the controller's web server on port 80.

## 2. Install

```bash
git clone git@github.com:lawrencek52/LED-Central.git
cd LED-Central
./setup-linux.sh
```

The script asks for your password when it needs `sudo`. It:

1. Installs Node.js if it is missing.
2. Installs the backend and frontend npm dependencies.
3. Creates `backend/.env` from `backend/.env.example` (the defaults bind to
   all interfaces on port 3001).
4. Installs and configures **chrony** so this machine serves NTP time to its
   local network. The network range comes from the interface with the default
   route, so it follows you to a different network. The controllers sync
   their clocks to this machine while it is sending them frames; that is what
   keeps effects in step across controllers.

Re-running the script is safe; it only changes what is out of date.

## 3. Run

```bash
make dev
```

This starts the backend API on port 3001 and the frontend on port 5173, and
logs both to `~/led-logs/` (set `LED_CENTRAL_LOG_DIR` to change that). Open
`http://<this-machine>:5173` from any browser on the network.

Check the API with:

```bash
curl http://localhost:3001/api/health
```

On the reference Raspberry Pi, a desktop autostart entry runs `make dev` at
login, so LED-Central comes back after a power cut. Stop the servers with
Ctrl+C, or kill the `nodemon` and `vite` processes.

## 4. Register a controller

On the **Controllers** tab, fill in the **Add controller** form: a name and
the host name (for example `deck1.local`) or IP address. Press **Detect from
device**: LED-Central reads the controller's strip count, each strip's LED
count and LED density, and whether it is a HUB75 matrix. Press **Register
controller**. Whether the controller has a microphone is checked when it
connects (**Recheck Audio** repeats the check).

If you later change a controller's strip lengths, open it again and detect
again; canvases keep the LED counts they were built with, so rebuild any
canvas that uses those strips too.

## 5. Build a canvas

On the **Canvases** tab, add a new canvas and add one mapping per strip:

- **Series**: strips end to end in one long row (a roofline).
- **Parallel**: strips side by side as rows of a wider surface (a deck rail of
  several strips). Set the *strip spacing ratio* to the distance between
  strips divided by the distance between LEDs along a strip, so effects that
  spread sideways, like Rocket Fireworks, stay round in real space.
- **Serpentine**: one strip folded into a matrix (a 16 x 16 panel). Pick the
  corner LED 0 is in and the direction of the first row.

Each mapping also has a position, rotation and direction (reversed).
Optionally set a *sound streamer* (an Arylic/LinkPlay device) for effects that
play sound, such as Halloween thunder. A strip can belong to only one canvas.

## 6. Run an effect

On the **Effects** tab, pick an effect in the effect library and adjust its
parameters and frame rate (they are remembered in this browser). Under **Run
effects**, each canvas has a row: choose the effect and press **Start**.
Starting another effect on the same canvas replaces the first; **Stop** ends
it. The **Status** tab shows what every canvas is doing, with a live preview
of each strip.

The **True random** / **Pseudo random (repeatable)** choice on the same tab
picks between a fresh random seed for every run (the default) and fixed seeds
that repeat exactly, for testing.

See [docs/EFFECTS.md](docs/EFFECTS.md) for what each effect does.

## Troubleshooting

- **A strip stays dark.** Check the controller's own web page: if it shows a
  local effect running, LED-Central's frames aren't arriving. The backend log
  (`~/led-logs/led-central-backend.log`) reports controllers going unreachable
  and reconnecting.
- **Effects aren't in step across controllers.** Each controller's
  `http://<controller>/statistics` shows `NTP_SOURCE`; it should read
  `led-central` while LED-Central drives it, with `NTP_OFFSET_MS` within a few
  milliseconds. If it reads `server`, check that chrony is running here and
  re-run `./setup-linux.sh`.
- **Port 3001 or 5173 is in use.** `lsof -i :3001` finds the process; or set
  `PORT` in `backend/.env`.
- **The UI can't reach the backend.** The UI talks to port 3001 on the same
  host name you opened it with, unless `VITE_API_URL` is set; make sure the
  backend is bound to `0.0.0.0` (the default).
