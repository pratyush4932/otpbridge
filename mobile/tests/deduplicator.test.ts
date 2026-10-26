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

  test('Different messages with the same notification ID produce distinct keys', () => {
    // Android SMS apps often reuse id="0" across subsequent messages
    const key1 = deduplicator.generateKey('com.google.android.apps.messaging', 'Bank', 'OTP is 123456', '0');
    const key2 = deduplicator.generateKey('com.google.android.apps.messaging', 'Bank', 'OTP is 654321', '0');
    assert.notStrictEqual(key1, key2);
    assert.strictEqual(deduplicator.isDuplicate(key1), false);
    assert.strictEqual(deduplicator.isDuplicate(key2), false);
  });

  test('Identical message with same notification ID is detected as duplicate', () => {
    const key1 = deduplicator.generateKey('com.google.android.apps.messaging', 'Bank', 'OTP is 123456', '1001');
    const key2 = deduplicator.generateKey('com.google.android.apps.messaging', 'Bank', 'OTP is 123456', '1001');
    assert.strictEqual(key1, key2);
    assert.strictEqual(deduplicator.isDuplicate(key1), false);
    assert.strictEqual(deduplicator.isDuplicate(key2), true);
  });

  test('Normalizes invisible zero-width spaces and redundant whitespace', () => {
    const key1 = deduplicator.generateKey('com.messaging', 'Title', 'Your\u200B OTP\uFEFF is  123456');
    const key2 = deduplicator.generateKey('com.messaging', 'Title', 'Your OTP is 123456');
    assert.strictEqual(key1, key2);
  });

  test('peek checks duplicate status without recording lastSeen', () => {
    const key = deduplicator.generateKey('com.app', 'Title', 'Text');
    assert.strictEqual(deduplicator.peek(key), false);
    assert.strictEqual(deduplicator.isDuplicate(key), false);
    assert.strictEqual(deduplicator.peek(key), true);
  });

  test('clear empties the deduplication cache', () => {
    const key = deduplicator.generateKey('com.app', 'Title', 'Text');
    deduplicator.isDuplicate(key);
    assert.strictEqual(deduplicator.peek(key), true);
    deduplicator.clear();
    assert.strictEqual(deduplicator.peek(key), false);
    assert.strictEqual(deduplicator.size, 0);
  });
});
