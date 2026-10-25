#!/bin/bash
# LED-Central Linux Setup Script
# Installs dependencies and configures the development environment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
cd "$SCRIPT_DIR/backend"
npm install
echo -e "${GREEN}✓ Backend dependencies installed${NC}"

echo ""
echo -e "${YELLOW}Step 3: Installing frontend dependencies...${NC}"
cd "$SCRIPT_DIR/frontend"
npm install
echo -e "${GREEN}✓ Frontend dependencies installed${NC}"

echo ""
echo -e "${YELLOW}Step 4: Creating .env files from templates...${NC}"
cd "$SCRIPT_DIR"

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
echo -e "${YELLOW}Step 5: Serving NTP time to the controllers (chrony)...${NC}"
# NightDriver controllers sync their clocks to the machine that's sending them frames, since the
# frame timestamps come from its clock; without an NTP server here they fall back to internet
# time and drift apart by tens of milliseconds. chrony keeps this machine on internet time and
# answers the controllers on the local network.

if ! command -v chronyd &> /dev/null && [ ! -x /usr/sbin/chronyd ]; then
    echo -e "${YELLOW}chrony not found. Installing...${NC}"
    sudo apt-get update
    sudo apt-get install -y chrony
fi

# The local network is the subnet of the interface that carries the default route, as the kernel
# reports it (e.g. "192.168.86.0/24 ... src 192.168.86.67"), so a different network or location
# just works.
LAN_DEV=$(ip -4 route show default | awk '{for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit }}')
LAN_SUBNET=""
if [ -n "$LAN_DEV" ]; then
    LAN_SUBNET=$(ip -4 route show dev "$LAN_DEV" proto kernel scope link | awk 'NR == 1 {print $1}')
fi

if [ -z "$LAN_SUBNET" ]; then
    echo -e "${RED}Could not work out the local network (no default route?); skipping NTP serving.${NC}"
    echo -e "${RED}Controllers will use internet time until this step is re-run on the network.${NC}"
else
    echo "  Local network: $LAN_SUBNET (on $LAN_DEV)"

    CHRONY_ALLOW="# Written by LED-Central's setup-linux.sh: serve time to the NightDriver controllers
allow $LAN_SUBNET"

    # Prefer a drop-in file when chrony.conf reads one, else a marked block in chrony.conf itself.
    if grep -qs '^confdir /etc/chrony/conf.d' /etc/chrony/chrony.conf; then
        CHRONY_CONF=/etc/chrony/conf.d/led-central-lan.conf
        CURRENT=$(cat "$CHRONY_CONF" 2>/dev/null || true)
        if [ "$CURRENT" != "$CHRONY_ALLOW" ]; then
            echo "$CHRONY_ALLOW" | sudo tee "$CHRONY_CONF" > /dev/null
            CHRONY_CHANGED=1
        fi
    else
        CHRONY_CONF=/etc/chrony/chrony.conf
        if ! grep -qxF "allow $LAN_SUBNET" "$CHRONY_CONF"; then
            # Replace an earlier block (the network may have changed), then append the current one.
            sudo sed -i '/^# Written by LED-Central.s setup-linux.sh/,+1d' "$CHRONY_CONF"
            echo "$CHRONY_ALLOW" | sudo tee -a "$CHRONY_CONF" > /dev/null
            CHRONY_CHANGED=1
        fi
    fi

    # NTP is UDP port 123; only matters if the ufw firewall is switched on.
    if command -v ufw &> /dev/null && sudo ufw status | grep -q '^Status: active'; then
        sudo ufw allow from "$LAN_SUBNET" to any port 123 proto udp > /dev/null
        echo -e "${GREEN}✓ Firewall allows NTP from $LAN_SUBNET${NC}"
    fi

    if ! systemctl is-active --quiet chrony; then
        sudo systemctl enable --now chrony
        echo -e "${GREEN}✓ chrony started${NC}"
    elif [ -n "${CHRONY_CHANGED:-}" ]; then
        sudo systemctl restart chrony
        echo -e "${GREEN}✓ chrony restarted with the new settings${NC}"
    else
        echo -e "${GREEN}✓ chrony already running${NC}"
    fi
    sudo systemctl enable chrony > /dev/null 2>&1 || true

    if [ -n "${CHRONY_CHANGED:-}" ]; then
        echo -e "${GREEN}✓ chrony serves time to $LAN_SUBNET ($CHRONY_CONF)${NC}"
    else
        echo -e "${GREEN}✓ chrony already serves time to $LAN_SUBNET${NC}"
    fi
fi

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
