import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export class SqlitePlaybackRepository {
  constructor({ databasePath }) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS playback_intents (
        canvas_id TEXT PRIMARY KEY,
        effect_id TEXT NOT NULL,
        parameters_json TEXT NOT NULL,
        frame_rate INTEGER NOT NULL
      )
    `);
  }

  list() {
    return this.database
      .prepare("SELECT * FROM playback_intents ORDER BY canvas_id")
      .all()
      .map((row) => ({
        canvasId: row.canvas_id,
        effectId: row.effect_id,
        parameters: JSON.parse(row.parameters_json),
        fps: row.frame_rate,
      }));
  }

  save({ canvasId, effectId, parameters, fps }) {
    this.database
      .prepare(
        `
        INSERT INTO playback_intents (canvas_id, effect_id, parameters_json, frame_rate)
        VALUES (@canvasId, @effectId, @parametersJson, @fps)
        ON CONFLICT(canvas_id) DO UPDATE SET
          effect_id = excluded.effect_id,
          parameters_json = excluded.parameters_json,
          frame_rate = excluded.frame_rate
      `,
      )
      .run({
        canvasId,
        effectId,
        parametersJson: JSON.stringify(parameters),
        fps,
      });
  }

  remove(canvasId) {
    return (
      this.database
        .prepare("DELETE FROM playback_intents WHERE canvas_id = ?")
        .run(canvasId).changes > 0
    );
  }
}
