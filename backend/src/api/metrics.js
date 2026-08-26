import { Router } from 'express';

export function createMetricsRouter({ metrics }) {
  const router = Router();
  router.get('/', (req, res) => res.json(metrics.snapshot()));
  return router;
}
