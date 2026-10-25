import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  carrierRegistry,
  GMAIL_PACKAGE_NAME,
  ARCHIVED_CARRIER_PACKAGES
} from '../services/carrier-registry.js';
import {
  setMockDefaultSmsPackage,
  setMockInstalledSmsApps,
  setMockInstalledPackages
} from '../modules/notification-listener/index.js';
import { StorageService } from '../services/storage.js';

describe('Dynamic Carrier Registry Tests', () => {
  beforeEach(async () => {
    // Reset test mocks to baseline
    setMockDefaultSmsPackage('com.google.android.apps.messaging');
    setMockInstalledSmsApps([
      { packageName: 'com.google.android.apps.messaging', appName: 'Messages', isDefault: true, isSystemApp: true },
      { packageName: 'com.samsung.android.messaging', appName: 'Samsung Messages', isDefault: false, isSystemApp: true },
      { packageName: 'com.simplemobiletools.smsmessenger', appName: 'Simple SMS', isDefault: false, isSystemApp: false }
    ]);
    setMockInstalledPackages([
      'com.google.android.apps.messaging',
      'com.samsung.android.messaging',
      'com.simplemobiletools.smsmessenger',
      'com.google.android.gm'
    ]);

    await StorageService.setDefaultSmsEnabled(true);
    await StorageService.setEnabledOtherSmsPackages([]);
    await StorageService.setGmailEnabled(false);
  });

  test('Dynamically discovers device default SMS app without hardcoding', async () => {
    setMockDefaultSmsPackage('com.samsung.android.messaging');
    const snapshot = await carrierRegistry.refresh();

    assert.ok(snapshot.defaultSms, 'Default SMS app should be resolved');
    assert.strictEqual(snapshot.defaultSms.packageName, 'com.samsung.android.messaging');
    assert.strictEqual(snapshot.defaultSms.appName, 'Samsung Messages');
    assert.strictEqual(snapshot.defaultSms.enabled, true);
    assert.strictEqual(snapshot.defaultSms.category, 'default_sms');
  });

  test('Detects when default SMS app changes in Android OS and refreshes registry', async () => {
    setMockDefaultSmsPackage('com.google.android.apps.messaging');
    await carrierRegistry.refresh();
    assert.strictEqual(carrierRegistry.getSnapshot().defaultSms?.packageName, 'com.google.android.apps.messaging');

    // User switches default SMS in Android settings to Samsung Messages
    setMockDefaultSmsPackage('com.samsung.android.messaging');
    const didChange = await carrierRegistry.detectAndHandleDefaultSmsChange();

    assert.strictEqual(didChange, true, 'Should detect default SMS changed');
    assert.strictEqual(carrierRegistry.getSnapshot().defaultSms?.packageName, 'com.samsung.android.messaging');
  });

  test('Discovers multiple installed secondary SMS apps excluding default', async () => {
    setMockDefaultSmsPackage('com.google.android.apps.messaging');
    const snapshot = await carrierRegistry.refresh();

    const otherPackages = snapshot.otherSms.map((c) => c.packageName);
    assert.ok(otherPackages.includes('com.samsung.android.messaging'));
    assert.ok(otherPackages.includes('com.simplemobiletools.smsmessenger'));
    assert.ok(!otherPackages.includes('com.google.android.apps.messaging'), 'Default SMS must not be duplicated in other SMS');
  });

  test('Enables individual secondary SMS apps with allowlist enforcement', async () => {
    await carrierRegistry.refresh();
    assert.strictEqual(carrierRegistry.isCarrierAllowed('com.samsung.android.messaging'), false);

    // User explicitly enables Samsung Messages as secondary SMS app
    await carrierRegistry.setOtherSmsEnabled('com.samsung.android.messaging', true);

    assert.strictEqual(carrierRegistry.isCarrierAllowed('com.samsung.android.messaging'), true);
    assert.strictEqual(carrierRegistry.getCategory('com.samsung.android.messaging'), 'other_sms');
    assert.strictEqual(carrierRegistry.getCarrierTag('com.samsung.android.messaging'), 'via SMS');
  });

  test('Gmail integration: requires explicit enablement and respects enabled/disabled states', async () => {
    await carrierRegistry.refresh();
    // Default state: disabled
    assert.strictEqual(carrierRegistry.isCarrierAllowed(GMAIL_PACKAGE_NAME), false);
    assert.strictEqual(carrierRegistry.getSnapshot().gmail?.enabled, false);

    // Explicitly enable Gmail
    await carrierRegistry.setGmailEnabled(true);
    assert.strictEqual(carrierRegistry.isCarrierAllowed(GMAIL_PACKAGE_NAME), true);
    assert.strictEqual(carrierRegistry.getCategory(GMAIL_PACKAGE_NAME), 'gmail');
    assert.strictEqual(carrierRegistry.getCarrierTag(GMAIL_PACKAGE_NAME), 'via Gmail');

    // Disable Gmail
    await carrierRegistry.setGmailEnabled(false);
    assert.strictEqual(carrierRegistry.isCarrierAllowed(GMAIL_PACKAGE_NAME), false);
  });

  test('Archived carriers (WhatsApp, Telegram) are completely rejected and cannot be active', async () => {
    await carrierRegistry.refresh();

    for (const archivedPkg of ARCHIVED_CARRIER_PACKAGES) {
      assert.strictEqual(carrierRegistry.isCarrierAllowed(archivedPkg), false);
      assert.strictEqual(carrierRegistry.getCategory(archivedPkg), null);

      // Attempting to enable through API must be rejected
      await carrierRegistry.setOtherSmsEnabled(archivedPkg, true);
      assert.strictEqual(carrierRegistry.isCarrierAllowed(archivedPkg), false);
    }
  });

  test('Stale settings referencing archived carriers are purged during refresh', async () => {
    // Simulate legacy storage containing archived WhatsApp and Telegram packages
    await StorageService.setCarrierPackages([
      'com.google.android.apps.messaging',
      'com.whatsapp',
      'org.telegram.messenger'
    ]);
    await StorageService.setEnabledOtherSmsPackages(['com.whatsapp', 'com.samsung.android.messaging']);

    // Refresh should automatically sanitize
    await carrierRegistry.refresh();

    const sanitizedSaved = await StorageService.getCarrierPackages();
    assert.ok(!sanitizedSaved.includes('com.whatsapp'), 'WhatsApp purged from saved packages');
    assert.ok(!sanitizedSaved.includes('org.telegram.messenger'), 'Telegram purged from saved packages');

    const sanitizedOther = await StorageService.getEnabledOtherSmsPackages();
    assert.ok(!sanitizedOther.includes('com.whatsapp'));
    assert.ok(sanitizedOther.includes('com.samsung.android.messaging'));
  });
});
