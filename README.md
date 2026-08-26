# LED-Central
Central controller for many NightDriverStrip Controllers

I have multiple NightDriverStrip controllers. Each controller can operate up to four
independent strips of LEDs. Each controller has a few build-in effects (or patterns)
for the strips of LEDs. The effects can be individually selected for each strip, or
one pattern can be used for all four strips of LEDs. The code for NightDriverStrip is
in the directory `../NightDriverStrip`

The NightDriverStrip program also has a build-in http server, a phone, a tablet,
or a laptop can connect to the server, the displayed web pages permit selecting the
effects on each of the strips of LEDs. However each controller has it's own web page
and the user must open a separate browser window to each controller to control all
of the LEDs.

The NightDriverStrip program can also receive effects on a socket at port 49152. The
effects are received one frame at a time and may be uncompressed, or in a compressed
format. Received effect frames are timestamped for when they should be displayed, and
multiple frames may be queued. Each effect frame is transferred to the LED strips at the
appropriate time, then nothing happens until the next frame is displayed.

Receiving effects over a web socket allows a higher level controller to build effects
that span multiple strips and multiple controllers. The goal of this program is to design
and build the higher level control into a program called LED-Central.

There is a program called NDSCPP in the directory `../NDSCPP` that can send effects to
each channel on a controller, or effects to multiple controllers. NDSCPP is the baseline
program that will be extended to build the LED-Central controller for all of the strip
controllers and all of the individual strips.

Start by copying the NDSCPP source code and configuration files for `vscode`, `PlatformIO`,
and any other relevant files into this LED-Central directory.

NDSCPP is configured by a file called `config.led`. The file `config.led` is a JSON file
which contains basic configuration information for the LED strips. Manually editing
`config.led` is too time consuming, hence instead of editing the file directly, the user
should be able to connect to a LED-Central HTTP server and select the effects, that are
sent to each strip on each controller. The NightDriverStrip program contains the code
for a HTTP server that controls one set of strips. Copy this HTTP server and extend it to
handle more than 4 strips, up to a maximum of 100 strips.

Groups of LED strips can be arranged to build a much larger canvas. LED-Control will need
a method (HTTP page) to configure the canvas. A canvas can be multiple LED strips in series
around the house, strips in parallel to create a wider canvas, or a combination of serial and
parallel LED strips. A canvas can also be an XY array of LEDs in series, the individual LEDs are
wired in a serpentine pattern where the data order is left to right across one row, then down
to the next row and across right to left and so on for all rows. The effects will need to be
drawn across an entire canvas rather than just a single LED strip.

The LED-Central server should be able to create any of the effects currently in both NDSCPP
and NightDriverStrip. In addition to these effects there are many effects in the program WLED
(see `../WLED`), and in the program FastLED (see `../FastLED`). The goal is to extract all of
the effects from WLED and FastLED and add them to the repertoire of LED-Central. The effects in
both WLED and FastLED have many more settings than the simpler effects in NDSCPP and
NightDriverStrip, hence the HTTP server will need to have pages dedicated to configuring the
more complex effects.

---

## Project Structure

```
LED-Central/
├── backend/              # Node.js/Express central server
│   ├── src/
│   │   └── server.js
│   ├── package.json
│   ├── .env.example
│   └── README.md
├── frontend/             # React + Vite web UI
│   ├── src/
│   ├── public/
│   ├── vite.config.js
│   ├── package.json
│   ├── .env.development
│   └── README.md
├── docs/                 # Project documentation
├── .vscode/              # VS Code workspace settings
├── scripts/              # Development helper scripts
├── .gitignore
├── Makefile              # Linux development commands
├── setup-linux.sh        # Automated Linux setup
├── QUICKSTART.md         # Quick start guide
├── LED-Central.code-workspace  # VS Code workspace
└── README.md            # This file
```

## Technology Stack

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Key Features**: RESTful API, CORS, Controller management
- **Communication**: HTTP, WebSocket

### Frontend
- **Framework**: React
- **Build Tool**: Vite
- **Linting**: Oxlint
- **API Client**: Axios

## Getting Started

### System Requirements

**This project is configured to run on Linux systems.**

- Ubuntu/Debian-based Linux (recommended)
- Linux kernel 4.4+
- 2GB RAM minimum
- Text editor or VS Code for development

### Prerequisites

- **Node.js >= 14.0**: `sudo apt install nodejs npm`
- **VS Code** (optional): `sudo snap install --classic code`

### Automated Setup (Recommended)

Run the Linux setup script to automatically install all dependencies:

```bash
./setup-linux.sh
```

This script will:
- Install Node.js if not already installed
- Install npm dependencies for backend and frontend
- Create `.env` configuration files

### Manual Setup Instructions

If you prefer manual setup:

#### 1. Install Backend Dependencies

```bash
cd backend
npm install
```

#### 2. Install Frontend Dependencies

```bash
cd frontend
npm install
```

### Running the Project

#### Terminal 1: Start Backend Server

```bash
cd backend
npm run dev
```

Server runs on `http://localhost:3001`

#### Terminal 2: Start Frontend Dev Server

```bash
cd frontend
npm run dev
```

UI available at `http://localhost:5173`

## API Documentation

See [backend/README.md](backend/README.md) for detailed API endpoints.

Backend configuration is loaded from `backend/.env`. Copy
`backend/.env.example` to `backend/.env`; values are validated at startup.
The supported settings are `NODE_ENV`, `HOST`, `PORT`, `API_TIMEOUT`,
`LOG_LEVEL`, and comma-separated `CORS_ORIGIN`.

Set `AUTH_TOKEN` to require bearer authentication for the HTTP API and browser
realtime WebSocket. See [backend/README.md](backend/README.md#authentication)
for request examples and the frontend token settings.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the system boundaries,
domain model, data flow, API direction, and implementation milestones.

## Component Descriptions

### Backend Server
- Central coordination point for all controllers
- Manages controller registry and status
- Distributes effects to multiple controllers
- RESTful API for frontend and external systems

### Frontend UI
- Dashboard for viewing all controllers
- Controller management (add, remove, configure)
- Effect library browser
- Canvas builder for creating multi-controller layouts
- Effect configuration and preview

## Development Workflow

1. **Backend Development**: Modify files in `backend/src/`, uses hot-reload with nodemon
2. **Frontend Development**: Modify React components in `frontend/src/`, hot-reload with Vite

## Next Milestones

- [ ] Effect distribution system
- [ ] WebSocket real-time control
- [ ] Effect library implementation
- [ ] Canvas configuration UI
- [ ] WLED/FastLED effect integration
- [ ] Database persistence
- [ ] User authentication
- [ ] Performance optimization

## Contributing

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) (to be created)

## License

See LICENSE file (to be created)

