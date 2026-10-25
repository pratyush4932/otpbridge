export interface Subscription {
  remove: () => void;
}

export interface RawNotificationEvent {
  id: string;
  packageName: string;
  title?: string;
  text?: string;
  timestamp: number;
  isSynthetic?: boolean;
}

export interface InstalledAppInfo {
  packageName: string;
  appName: string;
  isSystemApp: boolean;
  icon?: string;
}

export interface InstalledSmsAppInfo {
  packageName: string;
  appName: string;
  isDefault: boolean;
  isSystemApp: boolean;
  icon?: string;
}

// Fallback in-memory synthetic bus for unit tests & non-Android environments
const mockListeners = new Set<(event: RawNotificationEvent) => void>();
let mockDefaultSmsPackage: string | null = 'com.google.android.apps.messaging';
let mockInstalledSmsApps: InstalledSmsAppInfo[] = [
  { packageName: 'com.google.android.apps.messaging', appName: 'Messages', isDefault: true, isSystemApp: true },
  { packageName: 'com.samsung.android.messaging', appName: 'Samsung Messages', isDefault: false, isSystemApp: true }
];
let mockInstalledPackages = new Set<string>([
  'com.google.android.apps.messaging',
  'com.samsung.android.messaging',
  'com.google.android.gm'
]);

let nativeModule: any = null;
let eventEmitter: any = null;

if (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') {
  try {
    const core = require('expo-modules-core');
    if (core.Platform?.OS === 'android') {
      nativeModule = core.requireNativeModule('NotificationListener');
      if (nativeModule && core.EventEmitter) {
        eventEmitter = new core.EventEmitter(nativeModule);
      }
    }
  } catch {
    nativeModule = null;
  }
}

export function setMockDefaultSmsPackage(pkg: string | null): void {
  mockDefaultSmsPackage = pkg;
}

export function setMockInstalledSmsApps(apps: InstalledSmsAppInfo[]): void {
  mockInstalledSmsApps = apps;
}

export function setMockInstalledPackages(pkgs: string[]): void {
  mockInstalledPackages = new Set(pkgs);
}

export async function isNotificationPermissionGranted(): Promise<boolean> {
  if (nativeModule?.isPermissionGranted) {
    return await nativeModule.isPermissionGranted();
  }
  return false;
}

export async function openNotificationListenerSettings(): Promise<void> {
  if (nativeModule?.openSettings) {
    return await nativeModule.openSettings();
  }
}

export async function getDefaultSmsPackage(): Promise<string | null> {
  if (nativeModule?.getDefaultSmsPackage) {
    return await nativeModule.getDefaultSmsPackage();
  }
  return mockDefaultSmsPackage;
}

export async function getInstalledSmsApplications(): Promise<InstalledSmsAppInfo[]> {
  if (nativeModule?.getInstalledSmsApplications) {
    return await nativeModule.getInstalledSmsApplications();
  }
  return mockInstalledSmsApps;
}

export async function isPackageInstalled(packageName: string): Promise<boolean> {
  if (nativeModule?.isPackageInstalled) {
    return await nativeModule.isPackageInstalled(packageName);
  }
  return mockInstalledPackages.has(packageName);
}

export async function getAppIcon(packageName: string): Promise<string | null> {
  if (nativeModule?.getAppIcon) {
    return await nativeModule.getAppIcon(packageName);
  }
  return null;
}

export async function simulateNotification(
  packageName: string,
  title: string,
  text: string
): Promise<boolean> {
  if (nativeModule?.simulateNotification) {
    return await nativeModule.simulateNotification(packageName, title, text);
  }

  // Fallback simulator for automated tests and web
  const mockEvent: RawNotificationEvent = {
    id: `syn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    packageName,
    title,
    text,
    timestamp: Date.now(),
    isSynthetic: true
  };
  for (const listener of mockListeners) {
    listener(mockEvent);
  }
  return true;
}

export async function getInstalledApplications(): Promise<InstalledAppInfo[]> {
  if (nativeModule?.getInstalledApplications) {
    return await nativeModule.getInstalledApplications();
  }
  // Common pre-configured defaults for fallback/mock
  return [
    { packageName: 'com.google.android.apps.messaging', appName: 'Messages (SMS)', isSystemApp: true },
    { packageName: 'com.samsung.android.messaging', appName: 'Samsung Messages', isSystemApp: true },
    { packageName: 'com.google.android.gm', appName: 'Gmail', isSystemApp: true },
    { packageName: 'in.swiggy.android', appName: 'Swiggy', isSystemApp: false },
    { packageName: 'com.ubercab', appName: 'Uber', isSystemApp: false },
    { packageName: 'com.amazon.mShop.android.shopping', appName: 'Amazon', isSystemApp: false }
  ];
}

export function addNotificationListener(
  listener: (event: RawNotificationEvent) => void
): { remove: () => void } {
  if (eventEmitter) {
    const sub: Subscription = eventEmitter.addListener('onNotificationReceived', listener);
    return {
      remove: () => sub.remove()
    };
  }

  mockListeners.add(listener);
  return {
    remove: () => {
      mockListeners.delete(listener);
    }
  };
}
