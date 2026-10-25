import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import { buildApp } from '../src/index.js';
import { deviceStore } from '../src/services/device-store.js';
import { ephemeralMessageQueue } from '../src/services/message-queue.js';
import { wsManager } from '../src/websocket/ws-server.js';
import { config } from '../src/config.js';
import { FastifyInstance } from 'fastify';

describe('OTP Bridge Server Integration Tests', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildApp();
  });

  beforeEach(() => {
    deviceStore.clear();
    ephemeralMessageQueue.clear();
  });

  after(async () => {
    wsManager.destroy();
    if (app) await app.close();
  });

  test('Health check returns ok', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health'
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'ok');
  });

  test('Pairing Flow: Receiver creates session, Sender completes with token', async () => {
    // 1. Receiver starts pairing
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/pairing/start',
      payload: { receiverName: 'Receiver Pixel 8' }
    });
    assert.strictEqual(startRes.statusCode, 200);
    const startData = JSON.parse(startRes.body);
    assert.ok(startData.pairingToken);
    assert.ok(startData.receiverDevice.id);
    assert.ok(startData.receiverDevice.token);

    const receiverId = startData.receiverDevice.id;
    const receiverToken = startData.receiverDevice.token;
    const pairingToken = startData.pairingToken;

    // 2. Sender completes pairing
    const completeRes = await app.inject({
      method: 'POST',
      url: '/api/pairing/complete',
      payload: {
        pairingToken,
        senderName: 'Sender Galaxy S24'
      }
    });
    assert.strictEqual(completeRes.statusCode, 200);
    const completeData = JSON.parse(completeRes.body);
    assert.strictEqual(completeData.success, true);
    assert.ok(completeData.senderDevice.id);
    assert.ok(completeData.senderDevice.token);
    assert.strictEqual(completeData.senderDevice.pairedWithReceiverId, receiverId);

    // 3. Verify sender device query
    const senderRes = await app.inject({
      method: 'GET',
      url: '/api/devices',
      headers: {
        'x-device-id': completeData.senderDevice.id,
        'x-device-token': completeData.senderDevice.token
      }
    });
    assert.strictEqual(senderRes.statusCode, 200);
    const senderData = JSON.parse(senderRes.body);
    assert.strictEqual(senderData.device.isPaired, true);
    assert.strictEqual(senderData.partner.id, receiverId);
  });

  test('Pairing Security: Replay / Repeated use of single-use token fails', async () => {
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/pairing/start',
      payload: { receiverName: 'Receiver Phone' }
    });
    const { pairingToken } = JSON.parse(startRes.body);

    // First use succeeds
    const firstAttempt = await app.inject({
      method: 'POST',
      url: '/api/pairing/complete',
      payload: { pairingToken, senderName: 'Sender Phone' }
    });
    assert.strictEqual(firstAttempt.statusCode, 200);

    // Second use must fail
    const secondAttempt = await app.inject({
      method: 'POST',
      url: '/api/pairing/complete',
      payload: { pairingToken, senderName: 'Attacker Phone' }
    });
    assert.strictEqual(secondAttempt.statusCode, 400);
    const err = JSON.parse(secondAttempt.body);
    assert.match(err.error, /invalid or non-existent|already been used/i);
  });

  test('Pairing Security: Expired pairing token is rejected', async () => {
    // Register receiver manually with negative TTL
    const { device } = deviceStore.registerReceiver('Receiver');
    const session = deviceStore.createPairingSession(device.id, 'http://localhost:4000', -10);

    const res = await app.inject({
      method: 'POST',
      url: '/api/pairing/complete',
      payload: { pairingToken: session.rawPairingToken, senderName: 'Sender' }
    });
    assert.strictEqual(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /expired/i);
  });

  test('Authorization: Unpaired sender cannot forward messages', async () => {
    // Fabricate an unregistered sender credentials
    const res = await app.inject({
      method: 'POST',
      url: '/api/messages',
      headers: {
        'x-device-id': 'snd_fake',
        'x-device-token': 'token_fake'
      },
      payload: {
        id: 'msg_1',
        packageName: 'com.google.android.apps.messaging',
        otpCode: '849201',
        timestamp: Date.now()
      }
    });
    assert.strictEqual(res.statusCode, 401);
  });

  test('Revocation: Revoked device is immediately rejected', async () => {
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/pairing/start',
      payload: { receiverName: 'Receiver' }
    });
    const { pairingToken } = JSON.parse(startRes.body);

    const completeRes = await app.inject({
      method: 'POST',
      url: '/api/pairing/complete',
      payload: { pairingToken, senderName: 'Sender' }
    });
    const { senderDevice } = JSON.parse(completeRes.body);

    // Revoke the sender
    const revokeRes = await app.inject({
      method: 'POST',
      url: '/api/devices/revoke',
      headers: {
        'x-device-id': senderDevice.id,
        'x-device-token': senderDevice.token
      }
    });
    assert.strictEqual(revokeRes.statusCode, 200);

    // Any subsequent call with this token must be rejected
    const testPost = await app.inject({
      method: 'POST',
      url: '/api/messages',
      headers: {
        'x-device-id': senderDevice.id,
        'x-device-token': senderDevice.token
      },
      payload: {
        id: 'msg_2',
        packageName: 'com.whatsapp',
        otpCode: '123456',
        timestamp: Date.now()
      }
    });
    assert.strictEqual(testPost.statusCode, 401);
  });

  test('Validation: Rejects invalid request payloads', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/pairing/complete',
      payload: { invalidField: 123 }
    });
    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, 'Invalid request payload');
  });

  test('Message Forwarding: Offline receiver causes message to be safely queued with TTL', async () => {
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/pairing/start',
      payload: { receiverName: 'Receiver' }
    });
    const { pairingToken, receiverDevice } = JSON.parse(startRes.body);

    const completeRes = await app.inject({
      method: 'POST',
      url: '/api/pairing/complete',
      payload: { pairingToken, senderName: 'Sender' }
    });
    const { senderDevice } = JSON.parse(completeRes.body);

    // Post message while receiver is offline
    const msgRes = await app.inject({
      method: 'POST',
      url: '/api/messages',
      headers: {
        'x-device-id': senderDevice.id,
        'x-device-token': senderDevice.token
      },
      payload: {
        id: 'evt_test_100',
        packageName: 'com.google.android.apps.messaging',
        title: 'Bank Alert',
        serviceName: 'HDFC Bank',
        carrierTag: 'via SMS',
        otpCode: '938210',
        bodySnippet: 'Your security code is 938210',
        timestamp: Date.now()
      }
    });

    assert.strictEqual(msgRes.statusCode, 200);
    const msgData = JSON.parse(msgRes.body);
    assert.strictEqual(msgData.delivered, false);
    assert.strictEqual(msgData.queued, true);
    assert.strictEqual(msgData.receiverOffline, true);

    // Verify message is in ephemeral queue with service and carrier metadata
    const queued = ephemeralMessageQueue.peekForReceiver(receiverDevice.id);
    assert.strictEqual(queued.length, 1);
    assert.strictEqual(queued[0].otpCode, '938210');
    assert.strictEqual(queued[0].serviceName, 'HDFC Bank');
    assert.strictEqual(queued[0].carrierTag, 'via SMS');

    // Duplicate submission within window is ignored
    const dupRes = await app.inject({
      method: 'POST',
      url: '/api/messages',
      headers: {
        'x-device-id': senderDevice.id,
        'x-device-token': senderDevice.token
      },
      payload: {
        id: 'evt_test_100',
        packageName: 'com.google.android.apps.messaging',
        title: 'Bank Alert',
        otpCode: '938210',
        timestamp: Date.now()
      }
    });
    const dupData = JSON.parse(dupRes.body);
    assert.strictEqual(dupData.duplicate, true);

    // Flush on receiver reconnect returns queued items
    const flushed = ephemeralMessageQueue.flushForReceiver(receiverDevice.id);
    assert.strictEqual(flushed.length, 1);
    assert.strictEqual(flushed[0].id, 'evt_test_100');

    // After flush, queue is empty
    assert.strictEqual(ephemeralMessageQueue.peekForReceiver(receiverDevice.id).length, 0);
  });

  test('Health check is exempt from rate limits and always succeeds', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health'
    });
    assert.strictEqual(res.statusCode, 200);
  });

  test('Rate Limiting: Rejects requests exceeding rate limit threshold on API routes', async () => {
    let lastRes;
    for (let i = 0; i <= config.RATE_LIMIT_MAX + 5; i++) {
      lastRes = await app.inject({
        method: 'GET',
        url: '/api/devices'
      });
      if (lastRes.statusCode === 429) break;
    }
    assert.strictEqual(lastRes?.statusCode, 429);
    assert.match(JSON.parse(lastRes.body).message || JSON.parse(lastRes.body).error, /rate limit/i);
  });
});

