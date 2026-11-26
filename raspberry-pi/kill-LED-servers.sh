#!/bin/bash
# Stop LED-Central's backend and frontend dev servers (started by start-LED-servers.sh / make dev).
pids() { ps aux | grep -E "backend/node_modules|frontend/node_modules" | grep -v grep | awk '{print $2}'; }
pids
kill $(pids) 2>/dev/null
sleep 1
kill -9 $(lsof -t -i :3001) 2>/dev/null
kill -9 $(lsof -t -i :5173) 2>/dev/null
echo killed everything
pids
