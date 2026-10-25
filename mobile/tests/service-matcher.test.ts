import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ServiceMatcher } from '../services/service-matcher.js';
import { GMAIL_PACKAGE_NAME } from '../services/carrier-registry.js';

describe('ServiceMatcher Engine Tests', () => {
  const targetApps = [
    { packageName: 'in.swiggy.android', appName: 'Swiggy' },
    { packageName: 'com.ubercab', appName: 'Uber' },
    { packageName: 'com.amazon.mShop.android.shopping', appName: 'Amazon' }
  ];

  const activeCarrierPackages = [
    'com.google.android.apps.messaging',
    'com.samsung.android.messaging',
    GMAIL_PACKAGE_NAME
  ];

  test('Identifies active Default SMS carrier and matches target app by SMS Indian TRAI header', () => {
    const result = ServiceMatcher.evaluate({
      packageName: 'com.google.android.apps.messaging',
      title: 'AX-SWIGGY',
      text: '839201 is your Swiggy OTP. Do not share it with anyone.',
      carrierPackages: activeCarrierPackages,
      targetApps,
      forwardAllCarriers: false
    });

    assert.strictEqual(result.isAllowed, true);
    assert.strictEqual(result.serviceName, 'Swiggy');
    assert.strictEqual(result.carrierTag, 'via SMS');
    assert.strictEqual(result.matchedTargetApp?.packageName, 'in.swiggy.android');
  });

  test('Identifies active secondary SMS app (e.g. Samsung Messages) and extracts service name', () => {
    const result = ServiceMatcher.evaluate({
      packageName: 'com.samsung.android.messaging',
      title: 'VK-AMAZON',
      text: '482019 is your Amazon verification code.',
      carrierPackages: activeCarrierPackages,
      targetApps,
      forwardAllCarriers: false
    });

    assert.strictEqual(result.isAllowed, true);
    assert.strictEqual(result.serviceName, 'Amazon');
    assert.strictEqual(result.carrierTag, 'via SMS');
  });

  test('Identifies Gmail when enabled and extracts service name and via Gmail tag', () => {
    const result = ServiceMatcher.evaluate({
      packageName: GMAIL_PACKAGE_NAME,
      title: 'GitHub <noreply@github.com>',
      text: 'Your GitHub verification code is 849201',
      carrierPackages: activeCarrierPackages,
      targetApps: [],
      forwardAllCarriers: true
    });

    assert.strictEqual(result.isAllowed, true);
    assert.strictEqual(result.serviceName, 'GitHub');
    assert.strictEqual(result.carrierTag, 'via Gmail');
  });

  test('Matches target app from Gmail notification', () => {
    const result = ServiceMatcher.evaluate({
      packageName: GMAIL_PACKAGE_NAME,
      title: 'Amazon.com: OTP for sign-in',
      text: '482019 is your Amazon verification code.',
      carrierPackages: activeCarrierPackages,
      targetApps,
      forwardAllCarriers: false
    });

    assert.strictEqual(result.isAllowed, true);
    assert.strictEqual(result.serviceName, 'Amazon');
    assert.strictEqual(result.carrierTag, 'via Gmail');
    assert.strictEqual(result.matchedTargetApp?.packageName, 'com.amazon.mShop.android.shopping');
  });

  test('Rejects Gmail when not in active carriers (Gmail disabled)', () => {
    const result = ServiceMatcher.evaluate({
      packageName: GMAIL_PACKAGE_NAME,
      title: 'GitHub <noreply@github.com>',
      text: 'Your GitHub verification code is 849201',
      carrierPackages: ['com.google.android.apps.messaging'], // Gmail not enabled
      targetApps: [],
      forwardAllCarriers: true
    });

    assert.strictEqual(result.isAllowed, false);
    assert.match(result.reason || '', /allowlist/i);
  });

  test('Safely rejects redacted notifications ("Sensitive notification content hidden")', () => {
    const result = ServiceMatcher.evaluate({
      packageName: 'com.google.android.apps.messaging',
      title: 'SMS',
      text: 'Sensitive notification content hidden',
      carrierPackages: activeCarrierPackages,
      targetApps: [],
      forwardAllCarriers: true
    });

    assert.strictEqual(result.isAllowed, false);
    assert.match(result.reason || '', /hidden or inaccessible/i);
  });

  test('Safely rejects empty or blank notification text', () => {
    const result = ServiceMatcher.evaluate({
      packageName: 'com.google.android.apps.messaging',
      title: 'Google',
      text: '   ',
      carrierPackages: activeCarrierPackages,
      targetApps: [],
      forwardAllCarriers: true
    });

    assert.strictEqual(result.isAllowed, false);
    assert.match(result.reason || '', /hidden or inaccessible/i);
  });

  test('Explicitly rejects archived carriers (WhatsApp, Telegram) as unlisted at runtime', () => {
    const archivedPackages = ['com.whatsapp', 'com.whatsapp.w4b', 'org.telegram.messenger'];
    for (const pkg of archivedPackages) {
      const result = ServiceMatcher.evaluate({
        packageName: pkg,
        title: 'Uber',
        text: 'Your Uber code is 4920.',
        carrierPackages: [...activeCarrierPackages, pkg], // Even if erroneously in carrierPackages list
        targetApps,
        forwardAllCarriers: true
      });

      assert.strictEqual(result.isAllowed, false);
      assert.match(result.reason || '', /archived/i);
    }
  });

  test('Rejects carrier message when target apps are selected but none match and forwardAllCarriers is false', () => {
    const result = ServiceMatcher.evaluate({
      packageName: 'com.google.android.apps.messaging',
      title: 'VK-NETFLIX',
      text: 'Your Netflix temporary passcode is 998811.',
      carrierPackages: activeCarrierPackages,
      targetApps,
      forwardAllCarriers: false
    });

    assert.strictEqual(result.isAllowed, false);
    assert.match(result.reason || '', /does not match any selected target/i);
  });

  test('Accepts unlisted service carrier message when forwardAllCarriers is true and extracts clean service name', () => {
    const result = ServiceMatcher.evaluate({
      packageName: 'com.google.android.apps.messaging',
      title: 'VK-NETFLIX',
      text: 'Your Netflix temporary passcode is 998811.',
      carrierPackages: activeCarrierPackages,
      targetApps,
      forwardAllCarriers: true
    });

    assert.strictEqual(result.isAllowed, true);
    assert.strictEqual(result.serviceName, 'NETFLIX');
    assert.strictEqual(result.carrierTag, 'via SMS');
  });

  test('Extracts service name from body when title is a phone number or generic Messages', () => {
    const result = ServiceMatcher.evaluate({
      packageName: 'com.google.android.apps.messaging',
      title: '+18005550199',
      text: 'Your Amazon verification code is 849201',
      carrierPackages: activeCarrierPackages,
      targetApps: [],
      forwardAllCarriers: true
    });

    assert.strictEqual(result.isAllowed, true);
    assert.strictEqual(result.serviceName, 'Amazon');
    assert.strictEqual(result.carrierTag, 'via SMS');
  });

  test('Accepts direct notification from an installed target application', () => {
    const result = ServiceMatcher.evaluate({
      packageName: 'com.ubercab',
      title: 'Security Alert',
      text: 'Login prompt',
      carrierPackages: activeCarrierPackages,
      targetApps,
      forwardAllCarriers: false
    });

    assert.strictEqual(result.isAllowed, true);
    assert.strictEqual(result.serviceName, 'Uber');
    assert.strictEqual(result.carrierTag, undefined);
  });

  test('Rejects notification from un-allowlisted non-carrier application', () => {
    const result = ServiceMatcher.evaluate({
      packageName: 'com.random.untrusted.app',
      title: 'Alert',
      text: 'Random code 123456',
      carrierPackages: activeCarrierPackages,
      targetApps,
      forwardAllCarriers: false
    });

    assert.strictEqual(result.isAllowed, false);
    assert.strictEqual(result.reason, 'Package not in explicit allowlist');
  });
});
