import { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', { config: { rateLimit: false } }, async () => {
    return {
      status: 'ok',
      service: 'otp-bridge-relay',
      timestamp: Date.now(),
      uptime: process.uptime()
    };
  });
}
