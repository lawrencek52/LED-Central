import { Router } from "express";
import { normalizeCanvas, previewGridForMapping } from "../domain/canvases/canvas.js";
import { HostCpuSampler } from "../infrastructure/metrics/host-cpu.js";

export function createStatusRouter({
  canvasService,
  controllerService,
  playbackService,
  gateway,
  hostCpu = new HostCpuSampler(),
}) {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const sessions = playbackService.list();
      const canvases = canvasService.list().map(normalizeCanvas).map((canvas) => {
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
            kibPerSecond: 0,
            activeChannels: 0,
          };
          const preview = controller
            ? (gateway.getPreviewStatus?.(controller) ?? {})
            : {};
          const controllerStats = controller
            ? (gateway.getControllerStats?.(controller) ?? {})
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
            // Position within the canvas, so the frontend can composite every
            // strip's own preview frame into one canvas-shaped image instead
            // of showing N separate per-strip previews.
            x: mapping.x || 0,
            y: mapping.y || 0,
            framesPerSecond: queue.framesPerSecond,
            // The controller's PACKETS_RX rate covers all its channels, so
            // split it evenly across the channels it's currently being sent.
            recvFps: Math.round(
              (controllerStats.receivedPerSecond ?? 0) /
                Math.max(1, queue.activeChannels ?? 1),
            ),
            drawFps: controllerStats.drawFps ?? 0,
            wifiSignal: controllerStats.wifiSignal ?? null,
            kibPerSecond: queue.kibPerSecond ?? 0,
            queuedFrames: queue.queuedFrames,
            preview: latestFrame
              ? {
                  width: mapping.width,
                  height: mapping.height,
                  // latestFrame.pixels is in physical LED wire order (as sent
                  // to the controller) - for a serpentine mapping that's a
                  // zigzag, not a raster, so previewGridForMapping() un-shuffles
                  // it back into a plain row-major image first.
                  pixels: Buffer.from(
                    previewGridForMapping(mapping, latestFrame.pixels).flat(),
                  ).toString("base64"),
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
          width: canvas.width,
          height: canvas.height,
          effectName: session
            ? (playbackService.effectService.get(session.effectId)?.name ??
              session.effectId)
            : "Inactive",
          framesPerSecond: session ? session.frameRate : 0,
          strips,
        };
      });
      res.json({ hostCpu: hostCpu.sample(), canvases });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
