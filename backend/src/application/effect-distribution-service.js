import { mapCanvasFrame } from "../domain/canvases/canvas.js";

export class EffectDistributionError extends Error {
  constructor(message, statusCode = 400, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class EffectDistributionService {
  constructor({ controllerService, gateway, eventHub = null }) {
    this.controllerService = controllerService;
    this.gateway = gateway;
    this.eventHub = eventHub;
  }

  async distribute({ controllerIds, frames }) {
    const missingControllerIds = controllerIds.filter(
      (id) => !this.controllerService.get(id),
    );

    if (missingControllerIds.length > 0) {
      throw new EffectDistributionError(
        "One or more controllers were not found",
        404,
        {
          controllerIds: missingControllerIds,
        },
      );
    }

    const results = await Promise.allSettled(
      controllerIds.map(async (controllerId) => {
        const controller = this.controllerService.get(controllerId);
        await this.gateway.sendFrames(controller, frames);
        return { controllerId, status: "sent", frameCount: frames.length };
      }),
    );

    const sent = results.reduce((items, result) => {
      if (result.status === "fulfilled") {
        items.push(result.value);
      }
      return items;
    }, []);
    const failed = results.reduce((items, result, index) => {
      if (result.status === "rejected") {
        items.push({
          controllerId: controllerIds[index],
          error: result.reason.message,
        });
      }
      return items;
    }, []);

    if (sent.length === 0 && failed.length > 0) {
      throw new EffectDistributionError(
        "No controllers accepted the frames",
        503,
        {
          sent,
          failed,
        },
      );
    }

    const distribution = {
      status: failed.length > 0 ? "partial" : "sent",
      frameCount: frames.length,
      sent,
      failed,
    };

    this.eventHub?.publish({
      topic: "distribution",
      type: "distribution.completed",
      payload: distribution,
    });

    return distribution;
  }

  async distributeCanvasFrame({ canvas, frame }) {
    return this.distributeCanvasFrames({ canvas, frames: [frame] });
  }

  async distributeCanvasFrames({ canvas, frames }) {
    let mapped;
    try {
      mapped = new Map();
      for (const frame of frames) {
        for (const [controllerId, controllerFrames] of mapCanvasFrame(
          canvas,
          frame,
        )) {
          mapped.set(controllerId, [
            ...(mapped.get(controllerId) || []),
            ...controllerFrames,
          ]);
        }
      }
    } catch (error) {
      error.statusCode = 400;
      throw error;
    }
    const controllerIds = [...mapped.keys()];
    const results = await Promise.allSettled(
      controllerIds.map(async (controllerId) => {
        const controller = this.controllerService.get(controllerId);
        if (!controller) {
          throw new EffectDistributionError(
            `Controller ${controllerId} was not found`,
            404,
          );
        }
        await this.gateway.sendFrames(controller, mapped.get(controllerId));
        return {
          controllerId,
          status: "sent",
          frameCount: mapped.get(controllerId).length,
        };
      }),
    );
    const sent = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    const failed = results.reduce((items, result, index) => {
      if (result.status === "rejected")
        items.push({
          controllerId: controllerIds[index],
          error: result.reason.message,
        });
      return items;
    }, []);
    if (sent.length === 0 && failed.length > 0) {
      throw new EffectDistributionError(
        "No controllers accepted the canvas frame",
        503,
        { sent, failed },
      );
    }
    return {
      status: failed.length > 0 ? "partial" : "sent",
      frameCount: frames.length,
      sent,
      failed,
    };
  }
}
