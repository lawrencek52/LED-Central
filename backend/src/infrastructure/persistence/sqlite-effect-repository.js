import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export class SqliteEffectRepository {
  constructor({ databasePath, seedEffects = [] }) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma('journal_mode = WAL');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS effects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        renderer TEXT NOT NULL,
        parameters_json TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.seed(seedEffects);
  }

  list() {
    return this.database.prepare('SELECT * FROM effects ORDER BY name').all().map(toEffect);
  }

  get(id) {
    const row = this.database.prepare('SELECT * FROM effects WHERE id = ?').get(id);
    return row ? toEffect(row) : null;
  }

  save(effect) {
    this.database.prepare(`
      INSERT INTO effects (id, name, description, renderer, parameters_json, tags_json, created_at, updated_at)
      VALUES (@id, @name, @description, @renderer, @parametersJson, @tagsJson, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        renderer = excluded.renderer,
        parameters_json = excluded.parameters_json,
        tags_json = excluded.tags_json,
        updated_at = excluded.updated_at
    `).run({
      ...effect,
      parametersJson: JSON.stringify(effect.parameters),
      tagsJson: JSON.stringify(effect.tags),
      createdAt: effect.createdAt,
      updatedAt: effect.updatedAt
    });
    return this.get(effect.id);
  }

  remove(id) {
    return this.database.prepare('DELETE FROM effects WHERE id = ?').run(id).changes > 0;
  }

  close() {
    this.database.close();
  }

  seed(effects) {
    const save = this.database.transaction(items => {
      for (const effect of items) {
        if (!this.get(effect.id)) {
          this.save({
            ...effect,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
