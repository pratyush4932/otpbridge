import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StorageService, AppCredentials } from '../services/storage';
import {
  receiverSocketClient,
  ReceivedOtpMessage,
  ConnectionState
} from '../services/receiver-socket';
import { ApiClient } from '../services/api';
import { sessionHistoryService } from '../services/session-history';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { PrimaryButton } from '../components/PrimaryButton';
import { EmptyState } from '../components/EmptyState';
import { AppIcon } from '../components/AppIcon';

export default function ReceiverScreen() {
  const router = useRouter();
  const [messages, setMessages] = useState<ReceivedOtpMessage[]>(() =>
    receiverSocketClient.getMessages()
  );
  const [connectionStatus, setConnectionStatus] = useState<ConnectionState>(
    receiverSocketClient.status
  );
  const [credentials, setCredentials] = useState<AppCredentials | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const prevStatusRef = useRef<ConnectionState | null>(null);
  const isInitializingRef = useRef(false);

  const initReceiver = useCallback(async (forceServer = false) => {
    if (isInitializingRef.current) return;
    isInitializingRef.current = true;
    try {
      await sessionHistoryService.ensureActiveSessionRecorded();
      let creds = await StorageService.getCredentials();

      const isWsConnected = receiverSocketClient.isConnected();
      if (creds.serverUrl && creds.deviceId && creds.deviceToken && (!isWsConnected || forceServer)) {
        try {
          const statusRes = await ApiClient.getDeviceStatus(
            creds.serverUrl,
            creds.deviceId,
            creds.deviceToken
          );
          if (statusRes.device) {
            const partnerId = statusRes.device.isPaired ? statusRes.partner?.id || null : null;
            if (partnerId !== creds.pairedWithId) {
              const updated = { pairedWithId: partnerId };
              await StorageService.saveCredentials(updated);
              creds = { ...creds, ...updated };
            }
          }
        } catch {
          // Fall back to locally stored credentials
        }
      }

      setCredentials(creds);

      if (creds.deviceId && creds.deviceToken && creds.serverUrl) {
        receiverSocketClient.connect(creds.serverUrl, creds.deviceId, creds.deviceToken);
      }
    } finally {
      isInitializingRef.current = false;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      initReceiver(true);
      setMessages(receiverSocketClient.getMessages());
    }, [initReceiver])
  );

  useEffect(() => {
    initReceiver(true);

    receiverSocketClient.loadStoredMessages().then((stored) => {
      setMessages(stored);
    });

    const unsubMsg = receiverSocketClient.onMessagesChange((updated) => {
      setMessages(updated);
    });

    const unsubStatus = receiverSocketClient.onStatus(async (status) => {
      setConnectionStatus(status);
      if (prevStatusRef.current !== null && prevStatusRef.current !== status) {
        if (status === 'connected') {
          await sessionHistoryService.recordEvent(
            'connection_restored',
            'Connection restored',
            'Receiver WebSocket reconnected to relay server'
          );
        } else if (status === 'disconnected') {
          await sessionHistoryService.recordEvent(
            'connection_lost',
            'Connection lost',
            'Receiver WebSocket connection closed or interrupted'
          );
        }
      } else if (prevStatusRef.current === null && status === 'connected') {
        await sessionHistoryService.recordEvent(
          'connection_established',
          'Connection established',
          'Receiver connected to relay server via WebSocket'
        );
      }
      prevStatusRef.current = status;
    });

    const unsubPairing = receiverSocketClient.onPairing((partnerId) => {
      setCredentials((prev) => (prev ? { ...prev, pairedWithId: partnerId } : prev));
    });

    // Periodically sync receiver state with server to pick up pairing changes automatically (8s)
    const pollTimer = setInterval(() => {
      initReceiver(false);
    }, 8000);

    // Auto-prune messages older than 5 minutes from state and tick validity timer
    const pruneTimer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      setMessages(receiverSocketClient.getMessages());
    }, 1000);

    return () => {
      unsubMsg();
      unsubStatus();
      unsubPairing();
      clearInterval(pollTimer);
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

  const handleClearMessages = async () => {
    await receiverSocketClient.clearMessages();
    setMessages([]);
  };

  const handleUnlink = () => {
    Alert.alert(
      'Unlink Sender Device',
      'Are you sure you want to unlink Sender? You will need to re-pair devices to resume forwarding.',
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
            await sessionHistoryService.recordEvent(
              'device_unlinked',
              'Sender device unlinked',
              'Sender was unlinked from Receiver'
            );
            await sessionHistoryService.recordEvent(
              'session_ended',
              'Session ended',
              'Pairing session terminated'
            );
            await receiverSocketClient.clearMessages();
            receiverSocketClient.disconnect();
            await StorageService.clearCredentials();
            Alert.alert('Unlinked', 'Device unlinked successfully.');
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
            <Text style={styles.headerTitle}>Receiver Mode</Text>
            <Text style={styles.headerSubtitle}>
              {isSenderPaired ? 'Connected to Sender' : 'Waiting for pairing'}
            </Text>
          </View>
          <StatusBadge
            label={connectionStatus === 'connected' ? 'ONLINE' : connectionStatus.toUpperCase()}
            variant={
              connectionStatus === 'connected'
                ? 'success'
                : connectionStatus === 'connecting'
                ? 'warning'
                : 'error'
            }
          />
        </View>

        {!isSenderPaired && (
          <View style={styles.unpairedNotice}>
            <Text style={styles.unpairedText}>
              Receiver is connected to the server, but not paired with Sender yet.
            </Text>
            <PrimaryButton
              title="Pair with Sender"
              onPress={() => router.push('/pairing')}
              variant="outline"
              style={{ marginVertical: 0 }}
            />
          </View>
        )}

        <View style={styles.actionRow}>
          <TouchableOpacity onPress={() => router.push('/pairing?tab=history')}>
            <Text style={styles.historyBtnText}>Session History →</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', gap: 14 }}>
            {messages.length > 0 && (
              <TouchableOpacity onPress={handleClearMessages}>
                <Text style={styles.clearBtnText}>Clear ({messages.length})</Text>
              </TouchableOpacity>
            )}
            {isSenderPaired && (
              <TouchableOpacity onPress={handleUnlink}>
                <Text style={styles.unlinkBtnText}>Unlink</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Card>

      {/* Messages List */}
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <EmptyState
            title="Waiting for verification codes"
            description="When authorized OTP notifications arrive on Sender, their codes will appear here in real-time."
            iconName="shield-checkmark-outline"
          />
        }
        renderItem={({ item }) => {
          const isCopied = copiedId === item.id;
          const timeElapsed = Math.max(0, Math.floor((now - item.receivedAt) / 1000));
          const remainingSecs = Math.max(0, 300 - timeElapsed);
          const serviceDisplay =
            item.serviceName || item.packageName.split('.').pop() || 'Verification';

          return (
            <Card style={styles.otpCard}>
              <View style={styles.cardTopRow}>
                <View style={styles.serviceHeader}>
                  <AppIcon
                    appName={serviceDisplay}
                    size={36}
                    style={{ marginRight: 10 }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.serviceTitle} numberOfLines={1}>
                      {serviceDisplay}
                    </Text>
                    {item.carrierTag ? (
                      <Text style={styles.carrierTagText}>{item.carrierTag}</Text>
                    ) : null}
                  </View>
                </View>

                <View style={styles.timeTag}>
                  <Text style={styles.validityText}>
                    {remainingSecs > 0
                      ? `${Math.floor(remainingSecs / 60)}m ${remainingSecs % 60}s left`
                      : 'Expired'}
                  </Text>
                </View>
              </View>

              {/* Prominent OTP Code Container */}
              <View style={styles.codeContainer}>
                <Text style={styles.otpText} selectable>
                  {item.otpCode}
                </Text>
                <TouchableOpacity
                  style={[styles.copyBtn, isCopied && styles.copiedBtn]}
                  onPress={() => handleCopyCode(item.id, item.otpCode)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={isCopied ? 'checkmark-outline' : 'copy-outline'}
                    size={16}
                    color="#FFFFFF"
                    style={{ marginRight: 4 }}
                  />
                  <Text style={styles.copyBtnText}>
                    {isCopied ? 'Copied' : 'Copy'}
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
    marginBottom: 4,
    padding: 14
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A'
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2
  },
  unpairedNotice: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9'
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
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9'
  },
  historyBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563EB'
  },
  clearBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B'
  },
  unlinkBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#DC2626'
  },
  listContent: {
    padding: 16,
    paddingBottom: 32
  },
  otpCard: {
    marginVertical: 5,
    padding: 14,
    borderLeftWidth: 4,
    borderLeftColor: '#2563EB'
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  serviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1
  },
  serviceTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A'
  },
  carrierTagText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1
  },
  timeTag: {
    alignItems: 'flex-end'
  },
  validityText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2563EB'
  },
  codeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginVertical: 4
  },
  otpText: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 2.5,
    color: '#0F172A',
    fontFamily: 'monospace'
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2563EB',
    paddingHorizontal: 12,
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
  snippetText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
    fontStyle: 'italic'
  }
});
