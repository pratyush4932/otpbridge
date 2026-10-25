import { addNotificationListener, RawNotificationEvent } from '../modules/notification-listener';
import { StorageService } from './storage';
import { detectOtp } from './otp-detector';
import { notificationDeduplicator } from './deduplicator';
import { ApiClient } from './api';
import { ServiceMatcher } from './service-matcher';
import { carrierRegistry } from './carrier-registry';

export interface PipelineActivityItem {
  id: string;
  packageName: string;
  title?: string;
  serviceName?: string;
  carrierTag?: string;
  maskedCode: string;
  bodySnippet?: string;
  timestamp: number;
  status: 'forwarded' | 'queued' | 'ignored_unlisted' | 'ignored_no_otp' | 'duplicate' | 'error';
  reason?: string;
}

export class NotificationPipeline {
  private subscription: { remove: () => void } | null = null;
  private isRunning = false;
  private activityListeners = new Set<(item: PipelineActivityItem) => void>();
  private recentActivity: PipelineActivityItem[] = [];
  private lastReportedUnlisted = new Map<string, number>();

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Refresh dynamic carrier registry upon pipeline activation
    carrierRegistry.refresh().catch(() => {});

    this.subscription = addNotificationListener((event) => {
      this.processRawNotification(event);
    });
  }

  public stop(): void {
    if (this.subscription) {
      this.subscription.remove();
      this.subscription = null;
    }
    this.isRunning = false;
  }

  public async processRawNotification(event: RawNotificationEvent): Promise<PipelineActivityItem> {
    const { id, packageName, title, text, timestamp } = event;

    // 1. Check if forwarding is enabled
    const isForwardingEnabled = await StorageService.isForwardingEnabled();
    if (!isForwardingEnabled) {
      return this.recordActivity({
        id,
        packageName,
        title,
        maskedCode: '••••••',
        timestamp,
        status: 'ignored_no_otp',
        reason: 'Forwarding is disabled'
      });
    }

    // 2. Detect changes to the default SMS app and refresh registry
    await carrierRegistry.detectAndHandleDefaultSmsChange().catch(() => {});

    // 3. Evaluate dynamic active carriers (Default SMS / Other SMS / Gmail) & target apps
    const registryActive = carrierRegistry.getActivePackageNames();
    const [carrierPackages, targetApps, allowlist, forwardAllCarriers] = await Promise.all([
      registryActive.length > 0 ? Promise.resolve(registryActive) : StorageService.getCarrierPackages(),
      StorageService.getTargetApps(),
      StorageService.getAllowlistedPackages(),
      StorageService.isForwardAllCarriers()
    ]);

    const matchResult = ServiceMatcher.evaluate({
      packageName,
      title,
      text,
      carrierPackages,
      targetApps,
      allowlistedPackages: allowlist,
      forwardAllCarriers
    });

    if (!matchResult.isAllowed) {
      console.log('\n================ [IGNORED UNLISTED NOTIFICATION] ================');
      console.log(`📦 Package: ${packageName}`);
      console.log(`📌 Title:   ${title || '(no title)'}`);
      console.log(`💬 Message: "${text || '(empty body)'}"`);
      console.log(`⚠️  Reason:  ${matchResult.reason || 'Package not in explicit allowlist'}`);
      console.log('=================================================================\n');

      // Debounce unlisted reports to avoid flooding the relay server with duplicate notifications
      const reportKey = `${packageName}:${(text || '').slice(0, 60)}`;
      const nowTime = Date.now();
      const lastTime = this.lastReportedUnlisted.get(reportKey) || 0;

      if (nowTime - lastTime > 10000) {
        this.lastReportedUnlisted.set(reportKey, nowTime);
        if (this.lastReportedUnlisted.size > 80) {
          for (const [k, v] of this.lastReportedUnlisted.entries()) {
            if (nowTime - v > 60000) this.lastReportedUnlisted.delete(k);
          }
        }

        // Forward to server diagnostic endpoint
        StorageService.getCredentials().then((creds) => {
          if (creds.serverUrl) {
            ApiClient.reportUnlistedNotification(creds.serverUrl, {
              packageName,
              title,
              body: text,
              reason: matchResult.reason || 'Package not in explicit allowlist'
            }).catch(() => {});
          }
        });
      }

      return this.recordActivity({
        id,
        packageName,
        title,
        serviceName: matchResult.serviceName,
        carrierTag: matchResult.carrierTag,
        maskedCode: '••••••',
        bodySnippet: text,
        timestamp,
        status: 'ignored_unlisted',
        reason: matchResult.reason || 'Package not in explicit allowlist'
      });
    }

    // 3. Deduplication check
    const dedupKey = notificationDeduplicator.generateKey(packageName, title, text, id);
    if (notificationDeduplicator.isDuplicate(dedupKey)) {
      return this.recordActivity({
        id,
        packageName,
        title,
        serviceName: matchResult.serviceName,
        carrierTag: matchResult.carrierTag,
        maskedCode: '••••••',
        timestamp,
        status: 'duplicate',
        reason: 'Duplicate notification ignored'
      });
    }

    // 4. OTP Detection
    const otpResult = detectOtp(title, text);
    if (!otpResult.isOtp || !otpResult.code) {
      console.log('\n---------------- [IGNORED NO OTP NOTIFICATION] ----------------');
      console.log(`📦 Package: ${packageName}`);
      console.log(`📌 Title:   ${title || '(no title)'}`);
      console.log(`💬 Message: "${text || '(empty body)'}"`);
      console.log(`⚠️  Reason:  No authentic OTP pattern detected`);
      console.log('----------------------------------------------------------------\n');

      return this.recordActivity({
        id,
        packageName,
        title,
        serviceName: matchResult.serviceName,
        carrierTag: matchResult.carrierTag,
        maskedCode: '••••••',
        bodySnippet: text,
        timestamp,
        status: 'ignored_no_otp',
        reason: 'No authentic OTP pattern detected'
      });
    }

    // 5. Credentials check
    const credentials = await StorageService.getCredentials();
    if (!credentials.deviceId || !credentials.deviceToken || credentials.role !== 'sender') {
      return this.recordActivity({
        id,
        packageName,
        title,
        serviceName: matchResult.serviceName,
        carrierTag: matchResult.carrierTag,
        maskedCode: this.maskCode(otpResult.code),
        timestamp,
        status: 'error',
        reason: 'Sender device is not paired'
      });
    }

    // 6. Forward to server
    try {
      const result = await ApiClient.forwardOtpMessage(
        credentials.serverUrl,
        credentials.deviceId,
        credentials.deviceToken,
        {
          id,
          packageName,
          title,
          serviceName: matchResult.serviceName,
          carrierTag: matchResult.carrierTag,
          otpCode: otpResult.code,
          bodySnippet: otpResult.contextSnippet,
          timestamp
        }
      );

      const status = result.delivered ? 'forwarded' : 'queued';
      return this.recordActivity({
        id,
        packageName,
        title,
        serviceName: matchResult.serviceName,
        carrierTag: matchResult.carrierTag,
        maskedCode: this.maskCode(otpResult.code),
        timestamp,
        status,
        reason: result.receiverOffline ? 'Receiver offline, queued with TTL' : 'Delivered in real-time'
      });
    } catch (err: any) {
      return this.recordActivity({
        id,
        packageName,
        title,
        serviceName: matchResult.serviceName,
        carrierTag: matchResult.carrierTag,
        maskedCode: this.maskCode(otpResult.code),
        timestamp,
        status: 'error',
        reason: err.message || 'Forwarding network error'
      });
    }
  }

  private maskCode(code: string): string {
    if (code.length <= 4) return '••' + code.slice(-2);
    return code.slice(0, 1) + '••' + code.slice(-2);
  }

  private recordActivity(item: PipelineActivityItem): PipelineActivityItem {
    this.recentActivity.unshift(item);
    if (this.recentActivity.length > 50) {
      this.recentActivity.pop();
    }
    for (const listener of this.activityListeners) {
      listener(item);
    }
    return item;
  }

  public getRecentActivity(): PipelineActivityItem[] {
    return [...this.recentActivity];
  }

  public onActivity(listener: (item: PipelineActivityItem) => void): () => void {
    this.activityListeners.add(listener);
    return () => {
      this.activityListeners.delete(listener);
    };
  }
}

export const notificationPipeline = new NotificationPipeline();
