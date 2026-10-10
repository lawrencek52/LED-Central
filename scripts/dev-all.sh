#!/bin/bash
# Start both backend and frontend dev servers simultaneously on Linux
# This script opens the frontend in the default browser

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

trap 'kill $(jobs -p) 2>/dev/null; exit 0' EXIT TERM INT

# Logs live under $HOME rather than /tmp so they survive a power cycle, and are
# appended to so each restart doesn't wipe the previous run's history.
LOG_DIR="${LED_CENTRAL_LOG_DIR:-$HOME/led-logs}"
mkdir -p "$LOG_DIR"
BACKEND_LOG="$LOG_DIR/led-central-backend.log"
FRONTEND_LOG="$LOG_DIR/led-central-frontend.log"

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}Starting LED-Central development environment...${NC}"
echo ""

# Start backend in background
echo -e "${BLUE}[Backend]${NC} Starting on port 3001..."
cd "$PROJECT_ROOT/backend"
echo "===== backend start $(date -Iseconds) =====" >> "$BACKEND_LOG"
npm run dev >> "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

# Start frontend in background
echo -e "${BLUE}[Frontend]${NC} Starting on port 5173..."
cd "$PROJECT_ROOT/frontend"
echo "===== frontend start $(date -Iseconds) =====" >> "$FRONTEND_LOG"
npm run dev >> "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!

# Wait for servers to be ready
echo ""
echo "Waiting for servers to start..."
sleep 3

# Check if backend is up
if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Backend is running${NC} http://localhost:3001/api"
else
    echo -e "Backend may still be starting... Check logs:"
    echo "  tail -f $BACKEND_LOG"
fi

# Check if frontend is up
if curl -s http://localhost:5173 > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Frontend is running${NC} http://localhost:5173"

    # Try to open in default browser
    if command -v xdg-open &> /dev/null; then
        xdg-open http://localhost:5173 2>/dev/null || true
    fi
else
    echo "Frontend may still be starting... Check logs:"
    echo "  tail -f $FRONTEND_LOG"
fi

echo ""
echo "Both servers are running!"
echo "  Backend API:  http://localhost:3001/api"
echo "  Frontend UI:  http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers"
echo ""

# Wait for both processes
wait
