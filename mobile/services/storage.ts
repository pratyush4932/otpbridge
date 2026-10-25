// Safe dynamic loading for SecureStore to allow headless unit tests
let SecureStore: any = null;
try {
  if (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') {
    SecureStore = require('expo-secure-store');
  }
} catch {
  SecureStore = null;
}

const STORAGE_KEYS = {
  ROLE: 'otp_bridge_role',
  DEVICE_ID: 'otp_bridge_device_id',
  DEVICE_TOKEN: 'otp_bridge_device_token',
  SERVER_URL: 'otp_bridge_server_url',
  PAIRED_WITH_ID: 'otp_bridge_paired_with_id',
  ALLOWLIST_PACKAGES: 'otp_bridge_allowlist_packages',
  FORWARDING_ENABLED: 'otp_bridge_forwarding_enabled',
  CARRIER_PACKAGES: 'otp_bridge_carrier_packages',
  FORWARD_ALL_CARRIERS: 'otp_bridge_forward_all_carriers',
  TARGET_APPS: 'otp_bridge_target_apps',
  ENABLED_OTHER_SMS: 'otp_bridge_enabled_other_sms',
  GMAIL_ENABLED: 'otp_bridge_gmail_enabled',
  DEFAULT_SMS_ENABLED: 'otp_bridge_default_sms_enabled',
  RECEIVED_MESSAGES: 'otp_bridge_received_messages'
} as const;

export const ARCHIVED_PACKAGES = new Set([
  'com.whatsapp',
  'com.whatsapp.w4b',
  'org.telegram.messenger',
  'org.thunderdog.challegram'
]);

export interface CarrierAppInfo {
  packageName: string;
  appName: string;
  category: 'sms' | 'chat' | 'email';
}

export const KNOWN_UNIVERSAL_CARRIERS: CarrierAppInfo[] = [
  { packageName: 'com.google.android.apps.messaging', appName: 'Google Messages (SMS)', category: 'sms' },
  { packageName: 'com.samsung.android.messaging', appName: 'Samsung Messages', category: 'sms' },
  { packageName: 'com.android.mms', appName: 'Android Default SMS / MMS', category: 'sms' },
  { packageName: 'com.google.android.gm', appName: 'Gmail', category: 'email' },
  { packageName: 'com.whatsapp', appName: 'WhatsApp', category: 'chat' },
  { packageName: 'com.whatsapp.w4b', appName: 'WhatsApp Business', category: 'chat' },
  { packageName: 'org.telegram.messenger', appName: 'Telegram', category: 'chat' },
  { packageName: 'com.truecaller', appName: 'Truecaller SMS', category: 'sms' }
];

export const DEFAULT_CARRIER_PACKAGES = [
  'com.google.android.apps.messaging',
  'com.samsung.android.messaging',
  'com.android.mms'
];

// Default server URL for local network testing
export const DEFAULT_SERVER_URL = 'http://10.0.2.2:4000'; // Android emulator default to host machine

// Fallback memory store for web/test environments
const memoryFallback = new Map<string, string>();

async function setItem(key: string, value: string): Promise<void> {
  if (SecureStore?.setItemAsync) {
    try {
      await SecureStore.setItemAsync(key, value);
      return;
    } catch {
      // Fall through to memory fallback
    }
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(key, value);
  } else {
    memoryFallback.set(key, value);
  }
}

async function getItem(key: string): Promise<string | null> {
  if (SecureStore?.getItemAsync) {
    try {
      const val = await SecureStore.getItemAsync(key);
      if (val !== null) return val;
    } catch {
      // Fall through to memory fallback
    }
  }

  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(key);
  }
  return memoryFallback.get(key) || null;
}

async function removeItem(key: string): Promise<void> {
  if (SecureStore?.deleteItemAsync) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Fall through
    }
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(key);
  } else {
    memoryFallback.delete(key);
  }
}

export interface AppCredentials {
  role: 'sender' | 'receiver' | null;
  deviceId: string | null;
  deviceToken: string | null;
  serverUrl: string;
  pairedWithId: string | null;
}

export const StorageService = {
  async getCredentials(): Promise<AppCredentials> {
    const role = (await getItem(STORAGE_KEYS.ROLE)) as 'sender' | 'receiver' | null;
    const deviceId = await getItem(STORAGE_KEYS.DEVICE_ID);
    const deviceToken = await getItem(STORAGE_KEYS.DEVICE_TOKEN);
    const serverUrl = (await getItem(STORAGE_KEYS.SERVER_URL)) || DEFAULT_SERVER_URL;
    const pairedWithId = await getItem(STORAGE_KEYS.PAIRED_WITH_ID);

    return {
      role,
      deviceId,
      deviceToken,
      serverUrl,
      pairedWithId
    };
  },

  async saveCredentials(credentials: Partial<AppCredentials>): Promise<void> {
    if (credentials.role !== undefined) {
      if (credentials.role) await setItem(STORAGE_KEYS.ROLE, credentials.role);
      else await removeItem(STORAGE_KEYS.ROLE);
    }
    if (credentials.deviceId !== undefined) {
      if (credentials.deviceId) await setItem(STORAGE_KEYS.DEVICE_ID, credentials.deviceId);
      else await removeItem(STORAGE_KEYS.DEVICE_ID);
    }
    if (credentials.deviceToken !== undefined) {
      if (credentials.deviceToken) await setItem(STORAGE_KEYS.DEVICE_TOKEN, credentials.deviceToken);
      else await removeItem(STORAGE_KEYS.DEVICE_TOKEN);
    }
    if (credentials.serverUrl !== undefined) {
      await setItem(STORAGE_KEYS.SERVER_URL, credentials.serverUrl);
    }
    if (credentials.pairedWithId !== undefined) {
      if (credentials.pairedWithId) await setItem(STORAGE_KEYS.PAIRED_WITH_ID, credentials.pairedWithId);
      else await removeItem(STORAGE_KEYS.PAIRED_WITH_ID);
    }
  },

  async clearCredentials(): Promise<void> {
    await removeItem(STORAGE_KEYS.ROLE);
    await removeItem(STORAGE_KEYS.DEVICE_ID);
    await removeItem(STORAGE_KEYS.DEVICE_TOKEN);
    await removeItem(STORAGE_KEYS.PAIRED_WITH_ID);
    await removeItem(STORAGE_KEYS.RECEIVED_MESSAGES);
  },

  async getAllowlistedPackages(): Promise<string[]> {
    const raw = await getItem(STORAGE_KEYS.ALLOWLIST_PACKAGES);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  async setAllowlistedPackages(packages: string[]): Promise<void> {
    await setItem(STORAGE_KEYS.ALLOWLIST_PACKAGES, JSON.stringify(packages));
  },

  async isForwardingEnabled(): Promise<boolean> {
    const raw = await getItem(STORAGE_KEYS.FORWARDING_ENABLED);
    if (raw === null) return true; // Enabled by default once paired
    return raw === 'true';
  },

  async setForwardingEnabled(enabled: boolean): Promise<void> {
    await setItem(STORAGE_KEYS.FORWARDING_ENABLED, enabled ? 'true' : 'false');
  },

  async getCarrierPackages(): Promise<string[]> {
    const raw = await getItem(STORAGE_KEYS.CARRIER_PACKAGES);
    let packages = DEFAULT_CARRIER_PACKAGES;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          packages = parsed;
        }
      } catch {
        packages = DEFAULT_CARRIER_PACKAGES;
      }
    }
    // Strict sanitization: strip any archived packages so stale settings never re-activate them
    const sanitized = packages.filter((pkg) => !ARCHIVED_PACKAGES.has(pkg));
    if (sanitized.length !== packages.length) {
      await setItem(STORAGE_KEYS.CARRIER_PACKAGES, JSON.stringify(sanitized));
    }
    return sanitized;
  },

  async setCarrierPackages(packages: string[]): Promise<void> {
    const sanitized = packages.filter((pkg) => !ARCHIVED_PACKAGES.has(pkg));
    await setItem(STORAGE_KEYS.CARRIER_PACKAGES, JSON.stringify(sanitized));
  },

  async getEnabledOtherSmsPackages(): Promise<string[]> {
    const raw = await getItem(STORAGE_KEYS.ENABLED_OTHER_SMS);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((pkg: string) => !ARCHIVED_PACKAGES.has(pkg));
      }
      return [];
    } catch {
      return [];
    }
  },

  async setEnabledOtherSmsPackages(packages: string[]): Promise<void> {
    const sanitized = packages.filter((pkg) => !ARCHIVED_PACKAGES.has(pkg));
    await setItem(STORAGE_KEYS.ENABLED_OTHER_SMS, JSON.stringify(sanitized));
  },

  async isGmailEnabled(): Promise<boolean> {
    const raw = await getItem(STORAGE_KEYS.GMAIL_ENABLED);
    return raw === 'true'; // Disabled by default, requires explicit user enablement
  },

  async setGmailEnabled(enabled: boolean): Promise<void> {
    await setItem(STORAGE_KEYS.GMAIL_ENABLED, enabled ? 'true' : 'false');
  },

  async isDefaultSmsEnabled(): Promise<boolean> {
    const raw = await getItem(STORAGE_KEYS.DEFAULT_SMS_ENABLED);
    if (raw === null) return true; // Enabled by default
    return raw === 'true';
  },

  async setDefaultSmsEnabled(enabled: boolean): Promise<void> {
    await setItem(STORAGE_KEYS.DEFAULT_SMS_ENABLED, enabled ? 'true' : 'false');
  },

  async isForwardAllCarriers(): Promise<boolean> {
    const raw = await getItem(STORAGE_KEYS.FORWARD_ALL_CARRIERS);
    if (raw === null) return true; // Forward all carrier OTPs by default
    return raw === 'true';
  },

  async setForwardAllCarriers(enabled: boolean): Promise<void> {
    await setItem(STORAGE_KEYS.FORWARD_ALL_CARRIERS, enabled ? 'true' : 'false');
  },

  async getTargetApps(): Promise<{ packageName: string; appName: string }[]> {
    const raw = await getItem(STORAGE_KEYS.TARGET_APPS);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  async setTargetApps(apps: { packageName: string; appName: string }[]): Promise<void> {
    await setItem(STORAGE_KEYS.TARGET_APPS, JSON.stringify(apps));
    // Also update ALLOWLIST_PACKAGES for compatibility
    await setItem(STORAGE_KEYS.ALLOWLIST_PACKAGES, JSON.stringify(apps.map((a) => a.packageName)));
  },

  async getReceivedMessages<T = any>(): Promise<T[]> {
    const raw = await getItem(STORAGE_KEYS.RECEIVED_MESSAGES);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const cutoff = Date.now() - 5 * 60 * 1000;
      return parsed.filter((m: any) => m && typeof m.receivedAt === 'number' && m.receivedAt > cutoff);
    } catch {
      return [];
    }
  },

  async saveReceivedMessages<T = any>(messages: T[]): Promise<void> {
    const cutoff = Date.now() - 5 * 60 * 1000;
    const valid = messages.filter((m: any) => m && typeof (m as any).receivedAt === 'number' && (m as any).receivedAt > cutoff);
    await setItem(STORAGE_KEYS.RECEIVED_MESSAGES, JSON.stringify(valid));
  },

  async clearReceivedMessages(): Promise<void> {
    await removeItem(STORAGE_KEYS.RECEIVED_MESSAGES);
  },

  async getRawItem(key: string): Promise<string | null> {
    return await getItem(key);
  },

  async setRawItem(key: string, value: string): Promise<void> {
    await setItem(key, value);
  }
};
