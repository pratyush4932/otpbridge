import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { NotificationPipeline } from '../services/notification-pipeline.js';
import { StorageService } from '../services/storage.js';
import { carrierRegistry, GMAIL_PACKAGE_NAME } from '../services/carrier-registry.js';
import {
  setMockDefaultSmsPackage,
  setMockInstalledSmsApps,
  setMockInstalledPackages
} from '../modules/notification-listener/index.js';

describe('Notification Pipeline & Allowlist Tests', () => {
  let pipeline: NotificationPipeline;

  beforeEach(async () => {
    setMockDefaultSmsPackage('com.google.android.apps.messaging');
    setMockInstalledSmsApps([
      { packageName: 'com.google.android.apps.messaging', appName: 'Messages', isDefault: true, isSystemApp: true }
    ]);
    setMockInstalledPackages([
      'com.google.android.apps.messaging',
      GMAIL_PACKAGE_NAME
    ]);

    await StorageService.clearCredentials();
    await StorageService.setForwardingEnabled(true);
    await StorageService.setDefaultSmsEnabled(true);
    await StorageService.setGmailEnabled(false);
    await StorageService.setEnabledOtherSmsPackages([]);
    await StorageService.setAllowlistedPackages(['com.google.android.apps.messaging']);
    await carrierRegistry.refresh();

    pipeline = new NotificationPipeline();
  });

  test('Rejects notification from un-allowlisted application', async () => {
    const activity = await pipeline.processRawNotification({
      id: 'test_unlisted_1',
      packageName: 'com.random.untrusted.app',
      title: 'Alert',
      text: 'Your verification code is 849201',
      timestamp: Date.now()
    });

    assert.strictEqual(activity.status, 'ignored_unlisted');
    assert.strictEqual(activity.maskedCode, '••••••');
  });

  test('Processes notification from active Default SMS application', async () => {
    // Unpaired device state
    const activity = await pipeline.processRawNotification({
      id: 'test_allowed_1',
      packageName: 'com.google.android.apps.messaging',
      title: 'Google Alert',
      text: 'Your verification code is 849201',
      timestamp: Date.now()
    });

    // Allowed through, reached OTP extraction, caught that device is not yet paired
    assert.strictEqual(activity.status, 'error');
    assert.match(activity.reason || '', /not paired/i);
    // OTP code is safely masked in the activity record
    assert.strictEqual(activity.maskedCode.includes('849201'), false);
    assert.strictEqual(activity.maskedCode.endsWith('01'), true);
  });

  test('Rejects notification when forwarding toggle is disabled', async () => {
    await StorageService.setForwardingEnabled(false);

    const activity = await pipeline.processRawNotification({
      id: 'test_disabled_1',
      packageName: 'com.google.android.apps.messaging',
      title: 'Google Alert',
      text: 'Your verification code is 849201',
      timestamp: Date.now()
    });

    assert.strictEqual(activity.status, 'ignored_no_otp');
    assert.strictEqual(activity.reason, 'Forwarding is disabled');
  });

  test('Rejects non-OTP content from allowlisted application', async () => {
    const activity = await pipeline.processRawNotification({
      id: 'test_non_otp_1',
      packageName: 'com.google.android.apps.messaging',
      title: 'Mom',
      text: 'Hey are you coming for dinner tonight?',
      timestamp: Date.now()
    });

    assert.strictEqual(activity.status, 'ignored_no_otp');
    assert.strictEqual(activity.reason, 'No authentic OTP pattern detected');
  });

  test('Processes SMS OTP matching selected target app (e.g. Swiggy)', async () => {
    await StorageService.setTargetApps([
      { packageName: 'in.swiggy.android', appName: 'Swiggy' }
    ]);
    await StorageService.setCarrierPackages(['com.google.android.apps.messaging']);
    await StorageService.setForwardAllCarriers(false);

    const activity = await pipeline.processRawNotification({
      id: 'test_swiggy_sms',
      packageName: 'com.google.android.apps.messaging',
      title: 'AX-SWIGGY',
      text: '948201 is your Swiggy OTP verification code.',
      timestamp: Date.now()
    });

    // Allowed through, matched target service, caught unpaired error
    assert.strictEqual(activity.serviceName, 'Swiggy');
    assert.strictEqual(activity.carrierTag, 'via SMS');
    assert.strictEqual(activity.status, 'error');
    assert.match(activity.reason || '', /not paired/i);
  });

  test('Processes Gmail OTP matching selected target app (e.g. Uber) when Gmail is enabled', async () => {
    await StorageService.setTargetApps([
      { packageName: 'com.ubercab', appName: 'Uber' }
    ]);
    await carrierRegistry.setGmailEnabled(true);
    await StorageService.setForwardAllCarriers(false);

    const activity = await pipeline.processRawNotification({
      id: 'test_uber_gmail',
      packageName: GMAIL_PACKAGE_NAME,
      title: 'Uber <support@uber.com>',
      text: 'Your Uber verification code is 3829. Never share this code.',
      timestamp: Date.now()
    });

    assert.strictEqual(activity.serviceName, 'Uber');
    assert.strictEqual(activity.carrierTag, 'via Gmail');
    assert.strictEqual(activity.status, 'error');
    assert.match(activity.reason || '', /not paired/i);
  });

  test('Rejects Gmail notification when Gmail integration is disabled', async () => {
    await carrierRegistry.setGmailEnabled(false);

    const activity = await pipeline.processRawNotification({
      id: 'test_gmail_disabled',
      packageName: GMAIL_PACKAGE_NAME,
      title: 'GitHub <noreply@github.com>',
      text: 'Your GitHub verification code is 849201',
      timestamp: Date.now()
    });

    assert.strictEqual(activity.status, 'ignored_unlisted');
  });

  test('Rejects archived WhatsApp notification as unlisted at runtime', async () => {
    const activity = await pipeline.processRawNotification({
      id: 'test_archived_wa',
      packageName: 'com.whatsapp',
      title: 'Uber',
      text: 'Your Uber verification code is 3829.',
      timestamp: Date.now()
    });

    assert.strictEqual(activity.status, 'ignored_unlisted');
  });

  test('Rejects SMS OTP when target apps are configured and none match and forwardAllCarriers is false', async () => {
    await StorageService.setTargetApps([
      { packageName: 'in.swiggy.android', appName: 'Swiggy' }
    ]);
    await StorageService.setCarrierPackages(['com.google.android.apps.messaging']);
    await StorageService.setForwardAllCarriers(false);

    const activity = await pipeline.processRawNotification({
      id: 'test_unmatched_sms',
      packageName: 'com.google.android.apps.messaging',
      title: 'VK-AMAZON',
      text: '482019 is your Amazon OTP code.',
      timestamp: Date.now()
    });

    assert.strictEqual(activity.status, 'ignored_unlisted');
    assert.match(activity.reason || '', /does not match any selected target/i);
  });
});
