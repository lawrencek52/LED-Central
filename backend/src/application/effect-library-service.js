import { v4 as uuidv4 } from "uuid";

export class EffectLibraryError extends Error {
  constructor(message, statusCode = 400, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class EffectLibraryService {
  constructor({ repository, idFactory = uuidv4, now = () => new Date() }) {
    this.repository = repository;
    this.idFactory = idFactory;
    this.now = now;
  }

  list() {
    return this.repository.list();
  }

  get(id) {
    return this.repository.get(id);
  }

  create(input) {
    const timestamp = this.now().toISOString();
    return this.repository.save({
      id: input.id || this.idFactory(),
      name: input.name,
      description: input.description || "",
      renderer: input.renderer,
      parameters: input.parameters || {},
      tags: input.tags || [],
      sortOrder: input.sortOrder ?? this.repository.list().length,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  update(id, input) {
    const existing = this.get(id);
    if (!existing) return null;
    return this.repository.save({
      ...existing,
      ...input,
      id,
      updatedAt: this.now().toISOString(),
    });
  }

  remove(id) {
    return this.repository.remove(id);
  }
}
