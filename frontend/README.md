# LED-Central Frontend

React + Vite web interface for the LED-Central controller. Provides a modern UI for managing LED controllers, strips, effects, and creating complex LED canvases.

## Features

- Controller management dashboard
- Real-time effect preview
- Canvas configuration (serial, parallel, XY serpentine)
- Effect library browser and configuration
- Multi-strip effect composition

## Prerequisites

- Node.js >= 14.0
- npm or yarn
- Backend server running on localhost:3001

## Installation

```bash
npm install
```

## Development

Start the development server:

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Hot Module Replacement

Changes are automatically reflected in the browser as you develop.

## Building for Production

Create an optimized production build:

```bash
npm run build
```

Output files will be in the `dist/` directory.

## Preview Production Build

```bash
npm run preview
```

## Project Structure

```
frontend/
├── src/
│   ├── components/       # React components
│   │   ├── ControllerList.jsx
│   │   ├── EffectLibrary.jsx
│   │   ├── CanvasBuilder.jsx
│   │   └── EffectConfig.jsx
│   ├── pages/           # Page components
│   ├── services/        # API service layer
│   ├── hooks/           # Custom React hooks
│   ├── styles/          # CSS/styling
│   ├── App.jsx          # Root component
│   └── main.jsx         # Entry point
├── index.html           # HTML template
├── vite.config.js       # Vite configuration
├── package.json         # Dependencies
├── .env.development     # Dev environment variables
└── README.md           # This file
```

## Environment Variables

### Development (.env.development)

```
VITE_API_URL=http://localhost:3001/api
VITE_WS_URL=ws://localhost:3001/api/realtime
VITE_API_TOKEN=
VITE_WS_TOKEN=
```

## API Integration

The frontend communicates with the backend API:

- List controllers: `GET /api/controllers`
- Register controller: `POST /api/controllers`
- Get controller details: `GET /api/controllers/:id`
- Delete controller: `DELETE /api/controllers/:id`

## Key Pages

### Dashboard

Overview of all connected controllers and their status.

### Controllers

Manage controller registration, connection, and basic settings.

### Effects Library

Browse and configure available LED effects.

### Canvas Builder

Create complex LED layouts by combining multiple strips and controllers.

## Technologies

- **React** - UI framework
- **Vite** - Build tool
- **Axios** - HTTP client
- **Oxlint** - Code linting

## Next Steps

1. Implement controller dashboard with real-time status
2. Build effect library browser and configuration UI
3. Create canvas builder with visual layout editor
4. Add WebSocket support for real-time effect preview
5. Implement effect management and custom effects
6. Add user authentication and controller access control
