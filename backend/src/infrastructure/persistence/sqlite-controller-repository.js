import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export class SqliteControllerRepository {
  constructor({ databasePath }) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma('journal_mode = WAL');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS controllers (
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
    const columns = this.database.prepare('PRAGMA table_info(controllers)').all();
    if (!columns.some(column => column.name === 'led_counts_json')) {
      this.database.exec("ALTER TABLE controllers ADD COLUMN led_counts_json TEXT NOT NULL DEFAULT '[215,215,215,215]'");
    }
    if (!columns.some(column => column.name === 'audio_available')) {
      this.database.exec('ALTER TABLE controllers ADD COLUMN audio_available INTEGER NOT NULL DEFAULT -1');
    }
    if (!columns.some(column => column.name === 'audio_checked_at')) {
      this.database.exec('ALTER TABLE controllers ADD COLUMN audio_checked_at TEXT DEFAULT NULL');
    }
  }

  list() {
    return this.database.prepare('SELECT * FROM controllers ORDER BY name').all().map(toController);
  }

  get(id) {
    const row = this.database.prepare('SELECT * FROM controllers WHERE id = ?').get(id);
    return row ? toController(row) : null;
  }

  save(controller) {
    this.database.prepare(`
      INSERT INTO controllers (id, name, host, port, connected, strips, led_counts_json, audio_available, audio_checked_at, last_seen, created_at, updated_at)
      VALUES (@id, @name, @host, @port, @connected, @strips, @ledCountsJson, @audioAvailable, @audioCheckedAt, @lastSeen, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        host = excluded.host,
        port = excluded.port,
        connected = excluded.connected,
        strips = excluded.strips,
        led_counts_json = excluded.led_counts_json,
        audio_available = excluded.audio_available,
        audio_checked_at = excluded.audio_checked_at,
        last_seen = excluded.last_seen,
        updated_at = excluded.updated_at
    `).run({
      ...controller,
      connected: controller.connected ? 1 : 0,
      ledCountsJson: JSON.stringify(controller.ledCounts || Array(controller.strips).fill(215)),
      audioAvailable: controller.audioAvailable === true ? 1 : controller.audioAvailable === false ? 0 : -1,
      audioCheckedAt: controller.audioCheckedAt ?? null,
      createdAt: controller.createdAt || controller.lastSeen,
      updatedAt: controller.updatedAt || controller.lastSeen
    });
    return this.get(controller.id);
  }

  remove(id) {
    return this.database.prepare('DELETE FROM controllers WHERE id = ?').run(id).changes > 0;
  }

  close() {
    this.database.close();
  }
}

function toController(row) {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    connected: Boolean(row.connected),
    strips: row.strips,
    ledCounts: JSON.parse(row.led_counts_json || JSON.stringify(Array(row.strips).fill(215))),
    audioAvailable: row.audio_available === 1 ? true : row.audio_available === 0 ? false : 'unknown',
    audioCheckedAt: row.audio_checked_at ?? null,
    lastSeen: row.last_seen,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
