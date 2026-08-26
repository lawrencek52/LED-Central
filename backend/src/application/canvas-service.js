import { v4 as uuidv4 } from 'uuid';

export class CanvasService {
  constructor({ repository, idFactory = uuidv4, now = () => new Date() }) {
    this.repository = repository;
    this.idFactory = idFactory;
    this.now = now;
  }

  list() { return this.repository.list(); }
  get(id) { return this.repository.get(id); }

  create(input) {
    this.assertStripsAvailable(input.mappings);
    const timestamp = this.now().toISOString();
    return this.repository.save({
      id: this.idFactory(),
      ...input,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  update(id, input, expectedRevision) {
    const existing = this.get(id);
    if (!existing) return null;
    this.assertStripsAvailable(input.mappings, id);
    if (expectedRevision !== undefined && expectedRevision !== existing.revision) {
      const error = new Error('Canvas revision conflict');
      error.statusCode = 409;
      error.details = { expectedRevision, actualRevision: existing.revision };
      throw error;
    }
    return this.repository.save({
      ...existing,
      ...input,
      id,
      revision: existing.revision + 1,
      updatedAt: this.now().toISOString()
    });
  }

  remove(id) { return this.repository.remove(id); }

  assertStripsAvailable(mappings = [], canvasId = null) {
    const requested = new Set();
    const conflicts = [];
    for (const mapping of mappings) {
      const key = `${mapping.controllerId}:${mapping.stripIndex}`;
      if (requested.has(key)) conflicts.push({ ...mapping, reason: 'duplicate in canvas' });
      requested.add(key);
    }

    for (const canvas of this.repository.list()) {
      if (canvas.id === canvasId) continue;
      for (const mapping of canvas.mappings) {
        const key = `${mapping.controllerId}:${mapping.stripIndex}`;
        if (requested.has(key)) conflicts.push({ ...mapping, reason: `already assigned to canvas ${canvas.name}` });
      }
    }

    if (conflicts.length > 0) {
      const error = new Error('One or more LED strips are already assigned to a canvas');
      error.statusCode = 409;
      error.details = { mappings: conflicts };
      throw error;
    }
  }
}
