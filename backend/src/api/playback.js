import { Router } from 'express';

export function createPlaybackRouter({ playbackService }) {
  const router = Router();

  router.get('/', (req, res) => res.json(playbackService.list()));
  router.post('/start', async (req, res, next) => {
    try {
      const { canvasId, effectId, parameters } = req.body || {};
      if (typeof canvasId !== 'string' || typeof effectId !== 'string') {
        const error = new Error('canvasId and effectId are required');
        error.statusCode = 400;
        throw error;
      }
      return res.status(202).json(await playbackService.start({ canvasId, effectId, parameters }));
    } catch (error) {
      return next(error);
    }
  });
  router.post('/:id/stop', (req, res, next) => {
    const session = playbackService.stop(req.params.id);
    return session ? res.json(session) : next(Object.assign(new Error('Playback session not found'), { statusCode: 404 }));
  });

  return router;
}
