# LED-Central Backend

Central Node.js/Express server that manages multiple NightDriverStrip controllers and coordinates LED effects across them.

## Features

- Controller discovery and management
- RESTful API for controller configuration
- WebSocket support for real-time effect distribution
- CORS support for frontend communication
- Extensible architecture for effect management

## Prerequisites

- Node.js >= 14.0
- npm or yarn

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Configure:

```
NODE_ENV=development
HOST=127.0.0.1
PORT=3001
API_TIMEOUT=30000
LOG_LEVEL=info
CORS_ORIGIN=http://localhost:5173
```

## Running the Server

### Development mode (with auto-restart)

```bash
npm run dev
```

### Production mode

```bash
npm start
```

The server will start on `http://localhost:3001`

## API Endpoints

### Health & Status

- `GET /api/health` - Server health check

### Controllers

- `GET /api/controllers` - List all connected controllers
- `POST /api/controllers` - Register a new controller
- `GET /api/controllers/:id` - Get controller details
- `PATCH /api/controllers/:id` - Update controller name, host, or port
- `POST /api/controllers/:id/test` - Test controller connectivity (not yet implemented)
- `DELETE /api/controllers/:id` - Deregister a controller

### Effect Distribution

- `POST /api/distribution/frames` - Send timestamped frames to one or more controllers

Request body:

```json
{
  "controllerIds": ["controller-id"],
  "frames": [
    { "timestamp": 1700000000000, "pixels": [[255, 0, 0], [0, 0, 0]] }
  ]
}
```

The endpoint returns `202` when all targets accept the batch, `207` for a
partial delivery, and `503` when every target fails. Device protocol details
remain inside the controller gateway.

The gateway has two adapters: `TcpControllerGateway` sends NightDriverStrip's
raw TCP pixel packets, while `FakeControllerGateway`
records frames and simulates connection failures for tests. Both implement
`connect`, `disconnect`, `getStatus`, `sendFrame`, and `sendFrames`.

### Effect Library

- `GET /api/effects` - List stored effect definitions
- `POST /api/effects` - Create an effect definition
- `GET /api/effects/:id` - Get an effect definition
- `PATCH /api/effects/:id` - Update an effect definition
- `DELETE /api/effects/:id` - Delete an effect definition

Effect definitions are stored in SQLite at `EFFECT_DATABASE_PATH`. The first
startup seeds `solid`, `gradient`, and `wave` definitions. Parameters contain
renderer metadata and are intentionally separate from frame rendering.

### Persistent Controllers and Canvases

Controllers and canvases are stored in the same SQLite database. Canvases use
one-based revisions; send `If-Match-Revision` with `PUT` or `PATCH` to reject
updates based on stale configuration. Canvas mappings contain a `controllerId`
and zero-based `stripIndex`, with optional `rotation` and `reversed` fields.

### Realtime WebSocket

Connect a browser client to `ws://localhost:3001/api/realtime`. The server
sends `realtime.connected` immediately. Clients can send `ping`, subscribe or
unsubscribe messages with a `topics` array, and `effect.frames` commands using
the same `controllerIds` and `frames` fields as the REST endpoint. Distribution
events are published to clients subscribed to the `distribution` topic.

Successful responses contain JSON resources. Validation failures return `400`
with a `details` object, missing resources return `404`, and every API response
contains an `X-Request-Id` header for correlation.

### Controller Registration Example

```bash
curl -X POST http://localhost:3001/api/controllers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Kitchen LED",
    "host": "192.168.1.100",
    "port": 49152
  }'
```

## Project Structure

```
backend/
├── src/
│   ├── server.js         # Main Express server
│   ├── controllers/      # Controller management logic
│   ├── effects/          # Effect definitions and rendering
│   ├── routes/           # API route handlers
│   └── middleware/       # Custom middleware
├── package.json          # Dependencies
├── .env.example          # Environment template
└── README.md            # This file
```

## Architecture

### Controllers Map

Stores all registered controllers in memory with:
- Unique ID (UUID)
- Name, host, port
- Connection status
- Number of LED strips
- Last seen timestamp

## Next Steps

1. Implement effect distribution to controllers
2. Add WebSocket support for real-time effect streaming
3. Create effect library and management system
4. Add persistence (database) for controller registry
5. Implement authentication and authorization
6. Add comprehensive error handling and logging
