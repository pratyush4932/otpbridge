import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { pairingRoutes } from './routes/pairing.js';
import { deviceRoutes } from './routes/devices.js';
import { messageRoutes } from './routes/messages.js';
import { wsManager } from './websocket/ws-server.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = fastify({
    bodyLimit: config.MAX_PAYLOAD_SIZE_BYTES,
    logger: {
      level: config.NODE_ENV === 'test' ? 'silent' : 'info',
      serializers: {
        req(req) {
          return {
            method: req.method,
            url: req.url,
            hostname: req.hostname,
            remoteAddress: req.ip
          };
        }
      }
    }
  });

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS']
  });

  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_TIME_WINDOW_MS
  });

  await app.register(fastifyWebsocket, {
    options: {
      maxPayload: config.MAX_PAYLOAD_SIZE_BYTES
    }
  });

  // WebSocket Route for Receiver clients
  app.register(async (instance) => {
    instance.get('/ws', { websocket: true }, (connection) => {
      wsManager.handleConnection(connection);
    });
  });

  // Register REST Routes
  await app.register(healthRoutes);
  await app.register(pairingRoutes);
  await app.register(deviceRoutes);
  await app.register(messageRoutes);

  // Global Error Handler
  app.setErrorHandler((error: any, request, reply) => {
    app.log.error(`API Error: ${error.message}`);
    if (error.statusCode) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    return reply.code(500).send({ error: 'Internal Server Error' });
  });

  return app;
}

import { fileURLToPath } from 'node:url';

// Start standalone server when executed directly
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('index.ts') ||
  process.argv[1].endsWith('index.js')
);

if (isDirectRun && process.env.NODE_ENV !== 'test') {
  buildApp()
    .then(async (app) => {
      try {
        const address = await app.listen({
          port: config.PORT,
          host: config.HOST
        });
        console.log(`🚀 OTP Bridge Server listening at ${address}`);
        console.log(`📡 WebSocket endpoint ready at ws://${config.HOST === '0.0.0.0' ? '127.0.0.1' : config.HOST}:${config.PORT}/ws`);
      } catch (err) {
        app.log.error(err);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Fatal initialization error:', err);
      process.exit(1);
    });
}
