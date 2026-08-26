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
      id => !this.controllerService.get(id)
    );

    if (missingControllerIds.length > 0) {
      throw new EffectDistributionError('One or more controllers were not found', 404, {
        controllerIds: missingControllerIds
      });
    }

    const results = await Promise.allSettled(
      controllerIds.map(async controllerId => {
        const controller = this.controllerService.get(controllerId);
        await this.gateway.sendFrames(controller, frames);
        return { controllerId, status: 'sent', frameCount: frames.length };
      })
    );

    const sent = results.reduce((items, result) => {
      if (result.status === 'fulfilled') {
        items.push(result.value);
      }
      return items;
    }, []);
    const failed = results.reduce((items, result, index) => {
      if (result.status === 'rejected') {
        items.push({
          controllerId: controllerIds[index],
          error: result.reason.message
        });
      }
      return items;
    }, []);

    if (sent.length === 0 && failed.length > 0) {
      throw new EffectDistributionError('No controllers accepted the frames', 503, {
        sent,
        failed
      });
    }

    const distribution = {
      status: failed.length > 0 ? 'partial' : 'sent',
      frameCount: frames.length,
      sent,
      failed
    };

    this.eventHub?.publish({
      topic: 'distribution',
      type: 'distribution.completed',
      payload: distribution
    });

    return distribution;
  }
}
