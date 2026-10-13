import test from "node:test";
import assert from "node:assert/strict";
import { HostResolver } from "./host-resolver.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function notFound() {
  const error = new Error("getaddrinfo ENOTFOUND deck3.local");
  error.code = "ENOTFOUND";
  return error;
}

test("IP literals pass straight through without a lookup", async () => {
  const resolver = new HostResolver({
    lookup: () => assert.fail("should not look up an IP"),
  });
  assert.equal(await resolver.address("192.168.86.79"), "192.168.86.79");
});

test("concurrent callers share one lookup per hostname", async () => {
  let lookups = 0;
  const pending = deferred();
  const resolver = new HostResolver({
    lookup: () => {
      lookups += 1;
      return pending.promise;
    },
  });
  const results = Promise.all([
    resolver.address("deck3.local"),
    resolver.address("deck3.local"),
    resolver.address("deck3.local"),
  ]);
  pending.resolve({ address: "192.168.86.68" });
  assert.deepEqual(await results, ["192.168.86.68", "192.168.86.68", "192.168.86.68"]);
  assert.equal(lookups, 1);
  // Cached afterwards.
  assert.equal(await resolver.address("deck3.local"), "192.168.86.68");
  assert.equal(lookups, 1);
});

test("a failed lookup is not retried until its cooldown has passed", async () => {
  let now = 0;
  let lookups = 0;
  const resolver = new HostResolver({
    retryDelayMs: 10000,
    now: () => now,
    lookup: async () => {
      lookups += 1;
      throw notFound();
    },
  });
  await assert.rejects(resolver.address("deck3.local"), /ENOTFOUND/);
  await assert.rejects(resolver.address("deck3.local"), /ENOTFOUND/);
  assert.equal(lookups, 1);
  now = 10001;
  await assert.rejects(resolver.address("deck3.local"), /ENOTFOUND/);
  assert.equal(lookups, 2);
});

test("an unreachable host keeps dialing its last address while it re-resolves in the background", async () => {
  let now = 0;
  const answers = [
    async () => ({ address: "192.168.86.68" }),
    async () => {
      throw notFound();
    },
    async () => ({ address: "192.168.86.90" }),
  ];
  let lookups = 0;
  const resolver = new HostResolver({
    retryDelayMs: 10000,
    now: () => now,
    lookup: () => answers[lookups++](),
  });
  assert.equal(await resolver.address("deck3.local"), "192.168.86.68");

  // mDNS doesn't answer: the old address is still returned, and the failed
  // refresh holds off further lookups during its cooldown.
  resolver.markUnreachable("deck3.local");
  assert.equal(await resolver.address("deck3.local"), "192.168.86.68");
  await resolver.pending.get("deck3.local");
  assert.equal(await resolver.address("deck3.local"), "192.168.86.68");
  assert.equal(lookups, 2);

  // After the cooldown a refresh picks up a new DHCP address.
  now = 10001;
  assert.equal(await resolver.address("deck3.local"), "192.168.86.68");
  await resolver.pending.get("deck3.local");
  assert.equal(await resolver.address("deck3.local"), "192.168.86.90");
  assert.equal(lookups, 3);
});
