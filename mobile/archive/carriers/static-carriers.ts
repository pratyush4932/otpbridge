/**
 * ARCHIVED: Legacy Static Carrier Definitions & Matcher Rules
 * Original Locations:
 *   - mobile/services/storage.ts (KNOWN_UNIVERSAL_CARRIERS, DEFAULT_CARRIER_PACKAGES)
 *   - mobile/services/service-matcher.ts (SMS_PACKAGES, WHATSAPP_PACKAGES, TELEGRAM_PACKAGES)
 *
 * Archived Date: October 2026
 * Reason for Archival:
 *   Refactored from hard-coded 7-carrier list to Dynamic Carrier Registry:
 *   1. Default SMS App (dynamically detected via Android RoleManager/Telephony APIs)
 *   2. Other SMS Apps (discovered installed SMS applications)
 *   3. Gmail (explicitly enabled notification extraction)
 *
 * NOTE: This module is retained for documentation, auditability, and backwards-compatibility
 * reference. It must NOT be imported into the active application runtime.
 */

export interface LegacyCarrierAppInfo {
  packageName: string;
  appName: string;
  category: 'sms' | 'chat' | 'email';
}

/**
 * Original 7-carrier fixed configuration.
 */
export const ARCHIVED_KNOWN_UNIVERSAL_CARRIERS: LegacyCarrierAppInfo[] = [
  { packageName: 'com.google.android.apps.messaging', appName: 'Google Messages (SMS)', category: 'sms' },
  { packageName: 'com.samsung.android.messaging', appName: 'Samsung Messages', category: 'sms' },
  { packageName: 'com.android.mms', appName: 'Android Default SMS / MMS', category: 'sms' },
  { packageName: 'com.google.android.gm', appName: 'Gmail', category: 'email' },
  { packageName: 'com.whatsapp', appName: 'WhatsApp', category: 'chat' },
  { packageName: 'com.whatsapp.w4b', appName: 'WhatsApp Business', category: 'chat' },
  { packageName: 'org.telegram.messenger', appName: 'Telegram', category: 'chat' },
  { packageName: 'com.truecaller', appName: 'Truecaller SMS', category: 'sms' }
];

export const ARCHIVED_DEFAULT_CARRIER_PACKAGES: string[] = [
  'com.google.android.apps.messaging',
  'com.samsung.android.messaging',
  'com.android.mms',
  'com.google.android.gm',
  'com.whatsapp',
  'com.whatsapp.w4b'
];

export const ARCHIVED_SMS_PACKAGES = new Set([
  'com.google.android.apps.messaging',
  'com.samsung.android.messaging',
  'com.android.mms',
  'com.oneplus.mms',
  'com.coloros.mms',
  'com.truecaller'
]);

export const ARCHIVED_WHATSAPP_PACKAGES = new Set([
  'com.whatsapp',
  'com.whatsapp.w4b'
]);

export const ARCHIVED_TELEGRAM_PACKAGES = new Set([
  'org.telegram.messenger',
  'org.thunderdog.challegram'
]);

/**
 * Legacy carrier tag resolution logic.
 */
export function getLegacyCarrierTag(packageName: string): string {
  if (ARCHIVED_WHATSAPP_PACKAGES.has(packageName) || packageName.includes('whatsapp')) {
    return 'via WhatsApp';
  }
  if (ARCHIVED_TELEGRAM_PACKAGES.has(packageName) || packageName.includes('telegram')) {
    return 'via Telegram';
  }
  if (ARCHIVED_SMS_PACKAGES.has(packageName) || packageName.includes('mms') || packageName.includes('messaging')) {
    return 'via SMS';
  }
  if (packageName === 'com.google.android.gm' || packageName.includes('gmail')) {
    return 'via Gmail';
  }
  return 'via Messaging';
}
