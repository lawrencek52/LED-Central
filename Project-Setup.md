# LED-Central: original project brief

> This is the brief LED-Central was started from in August 2026, kept for
> history. Much of it has since been built, and some of it was done
> differently; see [README.md](README.md) and [docs/](docs/) for the
> current state. The stock server described at the end is not used by the
> Stock Banner effect yet.

Central controller for many NightDriverStrip Controllers

I have multiple NightDriverStrip controllers. Each controller can operate up to four
independent strips of LEDs. Each controller has a few build-in effects (or patterns)
for the strips of LEDs. The effects can be individually selected for each strip, or
one pattern can be used for all four strips of LEDs. The code for NightDriverStrip is
in the directory `../NightDriverStrip`

The NightDriverStrip program also has a build-in http server, a phone, a tablet,
or a laptop can connect to the server, the displayed web pages permit selecting the
effects on each of the strips of LEDs. However each controller has it's own web page
and the user must open a separate browser window to each controller to control all
of the LEDs.

The NightDriverStrip program can also receive effects on a socket at port 49152. The
effects are received one frame at a time and may be uncompressed, or in a compressed
format. Received effect frames are timestamped for when they should be displayed, and
multiple frames may be queued. Each effect frame is transferred to the LED strips at the
appropriate time, then nothing happens until the next frame is displayed.

Receiving effects over a web socket allows a higher level controller to build effects
that span multiple strips and multiple controllers. The goal of this program is to design
and build the higher level control into a program called LED-Central.

There is a program called NDSCPP in the directory `../NDSCPP` that can send effects to
each channel on a controller, or effects to multiple controllers. NDSCPP is the baseline
program that will be extended to build the LED-Central controller for all of the strip
controllers and all of the individual strips.

Start by copying the NDSCPP source code and configuration files for `vscode`, `PlatformIO`,
and any other relevant files into this LED-Central directory.

NDSCPP is configured by a file called `config.led`. The file `config.led` is a JSON file
which contains basic configuration information for the LED strips. Manually editing
`config.led` is too time consuming, hence instead of editing the file directly, the user
should be able to connect to a LED-Central HTTP server and select the effects, that are
sent to each strip on each controller. The NightDriverStrip program contains the code
for a HTTP server that controls one set of strips. Copy this HTTP server and extend it to
handle more than 4 strips, up to a maximum of 100 strips.

Groups of LED strips can be arranged to build a much larger canvas. LED-Control will need
a method (HTTP page) to configure the canvas. A canvas can be multiple LED strips in series
around the house, strips in parallel to create a wider canvas, or a combination of serial and
parallel LED strips. A canvas can also be an XY array of LEDs in series, the individual LEDs are
wired in a serpentine pattern where the data order is left to right across one row, then down
to the next row and across right to left and so on for all rows. The effects will need to be
drawn across an entire canvas rather than just a single LED strip.

The LED-Central server should be able to create any of the effects currently in both NDSCPP
and NightDriverStrip. In addition to these effects there are many effects in the program WLED
(see `../WLED`), and in the program FastLED (see `../FastLED`). The goal is to extract all of
the effects from WLED and FastLED and add them to the repertoire of LED-Central. The effects in
both WLED and FastLED have many more settings than the simpler effects in NDSCPP and
NightDriverStrip, hence the HTTP server will need to have pages dedicated to configuring the
more complex effects.

The stock ticker effect requires a local server that collects current stock prices and makes
them prices available to LED-Central. To setup the server you need:
```
pip install flask yfinance
```
then start the stock server with
```
python scripts/stock_server.py
```
you can test that the server is running
```
http://<your-raspberry-pi-ip>:5000/api/stocks
```
