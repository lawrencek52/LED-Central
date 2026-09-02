// Attempts to connect every known controller in parallel and records the
// resulting online/offline status back on the controller records.
export async function bringControllersOnline({ controllerService, gateway }) {
  const controllers = controllerService.list();
  const results = await Promise.allSettled(
    controllers.map((controller) => gateway.connect(controller)),
  );

  const online = [];
  const offline = [];
  results.forEach((result, index) => {
    const controller = controllers[index];
    if (result.status === "fulfilled") {
      controllerService.setConnectionState(controller.id, true);
      online.push(controller.id);
    } else {
      controllerService.setConnectionState(controller.id, false);
      offline.push({
        controllerId: controller.id,
        error: result.reason?.message ?? String(result.reason),
      });
    }
  });

  return { online, offline };
}
