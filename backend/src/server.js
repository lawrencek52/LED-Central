import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config/index.js';
import { ControllerService } from './application/controller-service.js';
import { EffectDistributionService } from './application/effect-distribution-service.js';
import { createControllerRouter } from './api/controllers.js';
import { createDistributionRouter } from './api/distribution.js';
import { TcpControllerGateway } from './infrastructure/controllers/tcp-controller-gateway.js';
import { EventHub } from './infrastructure/realtime/event-hub.js';
import { attachRealtimeServer } from './infrastructure/realtime/websocket-server.js';
import { SqliteEffectRepository } from './infrastructure/persistence/sqlite-effect-repository.js';
import { EffectLibraryService } from './application/effect-library-service.js';
import { defaultEffects } from './domain/effects/default-effects.js';
import { createEffectRouter } from './api/effects.js';
import { createPlaybackRouter } from './api/playback.js';
import { EffectRenderService } from './application/effect-render-service.js';
import { PlaybackService } from './application/playback-service.js';
import { createCanvasRouter } from './api/canvases.js';
import { CanvasService } from './application/canvas-service.js';
import { SqliteControllerRepository } from './infrastructure/persistence/sqlite-controller-repository.js';
import { SqliteCanvasRepository } from './infrastructure/persistence/sqlite-canvas-repository.js';
import { Metrics } from './infrastructure/metrics/metrics.js';
import { createMetricsRouter } from './api/metrics.js';
import { createAuthMiddleware } from './middleware/auth.js';

export function createApp({
  controllerService = new ControllerService({
    repository: new SqliteControllerRepository({ databasePath: config.effectDatabasePath })
  }),
  canvasService = new CanvasService({
    repository: new SqliteCanvasRepository({ databasePath: config.effectDatabasePath })
  }),
  playbackService,
  eventHub = new EventHub(),
  metrics = new Metrics(),
  effectService = new EffectLibraryService({
    repository: new SqliteEffectRepository({
      databasePath: config.effectDatabasePath,
      seedEffects: defaultEffects
    })
  }),
  distributionService = new EffectDistributionService({
    controllerService,
    gateway: new TcpControllerGateway(),
    eventHub
  })
} = {}) {
  const app = express();
  app.locals.eventHub = eventHub;
  app.locals.distributionService = distributionService;
  app.locals.effectService = effectService;
  app.locals.canvasService = canvasService;
  app.locals.playbackService = playbackService || new PlaybackService({
    canvasService,
    effectService,
    renderService: new EffectRenderService(),
    distributionService,
    eventHub
  });
  app.locals.metrics = metrics;

  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json());
  app.use((req, res, next) => {
    req.requestId = uuidv4();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  });
  app.use((req, res, next) => {
    const startedAt = Date.now();
    metrics.recordRequest();
    res.on('finish', () => metrics.recordResponse({ durationMs: Date.now() - startedAt, statusCode: res.statusCode }));
    next();
  });
  app.use('/api', createAuthMiddleware({ token: config.authToken }));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  app.use('/api/metrics', createMetricsRouter({ metrics }));

  app.use('/api/controllers', createControllerRouter({ controllerService }));
  app.use('/api/distribution', createDistributionRouter({ distributionService, canvasService }));
  app.use('/api/effects', createEffectRouter({ effectService }));
  app.use('/api/canvases', createCanvasRouter({ canvasService }));
  app.use('/api/playback', createPlaybackRouter({ playbackService: app.locals.playbackService }));

  app.use((req, res) => {
    res.status(404).json({
      error: 'Route not found',
      requestId: req.requestId
    });
  });

  app.use((err, req, res, next) => {
    const statusCode = err.statusCode || (err instanceof SyntaxError ? 400 : 500);
    const response = {
      error: statusCode === 500 ? 'Internal server error' :
        (err instanceof SyntaxError ? 'Invalid JSON body' : err.message),
      requestId: req.requestId
    };

    if (err.details) {
      response.details = err.details;
    }

    if (statusCode === 500) {
      console.error(err.stack);
    }

    res.status(statusCode).json(response);
  });

  return app;
}

const app = createApp();

// Start server
export function startServer() {
  const server = createServer(app);
  attachRealtimeServer({
    server,
    eventHub: app.locals.eventHub,
    distributionService: app.locals.distributionService,
    authToken: config.authToken
  });
  server.listen(config.port, config.host, () => {
    console.log(
      `LED-Central backend server running on http://${config.host}:${config.port}`
    );
    console.log(`API available at http://${config.host}:${config.port}/api`);
  });
  return server;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  startServer();
}

export default app;
