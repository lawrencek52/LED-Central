import { Router } from "express";

const controllerFields = ["name", "host", "port", "strips", "ledCounts"];

function validateControllerPayload(body, { partial = false } = {}) {
  const errors = {};
  const payload = body && typeof body === "object" ? body : {};

  for (const field of controllerFields) {
    if (partial && payload[field] === undefined) {
      continue;
    }

    if (field === "port") {
      if (
        !Number.isInteger(payload.port) ||
        payload.port < 1 ||
        payload.port > 65535
      ) {
        errors.port = "must be an integer between 1 and 65535";
      }
    } else if (field === "strips") {
      if (
        !Number.isInteger(payload.strips) ||
        payload.strips < 1 ||
        payload.strips > 16
      ) {
        errors.strips = "must be an integer between 1 and 16";
      }
    } else if (field === "ledCounts") {
      if (
        !Array.isArray(payload.ledCounts) ||
        payload.ledCounts.length < 1 ||
        payload.ledCounts.length > 16 ||
        payload.ledCounts.some(
          (count) => !Number.isInteger(count) || count < 1 || count > 65536,
        )
      ) {
        errors.ledCounts =
          "must contain 1 to 16 integer counts between 1 and 65536";
      }
    } else if (
      typeof payload[field] !== "string" ||
      payload[field].trim() === ""
    ) {
      errors[field] = "must be a non-empty string";
    }
  }

  if (Object.keys(errors).length > 0) {
    const error = new Error("Invalid controller payload");
    error.statusCode = 400;
    error.details = errors;
    throw error;
  }

  const stripCount = payload.strips ?? payload.ledCounts?.length;
  if (
    stripCount !== undefined &&
    payload.ledCounts !== undefined &&
    payload.ledCounts.length !== stripCount
  ) {
    const error = new Error("ledCounts length must match strips");
    error.statusCode = 400;
    error.details = { ledCounts: "length must match strips" };
    throw error;
  }

  if (
    partial &&
    Object.keys(payload).every((field) => !controllerFields.includes(field))
  ) {
    const error = new Error("At least one controller field is required");
    error.statusCode = 400;
    throw error;
  }

  return {
    ...(payload.name === undefined ? {} : { name: payload.name.trim() }),
    ...(payload.host === undefined ? {} : { host: payload.host.trim() }),
    ...(payload.port === undefined ? {} : { port: payload.port }),
    ...(payload.strips === undefined ? {} : { strips: payload.strips }),
    ...(payload.ledCounts === undefined
      ? {}
      : { ledCounts: payload.ledCounts }),
  };
}

export function createControllerRouter({ controllerService, gateway }) {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const controllers = await Promise.all(
        controllerService.list().map(async (controller) => ({
          ...controller,
          connected: (await gateway.getStatus(controller.id)).connected,
          audioAvailable: gateway.getAudioStatus(controller.id).available,
        })),
      );
      res.json(controllers);
    } catch (error) {
      next(error);
    }
  });

  router.post("/", (req, res) => {
    const payload = validateControllerPayload(req.body);
    const controller = controllerService.create(payload);
    gateway
      .probeAudioSupport(controller)
      .then((available) =>
        controllerService.setAudioAvailability(controller.id, { available }),
      )
      .catch(() => {});
    res.status(201).json(controller);
  });

  // Registered before /:id so "detect" isn't swallowed as an id param.
  router.post("/detect", async (req, res, next) => {
    const host = typeof req.body?.host === "string" ? req.body.host.trim() : "";
    if (!host) {
      const error = new Error("host is required");
      error.statusCode = 400;
      return next(error);
    }
    try {
      const capabilities = await gateway.detectCapabilities(host);
      return res.json(capabilities);
    } catch (error) {
      error.statusCode = 502;
      return next(error);
    }
  });

  router.get("/:id", (req, res, next) => {
    const controller = controllerService.get(req.params.id);

    if (!controller) {
      return next(
        Object.assign(new Error("Controller not found"), { statusCode: 404 }),
      );
    }

    return res.json(controller);
  });

  router.patch("/:id", (req, res, next) => {
    const payload = validateControllerPayload(req.body, { partial: true });
    const controller = controllerService.update(req.params.id, payload);

    if (!controller) {
      return next(
        Object.assign(new Error("Controller not found"), { statusCode: 404 }),
      );
    }

    return res.json(controller);
  });

  router.post("/:id/test", (req, res, next) => {
    const controller = controllerService.get(req.params.id);

    if (!controller) {
      return next(
        Object.assign(new Error("Controller not found"), { statusCode: 404 }),
      );
    }

    return res.status(501).json({
      error: "Controller connectivity test is not implemented",
      controllerId: controller.id,
    });
  });

  router.post("/:id/recheck-audio", async (req, res, next) => {
    const controller = controllerService.get(req.params.id);
    if (!controller)
      return next(
        Object.assign(new Error("Controller not found"), { statusCode: 404 }),
      );
    try {
      const available = await gateway.probeAudioSupport(controller);
      const updated = controllerService.setAudioAvailability(controller.id, {
        available,
      });
      return res.json({
        ...updated,
        connected: (await gateway.getStatus(controller.id)).connected,
        audioAvailable: gateway.getAudioStatus(controller.id).available,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/:id/preview/start", (req, res, next) => {
    const controller = controllerService.get(req.params.id);
    if (!controller)
      return next(
        Object.assign(new Error("Controller not found"), { statusCode: 404 }),
      );
    gateway.startPreview?.(controller);
    return res.json({ active: true });
  });

  router.post("/:id/preview/stop", (req, res, next) => {
    const controller = controllerService.get(req.params.id);
    if (!controller)
      return next(
        Object.assign(new Error("Controller not found"), { statusCode: 404 }),
      );
    gateway.stopPreview?.(controller.id);
    return res.json({ active: false });
  });

  router.post("/:id/connect", async (req, res, next) => {
    const controller = controllerService.get(req.params.id);
    if (!controller)
      return next(
        Object.assign(new Error("Controller not found"), { statusCode: 404 }),
      );
    try {
      await gateway.connect(controller);
      return res.json(
        controllerService.setConnectionState(controller.id, true),
      );
    } catch (error) {
      controllerService.setConnectionState(controller.id, false);
      error.statusCode = 503;
      return next(error);
    }
  });

  router.post("/:id/disconnect", (req, res, next) => {
    const controller = controllerService.get(req.params.id);
    if (!controller)
      return next(
        Object.assign(new Error("Controller not found"), { statusCode: 404 }),
      );
    gateway.disconnect(controller.id);
    return res.json(controllerService.setConnectionState(controller.id, false));
  });

  router.delete("/:id", (req, res, next) => {
    if (!controllerService.remove(req.params.id)) {
      return next(
        Object.assign(new Error("Controller not found"), { statusCode: 404 }),
      );
    }

    return res.json({ success: true });
  });

  return router;
}
