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
  // with its alert sound enabled.
  controllersFor(fsa) {
    const controllers = new Map();
    for (const session of this.playbackService.list()) {
      if (session.status !== "playing") continue;
      const effect = this.effectService.get(session.effectId);
      if (!effect?.tags?.includes("weather")) continue;
      const postalCode = session.parameters?.postalCode ?? effect.parameters?.postalCode?.default;
      const alertSound = session.parameters?.alertSound ?? effect.parameters?.alertSound?.default ?? true;
      if (!alertSound || forwardSortationArea(postalCode) !== fsa) continue;
      for (const mapping of this.canvasService.get(session.canvasId)?.mappings ?? []) {
        const controller = this.controllerService.get(mapping.controllerId);
        if (controller) controllers.set(controller.id, controller);
      }
    }
    return [...controllers.values()];
  }

  async notify(fsa) {
    await Promise.all(
      this.controllersFor(fsa).map(async (controller) => {
        try {
          const status = await this.gateway.ringAlert(controller, RING_SECONDS);
          if (status !== 202 && status !== 404) {
            this.logger.warn?.(`[weather] alert ring on ${controller.name ?? controller.id}: HTTP ${status}`);
          }
        } catch (error) {
          this.logger.warn?.(`[weather] alert ring on ${controller.name ?? controller.id} failed: ${error.message}`);
        }
      }),
    );
  }
}
