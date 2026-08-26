#!/bin/bash
# LED-Central Linux Setup Script
# Installs dependencies and configures the development environment

set -e

echo "========================================"
echo "LED-Central Linux Setup"
echo "========================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running on Linux
if [[ ! "$OSTYPE" == "linux-gnu"* ]]; then
    echo -e "${RED}Error: This setup script is for Linux systems only${NC}"
    exit 1
fi

echo -e "${YELLOW}Step 1: Checking system dependencies...${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js not found. Installing...${NC}"
    sudo apt-get update
    sudo apt-get install -y nodejs npm
else
    NODE_VERSION=$(node -v)
    echo -e "${GREEN}✓ Node.js found: $NODE_VERSION${NC}"
fi

echo ""
echo -e "${YELLOW}Step 2: Installing backend dependencies...${NC}"
cd "$(dirname "$0")/backend"
npm install
echo -e "${GREEN}✓ Backend dependencies installed${NC}"

echo ""
echo -e "${YELLOW}Step 3: Installing frontend dependencies...${NC}"
cd "$(dirname "$0")/frontend"
npm install
echo -e "${GREEN}✓ Frontend dependencies installed${NC}"

echo ""
echo -e "${YELLOW}Step 4: Creating .env files from templates...${NC}"
cd "$(dirname "$0")"

# Backend .env
if [ ! -f backend/.env ]; then
    cp backend/.env.example backend/.env
    echo -e "${GREEN}✓ Created backend/.env${NC}"
else
    echo -e "${YELLOW}~ backend/.env already exists (not overwriting)${NC}"
fi

# Frontend .env.development exists already from Vite init
echo -e "${GREEN}✓ frontend/.env.development already configured${NC}"

echo ""
echo "========================================"
echo -e "${GREEN}Setup Complete!${NC}"
echo "========================================"
echo ""
echo "Next steps:"
echo ""
echo "1. Start the backend server:"
echo "   cd backend && npm run dev"
echo ""
echo "2. In another terminal, start the frontend:"
echo "   cd frontend && npm run dev"
echo ""
echo "3. Open in browser: http://localhost:5173"
echo ""
echo -e "${GREEN}Happy coding! 🚀${NC}"
