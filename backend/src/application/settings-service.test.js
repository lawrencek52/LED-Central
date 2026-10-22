import test from "node:test";
import assert from "node:assert/strict";
import { SettingsService } from "./settings-service.js";

function memoryRepository() {
  const values = {};
  return { list: () => ({ ...values }), save: (key, value) => { values[key] = value; } };
}

test("settings default to true random and persist changes", () => {
  const repository = memoryRepository();
  const service = new SettingsService({ repository });
  assert.equal(service.get().trueRandom, true);
  assert.deepEqual(service.update({ trueRandom: false }), { trueRandom: false });
  assert.equal(new SettingsService({ repository }).get().trueRandom, false);
});

test("settings reject unknown keys and wrong types without saving anything", () => {
  const service = new SettingsService({ repository: memoryRepository() });
  assert.throws(() => service.update({ volume: 3 }), /Unknown setting/);
  assert.throws(() => service.update({ trueRandom: "yes" }), /Invalid value/);
  assert.equal(service.get().trueRandom, true);
});
