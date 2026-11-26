#!/bin/bash
# Restart netwatch (a systemd --user service) and show that it came back.
# Run as your normal user; also works under sudo.
if [ "$(id -u)" -eq 0 ]; then
    user=${SUDO_USER:?run as your normal user, or with sudo from it}
    sc() { systemctl --user -M "$user@" "$@"; }
else
    user=$USER
    sc() { systemctl --user "$@"; }
fi
sc restart netwatch || exit 1
sleep 3
sc --no-pager status netwatch | head -8
echo
echo "Last events:"
tail -3 "$(getent passwd "$user" | cut -d: -f6)/netwatch-logs/events.log"
