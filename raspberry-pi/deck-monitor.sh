#!/bin/bash
# Poll each deck controller's /statistics every 5 s and log heap, FPS, uptime
# and WiFi counters (used to investigate controller WiFi dropouts).
# Optional: setup-pi.sh --deck-monitor starts it at boot from crontab (@reboot).
# Logs to ~/led-logs/deck-monitor.log, which grows ~15 MB a day and is not rotated;
# delete or truncate it once an investigation is done.
#
#   raspberry-pi/deck-monitor.sh [controller-ip ...]
HOSTS=("$@")
[ ${#HOSTS[@]} -eq 0 ] && HOSTS=(192.168.86.81 192.168.86.77 192.168.86.68)   # deck1 deck2 deck3
LOG="$HOME/led-logs/deck-monitor.log"
mkdir -p "$(dirname "$LOG")"
exec >> "$LOG" 2>&1
echo "===== monitor start $(date -Iseconds) ====="
while true; do
  for h in "${HOSTS[@]}"; do
    s=$(curl -s --max-time 3 "http://$h/statistics")
    if [ -z "$s" ]; then
      echo "$(date '+%F %T') $h NO-RESPONSE neigh=[$(ip neigh show "$h" | cut -d' ' -f4-)] ping=$(ping -c1 -W1 -q "$h" >/dev/null 2>&1 && echo ok || echo fail)"
    else
      echo "$(date '+%F %T') $h $(echo "$s" | python3 -c "import sys,json;d=json.load(sys.stdin);print(*[f\"{k}={d.get(k)}\" for k in [\"HEAP_FREE\",\"HEAP_MIN\",\"DMA_FREE\",\"DMA_MIN\",\"PSRAM_FREE\",\"LED_FPS\",\"PACKETS_RX\",\"UPTIME_SECONDS\",\"WIFI_RSSI\",\"RESET_REASON\",\"WIFI_WATCHDOG_REBOOTS\",\"WIFI_WATCHDOG_LAST_REASON\",\"WIFI_DISCONNECTS\",\"WIFI_LAST_DISCONNECT_REASON\",\"WIFI_STALL_RECONNECTS\",\"WIFI_GATEWAY_REPLY_AGE_MS\"]])")"
    fi
  done
  sleep 5
done
