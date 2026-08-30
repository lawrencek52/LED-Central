import { Router } from "express";

export function createStatusRouter({
  canvasService,
  controllerService,
  playbackService,
  gateway,
}) {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const sessions = playbackService.list();
      const canvases = canvasService.list().map((canvas) => {
        const session = sessions.find(
          (item) => item.canvasId === canvas.id && item.status === "playing",
        );
        const strips = canvas.mappings.map((mapping) => {
          const controller = controllerService.get(mapping.controllerId);
          const queue = gateway.getQueueStatus?.(
            mapping.controllerId,
            1 << mapping.stripIndex,
          ) ?? {
            queuedFrames: 0,
            framesPerSecond: 0,
          };
          const preview = controller
            ? (gateway.getPreviewStatus?.(controller) ?? {})
            : {};
          const latestFrame = queue.latestFrame;
          return {
            controllerId: mapping.controllerId,
            controllerName: controller?.name ?? mapping.controllerId,
            address: controller
              ? `${controller.host}:${controller.port}`
              : "Unknown controller",
            stripIndex: mapping.stripIndex,
            reversed: Boolean(mapping.reversed),
            framesPerSecond: preview.recvFps ?? queue.framesPerSecond,
            recvFps: preview.recvFps ?? 0,
            drawFps: preview.drawFps ?? 0,
            kibPerSecond: preview.kibPerSecond ?? 0,
            queuedFrames: queue.queuedFrames,
            preview: latestFrame
              ? {
                  width: mapping.width || canvas.width,
                  height: mapping.height || 1,
                  pixels: Buffer.from(latestFrame.pixels.flat()).toString(
                    "base64",
                  ),
                }
              : preview.frame
                ? {
                    width: preview.width,
                    height: preview.height,
                    pixels: preview.frame,
                  }
                : null,
          };
        });
        return {
          canvasId: canvas.id,
          canvasName: canvas.name,
          effectName: session
            ? (playbackService.effectService.get(session.effectId)?.name ??
              session.effectId)
            : "Inactive",
          framesPerSecond: session ? playbackService.frameRate : 0,
          strips,
        };
      });
      res.json({ canvases });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
