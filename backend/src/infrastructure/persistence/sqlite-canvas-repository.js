import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { normalizeCanvas } from '../../domain/canvases/canvas.js';

export class SqliteCanvasRepository {
  constructor({ databasePath }) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma('journal_mode = WAL');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS canvases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        mappings_json TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  list() {
    return this.database.prepare('SELECT * FROM canvases ORDER BY name').all().map(toCanvas);
  }

  get(id) {
    const row = this.database.prepare('SELECT * FROM canvases WHERE id = ?').get(id);
    return row ? toCanvas(row) : null;
  }

  save(canvas) {
    this.database.prepare(`
      INSERT INTO canvases (id, name, width, height, mappings_json, revision, created_at, updated_at)
      VALUES (@id, @name, @width, @height, @mappingsJson, @revision, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        width = excluded.width,
        height = excluded.height,
        mappings_json = excluded.mappings_json,
        revision = excluded.revision,
        updated_at = excluded.updated_at
    `).run({
      ...canvas,
      mappingsJson: JSON.stringify(canvas.mappings),
      createdAt: canvas.createdAt,
      updatedAt: canvas.updatedAt
    });
    return this.get(canvas.id);
  }

  remove(id) {
    return this.database.prepare('DELETE FROM canvases WHERE id = ?').run(id).changes > 0;
  }

  close() {
    this.database.close();
  }
}

function toCanvas(row) {
  return normalizeCanvas({
    id: row.id,
    name: row.name,
    width: row.width,
    height: row.height,
    mappings: JSON.parse(row.mappings_json),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}
