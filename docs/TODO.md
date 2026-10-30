# TODO

Open items that are known but not being worked on yet.

## LED-Central UI memory leak (Firefox on deck.local)

On 2026-10-21 deck.local ran out of memory and had to be rebooted. A Firefox
content process grew to 5.4 GB (about 40 MB/h at first, about 160 MB/h near the
end), filled swap, and the kernel OOM killer took out Firefox and the
LED-Central dev servers. Only two tabs were open: the LED-Central UI
(`http://localhost:5173`) and the OPNsense login page, so the LED-Central UI is
the likely leak. Reading the code didn't show an obvious cause: `Status.jsx`
polls `/api/status` once a second, and the realtime socket in `App.jsx` only
keeps the last event type.

- Workaround for now: Firefox stays closed on the Pi.
- Next step: load the UI in a browser against `deck.local:5173`, watch its
  memory for an hour or two, and find what grows.
- Possible safety net: an early-OOM killer on the Pi, so a runaway browser is
  killed before the system starts thrashing.

## Watch: S3 RMT interrupt crash during a flash write (fix deployed 2026-10-30)

matrix-16x16 (2026-10-25 and 2026-10-28) and deck3 (2026-10-28) panicked
with an interrupt watchdog in `rmt_driver_isr_default` ->
`xRingbufferSendFromISR` while core 1 was parked for a SPIFFS write of
`/current.cfg`. The ringbuffer was the IR remote's RMT RX buffer, which plain
malloc had put in PSRAM (PSRAM-default threshold 96). The legacy driver
registers one shared RMT ISR with the first channel's flags, and the WS281x
output installs first with `ESP_INTR_FLAG_IRAM`, so the remote's `0` flags
didn't keep it off the cache-disabled path. Fixed in NightDriverStrip
`remotecontrol.cpp` by routing that install's allocations to internal RAM;
OTA'd to deck3 and matrix-16x16. Dumps are in `elf-archive/crashes/`.

- If either board shows `CRASH_PRESENT` again, check whether it's the same
  signature (task `ipc1`, `excVaddr 0xbad00c11`, RMT ISR in the dump).

## Diagnosing a controller crash (reference)

The 2026-10-22 crash loops on deck1, deck3 and matrix-16x16 were two
effects writing past the end of a strip's pixel buffer: StarEffect's blur,
at the compiled 1220-LED size, and WarmGlowEffect, at channel 0's length on
every channel. Both were fixed in NightDriverStrip 9195b6bb. For the next
crash:

- `GET http://<controller>/api/v1/crash` gives the summary; `/raw` gives
  the full dump. `CRASH_PRESENT` in `/statistics` flags one.
- Decode it with the ELF from `NightDriverStrip/elf-archive/` that matches
  `elfSha256` (REST_API.md, "Crash reports").
- A panic in the output code (`PostProcessFrame` / `Show`) is usually the
  victim, not the cause: look for something writing past a strip's pixel
  buffer.

## Small background playback skips

Matrix-16x16, Garage and Deck11 log a steady trickle of small (~100-400 ms)
`[playback] ... skipping ahead` warnings, with or without the stalled-controller
fix in 9cf2968. They're unrelated to deck WiFi dropouts and haven't been looked
into yet.
