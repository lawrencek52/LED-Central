#!/bin/bash
# Start both backend and frontend dev servers simultaneously on Linux
# This script opens the frontend in the default browser

set -e

trap 'kill $(jobs -p) 2>/dev/null; exit 0' EXIT TERM INT

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}Starting LED-Central development environment...${NC}"
echo ""

# Start backend in background
echo -e "${BLUE}[Backend]${NC} Starting on port 3001..."
cd "$(dirname "$0")/backend"
npm run dev > /tmp/led-central-backend.log 2>&1 &
BACKEND_PID=$!

# Start frontend in background
echo -e "${BLUE}[Frontend]${NC} Starting on port 5173..."
cd "$(dirname "$0")/frontend"
npm run dev > /tmp/led-central-frontend.log 2>&1 &
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
    echo "  tail -f /tmp/led-central-backend.log"
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
    echo "  tail -f /tmp/led-central-frontend.log"
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
