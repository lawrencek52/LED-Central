# LED-Central
Central controller for many NightDriverStrip Controllers

I have multiple NightDriverStrip controllers. Each controller can operate up to four
independent strips of LEDs. Each controller has a few build-in effects (or patterns)
for the strips of LEDs. The effects can be individually selected for each strip, or 
one pattern can be used for all four strips of LEDs. The code for NightDriverStrip is
in the directory `../NightDriverStrip`

The NightDriverStrip program also has a build-in http server, when a phone, tablet,
or laptop connects to the server the displayed web pages permit selecting the effects
on each of the strips of LEDs. However each controller has it's own web page and the
user must open a seperate browser window to each controller to control all of the LEDs.

The NightDriverStrip program can also receive effects on a socket at port 49152. The 
effects are received one frame at a time and may be uncompressed, or in a compressed
format. Received effect frames are timestamped for when they should be displayed, and
multiple frames may be queued. Each effect frame is transferred to the LED strips at the
appropriate time, and nothing happens until the next frame is displayed.

Receiving effects over a web socket allows a higher level controller to build effects
that span multiple strips and multiple controllers. The goal of this program is to design
and build the higher level control.

There is a program called NDSCPP in the directory `../NDSCPP` that can send effects to
each channel on a controller, or effects to all controllers. NDSCPP is the baseline
program that will be extended to build the LED-Central controller for all of the strip
controllers and all of the individual strips.

Start by copying the NDSCPP source code and configuration files for `vscode`, `PlatformIO`,
and any other relevant files into this LED-Central directory.

NDSCPP is configured by a file called `config.led`. The file `config.led` is a JSON file
which contains basic configuration information for the LED strips. Manually editing
`config.led` is too time consuming, hence instead of editing the file directly, the user
should be able to connect to a LED-Central HTTP server and select the effects, that are
sent to each strip on each controller. The NightDriverStrip program contains a HTTP the code
for a HTTP server that controls one set of strips. Copy this HTTP server and extend it to
handle more than 4 strips.
