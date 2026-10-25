import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { StorageService, AppCredentials } from '../services/storage';
import {
  receiverSocketClient,
  ReceivedOtpMessage,
  ConnectionState
} from '../services/receiver-socket';
import { ApiClient } from '../services/api';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { PrimaryButton } from '../components/PrimaryButton';
import { EmptyState } from '../components/EmptyState';

export default function ReceiverScreen() {
  const router = useRouter();
  const [messages, setMessages] = useState<ReceivedOtpMessage[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionState>('disconnected');
  const [credentials, setCredentials] = useState<AppCredentials | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const initReceiver = useCallback(async () => {
    let creds = await StorageService.getCredentials();

    if (creds.serverUrl && creds.deviceId && creds.deviceToken) {
      // Sync fresh pairing status from server
      const statusRes = await ApiClient.getDeviceStatus(
        creds.serverUrl,
        creds.deviceId,
        creds.deviceToken
      );
      if (statusRes.ok && statusRes.device) {
        if (statusRes.device.pairedWithId !== creds.pairedWithId) {
          const updated = { pairedWithId: statusRes.device.pairedWithId || null };
          await StorageService.saveCredentials(updated);
          creds = { ...creds, ...updated };
        }
      }
    }

    setCredentials(creds);

    if (creds.deviceId && creds.deviceToken && creds.serverUrl) {
      receiverSocketClient.connect(creds.serverUrl, creds.deviceId, creds.deviceToken);
    }
  }, []);

  useEffect(() => {
    initReceiver();

    const unsubMsg = receiverSocketClient.onMessage((newMsg) => {
      setMessages((prev) => {
        // Prevent duplicate message IDs
        if (prev.some((m) => m.id === newMsg.id)) {
          return prev;
        }
        return [newMsg, ...prev];
      });
    });

    const unsubStatus = receiverSocketClient.onStatus((status) => {
      setConnectionStatus(status);
    });

    const unsubPairing = receiverSocketClient.onPairing((partnerId) => {
      setCredentials((prev) => (prev ? { ...prev, pairedWithId: partnerId } : prev));
    });

    // Auto-prune messages older than 5 minutes from state
    const pruneTimer = setInterval(() => {
      const cutoff = Date.now() - 5 * 60 * 1000;
      setMessages((prev) => prev.filter((m) => m.receivedAt > cutoff));
    }, 15000);

    return () => {
      unsubMsg();
      unsubStatus();
      unsubPairing();
      clearInterval(pruneTimer);
    };
  }, [initReceiver]);

  const handleCopyCode = async (id: string, code: string) => {
    await Clipboard.setStringAsync(code);
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId(null);
    }, 2000);
  };

  const handleClearMessages = () => {
    setMessages([]);
  };

  const handleUnlink = () => {
    Alert.alert(
      'Unlink Sender Device',
      'Are you sure you want to unlink Phone A? You will need to re-pair devices to resume forwarding.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink',
          style: 'destructive',
          onPress: async () => {
            if (credentials?.serverUrl && credentials?.deviceId && credentials?.deviceToken) {
              await ApiClient.revokeDevice(
                credentials.serverUrl,
                credentials.deviceId,
                credentials.deviceToken
              );
            }
            receiverSocketClient.disconnect();
            await StorageService.clearCredentials();
            Alert.alert('Unlinked', 'Device has been unlinked successfully.');
            router.replace('/');
          }
        }
      ]
    );
  };

  const isSenderPaired = Boolean(credentials?.pairedWithId);

  return (
    <View style={styles.container}>
      {/* Header Status Card */}
      <Card style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Receiver Dashboard</Text>
            <Text style={styles.headerSubtitle}>
              {credentials?.deviceId ? `Device ID: ${credentials.deviceId}` : 'Unregistered Device'}
            </Text>
          </View>
          <StatusBadge
            label={connectionStatus === 'connected' ? 'SERVER ONLINE' : connectionStatus.toUpperCase()}
            variant={
              connectionStatus === 'connected'
                ? 'success'
                : connectionStatus === 'connecting'
                ? 'warning'
                : 'error'
            }
          />
        </View>

        {/* Sender Pairing Status Row */}
        <View style={styles.pairingStatusRow}>
          <View style={styles.pairingLeft}>
            <Text style={styles.pairingLabel}>Sender (Phone A):</Text>
            <StatusBadge
              label={isSenderPaired ? 'PAIRED' : 'NOT PAIRED'}
              variant={isSenderPaired ? 'success' : 'warning'}
            />
          </View>
          {isSenderPaired && credentials?.pairedWithId ? (
            <Text style={styles.partnerIdText} numberOfLines={1}>
              {credentials.pairedWithId}
            </Text>
          ) : null}
        </View>

        {!isSenderPaired && (
          <View style={styles.unpairedNotice}>
            <Text style={styles.unpairedText}>
              Phone B is connected to relay server, but not paired with Phone A yet.
            </Text>
            <PrimaryButton
              title="Pair with Phone A"
              onPress={() => router.push('/pairing')}
              variant="outline"
            />
          </View>
        )}

        {isSenderPaired && messages.length > 0 && (
          <View style={styles.actionRow}>
            <TouchableOpacity onPress={handleClearMessages}>
              <Text style={styles.clearBtnText}>Clear All ({messages.length})</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleUnlink}>
              <Text style={styles.unlinkBtnText}>Unlink Phone A</Text>
            </TouchableOpacity>
          </View>
        )}
      </Card>

      {/* Messages List */}
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <EmptyState
            title="Waiting for OTPs"
            description="When authorized notifications arrive on Phone A, their verification codes will appear here in real-time."
          />
        }
        renderItem={({ item }) => {
          const isCopied = copiedId === item.id;
          const timeAgo = Math.max(0, Math.floor((Date.now() - item.receivedAt) / 1000));

          return (
            <Card style={styles.otpCard}>
              <View style={styles.cardTopRow}>
                <View style={styles.badgeGroup}>
                  <View style={styles.appBadge}>
                    <Text style={styles.appBadgeText}>
                      {item.serviceName || item.packageName.split('.').pop() || item.packageName}
                    </Text>
                  </View>
                  {item.carrierTag ? (
                    <View style={styles.carrierBadge}>
                      <Text style={styles.carrierBadgeText}>{item.carrierTag}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.timeText}>
                  {timeAgo < 60 ? `${timeAgo}s ago` : `${Math.floor(timeAgo / 60)}m ago`}
                  {item.wasQueued ? ' • Queued' : ''}
                </Text>
              </View>

              {item.title ? (
                <Text style={styles.titleText}>{item.title}</Text>
              ) : null}

              {/* Prominent OTP Code Display */}
              <View style={styles.codeContainer}>
                <Text style={styles.otpText} selectable>
                  {item.otpCode}
                </Text>
                <TouchableOpacity
                  style={[styles.copyBtn, isCopied && styles.copiedBtn]}
                  onPress={() => handleCopyCode(item.id, item.otpCode)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.copyBtnText, isCopied && styles.copiedBtnText]}>
                    {isCopied ? '✓ Copied' : 'Copy Code'}
                  </Text>
                </TouchableOpacity>
              </View>

              {item.bodySnippet ? (
                <Text style={styles.snippetText} numberOfLines={2}>
                  {item.bodySnippet}
                </Text>
              ) : null}
            </Card>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC'
  },
  statusCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A'
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2
  },
  pairingStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9'
  },
  pairingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  pairingLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569'
  },
  partnerIdText: {
    fontSize: 11,
    color: '#64748B',
    maxWidth: 150
  },
  unpairedNotice: {
    marginTop: 12
  },
  unpairedText: {
    fontSize: 13,
    color: '#B45309',
    marginBottom: 8
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9'
  },
  clearBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B'
  },
  unlinkBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#DC2626'
  },
  listContent: {
    padding: 16,
    paddingBottom: 40
  },
  otpCard: {
    marginVertical: 6,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#2563EB'
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  },
  badgeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  appBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6
  },
  appBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1D4ED8'
  },
  carrierBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6
  },
  carrierBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569'
  },
  timeText: {
    fontSize: 11,
    color: '#94A3B8'
  },
  titleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6
  },
  codeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginVertical: 6
  },
  otpText: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 2,
    color: '#0F172A',
    fontFamily: 'monospace'
  },
  copyBtn: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8
  },
  copiedBtn: {
    backgroundColor: '#16A34A'
  },
  copyBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600'
  },
  copiedBtnText: {
    color: '#FFFFFF'
  },
  snippetText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
    fontStyle: 'italic'
  }
});
