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
PORT=3001
API_TIMEOUT=30000
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
- `DELETE /api/controllers/:id` - Deregister a controller

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
