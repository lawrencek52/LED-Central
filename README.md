# LED-Central

LED-Central drives many NightDriverStrip LED controllers as one display. It
runs on a Linux machine (a Raspberry Pi 4 in the reference install), renders
effects onto *canvases* that span strips on several controllers, and streams
timestamped frames to each controller over WiFi. One browser UI replaces
opening every controller's own web page.

It is built on the work of [Dave Plummer](https://github.com/davepl) and the
NightDriver contributors; see [Credits](#credits).

## What it does

- **Canvases across controllers.** A canvas is a logical grid. Each strip is
  mapped onto it in series, in parallel, or as a serpentine matrix, with
  position, rotation and direction, so one effect can run across a deck rail
  made of eleven strips on three controllers.
- **39 effects**, including ports of NightDriverStrip's and NDSCPP's classics,
  audio-reactive effects fed by the controllers' microphones, holiday effects
  with thunder on a network speaker, and a weather display for HUB75 matrices.
  See [docs/EFFECTS.md](docs/EFFECTS.md).
- **Real-world geometry.** Effects read each strip's LED density (LEDs per
  meter, detected from the controller), so a fire or a meteor is the same
  physical size on a 30 LED/m strip as on a 60 LED/m one.
- **Synchronized playback.** Frames are rendered 1.5 s ahead and stamped with
  the time they should appear. Controllers sync their clocks to this machine
  over NTP while it drives them, so all of them show a frame within a few
  milliseconds of each other.
- **Resilience.** Playback survives controller reboots and WiFi dropouts and
  resumes on its own; running sessions are restored when LED-Central restarts.
- **Live status.** A Status tab shows every canvas with per-strip previews,
  receive and draw frame rates, throughput and queue depth.

## Tested hardware

| Role | Hardware | Notes |
| - | - | - |
| LED-Central host | Raspberry Pi 4 Model B, 8 GB | Ubuntu 26.04 LTS, Node.js 22, chrony as the LAN time server, on 5 GHz WiFi |
| Strip controller | Seeed XIAO ESP32-C5 | Deck1, Deck2, Garage: 4 channels of WS2812B-type strips, about 216 LEDs each at 60 LED/m (Garage: 2 x 120) |
| Strip controller | Seeed XIAO ESP32-S3 Sense on a custom carrier | Deck3: 3 strips of about 108 LEDs at 30 LED/m, PDM microphone for audio effects |
| Matrix controller | Seeed XIAO ESP32-S3 Sense | Matrix-16x16: one 16 x 16 WS2812B serpentine matrix (256 LEDs) |
| Matrix controller | Waveshare ESP32-S3-RGB-Matrix | Matrix-64x64 (one 64 x 64 HUB75 panel) and Matrix-128x64 (two chained panels); onboard microphones and speaker |
| Sound | Arylic S10+ network streamers | Thunder for the Halloween effect |

The controllers run the [NightDriverStrip fork](https://github.com/lawrencek52/NightDriverStrip)
that LED-Central was developed alongside. Its README lists the build
environment for each board. Stock NightDriverStrip firmware also accepts
LED-Central's frames, but per-strip lengths, LED density, clock sync with
LED-Central and the crash reports used by the Status tab come from the fork.

## Quick start

```bash
./setup-linux.sh   # installs Node.js and chrony if needed, npm dependencies, .env, LAN time server
make dev           # backend on :3001, frontend on :5173
```

Then open `http://<host>:5173`, register a controller (**Detect from device**
fills in its strips), build a canvas and start an effect. The
[Quick Start guide](QUICKSTART.md) walks through it.

## Project structure

```text
LED-Central/
├── backend/        Node.js + Express API, renderers, controller gateway, SQLite store
│   └── media/sounds/  Clips served to network speakers (thunder)
├── frontend/       React + Vite operator UI
├── docs/           Architecture, effects, Linux development notes, todo list
├── scripts/        dev-all.sh (runs both servers, logs to ~/led-logs), stock_server.py
├── Makefile
└── setup-linux.sh
```

## Documentation

- [Quick Start](QUICKSTART.md): install, first controller, first canvas, first effect
- [Effects](docs/EFFECTS.md): every effect and its parameters
- [Architecture](docs/ARCHITECTURE.md): how rendering, mapping, timing and delivery work
- [Backend](backend/README.md): API endpoints and configuration
- [Frontend](frontend/README.md): UI development
- [Linux development](docs/LINUX-DEVELOPMENT.md): tooling, debugging, troubleshooting
- [Todo list](docs/TODO.md): known open issues
- [Original project brief](Project-Setup.md): the August 2026 plan this grew from

## Credits

- **[NightDriverStrip](https://github.com/PlummersSoftwareLLC/NightDriverStrip)**
  by Dave Plummer and its contributors (Rutger van Bergen, Robert Lipe and
  many others) is the controller firmware LED-Central drives. Its wire
  protocol, timestamped frame buffering and many of its effects are the
  foundation of this project.
- **[NDSCPP](https://github.com/PlummersSoftwareLLC/NDSCPP)**, Dave Plummer's
  NightDriver server (with Rutger van Bergen and others), was LED-Central's
  starting point: the idea of a central server rendering canvases for many
  controllers, and the effects ported here with the `nds-` prefix.
- The Halloween effect's eyes and lightning are inspired by WLED's
  "Halloween Eyes" and "Lightning" effects (<https://github.com/wled/WLED>,
  building on Harm Aldick's WS2812FX); its default glow color is Trimlight's
  "Jack-O-Lantern Glow". No code was taken from either.
- Thunder clip: "Closeup Thunder Strike 01" by loganzsound on
  [freesound.org](https://freesound.org/people/loganzsound/sounds/840628/), CC0.
- Weather data: Environment and Climate Change Canada (weather.gc.ca) and the
  NRCan Geolocator, both free and key-less.
