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
import { useRouter } from 'expo-router';
import {
  isNotificationPermissionGranted,
  openNotificationListenerSettings,
  simulateNotification
} from '../modules/notification-listener';
import { StorageService, AppCredentials } from '../services/storage';
import { carrierRegistry } from '../services/carrier-registry';
import {
  notificationPipeline,
  PipelineActivityItem
} from '../services/notification-pipeline';
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
  const [simulating, setSimulating] = useState<boolean>(false);

  const checkPermissionAndState = useCallback(async () => {
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

  useEffect(() => {
    checkPermissionAndState();

    // Start pipeline listener
    notificationPipeline.start();

    // Subscribe to new pipeline activities
    const unsubActivity = notificationPipeline.onActivity((newItem) => {
      setActivityLog((prev) => [newItem, ...prev.slice(0, 49)]);
    });

    // Re-check permission when app returns to foreground from system settings
    const subAppState = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        checkPermissionAndState();
      }
    });

    return () => {
      unsubActivity();
      subAppState.remove();
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
        'Please open Android Settings -> Apps -> Special app access -> Notification access, and allow OTP Bridge.'
      );
    }
  };

  const handleTriggerSyntheticOtp = async () => {
    setSimulating(true);
    const syntheticCode = Math.floor(100000 + Math.random() * 900000).toString();
    const targets = await StorageService.getTargetApps();
    const targetName = targets.length > 0 ? targets[0].appName : 'Swiggy';
    const pkg = 'com.google.android.apps.messaging';

    try {
      await simulateNotification(
        pkg,
        `AX-${targetName.toUpperCase()}`,
        `Your ${targetName} verification OTP is ${syntheticCode}. Valid for 5 minutes.`
      );
    } catch (e: any) {
      Alert.alert('Simulation Error', e.message || 'Failed to inject notification');
    } finally {
      setTimeout(() => setSimulating(false), 300);
    }
  };

  const isPaired = Boolean(credentials?.deviceId && credentials?.pairedWithId);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Permission Status Alert */}
      {!permissionGranted ? (
        <Card style={styles.warningCard}>
          <Text style={styles.warningTitle}>Notification Access Required</Text>
          <Text style={styles.warningText}>
            Android requires explicit Notification Listener permission so the app can detect OTP notifications from selected apps.
          </Text>
          <PrimaryButton
            title="Grant Notification Access"
            onPress={handleOpenSettings}
            variant="primary"
            style={styles.permissionBtn}
          />
        </Card>
      ) : (
        <Card style={styles.grantedCard}>
          <View style={styles.grantedRow}>
            <View>
              <Text style={styles.grantedTitle}>Notification Access Granted</Text>
              <Text style={styles.grantedSubtitle}>Android listener service is authorized</Text>
            </View>
            <StatusBadge label="ACTIVE" variant="success" />
          </View>
        </Card>
      )}

      {/* Main Sender Controls */}
      <Card>
        <Text style={styles.cardHeader}>Forwarding Controls</Text>

        <View style={styles.controlRow}>
          <View style={styles.controlTextCol}>
            <Text style={styles.controlTitle}>Forwarding Active</Text>
            <Text style={styles.controlDesc}>
              Immediately halts or resumes notification transmission.
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
          <Text style={styles.infoLabel}>Universal Carriers</Text>
          <TouchableOpacity onPress={() => router.push('/select-apps')}>
            <Text style={styles.linkText}>
              {carrierCount} active →
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Target Services</Text>
          <TouchableOpacity onPress={() => router.push('/select-apps')}>
            <Text style={styles.linkText}>
              {targetCount} selected →
            </Text>
          </TouchableOpacity>
        </View>
      </Card>

      {/* App Allowlist Button */}
      <PrimaryButton
        title={`Configure Carriers & Applications`}
        onPress={() => router.push('/select-apps')}
        variant="secondary"
      />

      {/* Synthetic Test Pathway Card */}
      <Card>
        <Text style={styles.cardHeader}>Synthetic Notification Test</Text>
        <Text style={styles.cardDesc}>
          Test the native listener, allowlist filter, OTP detection, and server relay pipeline without waiting for a real SMS/OTP.
        </Text>

        <PrimaryButton
          title={simulating ? 'Processing...' : 'Simulate Incoming OTP Notification'}
          onPress={handleTriggerSyntheticOtp}
          variant="outline"
          loading={simulating}
        />
      </Card>

      {/* Live Activity Feed */}
      <Card>
        <Text style={styles.cardHeader}>Recent Activity (Redacted)</Text>
        <Text style={styles.cardDesc}>
          Only safe metadata is recorded. Actual OTP values are never stored.
        </Text>

        {activityLog.length === 0 ? (
          <EmptyState
            title="No activity recorded yet"
            description="Incoming notifications matching your allowlist will appear here."
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

      {/* Battery Notice */}
      <View style={styles.batteryNotice}>
        <Text style={styles.batteryTitle}>Android 14+ Battery Notice</Text>
        <Text style={styles.batteryText}>
          To ensure background forwarding while the screen is off, set OTP Bridge's battery usage to "Unrestricted" in Android App Settings.
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
    paddingBottom: 40
  },
  warningCard: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA'
  },
  warningTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#991B1B',
    marginBottom: 6
  },
  warningText: {
    fontSize: 13,
    color: '#B91C1C',
    lineHeight: 18,
    marginBottom: 12
  },
  permissionBtn: {
    backgroundColor: '#DC2626'
  },
  grantedCard: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0'
  },
  grantedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  grantedTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#166534'
  },
  grantedSubtitle: {
    fontSize: 12,
    color: '#15803D'
  },
  cardHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4
  },
  cardDesc: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 12,
    lineHeight: 18
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4
  },
  controlTextCol: {
    flex: 1,
    paddingRight: 16
  },
  controlTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1E293B'
  },
  controlDesc: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2
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
    paddingVertical: 8
  },
  infoLabel: {
    fontSize: 14,
    color: '#475569'
  },
  linkText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563EB'
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
    backgroundColor: '#F1F5F9',
    padding: 14,
    borderRadius: 12,
    marginTop: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#F59E0B'
  },
  batteryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 2
  },
  batteryText: {
    fontSize: 12,
    color: '#78350F',
    lineHeight: 18
  }
});
