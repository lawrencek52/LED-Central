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
        last_seen TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
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
      INSERT INTO controllers (id, name, host, port, connected, strips, last_seen, created_at, updated_at)
      VALUES (@id, @name, @host, @port, @connected, @strips, @lastSeen, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        host = excluded.host,
        port = excluded.port,
        connected = excluded.connected,
        strips = excluded.strips,
        last_seen = excluded.last_seen,
        updated_at = excluded.updated_at
    `).run({
      ...controller,
      connected: controller.connected ? 1 : 0,
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
    lastSeen: row.last_seen,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
