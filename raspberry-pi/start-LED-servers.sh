#!/bin/bash
# Start LED-Central (backend + frontend via `make dev`) and open the UI in Firefox.
# Run at login by the autostart entry that setup-pi.sh installs
# (~/.config/autostart/led-central.desktop). Logs go to ~/led-logs.
repo=$(dirname "$(readlink -f "$0")")/..
sleep 1
cd "$repo" && make dev &
sleep 4
firefox http://localhost:5173 &
