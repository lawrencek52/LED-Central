import { Router } from "express";

export function createSettingsRouter({ settingsService }) {
  const router = Router();

  router.get("/", (req, res) => {
    res.json(settingsService.get());
  });

  router.patch("/", (req, res, next) => {
    try {
      res.json(settingsService.update(req.body));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
