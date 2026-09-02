import test from "node:test";
import assert from "node:assert/strict";
import { bringControllersOnline } from "./controller-online-service.js";

function makeControllerService(controllers) {
  const states = new Map();
  return {
    list: () => controllers,
    setConnectionState: (id, connected) => states.set(id, connected),
    states,
  };
}

test("marks reachable controllers online and unreachable ones offline", async () => {
  const controllers = [
    { id: "good", host: "good-host", port: 1 },
    { id: "bad", host: "bad-host", port: 2 },
  ];
  const controllerService = makeControllerService(controllers);
  const gateway = {
    connect: async (controller) => {
      if (controller.id === "bad") throw new Error("connection refused");
      return {};
    },
  };

  const result = await bringControllersOnline({ controllerService, gateway });

  assert.deepEqual(result.online, ["good"]);
  assert.equal(result.offline.length, 1);
  assert.equal(result.offline[0].controllerId, "bad");
  assert.match(result.offline[0].error, /connection refused/);
  assert.equal(controllerService.states.get("good"), true);
  assert.equal(controllerService.states.get("bad"), false);
});
