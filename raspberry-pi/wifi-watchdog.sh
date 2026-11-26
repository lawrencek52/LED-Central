#!/bin/bash
# wifi-watchdog - recover the Pi when WiFi looks connected but passes no traffic.
#
# On 2026-11-25 the Pi's wlan0 stayed associated (steady -55 dBm, no disconnect,
# no driver errors) but stopped passing traffic for 13.5 hours. NetworkManager
# never noticed because the association stayed up. This watchdog pings the
# gateway and, if it stays unreachable, escalates:
#   1. reconnect wlan0 through NetworkManager
#   2. reload the brcmfmac WiFi driver
#   3. reboot (rate-limited, can be turned off)
# Each step gets STEP_WAIT seconds to work before the next one runs.
#
# Runs as root from wifi-watchdog.service. Logs go to the journal:
#   journalctl -u wifi-watchdog
# Settings can be overridden in /etc/default/wifi-watchdog.

IFACE=wlan0
CHECK_EVERY=10          # seconds between checks
FAIL_AFTER=120          # seconds of no replies before the first recovery step
STEP_WAIT=90            # seconds to give each step before escalating
EXTRA_TARGET=1.1.1.1    # counts as alive too, in case the router ignores pings
REBOOT_ENABLED=1        # 0 = never reboot, stop after the driver reload
MIN_UPTIME_FOR_REBOOT=1800    # don't reboot within 30 min of booting
MIN_SECS_BETWEEN_REBOOTS=21600  # at most one watchdog reboot every 6 hours
STATE_DIR=/var/lib/wifi-watchdog
DRIVER_MODULES="brcmfmac_cyw brcmfmac"   # removed in this order, loaded in reverse

[ -r /etc/default/wifi-watchdog ] && . /etc/default/wifi-watchdog

log() { echo "$*"; }    # stdout goes to the journal under systemd

gateway() {
    ip -4 route show default dev "$IFACE" 2>/dev/null | awk '/default via/ {print $3; exit}'
}

alive() {
    local gw
    gw=$(gateway)
    if [ -n "$gw" ] && ping -n -q -c 1 -W 2 -I "$IFACE" "$gw" >/dev/null 2>&1; then
        return 0
    fi
    [ -n "$EXTRA_TARGET" ] && ping -n -q -c 1 -W 2 -I "$IFACE" "$EXTRA_TARGET" >/dev/null 2>&1
}

link_info() {
    local l
    l=$(iw dev "$IFACE" link 2>/dev/null)
    if grep -q '^Connected' <<<"$l"; then
        echo "associated $(awk '/^Connected/ {print $3}' <<<"$l")" \
             "$(awk '/signal:/ {print $2, $3}' <<<"$l")" \
             "gw=$(gateway)"
    else
        echo "not associated, gw=$(gateway)"
    fi
}

step_reconnect() {
    log "STEP 1: reconnecting $IFACE via NetworkManager ($(link_info))"
    nmcli device disconnect "$IFACE" 2>&1 | sed 's/^/  nmcli: /'
    sleep 3
    nmcli device connect "$IFACE" 2>&1 | sed 's/^/  nmcli: /'
}

step_reload_driver() {
    log "STEP 2: reloading WiFi driver ($DRIVER_MODULES) ($(link_info))"
    local m rev=""
    for m in $DRIVER_MODULES; do
        modprobe -r "$m" 2>&1 | sed 's/^/  modprobe: /'
        rev="$m $rev"
    done
    sleep 3
    for m in $rev; do
        modprobe "$m" 2>&1 | sed 's/^/  modprobe: /'
    done
    # give the interface time to reappear, then make sure NM brings it up
    for _ in $(seq 1 15); do
        [ -e "/sys/class/net/$IFACE" ] && break
        sleep 1
    done
    sleep 5
    nmcli device connect "$IFACE" 2>&1 | sed 's/^/  nmcli: /'
}

step_reboot() {
    if [ "$REBOOT_ENABLED" != 1 ]; then
        log "STEP 3: reboot disabled; will retry from step 1 later"
        return
    fi
    local up last nowt
    up=$(cut -d. -f1 /proc/uptime)
    if [ "$up" -lt "$MIN_UPTIME_FOR_REBOOT" ]; then
        log "STEP 3: skipping reboot, only up ${up}s; will retry from step 1 later"
        return
    fi
    mkdir -p "$STATE_DIR"
    nowt=$(date +%s)
    last=$(cat "$STATE_DIR/last-reboot" 2>/dev/null || echo 0)
    if [ $((nowt - last)) -lt "$MIN_SECS_BETWEEN_REBOOTS" ]; then
        log "STEP 3: skipping reboot, last watchdog reboot was $((nowt - last))s ago; will retry from step 1 later"
        return
    fi
    echo "$nowt" > "$STATE_DIR/last-reboot"
    log "STEP 3: rebooting ($(link_info))"
    sync
    systemctl reboot
}

log "started: iface=$IFACE check=${CHECK_EVERY}s fail_after=${FAIL_AFTER}s step_wait=${STEP_WAIT}s reboot=$REBOOT_ENABLED ($(link_info))"

fail_since=0     # epoch of first failed check in this outage, 0 = healthy
step=0           # last recovery step taken in this outage
step_at=0        # when that step was taken

while true; do
    nowt=$(date +%s)
    if alive; then
        if [ "$fail_since" -ne 0 ]; then
            log "recovered after $((nowt - fail_since))s (last step: $step) ($(link_info))"
        fi
        fail_since=0; step=0; step_at=0
    else
        if [ "$fail_since" -eq 0 ]; then
            fail_since=$nowt
            log "no reply from gateway or $EXTRA_TARGET ($(link_info))"
        fi
        down=$((nowt - fail_since))
        # step_at is 0 at the start of an outage, so step 1 runs as soon as
        # FAIL_AFTER is reached; every later step waits STEP_WAIT
        if [ "$down" -ge "$FAIL_AFTER" ] && [ $((nowt - step_at)) -ge "$STEP_WAIT" ]; then
            step=$((step + 1))
            step_at=$nowt
            case $step in
                1) step_reconnect ;;
                2) step_reload_driver ;;
                *) step_reboot
                   # reboot skipped or disabled: start the ladder again
                   step=0 ;;
            esac
        fi
    fi
    sleep "$CHECK_EVERY"
done
