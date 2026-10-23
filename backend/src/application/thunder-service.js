import { halloweenLightningStrikes } from "./effect-render-service.js";

// Plays a thunder clip on a canvas's sound streamer (an Arylic/LinkPlay device, see
// canvas.soundStreamer) for every Halloween lightning strike. Strike times come from the
// same seeded schedule the renderer draws the flashes from, so each run's sounds match its
// flashes. Every tick looks ahead a few seconds and schedules a play command for each
// upcoming strike, thunderLeadMs before it appears, to cover the streamer's start-up
// delay. The clip itself has a short silence before the crack.
//
// The clip, media/sounds/thunder.wav, is "Closeup Thunder Strike 01" by loganzsound,
// https://freesound.org/people/loganzsound/sounds/840628/ (Creative Commons 0).
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

export class ThunderService {
  constructor({
    playbackService,
    canvasService,
    effectService,
    soundUrl,
    fetchImpl = fetch,
    now = () => Date.now(),
    setTimer = setTimeout,
    log = console,
  }) {
    this.playbackService = playbackService;
    this.canvasService = canvasService;
    this.effectService = effectService;
    this.soundUrl = soundUrl;
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
      const streamer = this.canvasService.get(session.canvasId)?.soundStreamer;
      if (!streamer) continue;
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
        this.setTimer(() => this.play(streamer, session.id), Math.max(0, sendAt - now));
      }
    }
    for (const [key, sendAt] of this.scheduled) {
      if (sendAt < now - 60_000) this.scheduled.delete(key);
    }
  }

  async play(streamer, sessionId) {
    // Skip a strike whose run was stopped or replaced after it was scheduled.
    if (this.playbackService.list().every((session) => session.id !== sessionId || session.status !== "playing"))
      return;
    try {
      if (await this.isPlaying(streamer)) {
        const prompt = await this.command(streamer, `playPromptUrl:${this.soundUrl}`);
        if (prompt.trim() === "OK") return;
      }
      await this.command(streamer, `setPlayerCmd:play:${this.soundUrl}`);
    } catch (error) {
      this.log.warn?.(`[thunder] ${streamer}: ${error.message}`);
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
