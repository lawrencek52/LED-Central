import { forwardSortationArea } from "./weather-service.js";

const RING_SECONDS = 12;

// Rings the speaker on every controller showing a weather effect for a
// postal code when WeatherService reports a new alert there. Controllers
// without a speaker just decline (404), which is ignored.
export class WeatherAlertNotifier {
  constructor({ playbackService, canvasService, controllerService, effectService, gateway, logger = console }) {
    this.playbackService = playbackService;
    this.canvasService = canvasService;
    this.controllerService = controllerService;
    this.effectService = effectService;
    this.gateway = gateway;
    this.logger = logger;
  }

  // Controllers on canvases currently playing a weather effect for `fsa`
  // with its alert sound enabled, each with the volume to ring at (the
  // loudest asked for, if it's on more than one such canvas).
  controllersFor(fsa) {
    const controllers = new Map();
    for (const session of this.playbackService.list()) {
      if (session.status !== "playing") continue;
      const effect = this.effectService.get(session.effectId);
      if (!effect?.tags?.includes("weather")) continue;
      const postalCode = session.parameters?.postalCode ?? effect.parameters?.postalCode?.default;
      const alertSound = session.parameters?.alertSound ?? effect.parameters?.alertSound?.default ?? true;
      if (!alertSound || forwardSortationArea(postalCode) !== fsa) continue;
      const volume = Number(session.parameters?.alertVolume ?? effect.parameters?.alertVolume?.default ?? 100);
      for (const controller of this.canvasControllers(session.canvasId)) {
        const existing = controllers.get(controller.id);
        controllers.set(controller.id, { controller, volume: Math.max(volume, existing?.volume ?? 0) });
      }
    }
    return [...controllers.values()];
  }

  canvasControllers(canvasId) {
    const controllers = new Map();
    for (const mapping of this.canvasService.get(canvasId)?.mappings ?? []) {
      const controller = this.controllerService.get(mapping.controllerId);
      if (controller) controllers.set(controller.id, controller);
    }
    return [...controllers.values()];
  }

  async notify(fsa) {
    await this.ring(this.controllersFor(fsa), RING_SECONDS);
  }

  // Rings every controller on a canvas once, e.g. to try out a volume.
  // Returns each controller's response status (404: no speaker).
  async test(canvasId, { seconds = 1, volume = 100 } = {}) {
    const controllers = this.canvasControllers(canvasId).map((controller) => ({ controller, volume }));
    return this.ring(controllers, seconds);
  }

  async ring(targets, seconds) {
    return Promise.all(
      targets.map(async ({ controller, volume }) => {
        try {
          const status = await this.gateway.ringAlert(controller, seconds, Math.round(volume));
          if (status !== 202 && status !== 404) {
            this.logger.warn?.(`[weather] alert ring on ${controller.name ?? controller.id}: HTTP ${status}`);
          }
          return { controllerId: controller.id, status };
        } catch (error) {
          this.logger.warn?.(`[weather] alert ring on ${controller.name ?? controller.id} failed: ${error.message}`);
          return { controllerId: controller.id, error: error.message };
        }
      }),
    );
  }
}
