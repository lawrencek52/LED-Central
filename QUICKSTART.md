# LED-Central Quick Start Guide (Linux)

**This guide is for Linux systems. All commands use bash and Linux utilities.**

This guide will get you up and running with LED-Central development in 5 minutes.

## Quickest Start: Automated Setup

For the fastest setup, run the automated Linux setup script:

```bash
./setup-linux.sh
```

This installs all dependencies and configures your environment. Then skip to [Step 4](#step-4-start-backend-server).

## Manual Setup

Ensure you have installed on your Linux system:
- **Node.js >= 14.0**: `sudo apt install nodejs npm` (or compile from [source](https://nodejs.org/))
- **VS Code** (optional): `sudo snap install --classic code`

## Step 1: Open the Workspace

Open the workspace file in VS Code:

```bash
# Option A: From terminal
code LED-Central.code-workspace

# Option B: File > Open Workspace from File in VS Code
```

This loads all project folders in a multi-root workspace.

## Step 2: Install Recommended Extensions

VS Code will prompt you to install recommended extensions. Click "Install All" or:

1. Open Extensions panel (Ctrl+Shift+X)
2. Search for "LED-Central" extensions
3. Install ESLint, Prettier, and other recommended extensions

## Step 3: Start Backend Server

Open terminal and run:

```bash
cd backend
npm run dev
```

You should see:
```
LED-Central backend server running on port 3001
API available at http://localhost:3001/api
```

## Step 4: Start Frontend Dev Server

Open another terminal and run:

```bash
cd frontend
npm run dev
```

You should see:
```
VITE v8.2.2 ready in XXX ms
Local:   http://localhost:5173/
```

## Step 5: Open in Browser

Navigate to `http://localhost:5173` to see the frontend.

Test the API connection:

```bash
curl http://localhost:3001/api/health
```

You should get: `{"status":"ok","timestamp":"..."}`

## Verification

- **Backend API**: http://localhost:3001/api/health
- **Frontend UI**: http://localhost:5173
- **Both running**: ✅ Ready for development!

## Next Steps

1. **Register a Controller**: Use the frontend to add a controller
2. **Explore API**: Check [backend/README.md](../backend/README.md) for endpoints
3. **Create Effects**: Start implementing effect library

## Troubleshooting

### Port Already in Use

If backend fails to start on port 3001:

```bash
# Find and kill process on port 3001
sudo lsof -i :3001
sudo kill -9 <PID>

# Or use a different port
PORT=3002 npm run dev
```

### Frontend Can't Connect to Backend

- Ensure backend is running on port 3001
- Check `.env.development` has correct API_URL
- Clear browser cache and reload (Ctrl+Shift+R)

## File Structure Reference

```
LED-Central/
├── backend/           # Node.js REST API server
├── frontend/          # React web UI
├── .vscode/          # Shared workspace settings
└── docs/             # Documentation
```

## Common Commands

```bash
# Backend
npm run dev           # Start dev server with auto-reload
npm start            # Start production server
npm install          # Install dependencies

# Frontend
npm run dev          # Start Vite dev server
npm run build        # Create production build
npm run preview      # Preview production build
```

## Getting Help

- Check individual README files: `backend/README.md`, `frontend/README.md`
- Review API documentation in `backend/README.md`
- Check VS Code output panel for errors

---

**You're all set! Happy coding! 🚀**
