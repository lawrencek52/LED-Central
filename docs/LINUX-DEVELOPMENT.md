# LED-Central Linux Development Guide

This project is configured specifically for Linux systems. All tools, scripts, and commands are optimized for Linux/Ubuntu environments.

## System Requirements

- **OS**: Linux (Ubuntu/Debian recommended)
- **Kernel**: 4.4 or later
- **RAM**: 2GB minimum (4GB recommended for comfortable development)
- **Disk**: 2GB free space for dependencies and builds

## Supported Linux Distributions

- Ubuntu 18.04 LTS or later
- Debian 10 (Buster) or later
- Linux Mint 19 or later
- Elementary OS 5 or later
- Other Debian/Ubuntu-based distributions

## Quick Setup

### One-Command Setup (Recommended)

```bash
./setup-linux.sh
```

This script automatically:
- Installs Node.js if not present
- Installs all npm dependencies
- Creates `.env` configuration files

### Alternative: Using Make

If you prefer using Make commands:

```bash
make setup      # Run setup script
make install    # Install just npm dependencies
make dev        # Start both backend and frontend
make build      # Build all components
```

## Development Workflows

### Starting Development Servers

#### Option 1: Using Make (Easiest)
```bash
make dev
```
This starts both backend and frontend servers simultaneously.

#### Option 2: Using the helper script
```bash
./scripts/dev-all.sh
```

#### Option 3: Manual in separate terminals
Terminal 1:
```bash
cd backend
npm run dev
```

Terminal 2:
```bash
cd frontend
npm run dev
```

### Available Make Commands

```bash
make help               # Show all available commands
make setup              # Run automated setup (installs everything)
make install            # Install npm dependencies only
make dev                # Start backend + frontend dev servers
make dev-backend        # Start backend only
make dev-frontend       # Start frontend only
make build              # Build frontend for production
make ports              # Show what's running on common ports
make clean              # Remove build artifacts
make test               # Run tests (when configured)
make info               # Show development environment info
```

## Port Management

Common ports used by LED-Central:

| Port | Service | URL |
|------|---------|-----|
| 3001 | Backend API | `http://localhost:3001/api` |
| 5173 | Frontend Dev | `http://localhost:5173` |

Check if a port is in use:
```bash
lsof -i :3001          # Check port 3001
```

Kill a process using a port:
```bash
# Find PID
lsof -i :3001 | grep LISTEN | awk '{print $2}'

# Kill it
kill -9 <PID>
```

## Environment Configuration

### Backend (.env)

Copy the example and customize:
```bash
cp backend/.env.example backend/.env
nano backend/.env
```

Available options:
```
NODE_ENV=development          # development or production
PORT=3001                     # Server port
API_TIMEOUT=30000            # Request timeout in ms
LOG_LEVEL=info               # Logging level
CORS_ORIGIN=http://localhost:5173  # Frontend URL
```

### Frontend (.env.development)

Already configured for local development:
```
VITE_API_URL=http://localhost:3001/api
VITE_WS_URL=ws://localhost:49152
```

## Debugging

### Backend Debugging in VS Code

Add to `.vscode/launch.json`:
```json
{
  "type": "node",
  "request": "launch",
  "name": "Backend",
  "program": "${workspaceFolder:Backend (Node.js)}/src/server.js",
  "restart": true,
  "console": "integratedTerminal"
}
```

Then press F5 to debug.

### Frontend Debugging

Use VS Code + Vite debugger:
1. Open browser DevTools (F12)
2. Set breakpoints in Sources tab
3. Refresh page to hit breakpoints

### Logs

Backend logs are saved to:
```bash
tail -f /tmp/led-central-backend.log
```

Frontend logs appear in browser console (F12).

## Performance Tips

### Development Mode

- Use `npm run dev` for fast rebuilds with hot reload
- Don't modify `node_modules` - reinstall if issues occur
- Keep `.env` files updated with your configuration

### Production Build

```bash
cd frontend
npm run build
# Outputs to frontend/dist/
```

## Cleanup and Maintenance

### Remove build artifacts:
```bash
make clean
```

### Reinstall dependencies (if corrupted):
```bash
make clean
make install
```

### Update dependencies to latest versions:
```bash
cd backend
npm update

cd ../frontend
npm update
```

## Integration with VS Code

1. Install recommended extensions:
   - Open Extensions (Ctrl+Shift+X)
   - Search "LED-Central"
   - Install all recommended extensions from `.vscode/extensions.json`

2. Open workspace:
   ```bash
   code LED-Central.code-workspace
   ```

3. Run tasks: Ctrl+Shift+P → "Run Task"

## Troubleshooting

### Port Already in Use

```bash
# Find what's using the port
lsof -i :3001

# Kill it
kill -9 <PID>

# Or use a different port
PORT=3002 npm run dev
```

### npm install fails

```bash
# Clear npm cache
npm cache clean --force

# Remove node_modules
rm -rf node_modules package-lock.json

# Reinstall
npm install
```

### ES6 module errors

Ensure backend `package.json` has:
```json
{
  "type": "module",
  ...
}
```

### Frontend won't start

```bash
# Check if port 5173 is in use
lsof -i :5173

# Clear Vite cache
rm -rf frontend/.vite

# Reinstall
cd frontend
npm install
npm run dev
```

## Next Steps

1. Run `./setup-linux.sh` or `make setup`
2. Start development with `make dev`
3. Open http://localhost:5173 in browser
4. Test API with `curl http://localhost:3001/api/health`

## Resources

- [Node.js Documentation](https://nodejs.org/en/docs/)
- [React Documentation](https://react.dev/)
- [Vite Documentation](https://vitejs.dev/)
- [Express.js Documentation](https://expressjs.com/)

## Getting Help

- Check individual component README files
- Review logs: `tail -f /tmp/led-central-*.log`
- Examine `.vscode/settings.json` for IDE configuration
- Visit project repository for issues and discussions
