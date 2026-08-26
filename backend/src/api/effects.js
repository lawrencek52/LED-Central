import { Router } from 'express';
import { EffectLibraryError } from '../application/effect-library-service.js';

const fields = ['name', 'renderer', 'description', 'parameters', 'tags'];

function validateEffectPayload(body, { partial = false } = {}) {
  const payload = body && typeof body === 'object' ? body : {};
  const errors = {};
  for (const field of fields) {
    if (payload[field] === undefined) {
      if (!partial && (field === 'name' || field === 'renderer')) {
        errors[field] = 'must be a non-empty string';
      }
      continue;
    }
    if (field === 'name' || field === 'renderer' || field === 'description') {
      if (typeof payload[field] !== 'string' || (field !== 'description' && !payload[field].trim())) {
        errors[field] = field === 'description' ? 'must be a string' : 'must be a non-empty string';
      }
    } else if (field === 'parameters' && (!payload.parameters || Array.isArray(payload.parameters) || typeof payload.parameters !== 'object')) {
      errors.parameters = 'must be an object';
    } else if (field === 'tags' && (!Array.isArray(payload.tags) || payload.tags.some(tag => typeof tag !== 'string'))) {
      errors.tags = 'must be an array of strings';
    }
  }
  if (partial && !fields.some(field => payload[field] !== undefined)) {
    errors.body = 'must include at least one effect field';
  }
  if (Object.keys(errors).length > 0) {
    throw new EffectLibraryError('Invalid effect payload', 400, errors);
  }
  return payload;
}

export function createEffectRouter({ effectService }) {
  const router = Router();
  router.get('/', (req, res) => res.json(effectService.list()));
  router.post('/', (req, res) => res.status(201).json(effectService.create(validateEffectPayload(req.body))));
  router.get('/:id', (req, res, next) => {
    const effect = effectService.get(req.params.id);
    return effect ? res.json(effect) : next(new EffectLibraryError('Effect not found', 404));
  });
  router.patch('/:id', (req, res, next) => {
    const effect = effectService.update(req.params.id, validateEffectPayload(req.body, { partial: true }));
    return effect ? res.json(effect) : next(new EffectLibraryError('Effect not found', 404));
  });
  router.delete('/:id', (req, res, next) => {
    return effectService.remove(req.params.id)
      ? res.json({ success: true })
      : next(new EffectLibraryError('Effect not found', 404));
  });
  return router;
}
