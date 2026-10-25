/**
 * ARCHIVED: Legacy Carrier Test Suite
 * Original Location: mobile/tests/service-matcher.test.ts (WhatsApp & static carrier tests)
 *
 * Archived Date: October 2026
 * Reason for Archival:
 *   WhatsApp, Telegram, and static hard-coded carrier lists have been retired from the active
 *   carrier scope in favor of dynamic discovery (Default SMS, Other SMS, Gmail).
 *
 * NOTE: These tests verify legacy carrier behavior against archived static definitions.
 * They are preserved for regression verification and potential future restoration.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  ARCHIVED_KNOWN_UNIVERSAL_CARRIERS,
  ARCHIVED_DEFAULT_CARRIER_PACKAGES,
  getLegacyCarrierTag
} from '../static-carriers.js';

describe('Legacy Carrier Archived Tests', () => {
  test('Archived carriers include legacy chat apps (WhatsApp, Telegram)', () => {
    const packages = ARCHIVED_KNOWN_UNIVERSAL_CARRIERS.map((c) => c.packageName);
    assert.ok(packages.includes('com.whatsapp'), 'WhatsApp package retained in archive');
    assert.ok(packages.includes('org.telegram.messenger'), 'Telegram package retained in archive');
  });

  test('Legacy tag helper correctly tags WhatsApp and Telegram', () => {
    assert.strictEqual(getLegacyCarrierTag('com.whatsapp'), 'via WhatsApp');
    assert.strictEqual(getLegacyCarrierTag('org.telegram.messenger'), 'via Telegram');
    assert.strictEqual(getLegacyCarrierTag('com.google.android.apps.messaging'), 'via SMS');
  });

  test('Legacy default carriers set contains WhatsApp by default', () => {
    assert.ok(ARCHIVED_DEFAULT_CARRIER_PACKAGES.includes('com.whatsapp'));
  });
});
