import { Router } from 'express';

const fields = ['name', 'width', 'height', 'mappings'];

function validateCanvasPayload(body, { partial = false } = {}) {
  const payload = body && typeof body === 'object' ? body : {};
  const errors = {};
  for (const field of fields) {
    if (payload[field] === undefined) {
      if (!partial) errors[field] = 'is required';
      continue;
    }
    if (field === 'name' && (typeof payload.name !== 'string' || !payload.name.trim())) errors.name = 'must be a non-empty string';
    if ((field === 'width' || field === 'height') && (!Number.isInteger(payload[field]) || payload[field] < 1 || payload[field] > 10000)) errors[field] = 'must be an integer between 1 and 10000';
    if (field === 'mappings' && (!Array.isArray(payload.mappings) || payload.mappings.some(mapping => !mapping || typeof mapping !== 'object' || typeof mapping.controllerId !== 'string' || !Number.isInteger(mapping.stripIndex) || mapping.stripIndex < 0 || !['series', 'parallel', 'serpentine'].includes(mapping.layout || 'series')))) errors.mappings = 'must contain valid strip mappings';
  }
  if (partial && !fields.some(field => payload[field] !== undefined)) errors.body = 'must include at least one canvas field';
  if (Object.keys(errors).length > 0) {
    const error = new Error('Invalid canvas payload');
    error.statusCode = 400;
    error.details = errors;
    throw error;
  }
  return {
    ...(payload.name === undefined ? {} : { name: payload.name.trim() }),
    ...(payload.width === undefined ? {} : { width: payload.width }),
    ...(payload.height === undefined ? {} : { height: payload.height }),
    ...(payload.mappings === undefined ? {} : { mappings: payload.mappings })
  };
}

export function createCanvasRouter({ canvasService }) {
  const router = Router();
  router.get('/', (req, res) => res.json(canvasService.list()));
  router.post('/', (req, res, next) => {
    try {
      return res.status(201).json(canvasService.create(validateCanvasPayload(req.body)));
    } catch (error) {
      return next(error);
    }
  });
  router.get('/:id', (req, res, next) => {
    const canvas = canvasService.get(req.params.id);
    return canvas ? res.json(canvas) : next(Object.assign(new Error('Canvas not found'), { statusCode: 404 }));
  });
  router.put('/:id', (req, res, next) => {
    try {
      const canvas = canvasService.update(req.params.id, validateCanvasPayload(req.body), readRevision(req));
      return canvas ? res.json(canvas) : next(Object.assign(new Error('Canvas not found'), { statusCode: 404 }));
    } catch (error) {
      return next(error);
    }
  });
  router.patch('/:id', (req, res, next) => {
    try {
      const canvas = canvasService.update(req.params.id, validateCanvasPayload(req.body, { partial: true }), readRevision(req));
      return canvas ? res.json(canvas) : next(Object.assign(new Error('Canvas not found'), { statusCode: 404 }));
    } catch (error) {
      return next(error);
    }
  });
  router.delete('/:id', (req, res, next) => canvasService.remove(req.params.id) ? res.json({ success: true }) : next(Object.assign(new Error('Canvas not found'), { statusCode: 404 })));
  return router;
}

function readRevision(request) {
  if (request.headers['if-match-revision'] === undefined) return undefined;
  const revision = Number(request.headers['if-match-revision']);
  if (!Number.isInteger(revision)) {
    const error = new Error('If-Match-Revision must be an integer');
    error.statusCode = 400;
    throw error;
  }
  return revision;
}
