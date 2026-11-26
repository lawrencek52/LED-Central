#!/bin/bash
# Install (or update) wifi-watchdog as a root systemd service that starts at every boot.
#   sudo raspberry-pi/install-wifi-watchdog.sh
# Re-run it after changing wifi-watchdog.sh to install the new version.
set -e
if [ "$(id -u)" -ne 0 ]; then
    echo "run with sudo: sudo $0" >&2
    exit 1
fi
here=$(dirname "$(readlink -f "$0")")
install -m 755 "$here/wifi-watchdog.sh" /usr/local/sbin/wifi-watchdog
install -m 644 "$here/wifi-watchdog.service" /etc/systemd/system/wifi-watchdog.service
systemctl daemon-reload
systemctl enable wifi-watchdog
systemctl restart wifi-watchdog
sleep 2
systemctl --no-pager status wifi-watchdog | head -12
echo
echo "wifi-watchdog installed. Logs: journalctl -u wifi-watchdog -f"
