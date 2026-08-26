import { Router } from 'express';
import { EffectDistributionError } from '../application/effect-distribution-service.js';

function validateDistributionPayload(body) {
  const errors = {};
  const payload = body && typeof body === 'object' ? body : {};

  if (!Array.isArray(payload.controllerIds) || payload.controllerIds.length === 0) {
    errors.controllerIds = 'must be a non-empty array';
  } else if (payload.controllerIds.some(id => typeof id !== 'string' || !id.trim())) {
    errors.controllerIds = 'must contain non-empty string IDs';
  }

  if (!Array.isArray(payload.frames) || payload.frames.length === 0) {
    errors.frames = 'must be a non-empty array';
  } else if (payload.frames.some(frame => !isValidFrame(frame))) {
    errors.frames = 'must contain frames with a timestamp and pixel data';
  }

  if (Object.keys(errors).length > 0) {
    throw new EffectDistributionError('Invalid distribution payload', 400, errors);
  }

  return {
    controllerIds: [...new Set(payload.controllerIds.map(id => id.trim()))],
    frames: payload.frames
  };
}

function isValidFrame(frame) {
  return Boolean(
    frame &&
    Number.isFinite(frame.timestamp) &&
    Array.isArray(frame.pixels)
  );
}

export function createDistributionRouter({ distributionService }) {
  const router = Router();

  router.post('/frames', async (req, res, next) => {
    try {
      const payload = validateDistributionPayload(req.body);
      const result = await distributionService.distribute(payload);
      return res.status(result.status === 'partial' ? 207 : 202).json(result);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
