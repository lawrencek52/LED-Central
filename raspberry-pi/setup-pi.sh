#!/bin/bash
# Set up a Raspberry Pi as the LED-Central host, or bring an existing one up to date.
# Run as your normal user from the LED-Central checkout; it asks for sudo where needed.
#
#   raspberry-pi/setup-pi.sh [--deck-monitor]
#
#   --deck-monitor   also start deck-monitor.sh at boot (controller WiFi investigations only;
#                    its log grows ~15 MB a day)
#
# Every step is safe to re-run.
set -e
here=$(dirname "$(readlink -f "$0")")
repo=$(readlink -f "$here/..")
DECK_MONITOR=0
for a in "$@"; do
    case $a in
        --deck-monitor) DECK_MONITOR=1 ;;
        *) echo "unknown option: $a" >&2; exit 1 ;;
    esac
done
if [ "$(id -u)" -eq 0 ]; then
    echo "run as your normal user (it uses sudo where needed): $0" >&2
    exit 1
fi

step() { echo; echo "==== $* ===="; }

step "1/6 LED-Central dependencies, .env and LAN time server (setup-linux.sh)"
"$repo/setup-linux.sh"

step "2/6 Start LED-Central at login (desktop autostart)"
mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/led-central.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=LED-Central
Comment=Starts the LED-Central servers and opens the UI in Firefox
Exec=bash $here/start-LED-servers.sh
X-GNOME-Autostart-enabled=true
Terminal=false
EOF
# the original Pi used this name for the same entry; don't start LED-Central twice
rm -f "$HOME/.config/autostart/led-dev.desktop"
echo "Wrote ~/.config/autostart/led-central.desktop (needs automatic login to start after a power cut)"

step "3/6 netwatch network monitor (user service)"
"$here/install-netwatch.sh"

step "4/6 Turn off WiFi power saving"
sudo "$here/disable-wifi-powersave.sh"

step "5/6 wifi-watchdog (root service, starts at boot)"
sudo "$here/install-wifi-watchdog.sh"

step "6/6 crontab: daily database backup$([ "$DECK_MONITOR" = 1 ] && echo ' and deck monitor')"
cron=$(crontab -l 2>/dev/null || true)
add_cron() {   # add_cron <marker> <line>: add the line unless something with the marker is there
    if ! grep -qF "$1" <<<"$cron"; then
        cron=$(printf '%s\n%s\n' "$cron" "$2" | sed '/^$/d')
        echo "added: $2"
    else
        echo "already there: $1"
    fi
}
add_cron backup-db.sh "30 3 * * * $here/backup-db.sh >> $HOME/led-logs/backup-db.log 2>&1"
if [ "$DECK_MONITOR" = 1 ]; then
    add_cron deck-monitor.sh "@reboot sleep 30 && $here/deck-monitor.sh"
fi
mkdir -p "$HOME/led-logs"
printf '%s\n' "$cron" | crontab -

echo
echo "Done. Reboot to check everything comes back on its own:"
echo "  sudo reboot"
echo "then:  systemctl status wifi-watchdog; systemctl --user status netwatch; curl -s localhost:3001/api/health"
