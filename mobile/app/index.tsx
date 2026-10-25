import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { StorageService, AppCredentials } from '../services/storage';
import { ApiClient } from '../services/api';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { PrimaryButton } from '../components/PrimaryButton';

export default function HomeScreen() {
  const router = useRouter();
  const [credentials, setCredentials] = useState<AppCredentials | null>(null);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [allowlistCount, setAllowlistCount] = useState<number>(0);
  const [refreshing, setRefreshing] = useState(false);

  const loadState = useCallback(async () => {
    let creds = await StorageService.getCredentials();
    const apps = await StorageService.getAllowlistedPackages();
    setAllowlistCount(apps.length);

    const isHealthy = await ApiClient.checkHealth(creds.serverUrl);
    setServerOnline(isHealthy);

    // If device has registered credentials, sync live pairing state from server
    if (isHealthy && creds.deviceId && creds.deviceToken) {
      try {
        const status = await ApiClient.getDeviceStatus(creds.serverUrl, creds.deviceId, creds.deviceToken);
        if (status.device.isPaired && status.partner?.id) {
          if (creds.pairedWithId !== status.partner.id) {
            await StorageService.saveCredentials({ pairedWithId: status.partner.id });
            creds = { ...creds, pairedWithId: status.partner.id };
          }
        } else if (!status.device.isPaired && creds.pairedWithId) {
          await StorageService.saveCredentials({ pairedWithId: null });
          creds = { ...creds, pairedWithId: null };
        }
      } catch {
        // Fall back to locally stored credentials if network request fails
      }
    }

    setCredentials(creds);
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadState();
    setRefreshing(false);
  };

  const isPaired = Boolean(credentials?.deviceId && credentials?.pairedWithId);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Header Info Banner */}
      <View style={styles.header}>
        <Text style={styles.appName}>OTP Bridge</Text>
        <Text style={styles.appSubtitle}>
          Private, encrypted notification forwarding between Android 14+ devices.
        </Text>
      </View>

      {/* System Status Card */}
      <Card>
        <Text style={styles.sectionTitle}>System Status</Text>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Backend Server</Text>
          <StatusBadge
            label={
              serverOnline === null
                ? 'Checking...'
                : serverOnline
                ? 'Online'
                : 'Offline'
            }
            variant={
              serverOnline === null
                ? 'neutral'
                : serverOnline
                ? 'success'
                : 'error'
            }
          />
        </View>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Configured Role</Text>
          <StatusBadge
            label={
              credentials?.role
                ? credentials.role.toUpperCase()
                : 'NOT CONFIGURED'
            }
            variant={credentials?.role ? 'info' : 'neutral'}
          />
        </View>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Pairing Status</Text>
          <StatusBadge
            label={isPaired ? 'PAIRED' : 'UNPAIRED'}
            variant={isPaired ? 'success' : 'warning'}
          />
        </View>

        {credentials?.role === 'sender' && (
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Allowed Apps</Text>
            <StatusBadge
              label={`${allowlistCount} Selected`}
              variant={allowlistCount > 0 ? 'info' : 'warning'}
            />
          </View>
        )}
      </Card>

      {/* Mode Actions */}
      <Card>
        <Text style={styles.sectionTitle}>Select Device Mode</Text>
        <Text style={styles.sectionSubtitle}>
          Choose how this device should operate in your personal bridge:
        </Text>

        <PrimaryButton
          title="Phone A (Sender Mode)"
          onPress={() => router.push('/sender')}
          variant="primary"
          style={styles.actionBtn}
        />

        <PrimaryButton
          title="Phone B (Receiver Mode)"
          onPress={() => router.push('/receiver')}
          variant="secondary"
          style={styles.actionBtn}
        />

        <PrimaryButton
          title={isPaired ? 'Manage Device Pairing' : 'Pair New Devices (QR)'}
          onPress={() => router.push('/pairing')}
          variant="outline"
          style={styles.actionBtn}
        />
      </Card>

      {/* Settings Action */}
      <View style={styles.footerActions}>
        <PrimaryButton
          title="Network & Security Settings"
          onPress={() => router.push('/settings')}
          variant="outline"
        />
      </View>

      {/* Security Privacy Notice */}
      <View style={styles.noticeBox}>
        <Text style={styles.noticeTitle}>Security & Privacy Guarantee</Text>
        <Text style={styles.noticeText}>
          • Only notifications from explicitly allowlisted packages are processed.
        </Text>
        <Text style={styles.noticeText}>
          • No SMS inbox permissions requested.
        </Text>
        <Text style={styles.noticeText}>
          • Plain OTP values and message contents are never persisted or logged to disk.
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
  header: {
    marginBottom: 16
  },
  appName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5
  },
  appSubtitle: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 4,
    lineHeight: 20
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 4
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 12
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9'
  },
  statusLabel: {
    fontSize: 14,
    color: '#334155',
    fontWeight: '500'
  },
  actionBtn: {
    marginVertical: 4
  },
  footerActions: {
    marginTop: 8
  },
  noticeBox: {
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#2563EB'
  },
  noticeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 4
  },
  noticeText: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18
  }
});
