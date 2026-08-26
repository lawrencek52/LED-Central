import { Router } from 'express';

const controllerFields = ['name', 'host', 'port', 'strips', 'ledCounts'];

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
    } else if (field === 'strips') {
      if (!Number.isInteger(payload.strips) || payload.strips < 1 || payload.strips > 16) {
        errors.strips = 'must be an integer between 1 and 16';
      }
    } else if (field === 'ledCounts') {
      if (!Array.isArray(payload.ledCounts) || payload.ledCounts.length < 1 || payload.ledCounts.length > 16 || payload.ledCounts.some(count => !Number.isInteger(count) || count < 1 || count > 4200)) {
        errors.ledCounts = 'must contain 1 to 16 integer counts between 1 and 4200';
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

  const stripCount = payload.strips ?? payload.ledCounts?.length;
  if (stripCount !== undefined && payload.ledCounts !== undefined && payload.ledCounts.length !== stripCount) {
    const error = new Error('ledCounts length must match strips');
    error.statusCode = 400;
    error.details = { ledCounts: 'length must match strips' };
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
    ,...(payload.strips === undefined ? {} : { strips: payload.strips })
    ,...(payload.ledCounts === undefined ? {} : { ledCounts: payload.ledCounts })
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
