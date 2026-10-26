import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { deviceStore } from '../services/device-store.js';
import { wsManager } from '../websocket/ws-server.js';

const pairingStartSchema = z.object({
  receiverName: z.string().max(64).optional(),
  deviceId: z.string().optional(),
  token: z.string().optional(),
  serverUrl: z.string().optional()
});

const pairingCompleteSchema = z.object({
  pairingToken: z.string().min(16).max(128),
  senderName: z.string().max(64).optional()
});

export async function pairingRoutes(app: FastifyInstance) {
  // Receiver starts a short-lived, single-use pairing session
  app.post('/api/pairing/start', async (req, reply) => {
    const parseResult = pairingStartSchema.safeParse(req.body || {});
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Invalid request payload',
        details: parseResult.error.flatten()
      });
    }

    const { receiverName, deviceId, token } = parseResult.data;

    let receiverId: string;
    let rawReceiverToken: string | undefined;

    // Check if receiver already has credentials
    if (deviceId && token) {
      const existing = deviceStore.authenticateDevice(deviceId, token);
      if (existing) {
        if (existing.role !== 'receiver') {
          return reply.code(401).send({ error: 'Device is not a receiver' });
        }
        receiverId = existing.id;
      } else {
        // Credentials no longer exist on server (e.g. server restart)
        // Re-register a fresh receiver device so pairing succeeds seamlessly
        const registered = deviceStore.registerReceiver(receiverName || 'Receiver Phone B');
        receiverId = registered.device.id;
        rawReceiverToken = registered.rawToken;
      }
    } else {
      // Register a new receiver device
      const registered = deviceStore.registerReceiver(receiverName || 'Receiver Phone B');
      receiverId = registered.device.id;
      rawReceiverToken = registered.rawToken;
    }

    const clientServerUrl = parseResult.data.serverUrl?.trim().replace(/\/+$/, '');
    const hostHeader = req.headers.host || '127.0.0.1:4000';
    const rawProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
    const protocol = rawProto || (req.protocol === 'https' ? 'https' : 'http');
    const detectedUrl = `${protocol}://${hostHeader}`;
    const serverUrl = clientServerUrl || detectedUrl;

    try {
      const session = deviceStore.createPairingSession(receiverId, serverUrl);

      return reply.code(200).send({
        pairingId: session.pairingId,
        pairingToken: session.rawPairingToken,
        serverUrl,
        expiresAt: session.expiresAt,
        receiverDevice: {
          id: receiverId,
          token: rawReceiverToken // returned on new registration
        }
      });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message || 'Failed to create pairing session' });
    }
  });

  // Sender completes pairing by submitting the scanned pairing token
  app.post('/api/pairing/complete', async (req, reply) => {
    const parseResult = pairingCompleteSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Invalid request payload',
        details: parseResult.error.flatten()
      });
    }

    const { pairingToken, senderName } = parseResult.data;

    try {
      const result = deviceStore.completePairing(
        pairingToken,
        senderName || 'Sender Phone A'
      );

      // Notify connected receiver device that pairing is complete
      wsManager.sendEventToReceiver(result.receiverId, {
        type: 'pairing_success',
        partner: {
          id: result.senderDevice.id,
          name: result.senderDevice.name
        }
      });

      return reply.code(200).send({
        success: true,
        senderDevice: {
          id: result.senderDevice.id,
          token: result.rawSenderToken,
          pairedWithReceiverId: result.receiverId
        }
      });
    } catch (err: any) {
      return reply.code(400).send({
        error: err.message || 'Pairing completion failed'
      });
    }
  });
}
