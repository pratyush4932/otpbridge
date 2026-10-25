import {
  getDefaultSmsPackage,
  getInstalledSmsApplications,
  isPackageInstalled,
  InstalledSmsAppInfo
} from '../modules/notification-listener';
import { StorageService } from './storage';

export type CarrierCategory = 'default_sms' | 'other_sms' | 'gmail';

export interface ActiveCarrierInfo {
  category: CarrierCategory;
  packageName: string;
  appName: string;
  enabled: boolean;
  isDefault?: boolean;
  isSystemApp?: boolean;
  limitations?: string;
}

export interface CarrierRegistrySnapshot {
  defaultSms: ActiveCarrierInfo | null;
  otherSms: ActiveCarrierInfo[];
  gmail: ActiveCarrierInfo | null;
  activePackages: Set<string>;
  lastRefreshedAt: number;
}

export const GMAIL_PACKAGE_NAME = 'com.google.android.gm';

/**
 * Known legacy packages that have been archived and MUST NOT be activated
 * under any circumstances, even if present in legacy persisted storage.
 */
export const ARCHIVED_CARRIER_PACKAGES = new Set<string>([
  'com.whatsapp',
  'com.whatsapp.w4b',
  'org.telegram.messenger',
  'org.thunderdog.challegram'
]);

class DynamicCarrierRegistry {
  private defaultSms: ActiveCarrierInfo | null = null;
  private otherSms: ActiveCarrierInfo[] = [];
  private gmail: ActiveCarrierInfo | null = null;
  private activePackageSet = new Set<string>();
  private lastRefreshedAt = 0;
  private isInitialized = false;

  /**
   * Initializes or refreshes the carrier registry by querying the device runtime
   * for the default SMS role, eligible SMS applications, and Gmail availability.
   */
  public async refresh(): Promise<CarrierRegistrySnapshot> {
    // 1. Discover device default SMS app dynamically
    const detectedDefaultPkg = await getDefaultSmsPackage();
    const installedSmsList: InstalledSmsAppInfo[] = await getInstalledSmsApplications();

    // 2. Query persisted user choices from storage
    const [savedOtherSms, isGmailEnabled, isDefaultSmsEnabled] = await Promise.all([
      StorageService.getEnabledOtherSmsPackages(),
      StorageService.isGmailEnabled(),
      StorageService.isDefaultSmsEnabled()
    ]);

    // Sanitize any archived carrier packages from persisted settings
    const sanitizedOtherSms = savedOtherSms.filter((pkg) => !ARCHIVED_CARRIER_PACKAGES.has(pkg));
    if (sanitizedOtherSms.length !== savedOtherSms.length) {
      await StorageService.setEnabledOtherSmsPackages(sanitizedOtherSms);
    }
    const otherSmsSet = new Set(sanitizedOtherSms);

    // 3. Resolve Default SMS carrier
    if (detectedDefaultPkg && !ARCHIVED_CARRIER_PACKAGES.has(detectedDefaultPkg)) {
      const match = installedSmsList.find((app) => app.packageName === detectedDefaultPkg);
      this.defaultSms = {
        category: 'default_sms',
        packageName: detectedDefaultPkg,
        appName: match?.appName || 'Default Messages',
        enabled: isDefaultSmsEnabled,
        isDefault: true,
        isSystemApp: match?.isSystemApp ?? true,
        limitations: 'Notification Listener permission required. Must display notification preview.'
      };
    } else {
      this.defaultSms = null;
    }

    // 4. Resolve Other SMS carriers (installed SMS apps excluding the current default)
    const otherSmsCandidates = installedSmsList.filter(
      (app) => app.packageName !== detectedDefaultPkg && !ARCHIVED_CARRIER_PACKAGES.has(app.packageName)
    );

    this.otherSms = otherSmsCandidates.map((app) => ({
      category: 'other_sms',
      packageName: app.packageName,
      appName: app.appName,
      enabled: otherSmsSet.has(app.packageName),
      isDefault: false,
      isSystemApp: app.isSystemApp,
      limitations: 'Notification content may be truncated or subject to notification-access limits.'
    }));

    // 5. Resolve Gmail carrier
    const isGmailOnDevice = await isPackageInstalled(GMAIL_PACKAGE_NAME);
    if (isGmailOnDevice) {
      this.gmail = {
        category: 'gmail',
        packageName: GMAIL_PACKAGE_NAME,
        appName: 'Gmail',
        enabled: isGmailEnabled,
        isDefault: false,
        isSystemApp: true,
        limitations: 'Only unredacted, accessible notifications with clear OTP context are processed.'
      };
    } else {
      this.gmail = null;
    }

    // 6. Build the active allowlist of package identifiers
    this.rebuildActivePackageSet();
    this.lastRefreshedAt = Date.now();
    this.isInitialized = true;

    return this.getSnapshot();
  }

  /**
   * Fast check to detect if the default SMS app package has changed at the OS level.
   * If changed, triggers a refresh.
   */
  public async detectAndHandleDefaultSmsChange(): Promise<boolean> {
    const currentDefault = await getDefaultSmsPackage();
    const existingDefault = this.defaultSms?.packageName || null;

    if (currentDefault !== existingDefault) {
      await this.refresh();
      return true;
    }
    return false;
  }

  /**
   * Checks whether a package is recognized as an active, enabled carrier.
   * Rejects any archived or disabled packages.
   */
  public isCarrierAllowed(packageName: string): boolean {
    if (!packageName || ARCHIVED_CARRIER_PACKAGES.has(packageName)) {
      return false;
    }
    return this.activePackageSet.has(packageName);
  }

  /**
   * Resolves the logical category for an active package.
   */
  public getCategory(packageName: string): CarrierCategory | null {
    if (!this.isCarrierAllowed(packageName)) return null;
    if (this.defaultSms && this.defaultSms.packageName === packageName) {
      return 'default_sms';
    }
    if (this.gmail && this.gmail.packageName === packageName) {
      return 'gmail';
    }
    if (this.otherSms.some((c) => c.packageName === packageName)) {
      return 'other_sms';
    }
    return null;
  }

  /**
   * Returns a concise human-readable carrier tag (e.g., "via SMS", "via Gmail").
   */
  public getCarrierTag(packageName: string): string {
    if (packageName === GMAIL_PACKAGE_NAME || packageName.includes('gmail')) {
      return 'via Gmail';
    }
    return 'via SMS';
  }

  /**
   * Toggles the default SMS app active status.
   */
  public async setDefaultSmsEnabled(enabled: boolean): Promise<void> {
    await StorageService.setDefaultSmsEnabled(enabled);
    if (this.defaultSms) {
      this.defaultSms.enabled = enabled;
      this.rebuildActivePackageSet();
    }
  }

  /**
   * Enables or disables an individual secondary SMS app.
   */
  public async setOtherSmsEnabled(packageName: string, enabled: boolean): Promise<void> {
    if (ARCHIVED_CARRIER_PACKAGES.has(packageName)) return;

    const saved = await StorageService.getEnabledOtherSmsPackages();
    const set = new Set(saved);
    if (enabled) {
      set.add(packageName);
    } else {
      set.delete(packageName);
    }
    await StorageService.setEnabledOtherSmsPackages(Array.from(set));

    const target = this.otherSms.find((c) => c.packageName === packageName);
    if (target) {
      target.enabled = enabled;
      this.rebuildActivePackageSet();
    }
  }

  /**
   * Enables or disables Gmail OTP extraction.
   */
  public async setGmailEnabled(enabled: boolean): Promise<void> {
    await StorageService.setGmailEnabled(enabled);
    if (this.gmail) {
      this.gmail.enabled = enabled;
      this.rebuildActivePackageSet();
    }
  }

  /**
   * Returns all package names currently enabled in the carrier registry.
   */
  public getActivePackageNames(): string[] {
    return Array.from(this.activePackageSet);
  }

  /**
   * Returns an immutable snapshot of current registry state.
   */
  public getSnapshot(): CarrierRegistrySnapshot {
    return {
      defaultSms: this.defaultSms ? { ...this.defaultSms } : null,
      otherSms: this.otherSms.map((c) => ({ ...c })),
      gmail: this.gmail ? { ...this.gmail } : null,
      activePackages: new Set(this.activePackageSet),
      lastRefreshedAt: this.lastRefreshedAt
    };
  }

  private rebuildActivePackageSet(): void {
    this.activePackageSet.clear();

    if (this.defaultSms && this.defaultSms.enabled) {
      this.activePackageSet.add(this.defaultSms.packageName);
    }

    for (const other of this.otherSms) {
      if (other.enabled) {
        this.activePackageSet.add(other.packageName);
      }
    }

    if (this.gmail && this.gmail.enabled) {
      this.activePackageSet.add(this.gmail.packageName);
    }
  }
}

export const carrierRegistry = new DynamicCarrierRegistry();
