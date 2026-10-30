import { halloweenLightningStrikes } from "./effect-render-service.js";

// Plays a thunder clip on a canvas's sound streamer (an Arylic/LinkPlay device, see
// canvas.soundStreamer) for every Halloween lightning strike. Strike times come from the
// same seeded schedule the renderer draws the flashes from, so each run's sounds match its
// flashes. Every tick looks ahead a few seconds and schedules a play command for each
// upcoming strike, thunderLeadMs before it appears, to cover the streamer's start-up
// delay. The clip itself has a short silence before the crack.
//
// The clip, media/sounds/thunder.wav, is "Closeup Thunder Strike 01" by loganzsound,
// https://freesound.org/people/loganzsound/sounds/840628/ (Creative Commons 0);
// thunder-dim.wav is the same clip 10 dB quieter.
//
// The thunder follows the controllers' nightly brightness schedule (SCHEDULE_STATE in
// their /statistics): the quieter clip while the canvas is dimmed, none while it's off.
// A different file rather than the streamer's volume, which would also change anything
// else it plays. Each controller's state is refreshed in the background and cached, so
// nothing waits on it at strike time.
//
// While the streamer is playing something, playPromptUrl plays the clip over it with
// the music ducked. Otherwise it gets plain setPlayerCmd:play: idle, Arylic answers
// playPromptUrl with "Failed", and in network mode after a previous clip it answers "OK"
// but stays silent (seen on S10+ firmware 4.6.415145). So check getPlayerStatus first,
// and fall back to play if the prompt is refused anyway.

const TICK_MS = 500;
const LOOKAHEAD_MS = 3000;
// A strike whose send time has already slipped by more than this is skipped rather
// than played late.
const MAX_LATE_MS = 250;
const SCHEDULE_REFRESH_MS = 15_000;

export class ThunderService {
  constructor({
    playbackService,
    canvasService,
    effectService,
    controllerService = null,
    // (controller, path) -> URL on that controller (TcpControllerGateway.controllerUrl).
    controllerUrl = null,
    soundUrls,                      // { normal, dim }
    fetchImpl = fetch,
    now = () => Date.now(),
    setTimer = setTimeout,
    log = console,
  }) {
    this.playbackService = playbackService;
    this.canvasService = canvasService;
    this.effectService = effectService;
    this.controllerService = controllerService;
    this.controllerUrl = controllerUrl;
    this.soundUrls = soundUrls;
    this.scheduleStates = new Map(); // controllerId -> { state, at, inFlight }
    this.canvasStates = new Map();   // canvasId -> last state played under, for logging
    this.fetch = fetchImpl;
    this.now = now;
    this.setTimer = setTimer;
    this.log = log;
    this.scheduled = new Map();     // "sessionId:strikeSeconds" -> send time (ms)
    this.interval = null;
  }

  start() {
    if (!this.interval) this.interval = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    clearInterval(this.interval);
    this.interval = null;
  }

  // Effective Halloween parameters for a session: the effect's defaults overlaid with
  // what the run was started with, plus its true-random seed.
  sessionParameters(effect, session) {
    const defaults = Object.fromEntries(
      Object.entries(effect.parameters ?? {}).map(([name, definition]) => [name, definition.default]),
    );
    return { ...defaults, ...session.parameters, sessionSeed: session.sessionSeed ?? 0 };
  }

  tick() {
    const now = this.now();
    for (const session of this.playbackService.list()) {
      if (session.status !== "playing") continue;
      const effect = this.effectService.get(session.effectId);
      if (effect?.renderer !== "halloween") continue;
      const canvas = this.canvasService.get(session.canvasId);
      const streamer = canvas?.soundStreamer;
      if (!streamer) continue;
      this.refreshScheduleStates(canvas, now);
      const parameters = this.sessionParameters(effect, session);
      if (parameters.thunder === false) continue;

      const leadMs = Math.max(0, Math.min(5000, Number(parameters.thunderLeadMs ?? 300)));
      const startedAt = Date.parse(session.startedAt);
      const fromSeconds = (now - startedAt) / 1000;
      const toSeconds = fromSeconds + (LOOKAHEAD_MS + leadMs) / 1000;
      for (const strikeSeconds of halloweenLightningStrikes(parameters, fromSeconds, toSeconds)) {
        const key = `${session.id}:${strikeSeconds}`;
        if (this.scheduled.has(key)) continue;
        const sendAt = startedAt + strikeSeconds * 1000 - leadMs;
        this.scheduled.set(key, sendAt);
        if (sendAt - now < -MAX_LATE_MS) continue;
        this.setTimer(() => this.play(streamer, session.id, canvas), Math.max(0, sendAt - now));
      }
    }
    for (const [key, sendAt] of this.scheduled) {
      if (sendAt < now - 60_000) this.scheduled.delete(key);
    }
  }

  // The canvas follows its brightest controller: normal if any is normal, else dim if any
  // is dim, else off. A controller that doesn't report a state (unreachable, or firmware
  // without SCHEDULE_STATE) counts as normal - better a strike too loud than a silent one.
  scheduleState(canvas) {
    const states = [...new Set((canvas.mappings ?? []).map((mapping) => mapping.controllerId))]
      .map((id) => this.scheduleStates.get(id)?.state ?? "normal");
    if (states.length === 0 || states.includes("normal")) return "normal";
    return states.includes("dim") ? "dim" : "off";
  }

  refreshScheduleStates(canvas, now) {
    if (!this.controllerService || !this.controllerUrl) return;
    for (const id of new Set((canvas.mappings ?? []).map((mapping) => mapping.controllerId))) {
      const cached = this.scheduleStates.get(id) ?? {};
      if (cached.inFlight || now - (cached.at ?? 0) < SCHEDULE_REFRESH_MS) continue;
      const controller = this.controllerService.get(id);
      if (!controller) continue;
      this.scheduleStates.set(id, { ...cached, inFlight: true });
      this.controllerUrl(controller, "/statistics/dynamic")
        .then((url) => this.fetch(url, { signal: AbortSignal.timeout(3000) }))
        .then((response) => response.json())
        .then((stats) => this.scheduleStates.set(id, { state: stats.SCHEDULE_STATE ?? "normal", at: this.now() }))
        .catch(() => this.scheduleStates.set(id, { state: cached.state, at: this.now() }));
    }
  }

  async play(streamer, sessionId, canvas) {
    // Skip a strike whose run was stopped or replaced after it was scheduled.
    if (this.playbackService.list().every((session) => session.id !== sessionId || session.status !== "playing"))
      return;
    const state = canvas ? this.scheduleState(canvas) : "normal";
    if (canvas && this.canvasStates.get(canvas.id) !== state) {
      this.canvasStates.set(canvas.id, state);
      const effect = { normal: "full-volume thunder", dim: "thunder 10 dB quieter", off: "no thunder" }[state];
      this.log.info?.(`${new Date().toISOString()} [thunder] ${canvas.name ?? canvas.id}: schedule ${state} - ${effect}`);
    }
    if (state === "off") return;
    const soundUrl = state === "dim" ? this.soundUrls.dim : this.soundUrls.normal;
    try {
      if (await this.isPlaying(streamer)) {
        const prompt = await this.command(streamer, `playPromptUrl:${soundUrl}`);
        if (prompt.trim() === "OK") return;
      }
      await this.command(streamer, `setPlayerCmd:play:${soundUrl}`);
    } catch (error) {
      this.log.warn?.(`${new Date().toISOString()} [thunder] ${streamer}: ${error.message}`);
    }
  }

  async isPlaying(streamer) {
    try {
      return JSON.parse(await this.command(streamer, "getPlayerStatus")).status === "play";
    } catch {
      return false;
    }
  }

  async command(streamer, command) {
    const response = await this.fetch(`http://${streamer}/httpapi.asp?command=${command}`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.text();
  }
}
