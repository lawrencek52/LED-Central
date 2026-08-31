# LED-Central Makefile for Linux Development
# Common commands for development, testing, and deployment

.PHONY: help install dev dev-backend dev-frontend dev-all build build-frontend clean logs setup test

# Default target
help:
	@echo "LED-Central Makefile - Linux Development"
	@echo ""
	@echo "Available targets:"
	@echo "  make setup              Install all dependencies (Linux setup script)"
	@echo "  make install            Install npm dependencies"
	@echo "  make dev                Start all services (backend + frontend)"
	@echo "  make dev-backend        Start backend server only"
	@echo "  make dev-frontend       Start frontend dev server only"
	@echo "  make build              Build frontend production build"
	@echo "  make build-frontend     Build frontend production build"
	@echo "  make clean              Remove build artifacts and cache"
	@echo "  make test               Run tests (when available)"
	@echo "  make ports              Show what's running on common ports"
	@echo ""

# Setup and installation
setup:
	@echo "Running Linux setup script..."
	@./setup-linux.sh

install:
	@echo "Installing npm dependencies..."
	cd backend && npm install
	cd frontend && npm install
	@echo "✓ Dependencies installed"

# Development servers
dev:
	@echo "Starting backend and frontend development servers..."
	@echo "Backend will run on http://localhost:3001/api"
	@echo "Frontend will run on http://localhost:5173"
	@echo ""
	@echo "Press Ctrl+C to stop both servers"
	@./scripts/dev-all.sh

dev-backend:
	@echo "Starting backend server on http://localhost:3001/api..."
	cd backend && npm run dev

dev-frontend:
	@echo "Starting frontend dev server on http://localhost:5173..."
	cd frontend && npm run dev

# Build targets
build: build-frontend
	@echo "✓ All builds complete"

build-frontend:
	@echo "Building frontend for production..."
	cd frontend && npm run build
	@echo "✓ Frontend build complete in frontend/dist/"

# Utilities
ports:
	@echo "Checking development ports..."
	@echo "Port 3001 (Backend API):"
	@lsof -i :3001 2>/dev/null | tail -n +2 || echo "  Not in use"
	@echo ""
	@echo "Port 5173 (Frontend Dev):"
	@lsof -i :5173 2>/dev/null | tail -n +2 || echo "  Not in use"

clean:
	@echo "Cleaning build artifacts..."
	rm -rf backend/node_modules
	rm -rf frontend/node_modules
	rm -rf frontend/dist
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	@echo "✓ Cleaned"

test:
	@echo "Running tests (backend)..."
	cd backend && npm test || echo "No tests configured"

# Advanced
logs-backend:
	@echo "Showing backend logs..."
	cd backend && npm run dev 2>&1 | grep -v "^\s*$$"

logs-frontend:
	@echo "Showing frontend logs..."
	cd frontend && npm run dev 2>&1 | grep -v "^\s*$$"

# Development server info
info:
	@echo "LED-Central Development Environment"
	@echo "======================================"
	@echo ""
	@echo "Backend:  http://localhost:3001/api"
	@echo "Frontend: http://localhost:5173"
	@echo ""
	@echo "API Health Check:"
	@curl -s http://localhost:3001/api/health | python3 -m json.tool || echo "Backend not running"
	@echo ""

.SILENT: help info
