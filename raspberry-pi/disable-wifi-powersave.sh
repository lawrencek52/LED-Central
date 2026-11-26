#!/bin/bash
# Turn off WiFi power saving on the Pi, now and after every boot.
#   sudo raspberry-pi/disable-wifi-powersave.sh
#
# Ubuntu ships /etc/NetworkManager/conf.d/default-wifi-powersave-on.conf
# (wifi.powersave = 3). Power saving on the Pi's Broadcom WiFi chip (brcmfmac)
# is a well-known cause of the link stalling while it still looks connected.
# NetworkManager reads conf.d files in name order and later ones win, so this
# drop-in overrides Ubuntu's default without editing it.
set -e
if [ "$(id -u)" -ne 0 ]; then
    echo "run with sudo: sudo $0" >&2
    exit 1
fi
IFACE=${1:-wlan0}
CONF=/etc/NetworkManager/conf.d/zz-led-central-wifi-powersave-off.conf
cat > "$CONF" <<'EOF'
# Written by LED-Central raspberry-pi/disable-wifi-powersave.sh
# 2 = disable WiFi power saving (overrides Ubuntu's default-wifi-powersave-on.conf)
[connection]
wifi.powersave = 2
EOF
echo "Wrote $CONF"
systemctl reload NetworkManager
# Apply now without dropping the connection; the config covers later reconnects and boots.
if iw dev "$IFACE" set power_save off 2>/dev/null; then
    iw dev "$IFACE" get power_save
else
    echo "Could not set power save on $IFACE now; it takes effect on the next reconnect or boot."
fi
