import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  AppState,
  TouchableOpacity
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  isNotificationPermissionGranted,
  openNotificationListenerSettings
} from '../modules/notification-listener';
import { StorageService, AppCredentials } from '../services/storage';
import { carrierRegistry } from '../services/carrier-registry';
import {
  notificationPipeline,
  PipelineActivityItem
} from '../services/notification-pipeline';
import { sessionHistoryService } from '../services/session-history';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { PrimaryButton } from '../components/PrimaryButton';
import { EmptyState } from '../components/EmptyState';

export default function SenderScreen() {
  const router = useRouter();
  const [permissionGranted, setPermissionGranted] = useState<boolean>(false);
  const [forwardingEnabled, setForwardingEnabled] = useState<boolean>(true);
  const [credentials, setCredentials] = useState<AppCredentials | null>(null);
  const [carrierCount, setCarrierCount] = useState<number>(0);
  const [targetCount, setTargetCount] = useState<number>(0);
  const [activityLog, setActivityLog] = useState<PipelineActivityItem[]>([]);

  const checkPermissionAndState = useCallback(async () => {
    await sessionHistoryService.ensureActiveSessionRecorded();
    const granted = await isNotificationPermissionGranted();
    setPermissionGranted(granted);

    const creds = await StorageService.getCredentials();
    setCredentials(creds);

    const enabled = await StorageService.isForwardingEnabled();
    setForwardingEnabled(enabled);

    const [snapshot, targets] = await Promise.all([
      carrierRegistry.refresh(),
      StorageService.getTargetApps()
    ]);
    setCarrierCount(snapshot.activePackages.size);
    setTargetCount(targets.length);

    setActivityLog(notificationPipeline.getRecentActivity());
  }, []);

  useFocusEffect(
    useCallback(() => {
      checkPermissionAndState();
    }, [checkPermissionAndState])
  );

  useEffect(() => {
    checkPermissionAndState();

    notificationPipeline.start();

    const unsubActivity = notificationPipeline.onActivity((newItem) => {
      setActivityLog((prev) => [newItem, ...prev.slice(0, 49)]);
    });

    const subAppState = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        checkPermissionAndState();
      }
    });

    // Auto-refresh state every 6 seconds so pairing changes and permissions reflect smoothly
    const pollInterval = setInterval(() => {
      checkPermissionAndState();
    }, 6000);

    return () => {
      unsubActivity();
      subAppState.remove();
      clearInterval(pollInterval);
    };
  }, [checkPermissionAndState]);

  const handleToggleForwarding = async (value: boolean) => {
    setForwardingEnabled(value);
    await StorageService.setForwardingEnabled(value);
  };

  const handleOpenSettings = async () => {
    try {
      await openNotificationListenerSettings();
    } catch {
      Alert.alert(
        'Manual Permission Required',
        'Open Android Settings -> Apps -> Special app access -> Notification access, and allow OTP Bridge.'
      );
    }
  };

  const isPaired = Boolean(credentials?.deviceId && credentials?.pairedWithId);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Compact Section Context Header */}
      <View style={styles.topHeaderRow}>
        <Text style={styles.sectionHeading}>Sender Mode</Text>
        <TouchableOpacity
          onPress={() => router.push('/pairing?tab=history')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.historyLinkText}>Session History →</Text>
        </TouchableOpacity>
      </View>

      {/* Permission Warning Card - Shown ONLY when permission is missing */}
      {!permissionGranted && (
        <Card style={styles.warningCard}>
          <Text style={styles.warningTitle}>Notification Access Required</Text>
          <Text style={styles.warningText}>
            Grant Notification Listener permission so Sender can detect verification codes from your chosen apps.
          </Text>
          <PrimaryButton
            title="Grant Notification Access"
            onPress={handleOpenSettings}
            variant="danger"
            style={{ marginVertical: 0 }}
          />
        </Card>
      )}

      {/* Main Forwarding Status & Controls */}
      <Card>
        <View style={styles.controlRow}>
          <View style={styles.controlTextCol}>
            <Text style={styles.cardHeader}>Forwarding Active</Text>
            <Text style={styles.cardDesc}>
              {forwardingEnabled ? 'Actively forwarding OTPs to Receiver' : 'Forwarding temporarily paused'}
            </Text>
          </View>
          <Switch
            value={forwardingEnabled}
            onValueChange={handleToggleForwarding}
            trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
            thumbColor={forwardingEnabled ? '#2563EB' : '#94A3B8'}
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Paired Receiver</Text>
          <StatusBadge
            label={isPaired ? 'CONNECTED' : 'NOT PAIRED'}
            variant={isPaired ? 'success' : 'warning'}
          />
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Active Carriers</Text>
          <Text style={styles.infoValue}>
            {carrierCount} active
          </Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Target Services</Text>
          <Text style={styles.infoValue}>
            {targetCount > 0 ? `${targetCount} selected` : 'All carriers forwarded'}
          </Text>
        </View>

        <PrimaryButton
          title="Configure Carriers & Applications"
          onPress={() => router.push('/select-apps')}
          variant="secondary"
          style={{ marginTop: 12 }}
        />
      </Card>

      {/* Recent Activity Log */}
      <Card>
        <View style={styles.activityTitleRow}>
          <Text style={styles.cardHeader}>Recent Activity</Text>
          <Text style={styles.safeNotice}>Zero-storage • Redacted</Text>
        </View>

        {activityLog.length === 0 ? (
          <EmptyState
            title="No activity recorded"
            description="Incoming OTP notifications from your allowed apps will appear here."
            iconName="notifications-outline"
          />
        ) : (
          activityLog.slice(0, 15).map((item) => (
            <View key={item.id} style={styles.activityItem}>
              <View style={styles.activityHeader}>
                <Text style={styles.pkgText} numberOfLines={1}>
                  {item.serviceName
                    ? `${item.serviceName}${item.carrierTag ? ` • ${item.carrierTag}` : ''}`
                    : item.packageName.split('.').pop() || item.packageName}
                </Text>
                <StatusBadge
                  label={item.status.toUpperCase()}
                  variant={
                    item.status === 'forwarded'
                      ? 'success'
                      : item.status === 'queued'
                      ? 'warning'
                      : 'neutral'
                  }
                />
              </View>
              <Text style={styles.activitySnippet}>
                {item.status === 'ignored_unlisted' || item.status === 'ignored_no_otp'
                  ? `Message: "${item.bodySnippet || item.maskedCode}" ${item.reason ? `• ${item.reason}` : ''}`
                  : `Code: ${item.maskedCode} ${item.reason ? `• ${item.reason}` : ''}`}
              </Text>
              <Text style={styles.timestampText}>
                {new Date(item.timestamp).toLocaleTimeString()}
              </Text>
            </View>
          ))
        )}
      </Card>

      {/* Subtle Battery Optimization Note */}
      <View style={styles.batteryNotice}>
        <Text style={styles.batteryText}>
          Tip: Set battery usage to "Unrestricted" in Android App Settings for reliable screen-off forwarding.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC'
  },
  content: {
    padding: 16,
    paddingBottom: 32
  },
  topHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A'
  },
  historyLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563EB'
  },
  warningCard: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    padding: 14
  },
  warningTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#991B1B',
    marginBottom: 4
  },
  warningText: {
    fontSize: 13,
    color: '#B91C1C',
    lineHeight: 18,
    marginBottom: 12
  },
  cardHeader: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A'
  },
  cardDesc: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  controlTextCol: {
    flex: 1,
    paddingRight: 16
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 12
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6
  },
  infoLabel: {
    fontSize: 13,
    color: '#475569'
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B'
  },
  activityTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  safeNotice: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500'
  },
  activityItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9'
  },
  activityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  pkgText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B',
    flex: 1,
    marginRight: 8
  },
  activitySnippet: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 3
  },
  timestampText: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2
  },
  batteryNotice: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center'
  },
  batteryText: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center'
  }
});
