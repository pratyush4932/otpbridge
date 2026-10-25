import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { deviceStore } from '../services/device-store.js';
import { ephemeralMessageQueue } from '../services/message-queue.js';
import { wsManager } from '../websocket/ws-server.js';
import { formatSafeMessageLog } from '../security/sanitize.js';

const messagePayloadSchema = z.object({
  id: z.string().min(1).max(128),
  packageName: z.string().min(1).max(128),
  title: z.string().max(256).optional(),
  serviceName: z.string().max(128).optional(),
  carrierTag: z.string().max(64).optional(),
  otpCode: z.string().min(3).max(32),
  bodySnippet: z.string().max(256).optional(),
  timestamp: z.number().int().positive()
});

export async function messageRoutes(app: FastifyInstance) {
  app.post('/api/messages', async (req, reply) => {
    const deviceId = req.headers['x-device-id'] as string;
    const deviceToken = req.headers['x-device-token'] as string;

    if (!deviceId || !deviceToken) {
      return reply.code(401).send({ error: 'Missing device authentication headers' });
    }

    const sender = deviceStore.authenticateDevice(deviceId, deviceToken);
    if (!sender || sender.role !== 'sender') {
      return reply.code(401).send({ error: 'Unauthorized or invalid sender device' });
    }

    if (!sender.pairedWithId) {
      return reply.code(403).send({ error: 'Sender is not paired to any receiver' });
    }

    const receiver = deviceStore.getDevice(sender.pairedWithId);
    if (!receiver || receiver.revoked) {
      return reply.code(403).send({ error: 'Paired receiver is invalid or revoked' });
    }

    const parseResult = messagePayloadSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Invalid message payload',
        details: parseResult.error.flatten()
      });
    }

    const payload = parseResult.data;
    const dedupKey = `${sender.id}:${payload.id}`;

    // Deduplication check
    if (ephemeralMessageQueue.isDuplicate(dedupKey)) {
      app.log.info(formatSafeMessageLog({
        messageId: payload.id,
        senderId: sender.id,
        receiverId: receiver.id,
        packageName: payload.packageName,
        status: 'duplicate_ignored'
      }));

      return reply.code(200).send({
        delivered: false,
        queued: false,
        duplicate: true,
        messageId: payload.id
      });
    }

    // Attempt real-time WebSocket delivery
    const isDelivered = wsManager.deliverToReceiver(receiver.id, {
      id: payload.id,
      senderId: sender.id,
      packageName: payload.packageName,
      title: payload.title,
      serviceName: payload.serviceName,
      carrierTag: payload.carrierTag,
      otpCode: payload.otpCode,
      bodySnippet: payload.bodySnippet,
      timestamp: payload.timestamp,
      wasQueued: false
    });

    if (isDelivered) {
      app.log.info(formatSafeMessageLog({
        messageId: payload.id,
        senderId: sender.id,
        receiverId: receiver.id,
        packageName: payload.packageName,
        status: 'delivered_realtime'
      }));

      return reply.code(200).send({
        delivered: true,
        queued: false,
        messageId: payload.id
      });
    }

    // Receiver is currently offline: enqueue with TTL
    const enqueued = ephemeralMessageQueue.enqueue({
      id: payload.id,
      senderId: sender.id,
      receiverId: receiver.id,
      packageName: payload.packageName,
      title: payload.title,
      serviceName: payload.serviceName,
      carrierTag: payload.carrierTag,
      otpCode: payload.otpCode,
      bodySnippet: payload.bodySnippet,
      timestamp: payload.timestamp
    });

    app.log.info(formatSafeMessageLog({
      messageId: payload.id,
      senderId: sender.id,
      receiverId: receiver.id,
      packageName: payload.packageName,
      status: enqueued ? 'enqueued_offline' : 'queue_rejected'
    }));

    return reply.code(200).send({
      delivered: false,
      queued: enqueued,
      receiverOffline: true,
      messageId: payload.id
    });
  });

  // Diagnostic route: Log ignored/unlisted notification unmasked to the server terminal
  app.post('/api/messages/unlisted', async (req, reply) => {
    const { packageName, title, body, reason } = (req.body as any) || {};

    console.log('\n================ [IGNORED UNLISTED NOTIFICATION] ================');
    console.log(`📦 Package: ${packageName || 'unknown'}`);
    console.log(`📌 Title:   ${title || '(no title)'}`);
    console.log(`💬 Message: "${body || '(no body)'}"`);
    console.log(`⚠️  Reason:  ${reason || 'Package not allowlisted or filtered'}`);
    console.log('=================================================================\n');

    return reply.code(200).send({ success: true });
  });
}
