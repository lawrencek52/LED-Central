#!/bin/bash
# Install (or update) netwatch as a systemd --user service of the current user.
#   raspberry-pi/install-netwatch.sh          (as your normal user, not sudo)
#
# netwatch pings every hop to the internet once a second and logs where the
# path breaks. Logs go to ~/netwatch-logs. The service runs netwatch.py
# straight from this checkout, so a `git pull` plus restart-netwatch.sh
# picks up changes.
set -e
if [ "$(id -u)" -eq 0 ]; then
    echo "run as your normal user, not root (it installs a per-user service)" >&2
    exit 1
fi
here=$(dirname "$(readlink -f "$0")")
unit_dir="$HOME/.config/systemd/user"
mkdir -p "$unit_dir"

# Hops to watch. discover traces the route once; targets.txt can be edited later.
if [ ! -f "$HOME/netwatch-logs/targets.txt" ]; then
    command -v traceroute >/dev/null || sudo apt-get install -y traceroute
    python3 "$here/netwatch.py" discover
fi

cat > "$unit_dir/netwatch.service" <<EOF
[Unit]
Description=netwatch - log where the internet path freezes

[Service]
ExecStart=/usr/bin/python3 $here/netwatch.py monitor
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable netwatch
systemctl --user restart netwatch

# Without lingering, user services stop when you log out and only start at login.
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != yes ]; then
    echo "Enabling lingering so netwatch runs from boot without a login (needs sudo)..."
    sudo loginctl enable-linger "$USER"
fi

sleep 3
systemctl --user --no-pager status netwatch | head -8
echo
echo "netwatch installed. Events: tail -f ~/netwatch-logs/events.log   Summary: python3 $here/netwatch.py report"
