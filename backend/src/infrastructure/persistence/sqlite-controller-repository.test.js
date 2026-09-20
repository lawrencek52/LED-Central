import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SqliteControllerRepository } from './sqlite-controller-repository.js';

test('persists controller configuration across repository instances', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'led-central-controllers-'));
  const databasePath = path.join(directory, 'led-central.db');
  const controller = {
    id: 'deck-one', name: 'Deck One', host: 'deck1.local', port: 49152,
    connected: false, strips: 4, lastSeen: '2026-01-01T00:00:00.000Z'
  };
  const first = new SqliteControllerRepository({ databasePath });
  first.save(controller);
  first.close();

  const second = new SqliteControllerRepository({ databasePath });
  assert.deepEqual(second.get(controller.id), {
    ...controller,
    ledCounts: [215, 215, 215, 215],
    ledsPerMeter: [0, 0, 0, 0],
    audioAvailable: 'unknown',
    audioCheckedAt: null,
    createdAt: controller.lastSeen,
    updatedAt: controller.lastSeen
  });
  assert.equal(second.remove(controller.id), true);
  second.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('round-trips a detected leds-per-meter density, and migrates a pre-density database', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'led-central-controllers-'));
  const databasePath = path.join(directory, 'led-central.db');

  // Simulate a database created before leds_per_meter_json existed.
  const legacyDb = new Database(databasePath);
  legacyDb.exec(`
    CREATE TABLE controllers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      connected INTEGER NOT NULL DEFAULT 0,
      strips INTEGER NOT NULL DEFAULT 4,
      led_counts_json TEXT NOT NULL DEFAULT '[215,215,215,215]',
      audio_available INTEGER NOT NULL DEFAULT -1,
      audio_checked_at TEXT DEFAULT NULL,
      last_seen TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  legacyDb.prepare(`
    INSERT INTO controllers (id, name, host, port, strips, led_counts_json, last_seen, created_at, updated_at)
    VALUES ('deck-two', 'Deck Two', 'deck2.local', 49152, 3, '[110,215,110]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `).run();
  legacyDb.close();

  const migrated = new SqliteControllerRepository({ databasePath });
  // The ALTER TABLE DEFAULT applies the same 4-zero literal to every pre-existing row regardless
  // of that row's own strip count - the same characteristic led_counts_json's own migration
  // already has (its DEFAULT is a fixed 4-entry '[215,215,215,215]' too). A controller whose
  // strip count differs from 4 ends up with a mismatched-length array until its next full
  // save() - not something this migration (or led_counts_json's) tries to reconcile.
  assert.deepEqual(migrated.get('deck-two').ledsPerMeter, [0, 0, 0, 0]);

  const updated = migrated.save({
    ...migrated.get('deck-two'),
    ledsPerMeter: [30, 60, 30]
  });
  assert.deepEqual(updated.ledsPerMeter, [30, 60, 30]);
  assert.deepEqual(migrated.get('deck-two').ledsPerMeter, [30, 60, 30]);

  migrated.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
