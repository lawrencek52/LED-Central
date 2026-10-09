import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { v4 as uuidv4 } from "uuid";
import { config } from "./config/index.js";
import { ControllerService } from "./application/controller-service.js";
import { EffectDistributionService } from "./application/effect-distribution-service.js";
import { createControllerRouter } from "./api/controllers.js";
import { createDistributionRouter } from "./api/distribution.js";
import { TcpControllerGateway } from "./infrastructure/controllers/tcp-controller-gateway.js";
import { EventHub } from "./infrastructure/realtime/event-hub.js";
import { attachRealtimeServer } from "./infrastructure/realtime/websocket-server.js";
import { SqliteEffectRepository } from "./infrastructure/persistence/sqlite-effect-repository.js";
import { EffectLibraryService } from "./application/effect-library-service.js";
import { defaultEffects } from "./domain/effects/default-effects.js";
import { createEffectRouter } from "./api/effects.js";
import { createPlaybackRouter } from "./api/playback.js";
import { EffectRenderService } from "./application/effect-render-service.js";
import { PlaybackService } from "./application/playback-service.js";
import { CanvasAudioService } from "./application/canvas-audio-service.js";
import { WeatherService } from "./application/weather-service.js";
import { WeatherAlertNotifier } from "./application/weather-alert-notifier.js";
import { createCanvasRouter } from "./api/canvases.js";
import { CanvasService } from "./application/canvas-service.js";
import { SqliteControllerRepository } from "./infrastructure/persistence/sqlite-controller-repository.js";
import { SqliteCanvasRepository } from "./infrastructure/persistence/sqlite-canvas-repository.js";
import { SqlitePlaybackRepository } from "./infrastructure/persistence/sqlite-playback-repository.js";
import { Metrics } from "./infrastructure/metrics/metrics.js";
import { createMetricsRouter } from "./api/metrics.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createStatusRouter } from "./api/status.js";
import {
  validateDatabase,
  formatValidationReport,
} from "./application/database-validation-service.js";
import { bringControllersOnline } from "./application/controller-online-service.js";

export function createApp({
  controllerService = new ControllerService({
    repository: new SqliteControllerRepository({
      databasePath: config.effectDatabasePath,
    }),
  }),
  canvasService = new CanvasService({
    repository: new SqliteCanvasRepository({
      databasePath: config.effectDatabasePath,
    }),
  }),
  playbackService,
  eventHub = new EventHub(),
  metrics = new Metrics(),
  gateway = new TcpControllerGateway(),
  effectService = new EffectLibraryService({
    repository: new SqliteEffectRepository({
      databasePath: config.effectDatabasePath,
      seedEffects: defaultEffects,
    }),
  }),
  distributionService = new EffectDistributionService({
    controllerService,
    gateway,
    eventHub,
  }),
  playbackRepository = new SqlitePlaybackRepository({
    databasePath: config.effectDatabasePath,
  }),
  audioService = new CanvasAudioService({ telemetrySource: gateway }),
  weatherService = new WeatherService(),
} = {}) {
  const app = express();
  app.locals.eventHub = eventHub;
  app.locals.distributionService = distributionService;
  app.locals.effectService = effectService;
  app.locals.canvasService = canvasService;
  app.locals.controllerService = controllerService;
  app.locals.gateway = gateway;
  app.locals.playbackRepository = playbackRepository;
  app.locals.audioService = audioService;
  app.locals.playbackService =
    playbackService ||
    new PlaybackService({
      canvasService,
      effectService,
      renderService: new EffectRenderService(),
      distributionService,
      controllerService,
      eventHub,
      playbackRepository,
      audioService,
      weatherService,
    });
  // Ring the matrices' speakers when the weather service sees a new alert.
  const weatherAlertNotifier = new WeatherAlertNotifier({
    playbackService: app.locals.playbackService,
    canvasService,
    controllerService,
    effectService,
    gateway,
  });
  weatherService.onNewAlerts = (fsa) => weatherAlertNotifier.notify(fsa);
  app.locals.metrics = metrics;

  app.use(
    cors({
      origin: config.corsOrigins.includes("*") ? true : config.corsOrigins,
      methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "If-Match-Revision",
        "X-Requested-With",
      ],
      credentials: false,
    }),
  );
  app.use(express.json());
  app.use((req, res, next) => {
    req.requestId = uuidv4();
    res.setHeader("X-Request-Id", req.requestId);
    next();
  });
  app.use((req, res, next) => {
    const startedAt = Date.now();
    metrics.recordRequest();
    res.on("finish", () =>
      metrics.recordResponse({
        durationMs: Date.now() - startedAt,
        statusCode: res.statusCode,
      }),
    );
    next();
  });
  app.use("/api", createAuthMiddleware({ token: config.authToken }));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });
  app.use("/api/metrics", createMetricsRouter({ metrics }));
  app.use(
    "/api/status",
    createStatusRouter({
      canvasService,
      controllerService,
      playbackService: app.locals.playbackService,
      gateway,
    }),
  );

  app.use(
    "/api/controllers",
    createControllerRouter({ controllerService, gateway }),
  );
  app.use(
    "/api/distribution",
    createDistributionRouter({ distributionService, canvasService }),
  );
  app.use("/api/effects", createEffectRouter({ effectService }));
  app.use(
    "/api/canvases",
    createCanvasRouter({
      canvasService,
      playbackService: app.locals.playbackService,
      audioService,
      weatherAlertNotifier,
    }),
  );
  app.use(
    "/api/playback",
    createPlaybackRouter({ playbackService: app.locals.playbackService }),
  );

  app.use((req, res) => {
    res.status(404).json({
      error: "Route not found",
      requestId: req.requestId,
    });
  });

  app.use((err, req, res, next) => {
    const statusCode =
      err.statusCode || (err instanceof SyntaxError ? 400 : 500);
    const response = {
      error:
        statusCode === 500
          ? "Internal server error"
          : err instanceof SyntaxError
            ? "Invalid JSON body"
            : err.message,
      requestId: req.requestId,
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

// Validates persisted data, brings controllers online, then restores any
// canvases that were playing an effect before the last shutdown.
async function runStartupSequence(app) {
  const {
    effectService,
    canvasService,
    controllerService,
    gateway,
    playbackRepository,
    playbackService,
  } = app.locals;

  const report = validateDatabase({
    effectService,
    canvasService,
    controllerService,
    playbackRepository,
  });
  console.log(formatValidationReport(report));

  const connectivity = await bringControllersOnline({
    controllerService,
    gateway,
  });
  console.log(
    `Controllers online: ${connectivity.online.length}, offline: ${connectivity.offline.length}`,
  );
  for (const failure of connectivity.offline) {
    console.warn(
      `Controller ${failure.controllerId} failed to connect: ${failure.error}`,
    );
  }

  await Promise.allSettled(
    controllerService.list().map((controller) =>
      gateway
        .probeAudioSupport(controller)
        .then((available) =>
          controllerService.setAudioAvailability(controller.id, { available }),
        ),
    ),
  );

  await playbackService.restore();
}

// Start server
export function startServer() {
  const server = createServer(app);
  attachRealtimeServer({
    server,
    eventHub: app.locals.eventHub,
    distributionService: app.locals.distributionService,
    authToken: config.authToken,
  });
  server.listen(config.port, config.host, () => {
    console.log(
      `LED-Central backend server running on http://${config.host}:${config.port}`,
    );
    console.log(`API available at http://${config.host}:${config.port}/api`);
    runStartupSequence(app).catch((error) => {
      console.error("Startup sequence failed", error);
    });
  });
  return server;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  startServer();
}

export default app;
