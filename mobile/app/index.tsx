import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StorageService, AppCredentials } from '../services/storage';
import { ApiClient } from '../services/api';
import { sessionHistoryService, SessionEvent } from '../services/session-history';
import { receiverSocketClient } from '../services/receiver-socket';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { PrimaryButton } from '../components/PrimaryButton';

export default function HomeScreen() {
  const router = useRouter();
  const [credentials, setCredentials] = useState<AppCredentials | null>(null);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [allowlistCount, setAllowlistCount] = useState<number>(0);
  const [refreshing, setRefreshing] = useState(false);
  const [sessionEvents, setSessionEvents] = useState<SessionEvent[]>(() =>
    sessionHistoryService.getEvents()
  );
  const isLoadingRef = useRef(false);

  const loadState = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    try {
      await sessionHistoryService.ensureActiveSessionRecorded();
      let creds = await StorageService.getCredentials();
      const apps = await StorageService.getAllowlistedPackages();
      setAllowlistCount(apps.length);

      const isHealthy = await ApiClient.checkHealth(creds.serverUrl);
      setServerOnline(isHealthy);

      if (isHealthy && creds.deviceId && creds.deviceToken) {
        try {
          const status = await ApiClient.getDeviceStatus(
            creds.serverUrl,
            creds.deviceId,
            creds.deviceToken
          );
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
          // Fall back to local credentials
        }
      }

      setCredentials(creds);
      setSessionEvents(sessionHistoryService.getEvents());

      if (
        creds.role === 'receiver' &&
        isHealthy &&
        creds.deviceId &&
        creds.deviceToken &&
        creds.serverUrl
      ) {
        receiverSocketClient.connect(creds.serverUrl, creds.deviceId, creds.deviceToken);
      }
    } finally {
      isLoadingRef.current = false;
    }
  }, []);

  // Reload automatically on screen focus
  useFocusEffect(
    useCallback(() => {
      loadState();
    }, [loadState])
  );

  // Auto-reload history events when new ones are recorded
  useEffect(() => {
    loadState();
    const unsub = sessionHistoryService.onHistoryChange((events) => {
      setSessionEvents(events);
    });
    return () => unsub();
  }, [loadState]);

  // Periodic auto-reload so state updates without excessive polling (6s)
  useEffect(() => {
    const timer = setInterval(() => {
      loadState();
    }, 6000);
    return () => clearInterval(timer);
  }, [loadState]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadState();
    setRefreshing(false);
  };

  const isPaired = Boolean(credentials?.deviceId && credentials?.pairedWithId);
  const role = credentials?.role;
  const latestEvent = sessionEvents[0];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* A. Compact Welcome Area (No duplicated OTP Bridge title) */}
      <View style={styles.welcomeBanner}>
        <View style={styles.brandIconWrapper}>
          <Ionicons name="shield-checkmark" size={20} color="#2563EB" />
        </View>
        <View style={styles.welcomeTextCol}>
          <Text style={styles.welcomeSubtitle}>Your private OTP connection</Text>
        </View>
      </View>

      {/* B. Connection Overview - Single Compact Unified Card */}
      <Card style={styles.overviewCard}>
        <Text style={styles.sectionHeader}>Connection Overview</Text>

        <View style={styles.overviewGrid}>
          {/* Row 1: Server Status */}
          <View style={styles.overviewRow}>
            <View style={styles.overviewLabelCol}>
              <Ionicons
                name="server-outline"
                size={16}
                color="#64748B"
                style={styles.rowIcon}
              />
              <Text style={styles.overviewLabel}>Relay Server</Text>
            </View>
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

          {/* Row 2: Configured Role */}
          <View style={styles.overviewRow}>
            <View style={styles.overviewLabelCol}>
              <Ionicons
                name="phone-portrait-outline"
                size={16}
                color="#64748B"
                style={styles.rowIcon}
              />
              <Text style={styles.overviewLabel}>Device Role</Text>
            </View>
            <Text style={styles.overviewValue}>
              {role === 'sender'
                ? 'Sender'
                : role === 'receiver'
                ? 'Receiver'
                : 'Not Configured'}
            </Text>
          </View>

          {/* Row 3: Pairing State */}
          <View style={styles.overviewRow}>
            <View style={styles.overviewLabelCol}>
              <Ionicons
                name="link-outline"
                size={16}
                color="#64748B"
                style={styles.rowIcon}
              />
              <Text style={styles.overviewLabel}>Pairing State</Text>
            </View>
            <StatusBadge
              label={isPaired ? 'PAIRED' : 'UNPAIRED'}
              variant={isPaired ? 'success' : 'warning'}
            />
          </View>

          {/* Row 4: Sources (if Sender) */}
          {role === 'sender' && (
            <View style={[styles.overviewRow, { borderBottomWidth: 0 }]}>
              <View style={styles.overviewLabelCol}>
                <Ionicons
                  name="apps-outline"
                  size={16}
                  color="#64748B"
                  style={styles.rowIcon}
                />
                <Text style={styles.overviewLabel}>Allowed Sources</Text>
              </View>
              <Text style={styles.overviewValue}>
                {allowlistCount > 0 ? `${allowlistCount} apps` : 'All carriers'}
              </Text>
            </View>
          )}
        </View>
      </Card>

      {/* C. Primary Action - Single Prioritized Action */}
      {!role ? (
        <Card style={styles.actionCard}>
          <Text style={styles.sectionHeader}>Choose Mode</Text>
          <Text style={styles.cardDesc}>
            Select how this device participates in your private bridge:
          </Text>

          <PrimaryButton
            title="Set Up Sender"
            onPress={() => router.push('/sender')}
            variant="primary"
          />
          <PrimaryButton
            title="Set Up Receiver"
            onPress={() => router.push('/receiver')}
            variant="secondary"
          />
          <PrimaryButton
            title="Pair New Devices (QR)"
            onPress={() => router.push('/pairing')}
            variant="outline"
          />
        </Card>
      ) : !isPaired ? (
        <Card style={styles.actionCard}>
          <Text style={styles.sectionHeader}>Pairing Required</Text>
          <Text style={styles.cardDesc}>
            Pair this device with your partner phone to activate end-to-end forwarding.
          </Text>

          <PrimaryButton
            title="Pair Devices (QR)"
            onPress={() => router.push('/pairing')}
            variant="primary"
          />
        </Card>
      ) : (
        /* Configured & Paired: Quick Dashboard Shortcut */
        <Card style={styles.actionCard}>
          <Text style={styles.sectionHeader}>Active Session</Text>
          <Text style={styles.cardDesc}>
            {role === 'sender'
              ? 'Ready to capture and forward OTPs to Receiver.'
              : 'Listening for incoming verification codes from Sender.'}
          </Text>

          <PrimaryButton
            title={role === 'sender' ? 'Open Sender Dashboard' : 'Open Receiver Dashboard'}
            onPress={() => router.push(role === 'sender' ? '/sender' : '/receiver')}
            variant="primary"
          />

          <View style={styles.quickNavRow}>
            {role === 'sender' && (
              <PrimaryButton
                title="Manage Apps"
                onPress={() => router.push('/select-apps')}
                variant="outline"
                style={styles.halfBtn}
              />
            )}
            <PrimaryButton
              title="Pairing Info"
              onPress={() => router.push('/pairing')}
              variant="outline"
              style={role === 'sender' ? styles.halfBtn : styles.fullBtn}
            />
          </View>
        </Card>
      )}

      {/* D. Active Pairing Summary & Session History Shortcut */}
      {isPaired && (
        <Card style={styles.sessionSummaryCard}>
          <View style={styles.summaryTopRow}>
            <View>
              <Text style={styles.sectionHeader}>Session Activity</Text>
              <Text style={styles.summaryPartnerText}>
                Bound with {role === 'sender' ? 'Receiver' : 'Sender'}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => router.push('/pairing?tab=history')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.viewHistoryLink}>View History →</Text>
            </TouchableOpacity>
          </View>

          {latestEvent ? (
            <View style={styles.recentEventBox}>
              <Ionicons
                name="time-outline"
                size={15}
                color="#2563EB"
                style={{ marginRight: 6 }}
              />
              <Text style={styles.recentEventTitle} numberOfLines={1}>
                {latestEvent.title}
              </Text>
              <Text style={styles.recentEventDot}>•</Text>
              <Text style={styles.recentEventTime}>
                {new Date(latestEvent.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </Text>
            </View>
          ) : (
            <Text style={styles.noEventsText}>No session events recorded yet.</Text>
          )}
        </Card>
      )}

      {/* Secondary Settings Action */}
      <View style={styles.footerRow}>
        <PrimaryButton
          title="Network & Security Settings"
          onPress={() => router.push('/settings')}
          variant="outline"
        />

        {role && (
          <TouchableOpacity
            style={styles.switchModeLink}
            onPress={() => router.push(role === 'sender' ? '/receiver' : '/sender')}
          >
            <Text style={styles.switchModeText}>
              Switch to {role === 'sender' ? 'Receiver' : 'Sender'} Mode →
            </Text>
          </TouchableOpacity>
        )}
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
    paddingBottom: 36
  },
  welcomeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    paddingHorizontal: 4
  },
  brandIconWrapper: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#BFDBFE'
  },
  welcomeTextCol: {
    flex: 1
  },
  welcomeSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569'
  },
  overviewCard: {
    padding: 16,
    marginVertical: 6
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 6
  },
  cardDesc: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 12,
    lineHeight: 18
  },
  overviewGrid: {
    marginTop: 4
  },
  overviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9'
  },
  overviewLabelCol: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  rowIcon: {
    marginRight: 8
  },
  overviewLabel: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '500'
  },
  overviewValue: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '600'
  },
  actionCard: {
    padding: 16,
    marginVertical: 6
  },
  quickNavRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6
  },
  halfBtn: {
    flex: 1,
    marginVertical: 0
  },
  fullBtn: {
    flex: 1,
    marginVertical: 0
  },
  sessionSummaryCard: {
    padding: 16,
    marginVertical: 6
  },
  summaryTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8
  },
  summaryPartnerText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2
  },
  viewHistoryLink: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563EB'
  },
  recentEventBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 4
  },
  recentEventTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E293B',
    flexShrink: 1
  },
  recentEventDot: {
    fontSize: 12,
    color: '#94A3B8',
    marginHorizontal: 4
  },
  recentEventTime: {
    fontSize: 11,
    color: '#64748B'
  },
  noEventsText: {
    fontSize: 12,
    color: '#94A3B8',
    fontStyle: 'italic',
    marginTop: 4
  },
  footerRow: {
    marginTop: 12
  },
  switchModeLink: {
    alignItems: 'center',
    paddingVertical: 10
  },
  switchModeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563EB'
  }
});
