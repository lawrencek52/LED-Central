import { Router } from "express";

const fields = ["name", "width", "height", "mappings"];

function validateCanvasPayload(body, { partial = false } = {}) {
  const payload = body && typeof body === "object" ? body : {};
  const errors = {};
  for (const field of fields) {
    if (payload[field] === undefined) {
      if (!partial) errors[field] = "is required";
      continue;
    }
    if (
      field === "name" &&
      (typeof payload.name !== "string" || !payload.name.trim())
    )
      errors.name = "must be a non-empty string";
    if (
      (field === "width" || field === "height") &&
      (!Number.isInteger(payload[field]) ||
        payload[field] < 1 ||
        payload[field] > 10000)
    )
      errors[field] = "must be an integer between 1 and 10000";
    if (
      field === "mappings" &&
      (!Array.isArray(payload.mappings) ||
        payload.mappings.some(
          (mapping) =>
            !mapping ||
            typeof mapping !== "object" ||
            typeof mapping.controllerId !== "string" ||
            !Number.isInteger(mapping.stripIndex) ||
            mapping.stripIndex < 0 ||
            !["series", "parallel", "serpentine"].includes(
              mapping.layout || "series",
            ) ||
            (mapping.originCorner !== undefined &&
              !["top-left", "top-right", "bottom-left", "bottom-right"].includes(
                mapping.originCorner,
              )) ||
            (mapping.axis !== undefined &&
              !["horizontal", "vertical"].includes(mapping.axis)),
        ))
    )
      errors.mappings = "must contain valid strip mappings";
  }
  if (
    payload.stripSpacingRatio !== undefined &&
    (typeof payload.stripSpacingRatio !== "number" ||
      !Number.isFinite(payload.stripSpacingRatio) ||
      payload.stripSpacingRatio <= 0)
  )
    errors.stripSpacingRatio = "must be a positive number";
  if (
    partial &&
    !fields.some((field) => payload[field] !== undefined) &&
    payload.stripSpacingRatio === undefined
  )
    errors.body = "must include at least one canvas field";
  if (
    Number.isInteger(payload.width) &&
    Number.isInteger(payload.height) &&
    Array.isArray(payload.mappings)
  ) {
    const outOfBounds = payload.mappings.find(
      (mapping) =>
        Number.isInteger(mapping.x) &&
        Number.isInteger(mapping.y) &&
        Number.isInteger(mapping.width) &&
        Number.isInteger(mapping.height) &&
        (mapping.x + mapping.width > payload.width ||
          mapping.y + mapping.height > payload.height),
    );
    if (outOfBounds)
      errors.mappings = "must fit within the declared canvas width and height";
  }
  if (Object.keys(errors).length > 0) {
    const error = new Error("Invalid canvas payload");
    error.statusCode = 400;
    error.details = errors;
    throw error;
  }
  return {
    ...(payload.name === undefined ? {} : { name: payload.name.trim() }),
    ...(payload.width === undefined ? {} : { width: payload.width }),
    ...(payload.height === undefined ? {} : { height: payload.height }),
    ...(payload.mappings === undefined ? {} : { mappings: payload.mappings }),
    ...(payload.stripSpacingRatio === undefined
      ? {}
      : { stripSpacingRatio: payload.stripSpacingRatio }),
  };
}

export function createCanvasRouter({
  canvasService,
  playbackService = null,
  audioService = null,
  weatherAlertNotifier = null,
}) {
  const router = Router();
  router.get("/", (req, res) => res.json(canvasService.list().map(withAudio)));
  router.post("/", (req, res, next) => {
    try {
      return res
        .status(201)
        .json(withAudio(canvasService.create(validateCanvasPayload(req.body))));
    } catch (error) {
      return next(error);
    }
  });
  router.get("/:id", (req, res, next) => {
    const canvas = canvasService.get(req.params.id);
    return canvas
      ? res.json(withAudio(canvas))
      : next(Object.assign(new Error("Canvas not found"), { statusCode: 404 }));
  });

  function withAudio(canvas) {
    return {
      ...canvas,
      audioAvailable: audioService ? audioService.hasAudioCapability(canvas) : false,
    };
  }
  router.put("/:id", (req, res, next) => {
    try {
      const canvas = canvasService.update(
        req.params.id,
        validateCanvasPayload(req.body),
        readRevision(req),
      );
      return canvas
        ? res.json(withAudio(canvas))
        : next(
            Object.assign(new Error("Canvas not found"), { statusCode: 404 }),
          );
    } catch (error) {
      return next(error);
    }
  });
  router.patch("/:id", (req, res, next) => {
    try {
      const canvas = canvasService.update(
        req.params.id,
        validateCanvasPayload(req.body, { partial: true }),
        readRevision(req),
      );
      return canvas
        ? res.json(withAudio(canvas))
        : next(
            Object.assign(new Error("Canvas not found"), { statusCode: 404 }),
          );
    } catch (error) {
      return next(error);
    }
  });
  router.delete("/:id", (req, res, next) => {
    if (!canvasService.get(req.params.id)) {
      return next(
        Object.assign(new Error("Canvas not found"), { statusCode: 404 }),
      );
    }
    playbackService?.stopByCanvas(req.params.id);
    const removed = canvasService.remove(req.params.id);
    if (!removed) {
      return next(
        Object.assign(new Error("Canvas not found"), { statusCode: 404 }),
      );
    }
    return res.json({ success: true });
  });
  // Plays the weather alert warble on the canvas's controllers so its
  // volume can be tried out: { seconds = 1, volume = 100 }.
  router.post("/:id/alert-sound", async (req, res, next) => {
    try {
      if (!canvasService.get(req.params.id)) {
        throw Object.assign(new Error("Canvas not found"), { statusCode: 404 });
      }
      if (!weatherAlertNotifier) {
        throw Object.assign(new Error("Alert sounds are not available"), { statusCode: 503 });
      }
      const seconds = Math.min(60, Math.max(1, Number(req.body?.seconds ?? 1) || 1));
      const volume = Math.min(100, Math.max(0, Number(req.body?.volume ?? 100) || 0));
      res.json(await weatherAlertNotifier.test(req.params.id, { seconds, volume }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function readRevision(request) {
  if (request.headers["if-match-revision"] === undefined) return undefined;
  const revision = Number(request.headers["if-match-revision"]);
  if (!Number.isInteger(revision)) {
    const error = new Error("If-Match-Revision must be an integer");
    error.statusCode = 400;
    throw error;
  }
  return revision;
}
