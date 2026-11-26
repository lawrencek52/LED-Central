# Raspberry Pi host utilities

These are scripts for the Raspberry Pi that runs LED-Central. They keep the Pi
stable and let you rebuild it quickly if the hardware fails.

The reference Pi is a Raspberry Pi 4 Model B (8 GB) running Ubuntu 26.04 LTS
Desktop. Its hostname is `deck`, its address is `192.168.86.67`, and it
connects over 5 GHz WiFi. LED-Central is checked out at `~/Documents/LED-Central`.

| File | What it does | Run as |
|---|---|---|
| `setup-pi.sh` | Sets up a new Pi, or updates an existing one. It runs every step below and is safe to re-run. | your user (it asks for sudo) |
| `wifi-watchdog.sh` / `.service` | Recovers the WiFi when it looks connected but passes no traffic. | root service |
| `install-wifi-watchdog.sh` | Installs or updates the watchdog service, which then starts at every boot. | `sudo` |
| `disable-wifi-powersave.sh` | Turns off WiFi power saving, now and after every boot. | `sudo` |
| `netwatch.py` | Network monitor. It pings every hop to the internet once a second and logs where the path breaks. | your user (service) |
| `install-netwatch.sh` | Installs netwatch as a user service. | your user |
| `restart-netwatch.sh` | Restarts netwatch and shows its status. | your user (or `sudo`) |
| `backup-db.sh` | Takes a snapshot of LED-Central's database. Runs daily from cron. | your user |
| `start-LED-servers.sh` | Starts LED-Central (`make dev`) and opens the UI. Runs at login. | your user |
| `kill-LED-servers.sh` | Stops the LED-Central servers. | your user |
| `deck-monitor.sh` | Optional. Logs the deck controllers' statistics every 5 s, for WiFi investigations. | your user |

## Setting up a new Pi

1. **Flash the SD card** with Raspberry Pi Imager: *Ubuntu Desktop 26.04 LTS
   (64-bit)*. In the Imager's settings, set the hostname to `deck`, create
   the user `lawrence`, enter the WiFi network `K220`, and enable SSH.
2. **First boot.** Finish the Ubuntu setup on a screen, then:
   - Turn on automatic login (*Settings → System → Users → Automatic Login*).
     LED-Central starts at login, so without automatic login it won't come
     back by itself after a power cut.
   - Keep the WiFi on 5 GHz only. The 2.4 GHz band is busy with the LED
     controllers.
     ```bash
     nmcli connection modify K220 802-11-wireless.band a
     nmcli connection up K220
     ```
   - Give the Pi a fixed address. In the Google Home app (*Wi-Fi → Devices →
     the Pi → Reserve IP*), reserve `192.168.86.67` so existing bookmarks and
     scripts keep working. The new Pi has a different MAC address, so reserve
     it again even if the old Pi had a reservation.
3. **Get the code.** Use an SSH key registered with GitHub, or clone over HTTPS:
   ```bash
   sudo apt install -y git make
   mkdir -p ~/Documents && cd ~/Documents
   git clone git@github.com:lawrencek52/LED-Central.git
   cd LED-Central
   ```
4. **Restore the database** from your most recent backup, if you have one
   (see [Backups](#database-backups)):
   ```bash
   mkdir -p backend/data
   cp /path/to/led-central-YYYY-MM-DD-HHMM.db backend/data/led-central.db
   ```
   Without a backup, LED-Central starts empty. You then add the controllers
   again on the **Controllers** tab and rebuild the canvases.
5. **Run the setup:**
   ```bash
   raspberry-pi/setup-pi.sh
   ```
   It runs `setup-linux.sh` (Node.js, npm packages, `.env`, the chrony time
   server for the controllers), the login autostart, netwatch, WiFi power
   saving off, the WiFi watchdog, and a daily database backup. Add
   `--deck-monitor` to also start the deck monitor at boot.
6. **Reboot and check** that everything came back by itself:
   ```bash
   sudo reboot
   # after it's back:
   systemctl status wifi-watchdog            # active (running)
   systemctl --user status netwatch          # active (running)
   curl -s localhost:3001/api/health         # LED-Central backend answers
   iw dev wlan0 get power_save               # Power save: off
   ```

To update an existing Pi after a `git pull`, run `raspberry-pi/setup-pi.sh`
again. To install just one part, run that part's install script on its own.

## WiFi watchdog

On 2026-11-25 at 19:27 the Pi's WiFi stopped passing traffic for 13½ hours.
It stayed connected the whole time, the signal held steady at −55 dBm, and
there were no driver errors. NetworkManager never noticed because the
connection still looked up, and only a reboot fixed it. The watchdog catches
that case.

Every 10 seconds it pings the router, and also `1.1.1.1` in case the router
ignores pings. If neither answers for 2 minutes, it escalates one step at a
time, giving each step 90 seconds to work:

1. Reconnects `wlan0` through NetworkManager.
2. Reloads the WiFi driver (`brcmfmac`).
3. Reboots the Pi. It won't reboot within 30 minutes of booting, and reboots
   at most once every 6 hours, so a real router outage can't cause a reboot
   loop. If it skips the reboot, it waits and starts again from step 1.

**Install** (once; it then starts at every boot). Run the same command again
after changing `wifi-watchdog.sh`:
```bash
sudo raspberry-pi/install-wifi-watchdog.sh
```
This copies the script to `/usr/local/sbin/wifi-watchdog` and installs
`/etc/systemd/system/wifi-watchdog.service`. The status it prints should say
`active (running)`, followed by a `started: ... associated <AP address>` line.

**Use:**
```bash
journalctl -u wifi-watchdog -f                 # watch it live (no sudo needed)
sudo systemctl stop wifi-watchdog              # stop it until the next boot
sudo systemctl disable --now wifi-watchdog     # turn it off permanently
```

**Settings.** You can override any variable at the top of `wifi-watchdog.sh`
in `/etc/default/wifi-watchdog` without editing the script. For example, to
never reboot:
```bash
echo REBOOT_ENABLED=0 | sudo tee /etc/default/wifi-watchdog
sudo systemctl restart wifi-watchdog
```

## WiFi power saving

Ubuntu turns WiFi power saving on by default. On the Pi's Broadcom chip, power
saving is a well-known cause of the WiFi stalling while it still looks
connected. `disable-wifi-powersave.sh` adds
`/etc/NetworkManager/conf.d/zz-led-central-wifi-powersave-off.conf`, which
overrides Ubuntu's setting, and also turns power saving off immediately.

```bash
sudo raspberry-pi/disable-wifi-powersave.sh
iw dev wlan0 get power_save      # Power save: off
```

## netwatch

`netwatch` was written to find the cause of the household's short internet
freezes. It pings each hop of the route (Nest → OPNsense → Deco → ISP →
Google/Cloudflare) once a second and logs:

- `~/netwatch-logs/events.log`: outages and slow periods, which hop failed
  first, WiFi access point and signal changes, and route traces.
- `~/netwatch-logs/samples-DATE.csv`: one row per second, with the round-trip
  time to every hop and the WiFi signal.

```bash
raspberry-pi/install-netwatch.sh               # install as a user service (runs from boot)
raspberry-pi/restart-netwatch.sh               # restart, e.g. after a git pull
python3 raspberry-pi/netwatch.py report        # summary of outages and slow periods
tail -f ~/netwatch-logs/events.log
```

The service runs `netwatch.py` directly from this checkout. The hops it
watches are in `~/netwatch-logs/targets.txt`. The installer creates that file
by tracing the route, and you can edit it.

## Database backups

LED-Central's database (`backend/data/led-central.db`) holds the controllers,
canvases, playback and settings. It is **not in git**, so a backup is the only
way to bring a replacement Pi back to the same state.

`setup-pi.sh` adds a cron job that runs `backup-db.sh` every day at 03:30. It
writes `~/led-central-backups/led-central-DATE-TIME.db` and keeps the newest 14
snapshots. The backup is safe to take while LED-Central is running. **Copies on
the Pi are lost if the SD card dies**, so copy them to another machine from
time to time:
```bash
scp 'lawrence@192.168.86.67:led-central-backups/*' ~/led-central-backups/
```

To restore, stop LED-Central (`raspberry-pi/kill-LED-servers.sh`), then copy
the snapshot to `backend/data/led-central.db` and delete any
`led-central.db-wal` and `led-central.db-shm` files next to it. Start
LED-Central again, or reboot.

## Deck monitor (optional)

`deck-monitor.sh` reads `/statistics` from the deck controllers every 5 s and
logs to `~/led-logs/deck-monitor.log`. It was used to track down the
controllers' WiFi dropouts. Its log grows about 15 MB a day and is not
rotated, so run it only while you're investigating. To start it at boot, run
`setup-pi.sh --deck-monitor`. Pass controller addresses as arguments to
monitor other controllers.

## Logs and where things live

| What | Where |
|---|---|
| LED-Central backend / frontend | `~/led-logs/led-central-backend.log`, `led-central-frontend.log` |
| WiFi watchdog | `journalctl -u wifi-watchdog` |
| netwatch | `~/netwatch-logs/` |
| Database backups | `~/led-central-backups/`, log in `~/led-logs/backup-db.log` |
| Deck monitor | `~/led-logs/deck-monitor.log` |

The Pi has no battery-backed clock. Until NTP sets the time, each boot is
logged with whatever date the Pi last saved, which can be weeks out. As a
result, `journalctl --list-boots` and `journalctl -b -1` can point at the
wrong boot. To find what happened at a particular time, search by time
instead:
```bash
journalctl --since "2026-11-25 19:00" --until "2026-11-25 20:00"
```

**Not in git, so copy these off the Pi before it fails:** the database
backups, and the controller firmware images and `espota.py` in the home
directory that are used for over-the-air updates.
