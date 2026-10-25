import { FastifyInstance } from 'fastify';
import { deviceStore } from '../services/device-store.js';

export async function deviceRoutes(app: FastifyInstance) {
  // Query device status and pairing binding
  app.get('/api/devices', async (req, reply) => {
    const deviceId = req.headers['x-device-id'] as string;
    const deviceToken = req.headers['x-device-token'] as string;

    if (!deviceId || !deviceToken) {
      return reply.code(401).send({ error: 'Missing device authentication headers' });
    }

    const device = deviceStore.authenticateDevice(deviceId, deviceToken);
    if (!device) {
      return reply.code(401).send({ error: 'Unauthorized or revoked device' });
    }

    let partnerStatus = null;
    if (device.pairedWithId) {
      const partner = deviceStore.getDevice(device.pairedWithId);
      if (partner && !partner.revoked) {
        partnerStatus = {
          id: partner.id,
          role: partner.role,
          name: partner.name,
          lastSeenAt: partner.lastSeenAt
        };
      }
    }

    return reply.code(200).send({
      device: {
        id: device.id,
        role: device.role,
        name: device.name,
        createdAt: device.createdAt,
        lastSeenAt: device.lastSeenAt,
        isPaired: Boolean(device.pairedWithId && partnerStatus)
      },
      partner: partnerStatus
    });
  });

  // Revoke device and immediate unpair
  app.post('/api/devices/revoke', async (req, reply) => {
    const deviceId = req.headers['x-device-id'] as string;
    const deviceToken = req.headers['x-device-token'] as string;

    if (!deviceId || !deviceToken) {
      return reply.code(401).send({ error: 'Missing device authentication headers' });
    }

    const device = deviceStore.authenticateDevice(deviceId, deviceToken);
    if (!device) {
      return reply.code(401).send({ error: 'Unauthorized or already revoked' });
    }

    deviceStore.revokeDevice(device.id);

    return reply.code(200).send({
      success: true,
      message: 'Device revoked and unlinked successfully'
    });
  });
}
