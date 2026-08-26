import { v4 as uuidv4 } from 'uuid';

export class ControllerService {
  constructor({ controllers = new Map(), idFactory = uuidv4, now = () => new Date() } = {}) {
    this.controllers = controllers;
    this.idFactory = idFactory;
    this.now = now;
  }

  list() {
    return Array.from(this.controllers.values());
  }

  get(id) {
    return this.controllers.get(id) ?? null;
  }

  create({ name, host, port }) {
    const timestamp = this.now().toISOString();
    const controller = {
      id: this.idFactory(),
      name,
      host,
      port,
      connected: false,
      strips: 4,
      lastSeen: timestamp
    };

    this.controllers.set(controller.id, controller);
    return controller;
  }

  update(id, changes) {
    const controller = this.get(id);

    if (!controller) {
      return null;
    }

    Object.assign(controller, changes);
    return controller;
  }

  remove(id) {
    return this.controllers.delete(id);
  }
}
