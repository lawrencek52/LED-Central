import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config/index.js';
import { ControllerService } from './application/controller-service.js';
import { createControllerRouter } from './api/controllers.js';

export function createApp({ controllerService = new ControllerService() } = {}) {
  const app = express();

  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json());
  app.use((req, res, next) => {
    req.requestId = uuidv4();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  });

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api/controllers', createControllerRouter({ controllerService }));

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
  return app.listen(config.port, config.host, () => {
    console.log(
      `LED-Central backend server running on http://${config.host}:${config.port}`
    );
    console.log(`API available at http://${config.host}:${config.port}/api`);
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  startServer();
}

export default app;
