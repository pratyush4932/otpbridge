import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { NotificationDeduplicator } from '../services/deduplicator.js';

describe('Notification Deduplicator Tests', () => {
  let deduplicator: NotificationDeduplicator;

  beforeEach(() => {
    deduplicator = new NotificationDeduplicator();
  });

  test('First occurrence is not duplicate', () => {
    const key = deduplicator.generateKey('com.google.android.apps.messaging', 'Code', 'Code is 123456');
    assert.strictEqual(deduplicator.isDuplicate(key), false);
  });

  test('Immediate second occurrence is detected as duplicate', () => {
    const key = deduplicator.generateKey('com.google.android.apps.messaging', 'Code', 'Code is 123456');
    deduplicator.isDuplicate(key);
    assert.strictEqual(deduplicator.isDuplicate(key), true);
  });

  test('Different packages produce distinct keys', () => {
    const key1 = deduplicator.generateKey('com.google.android.apps.messaging', 'Code', 'Code is 123456');
    const key2 = deduplicator.generateKey('com.whatsapp', 'Code', 'Code is 123456');
    assert.strictEqual(deduplicator.isDuplicate(key1), false);
    assert.strictEqual(deduplicator.isDuplicate(key2), false);
  });

  test('Expired key after time window is accepted again', () => {
    const key = deduplicator.generateKey('com.google.android.apps.messaging', 'Code', 'Code is 123456');
    // Set tiny 10ms window
    assert.strictEqual(deduplicator.isDuplicate(key, 10), false);
    assert.strictEqual(deduplicator.isDuplicate(key, 10), true);

    // Sleep 25ms to let window pass
    const start = Date.now();
    while (Date.now() - start < 25) {
      // spin wait
    }

    assert.strictEqual(deduplicator.isDuplicate(key, 10), false);
  });
});
