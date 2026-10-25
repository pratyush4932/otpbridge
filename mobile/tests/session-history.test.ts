import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { SessionHistoryService } from '../services/session-history.js';

describe('Session History Service Tests', () => {
  let service: SessionHistoryService;

  beforeEach(async () => {
    const { StorageService } = await import('../services/storage.js');
    await StorageService.clearCredentials();
    service = new SessionHistoryService();
    await service.clearHistory();
  });

  test('Starts with empty event history', () => {
    assert.strictEqual(service.getEvents().length, 0);
  });

  test('Records session event chronologically (newest first)', async () => {
    await service.recordEvent('pairing_created', 'Pairing session created', 'Single-use QR code ready');
    await service.recordEvent('pairing_attempt', 'Pairing scan initiated');

    const events = service.getEvents();
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].type, 'pairing_attempt');
    assert.strictEqual(events[1].type, 'pairing_created');
  });

  test('Debounces identical events within debounce window', async () => {
    await service.recordEvent('connection_established', 'Connection online');
    await service.recordEvent('connection_established', 'Connection online');
    await service.recordEvent('connection_established', 'Connection online');

    const events = service.getEvents();
    assert.strictEqual(events.length, 1);
  });

  test('Notifies subscribers on event recording', async () => {
    let notifiedCount = 0;
    const unsub = service.onHistoryChange((events) => {
      notifiedCount++;
      assert.ok(events.length > 0);
    });

    await service.recordEvent('connection_restored', 'Connection restored');
    assert.strictEqual(notifiedCount, 1);
    unsub();

    await service.recordEvent('session_ended', 'Session ended');
    assert.strictEqual(notifiedCount, 1); // Unsubscribed, no additional increment
  });

  test('Clears session history completely', async () => {
    await service.recordEvent('pairing_created', 'Created');
    assert.strictEqual(service.getEvents().length, 1);

    await service.clearHistory();
    assert.strictEqual(service.getEvents().length, 0);
  });

  test('Ensures recorded event attributes are non-empty and well-formed', async () => {
    const event = await service.recordEvent(
      'pairing_completed',
      'Pairing completed',
      'Sender paired successfully'
    );

    assert.ok(event.id);
    assert.strictEqual(event.type, 'pairing_completed');
    assert.strictEqual(event.title, 'Pairing completed');
    assert.strictEqual(event.detail, 'Sender paired successfully');
    assert.ok(typeof event.timestamp === 'number');
    assert.ok(event.timestamp <= Date.now());
  });

  test('ensureActiveSessionRecorded bootstraps active session events for paired device', async () => {
    const { StorageService } = await import('../services/storage.js');
    await StorageService.saveCredentials({
      role: 'sender',
      pairedWithId: 'receiver_device_xyz',
      serverUrl: 'http://192.168.1.100:4000'
    });

    const freshService = new SessionHistoryService();
    await freshService.loadHistory();
    await freshService.ensureActiveSessionRecorded();

    const events = freshService.getEvents();
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].type, 'connection_established');
    assert.strictEqual(events[1].type, 'pairing_completed');
    assert.ok(events[1].detail?.includes('Receiver'));

    // Clean up
    await StorageService.clearCredentials();
  });
});
