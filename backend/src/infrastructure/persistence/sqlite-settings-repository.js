import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

// Global LED-Central settings, one JSON value per key.
export class SqliteSettingsRepository {
  constructor({ databasePath }) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      )
    `);
  }

  list() {
    return Object.fromEntries(
      this.database
        .prepare("SELECT key, value_json FROM settings")
        .all()
        .map((row) => [row.key, JSON.parse(row.value_json)]),
    );
  }

  save(key, value) {
    this.database
      .prepare(
        `
        INSERT INTO settings (key, value_json) VALUES (@key, @valueJson)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
      `,
      )
      .run({ key, valueJson: JSON.stringify(value) });
  }
}
