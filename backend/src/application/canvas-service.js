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
}
