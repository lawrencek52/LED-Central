import dns from "node:dns";
import net from "node:net";

// Resolves controller hostnames (deck3.local etc.) to an IP that callers dial
// directly, instead of handing the hostname to net/fetch/WebSocket and letting
// each one do its own lookup.
//
// Why: Node's dns.lookup runs on the 4-thread libuv pool, and on deck.local a
// .local name that doesn't answer holds a thread for ~5s (nss-mdns timeout).
// Every offline channel used to start a fresh lookup on each ~6s reconnect
// attempt without waiting for the last one, so one dead controller plus the
// matrices that are switched off at night queued lookups faster than the pool
// drained them. Seen live 2026-10-10/11: weather fetches failed for the whole
// outage, and Deck3 stayed dark 25-35 min after it was reachable again
// because its own lookups were stuck at the back of that queue.
//
// So: at most one lookup in flight per hostname, a cooldown after a failed
// one, and the last good address is kept and dialed while a refresh runs in
// the background - a controller that is back on its old IP reconnects without
// needing mDNS at all.
export class HostResolver {
  constructor({
    lookup = (host) => dns.promises.lookup(host, { family: 4 }),
    retryDelayMs = 10000,
    now = Date.now,
  } = {}) {
    this.lookup = lookup;
    this.retryDelayMs = retryDelayMs;
    this.now = now;
    // host -> { address, stale, failedUntil, error }
    this.entries = new Map();
    this.pending = new Map();
  }

  // The address to dial for `host` right now. IP literals pass straight
  // through; a known address is returned immediately (refreshing in the
  // background if it was marked stale); otherwise this waits on the single
  // shared lookup, or rejects at once during a failed lookup's cooldown.
  async address(host) {
    if (net.isIP(host)) return host;
    const entry = this.entries.get(host);
    if (entry?.address) {
      if (entry.stale) this.refresh(host).catch(() => {});
      return entry.address;
    }
    if (entry?.failedUntil > this.now()) throw entry.error;
    return this.refresh(host);
  }

  // The controller at `host` stopped answering: its address may have changed
  // (new DHCP lease), so look it up again - in the background, still at most
  // once at a time and not during a failure cooldown.
  markUnreachable(host) {
    if (net.isIP(host)) return;
    const entry = this.entries.get(host);
    if (entry) entry.stale = true;
  }

  refresh(host) {
    const pending = this.pending.get(host);
    if (pending) return pending;
    const entry = this.entries.get(host) ?? {};
    if (entry.failedUntil > this.now()) {
      return entry.address ? Promise.resolve(entry.address) : Promise.reject(entry.error);
    }
    const lookup = Promise.resolve()
      .then(() => this.lookup(host))
      .then(({ address }) => {
        this.entries.set(host, { address, stale: false, failedUntil: 0 });
        return address;
      })
      .catch((error) => {
        this.entries.set(host, {
          ...entry,
          failedUntil: this.now() + this.retryDelayMs,
          error,
        });
        if (entry.address) return entry.address;
        throw error;
      })
      .finally(() => this.pending.delete(host));
    this.pending.set(host, lookup);
    return lookup;
  }
}
