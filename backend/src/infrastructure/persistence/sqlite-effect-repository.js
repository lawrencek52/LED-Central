import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export class SqliteEffectRepository {
  constructor({ databasePath, seedEffects = [] }) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS effects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        renderer TEXT NOT NULL,
        parameters_json TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    const columns = this.database.prepare("PRAGMA table_info(effects)").all();
    if (!columns.some((column) => column.name === "sort_order")) {
      this.database.exec(
        "ALTER TABLE effects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
      );
    }
    // Frame rate the effect should play at when the caller doesn't ask for
    // one (null = the playback default).
    if (!columns.some((column) => column.name === "default_fps")) {
      this.database.exec("ALTER TABLE effects ADD COLUMN default_fps INTEGER");
    }
    this.database
      .prepare("UPDATE effects SET sort_order = rowid WHERE sort_order = 0")
      .run();
    // "bouncing-balls" duplicated "nds-bouncing-balls-a" and was retired.
    this.remove("bouncing-balls");
    this.seed(seedEffects);
  }

  list() {
    return this.database
      .prepare("SELECT * FROM effects ORDER BY sort_order, name")
      .all()
      .map(toEffect);
  }

  get(id) {
    const row = this.database
      .prepare("SELECT * FROM effects WHERE id = ?")
      .get(id);
    return row ? toEffect(row) : null;
  }

  save(effect) {
    this.database
      .prepare(
        `
      INSERT INTO effects (id, name, description, renderer, parameters_json, tags_json, sort_order, default_fps, created_at, updated_at)
      VALUES (@id, @name, @description, @renderer, @parametersJson, @tagsJson, @sortOrder, @defaultFps, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        renderer = excluded.renderer,
        parameters_json = excluded.parameters_json,
        tags_json = excluded.tags_json,
        sort_order = excluded.sort_order,
        default_fps = excluded.default_fps,
        updated_at = excluded.updated_at
    `,
      )
      .run({
        ...effect,
        parametersJson: JSON.stringify(effect.parameters),
        tagsJson: JSON.stringify(effect.tags),
        sortOrder: effect.sortOrder ?? 0,
        defaultFps: effect.defaultFps ?? null,
        createdAt: effect.createdAt,
        updatedAt: effect.updatedAt,
      });
    return this.get(effect.id);
  }

  remove(id) {
    return (
      this.database.prepare("DELETE FROM effects WHERE id = ?").run(id)
        .changes > 0
    );
  }

  close() {
    this.database.close();
  }

  seed(effects) {
    const save = this.database.transaction((items) => {
      for (const [sortOrder, effect] of items.entries()) {
        const existing = this.get(effect.id);
        if (!existing) {
          this.save({
            ...effect,
            sortOrder,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        } else if (
          JSON.stringify(existing.parameters) !==
            JSON.stringify(effect.parameters) ||
          existing.description !== effect.description ||
          existing.renderer !== effect.renderer ||
          existing.defaultFps !== (effect.defaultFps ?? null)
        ) {
          // Refresh built-in definitions (e.g. parameter ranges) while
          // preserving user customizations like name and sort order.
          this.save({
            ...existing,
            description: effect.description,
            renderer: effect.renderer,
            parameters: effect.parameters,
            tags: effect.tags,
            defaultFps: effect.defaultFps ?? null,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    });
    save(effects);
  }
}

function toEffect(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    renderer: row.renderer,
    parameters: JSON.parse(row.parameters_json),
    tags: JSON.parse(row.tags_json),
    sortOrder: row.sort_order,
    defaultFps: row.default_fps ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
