import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { ReceiverSocketClient, ReceivedOtpMessage } from '../services/receiver-socket.js';
import { StorageService } from '../services/storage.js';

describe('Receiver Socket & Message Retention Tests', () => {
  let client: ReceiverSocketClient;
  const createdClients: ReceiverSocketClient[] = [];

  beforeEach(async () => {
    await StorageService.clearCredentials();
    await StorageService.clearReceivedMessages();
    client = new ReceiverSocketClient();
    createdClients.push(client);
    await client.clearMessages();
  });

  afterEach(() => {
    for (const c of createdClients) {
      c.stopPruneInterval();
      c.disconnect();
    }
    createdClients.length = 0;
  });

  test('Starts with empty message list when no messages exist', () => {
    assert.strictEqual(client.getMessages().length, 0);
  });

  test('Retains messages in memory across simulated page navigation', async () => {
    const mockMessage: ReceivedOtpMessage = {
      id: 'msg_test_1',
      senderId: 'dev_snd_1',
      packageName: 'com.google.android.apps.messaging',
      serviceName: 'HDFC Bank',
      carrierTag: 'via SMS',
      otpCode: '849201',
      bodySnippet: '849201 is your OTP for transaction',
      timestamp: Date.now(),
      receivedAt: Date.now(),
      wasQueued: false
    };

    // Save message via StorageService as if received
    await StorageService.saveReceivedMessages([mockMessage]);

    // Simulate opening Receiver Screen: loads stored messages
    await client.loadStoredMessages();

    assert.strictEqual(client.getMessages().length, 1);
    assert.strictEqual(client.getMessages()[0].otpCode, '849201');
    assert.strictEqual(client.getMessages()[0].serviceName, 'HDFC Bank');

    // Simulate navigating outside Receiver Screen (unmounting) and navigating back (mounting fresh instance)
    const newPageClient = new ReceiverSocketClient();
    createdClients.push(newPageClient);
    await newPageClient.loadStoredMessages();

    assert.strictEqual(newPageClient.getMessages().length, 1);
    assert.strictEqual(newPageClient.getMessages()[0].otpCode, '849201');
    assert.strictEqual(newPageClient.getMessages()[0].id, 'msg_test_1');
  });

  test('Notifies message change subscribers', async () => {
    let emittedMessages: ReceivedOtpMessage[] = [];
    const unsub = client.onMessagesChange((msgs) => {
      emittedMessages = msgs;
    });

    const mockMessage: ReceivedOtpMessage = {
      id: 'msg_test_2',
      senderId: 'dev_snd_2',
      packageName: 'com.google.android.gm',
      serviceName: 'Swiggy',
      carrierTag: 'via Gmail',
      otpCode: '918234',
      bodySnippet: 'Your Swiggy code is 918234',
      timestamp: Date.now(),
      receivedAt: Date.now()
    };

    await StorageService.saveReceivedMessages([mockMessage]);
    await client.loadStoredMessages();

    assert.strictEqual(emittedMessages.length, 1);
    assert.strictEqual(emittedMessages[0].otpCode, '918234');

    unsub();
  });

  test('Prunes messages older than 5 minutes', async () => {
    const freshMessage: ReceivedOtpMessage = {
      id: 'msg_fresh',
      senderId: 'dev_snd_1',
      packageName: 'com.google.android.apps.messaging',
      otpCode: '111111',
      timestamp: Date.now(),
      receivedAt: Date.now()
    };

    const expiredMessage: ReceivedOtpMessage = {
      id: 'msg_expired',
      senderId: 'dev_snd_1',
      packageName: 'com.google.android.apps.messaging',
      otpCode: '999999',
      timestamp: Date.now() - 6 * 60 * 1000,
      receivedAt: Date.now() - 6 * 60 * 1000 // 6 minutes ago
    };

    await StorageService.saveReceivedMessages([freshMessage, expiredMessage]);
    await client.loadStoredMessages();

    const currentMessages = client.getMessages();
    assert.strictEqual(currentMessages.length, 1);
    assert.strictEqual(currentMessages[0].id, 'msg_fresh');
    assert.strictEqual(currentMessages[0].otpCode, '111111');
  });

  test('Clearing messages removes them from memory and storage', async () => {
    const mockMessage: ReceivedOtpMessage = {
      id: 'msg_test_clear',
      senderId: 'dev_snd_1',
      packageName: 'com.google.android.apps.messaging',
      otpCode: '555555',
      timestamp: Date.now(),
      receivedAt: Date.now()
    };

    await StorageService.saveReceivedMessages([mockMessage]);
    await client.loadStoredMessages();
    assert.strictEqual(client.getMessages().length, 1);

    await client.clearMessages();
    assert.strictEqual(client.getMessages().length, 0);

    const storedInStorage = await StorageService.getReceivedMessages();
    assert.strictEqual(storedInStorage.length, 0);
  });
});
