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

## Firmware crashes when switching to some built-in effects

Found 2026-10-22 when the decks fell back to their own effects (Deck11 had
stopped playing in LED-Central). Both crash the same way on the firmware from
before that day's changes (a0b1dd03), so they aren't new:

- **deck1 (xiao_c5):** switching from Palette Effect (index 12) to Warm White
  2700K (13) panics immediately (`RESET_REASON=4`). Switching to other
  effects, and deck2 switching Palette Effect -> Cool White 6500K, are fine.
- **matrix-16x16 and deck3 (xiao_sense):** RGB Music Blend Stars (index 1)
  panics within about 20 s of starting, whether it's reached by rotation or
  set directly. A controller that saves it as its current effect
  crash-loops. deck3 went silent at 15:00 and probably crashes before WiFi
  connects, so it needs a power cycle and maybe a USB reflash.

Narrowed down on deck3 over USB, 2026-10-22:

- Not corrupt flash data: deck3's SPIFFS (device.cfg, effects.cfg,
  current.cfg) read back as valid JSON. A full `erase_flash` plus a fresh
  config still crashed.
- Not a regression: the a0b1dd03 build crashes too.
- Every panic is in `WS281xOutputManager::Show()` on the render task. On the
  new build, `PixelFormat`'s vtable pointer is overwritten with what looks
  like packed pixel bytes (`35 46 17 40`), giving LoadStoreAlignment at
  0x40174641. On a0b1dd03, `Ws2812Format::Pack` reads through a null `leds`
  (LoadProhibited at 0, ledCount 110). Both point to heap corruption or a
  use-after-free on the output path.
- deck3 crashed only while LED-Central was streaming to it, usually soon
  after boot. When it was running its own effects it stayed up, and later
  streaming runs (pseudo or true random, and a reboot while streaming)
  stayed up too, so it's intermittent. A crash can sustain itself: reboot,
  LED-Central reconnects at once, crash again.
- The boot log allocates a GFX for channel 3 although only 3 channels are
  active. Probably harmless, but worth checking.
- deck3 is on USB with a serial logger writing timestamped lines to
  `~/led-logs/deck3-serial.log` on the laptop (`serial-logger.py`).

## Crash log access on the controllers

When a controller panics, the backtrace only goes to its USB serial port, so a
controller out on the deck can't be diagnosed without carrying it in and
plugging it in (deck3, 2026-10-22). Make the last crash readable over WiFi:

- Give every build a coredump partition. `partitions_custom_8M.csv`, used by
  xiao_sense (deck3, matrix-16x16), has none, so the boot log shows
  `esp_core_dump_flash: Core dump flash config is corrupted!`. The `_v3`
  tables already have one. Changing the partition table needs a USB flash.
- Add a REST endpoint (e.g. `/api/v1/crash`) that returns the stored
  coredump summary: exception cause, PC, backtrace and ELF SHA. Clear it after
  reading, and report "crash present" in `/statistics` so the deck monitor and
  LED-Central can flag it.
- Decode it on the laptop with `xtensa-esp32s3-elf-addr2line -pfiaC -e
  .pio/build/<env>/firmware.elf <addresses>` (or `riscv32-esp-elf-addr2line`
  for the C5), checking that the ELF SHA matches.

## Small background playback skips

Matrix-16x16, Garage and Deck11 log a steady trickle of small (~100-400 ms)
`[playback] ... skipping ahead` warnings, with or without the stalled-controller
fix in 9cf2968. They're unrelated to deck WiFi dropouts and haven't been looked
into yet.
