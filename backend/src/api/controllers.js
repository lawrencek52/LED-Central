import { Router } from 'express';

const controllerFields = ['name', 'host', 'port'];

function validateControllerPayload(body, { partial = false } = {}) {
  const errors = {};
  const payload = body && typeof body === 'object' ? body : {};

  for (const field of controllerFields) {
    if (partial && payload[field] === undefined) {
      continue;
    }

    if (field === 'port') {
      if (!Number.isInteger(payload.port) || payload.port < 1 || payload.port > 65535) {
        errors.port = 'must be an integer between 1 and 65535';
      }
    } else if (typeof payload[field] !== 'string' || payload[field].trim() === '') {
      errors[field] = 'must be a non-empty string';
    }
  }

  if (Object.keys(errors).length > 0) {
    const error = new Error('Invalid controller payload');
    error.statusCode = 400;
    error.details = errors;
    throw error;
  }

  if (partial && Object.keys(payload).every(field => !controllerFields.includes(field))) {
    const error = new Error('At least one controller field is required');
    error.statusCode = 400;
    throw error;
  }

  return {
    ...(payload.name === undefined ? {} : { name: payload.name.trim() }),
    ...(payload.host === undefined ? {} : { host: payload.host.trim() }),
    ...(payload.port === undefined ? {} : { port: payload.port })
  };
}

export function createControllerRouter({ controllerService }) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(controllerService.list());
  });

  router.post('/', (req, res) => {
    const payload = validateControllerPayload(req.body);
    res.status(201).json(controllerService.create(payload));
  });

  router.get('/:id', (req, res, next) => {
    const controller = controllerService.get(req.params.id);

    if (!controller) {
      return next(Object.assign(new Error('Controller not found'), { statusCode: 404 }));
    }

    return res.json(controller);
  });

  router.patch('/:id', (req, res, next) => {
    const payload = validateControllerPayload(req.body, { partial: true });
    const controller = controllerService.update(req.params.id, payload);

    if (!controller) {
      return next(Object.assign(new Error('Controller not found'), { statusCode: 404 }));
    }

    return res.json(controller);
  });

  router.post('/:id/test', (req, res, next) => {
    const controller = controllerService.get(req.params.id);

    if (!controller) {
      return next(Object.assign(new Error('Controller not found'), { statusCode: 404 }));
    }

    return res.status(501).json({
      error: 'Controller connectivity test is not implemented',
      controllerId: controller.id
    });
  });

  router.delete('/:id', (req, res, next) => {
    if (!controllerService.remove(req.params.id)) {
      return next(Object.assign(new Error('Controller not found'), { statusCode: 404 }));
    }

    return res.json({ success: true });
  });

  return router;
}
