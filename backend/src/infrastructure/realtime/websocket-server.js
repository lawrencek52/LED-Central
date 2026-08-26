import WebSocket, { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { EffectDistributionError } from '../../application/effect-distribution-service.js';

export function attachRealtimeServer({
  server,
  eventHub,
  distributionService,
  path = '/api/realtime',
  authToken = ''
}) {
  const websocketServer = new WebSocketServer({ noServer: true });
  const clients = new Map();

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== path) {
      socket.destroy();
      return;
    }
    if (authToken && url.searchParams.get('token') !== authToken) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, client => {
      websocketServer.emit('connection', client, request);
    });
  });

  const unsubscribe = eventHub.subscribe(event => {
    for (const [client, subscriptions] of clients) {
      if (client.readyState === WebSocket.OPEN && subscriptions.has(event.topic)) {
        client.send(JSON.stringify(event));
      }
    }
  });

  websocketServer.on('connection', client => {
    const subscriptions = new Set(['controllers', 'playback', 'distribution']);
    clients.set(client, subscriptions);
    send(client, { type: 'realtime.connected', topics: [...subscriptions] });

    client.on('message', async data => {
      try {
        await handleMessage({
          client,
          subscriptions,
          message: JSON.parse(data.toString()),
          distributionService
        });
      } catch (error) {
        sendError(client, error);
      }
    });

    client.on('close', () => clients.delete(client));
  });

  websocketServer.closeAll = () => {
    unsubscribe();
    for (const client of clients.keys()) {
      client.terminate();
    }
    clients.clear();
    websocketServer.close();
  };

  return websocketServer;
}

async function handleMessage({ client, subscriptions, message, distributionService }) {
  if (!message || typeof message.type !== 'string') {
    throw new EffectDistributionError('WebSocket message requires a type', 400);
  }

  if (message.type === 'ping') {
    send(client, { type: 'pong', timestamp: new Date().toISOString() });
    return;
  }

  if (message.type === 'subscribe' || message.type === 'unsubscribe') {
    if (!Array.isArray(message.topics) || message.topics.some(topic => typeof topic !== 'string')) {
      throw new EffectDistributionError('topics must be an array of strings', 400);
    }

    for (const topic of message.topics) {
      if (message.type === 'subscribe') {
        subscriptions.add(topic);
      } else {
        subscriptions.delete(topic);
      }
    }
    send(client, { type: `${message.type}d`, topics: [...subscriptions] });
    return;
  }

  if (message.type === 'effect.frames') {
    const requestId = message.requestId || uuidv4();
    const result = await distributionService.distribute({
      controllerIds: message.controllerIds,
      frames: message.frames
    });
    send(client, { type: 'effect.frames.accepted', requestId, result });
    return;
  }

  throw new EffectDistributionError(`Unsupported WebSocket message: ${message.type}`, 400);
}

function send(client, message) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(message));
  }
}

function sendError(client, error) {
  send(client, {
    type: 'error',
    statusCode: error.statusCode || 500,
    error: error.statusCode ? error.message : 'Internal server error',
    ...(error.details ? { details: error.details } : {})
  });
}
