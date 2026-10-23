import test from "node:test";
import assert from "node:assert/strict";
import { ThunderService } from "./thunder-service.js";
import { halloweenLightningStrikes } from "./effect-render-service.js";
import { defaultEffects } from "../domain/effects/default-effects.js";

const halloween = defaultEffects.find((effect) => effect.id === "halloween");

const NORMAL = "http://192.168.86.67:3001/sounds/thunder.wav";
const DIM = "http://192.168.86.67:3001/sounds/thunder-dim.wav";

function harness({ soundStreamer = "192.168.86.80", parameters = {}, effectId = "halloween", promptReply = "OK", playerStatus = "stop", scheduleStates = null } = {}) {
  const startedAt = Date.parse("2026-10-22T20:00:00Z");
  let now = startedAt;
  const session = { id: "s1", status: "playing", canvasId: "deck11", effectId, parameters, sessionSeed: 777, startedAt: new Date(startedAt).toISOString() };
  const timers = [];
  const requests = [];
  const service = new ThunderService({
    playbackService: { list: () => [session] },
    canvasService: { get: () => ({ id: "deck11", soundStreamer, mappings: Object.keys(scheduleStates ?? { deck1: 0 }).map((controllerId) => ({ controllerId })) }) },
    controllerService: scheduleStates ? { get: (id) => ({ id, host: `${id}.local` }) } : null,
    controllerUrl: scheduleStates ? async (controller, path) => `http://${controller.host}${path}` : null,
    effectService: { get: (id) => (id === "halloween" ? halloween : { id, renderer: "fire", parameters: {} }) },
    soundUrls: { normal: NORMAL, dim: DIM },
    fetchImpl: async (url) => {
      const statsFor = url.match(/^http:\/\/(\w+)\.local\/statistics\/dynamic$/);
      if (statsFor) {
        const state = scheduleStates[statsFor[1]];
        if (state instanceof Error) throw state;
        return { json: async () => ({ SCHEDULE_STATE: state }) };
      }
      requests.push(url);
      if (url.includes("getPlayerStatus")) return { text: async () => JSON.stringify({ status: playerStatus }) };
      return { text: async () => (url.includes("playPromptUrl") ? promptReply : "OK") };
    },
    now: () => now,
    setTimer: (callback, delay) => timers.push({ at: now + delay, callback }),
    log: { warn() {}, info() {} },
  });
  return {
    service, session, timers, requests, startedAt,
    advance(ms) { now += ms; },
    async runDue() {
      for (const timer of timers.filter((t) => t.at <= now && !t.done)) {
        timer.done = true;
        await timer.callback();
      }
    },
  };
}

test("thunder plays on the canvas's streamer each strike, thunderLeadMs before it", async () => {
  const h = harness({ parameters: { thunderLeadMs: 1500 } });
  const expected = halloweenLightningStrikes({ lightningPerMinute: 3, sessionSeed: 777 }, 0, 120)
    .map((at) => h.startedAt + at * 1000 - 1500);
  for (let elapsed = 0; elapsed < 120_000; elapsed += 500) {
    h.service.tick();
    h.advance(500);
  }
  assert.ok(expected.length > 0);
  // Each strike scheduled exactly once, at its send time (strikes within the lead of the start
  // are sent immediately, since their send time is already due).
  const scheduled = h.timers.map((timer) => timer.at).sort((a, b) => a - b);
  const reachable = expected.filter((sendAt) => sendAt >= h.startedAt - 250);
  assert.equal(scheduled.length, reachable.length);
  scheduled.forEach((at, i) => assert.ok(Math.abs(at - Math.max(reachable[i], h.startedAt)) <= 500, `${at} vs ${reachable[i]}`));
});

test("thunder ducks music with playPromptUrl, and otherwise (or if refused) uses play", async () => {
  for (const [playerStatus, promptReply, commands] of [
    ["play", "OK", ["playPromptUrl"]],
    ["play", "Failed", ["playPromptUrl", "setPlayerCmd:play"]],
    ["stop", "OK", ["setPlayerCmd:play"]],
  ]) {
    const h = harness({ playerStatus, promptReply });
    while (h.timers.length === 0) { h.service.tick(); h.advance(500); }
    h.advance(10_000);
    await h.runDue();
    const first = h.requests.filter((url) => !url.includes("getPlayerStatus")).slice(0, commands.length);
    assert.deepEqual(first.map((url) => url.match(/command=(playPromptUrl|setPlayerCmd:play)/)[1]), commands);
    assert.ok(first.every((url) => url.startsWith("http://192.168.86.80/httpapi.asp?command=") && url.endsWith(`:${NORMAL}`)));
  }
});

test("no thunder without a streamer, with thunder off, for other effects, or after the run stops", async () => {
  for (const options of [{ soundStreamer: "" }, { parameters: { thunder: false } }, { effectId: "fire" }]) {
    const h = harness(options);
    for (let i = 0; i < 240; i += 1) { h.service.tick(); h.advance(500); }
    assert.equal(h.timers.length, 0, JSON.stringify(options));
  }
  const h = harness();
  while (h.timers.length === 0) { h.service.tick(); h.advance(500); }
  h.session.status = "stopped";
  h.advance(10_000);
  await h.runDue();
  assert.equal(h.requests.length, 0);
});

test("thunder follows the controllers' nightly schedule: quieter while dimmed, none while off", async () => {
  const cases = [
    [{ deck1: "dim", deck2: "dim" }, DIM],
    [{ deck1: "off", deck2: "off" }, null],
    [{ deck1: "off", deck2: "dim" }, DIM],
    [{ deck1: "dim", deck2: "normal" }, NORMAL],
    [{ deck1: new Error("unreachable"), deck2: "off" }, NORMAL],
  ];
  for (const [scheduleStates, expected] of cases) {
    const h = harness({ scheduleStates });
    while (h.timers.length === 0) { h.service.tick(); h.advance(500); }
    await new Promise((resolve) => setImmediate(resolve));   // let the state fetches land
    h.advance(10_000);
    await h.runDue();
    const plays = h.requests.filter((url) => url.includes("setPlayerCmd:play"));
    if (expected === null) assert.equal(plays.length, 0, JSON.stringify(scheduleStates));
    else assert.ok(plays.length > 0 && plays.every((url) => url.endsWith(`:${expected}`)), `${String(Object.values(scheduleStates))}: ${plays}`);
  }
});
