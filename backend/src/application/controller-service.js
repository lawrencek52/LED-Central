import { v4 as uuidv4 } from 'uuid';

export class ControllerService {
  constructor({ repository, controllers = new Map(), idFactory = uuidv4, now = () => new Date() } = {}) {
    this.repository = repository || new MapControllerRepository(controllers);
    this.idFactory = idFactory;
    this.now = now;
  }

  list() {
    return this.repository.list();
  }

  get(id) {
    return this.repository.get(id);
  }

  create({ name, host, port, strips = 4, ledCounts = Array(strips).fill(215) }) {
    const timestamp = this.now().toISOString();
    const controller = {
      id: this.idFactory(),
      name,
      host,
      port,
      connected: false,
      strips,
      ledCounts,
      lastSeen: timestamp
    };

    return this.repository.save(controller);
  }

  update(id, changes) {
    const controller = this.get(id);

    if (!controller) {
      return null;
    }

    const updated = { ...controller, ...changes };
    if (changes.strips !== undefined && changes.ledCounts === undefined) {
      updated.ledCounts = resizeLedCounts(controller.ledCounts, changes.strips);
    }
    if (changes.ledCounts !== undefined) {
      updated.strips = changes.ledCounts.length;
    }
    return this.repository.save(updated);
  }

  setConnectionState(id, connected) {
    const controller = this.get(id);
    if (!controller) return null;
    return this.repository.save({
      ...controller,
      connected,
      lastSeen: connected ? this.now().toISOString() : controller.lastSeen
    });
  }

  remove(id) {
    return this.repository.remove(id);
  }
}

function resizeLedCounts(ledCounts = [], count) {
  return Array.from({ length: count }, (_, index) => ledCounts[index] || 215);
}

class MapControllerRepository {
  constructor(controllers) {
    this.controllers = controllers;
  }

  list() {
    return Array.from(this.controllers.values());
  }

  get(id) {
    return this.controllers.get(id) ?? null;
  }

  save(controller) {
    this.controllers.set(controller.id, controller);
    return controller;
  }

  remove(id) {
    return this.controllers.delete(id);
  }
}
