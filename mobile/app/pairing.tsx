import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  TouchableOpacity
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { StorageService } from '../services/storage';
import { ApiClient } from '../services/api';
import { sessionHistoryService, SessionEvent } from '../services/session-history';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { StatusBadge } from '../components/StatusBadge';
import { SessionTimeline } from '../components/SessionTimeline';

type PairingTab = 'generate' | 'scan' | 'manual' | 'history';

export default function PairingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();

  const [activeTab, setActiveTab] = useState<PairingTab>(
    params.tab === 'history'
      ? 'history'
      : params.tab === 'scan'
      ? 'scan'
      : 'generate'
  );

  // Generator (Receiver) State
  const [pairingPayload, setPairingPayload] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [generating, setGenerating] = useState(false);

  // Scanner (Sender) State
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [completing, setCompleting] = useState(false);

  // Manual fallback inputs
  const [manualServerUrl, setManualServerUrl] = useState('');
  const [manualToken, setManualToken] = useState('');

  // Active Session Events
  const [sessionEvents, setSessionEvents] = useState<SessionEvent[]>(() =>
    sessionHistoryService.getEvents()
  );

  const refreshEvents = useCallback(() => {
    sessionHistoryService.ensureActiveSessionRecorded().then(() => {
      setSessionEvents(sessionHistoryService.getEvents());
    });
  }, []);

  // Reload history automatically on focus
  useFocusEffect(
    useCallback(() => {
      refreshEvents();
    }, [refreshEvents])
  );

  useEffect(() => {
    refreshEvents();

    const unsub = sessionHistoryService.onHistoryChange((events) => {
      setSessionEvents(events);
    });
    return () => unsub();
  }, [refreshEvents]);

  // Periodic auto-reload so events show immediately without manual refresh
  useEffect(() => {
    const timer = setInterval(() => {
      refreshEvents();
    }, 2000);
    return () => clearInterval(timer);
  }, [refreshEvents]);

  useEffect(() => {
    if (activeTab === 'history') {
      refreshEvents();
    }
  }, [activeTab, refreshEvents]);

  // Countdown timer for pairing token
  useEffect(() => {
    if (!expiresAt) return;

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        sessionHistoryService.recordEvent(
          'pairing_expired',
          'Pairing code expired',
          'Single-use token expired before scan was completed'
        );
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  // Auto-detect pairing completion when Sender scans this QR code
  useEffect(() => {
    if (!pairingPayload || !expiresAt || activeTab !== 'generate') return;

    let isMounted = true;
    const pollInterval = setInterval(async () => {
      try {
        const creds = await StorageService.getCredentials();
        if (creds.serverUrl && creds.deviceId && creds.deviceToken) {
          const res = await ApiClient.getDeviceStatus(
            creds.serverUrl,
            creds.deviceId,
            creds.deviceToken
          );
          if (isMounted && res.device?.isPaired && res.partner?.id) {
            clearInterval(pollInterval);
            await StorageService.saveCredentials({
              pairedWithId: res.partner.id
            });

            await sessionHistoryService.recordEvent(
              'pairing_completed',
              'Pairing completed',
              'Successfully paired with Sender'
            );

            Alert.alert(
              'Pairing Successful',
              'Sender has successfully paired with this receiver.',
              [{ text: 'Open Receiver Mode', onPress: () => router.replace('/receiver') }]
            );
          }
        }
      } catch {
        // Ignore network hiccups while polling
      }
    }, 3000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [pairingPayload, expiresAt, activeTab, router]);

  const handleStartPairingSession = async () => {
    setGenerating(true);
    try {
      const creds = await StorageService.getCredentials();
      let result;
      try {
        result = await ApiClient.startPairing(
          creds.serverUrl,
          'Receiver',
          creds.deviceId || undefined,
          creds.deviceToken || undefined
        );
      } catch (err: any) {
        if (
          err.message?.includes('Invalid receiver credentials') ||
          err.message?.includes('401')
        ) {
          await StorageService.clearCredentials();
          result = await ApiClient.startPairing(
            creds.serverUrl,
            'Receiver'
          );
        } else {
          throw err;
        }
      }

      await StorageService.saveCredentials({
        role: 'receiver',
        deviceId: result.receiverDevice.id,
        deviceToken: result.receiverDevice.token || creds.deviceToken,
        serverUrl: result.serverUrl
      });

      const qrData = JSON.stringify({
        s: result.serverUrl,
        t: result.pairingToken
      });

      setPairingPayload(qrData);
      setExpiresAt(result.expiresAt);
      setTimeLeft(Math.floor((result.expiresAt - Date.now()) / 1000));

      await sessionHistoryService.recordEvent(
        pairingPayload ? 'qr_regenerated' : 'pairing_created',
        pairingPayload ? 'Pairing code regenerated' : 'Pairing session created',
        'Single-use QR code ready for scanning'
      );
    } catch (err: any) {
      Alert.alert('Pairing Error', err.message || 'Failed to start pairing');
    } finally {
      setGenerating(false);
    }
  };

  const handleCompletePairing = async (serverUrl: string, token: string) => {
    if (!token || !serverUrl) {
      Alert.alert('Missing Data', 'Server URL and pairing token are required.');
      return;
    }

    setCompleting(true);
    await sessionHistoryService.recordEvent(
      'pairing_attempt',
      'Pairing attempt initiated',
      'Exchanging credentials with relay server'
    );

    try {
      const result = await ApiClient.completePairing(serverUrl, token.trim(), 'Sender');

      await StorageService.saveCredentials({
        role: 'sender',
        deviceId: result.senderDevice.id,
        deviceToken: result.senderDevice.token,
        pairedWithId: result.senderDevice.pairedWithReceiverId,
        serverUrl: serverUrl.trim().replace(/\/+$/, '')
      });

      await sessionHistoryService.recordEvent(
        'pairing_completed',
        'Pairing completed',
        'Sender authenticated and bound'
      );

      Alert.alert(
        'Pairing Successful',
        'Device successfully paired as Sender.',
        [{ text: 'Open Sender Dashboard', onPress: () => router.replace('/sender') }]
      );
    } catch (err: any) {
      Alert.alert('Pairing Failed', err.message || 'Invalid or expired token.');
      setScanned(false);
    } finally {
      setCompleting(false);
    }
  };

  const onBarcodeScanned = ({ data }: { data: string }) => {
    if (scanned || completing) return;
    setScanned(true);

    try {
      const parsed = JSON.parse(data);
      if (parsed.s && parsed.t) {
        handleCompletePairing(parsed.s, parsed.t);
        return;
      }
    } catch {
      if (data.length >= 16) {
        StorageService.getCredentials().then((creds) => {
          handleCompletePairing(creds.serverUrl, data);
        });
        return;
      }
    }

    Alert.alert('Invalid QR Code', 'This code is not an OTP Bridge pairing token.');
    setScanned(false);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Unified Segmented Mode Selector */}
      <View style={styles.tabsRow}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'generate' && styles.tabBtnActive]}
          onPress={() => setActiveTab('generate')}
          activeOpacity={0.8}
        >
          <Text
            style={[styles.tabBtnText, activeTab === 'generate' && styles.tabBtnTextActive]}
          >
            Display QR
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'scan' && styles.tabBtnActive]}
          onPress={() => setActiveTab('scan')}
          activeOpacity={0.8}
        >
          <Text
            style={[styles.tabBtnText, activeTab === 'scan' && styles.tabBtnTextActive]}
          >
            Scan QR
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'history' && styles.tabBtnActive]}
          onPress={() => setActiveTab('history')}
          activeOpacity={0.8}
        >
          <Text
            style={[styles.tabBtnText, activeTab === 'history' && styles.tabBtnTextActive]}
          >
            History ({sessionEvents.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Mode 1: Generate QR (Receiver) */}
      {activeTab === 'generate' && (
        <View>
          <Card style={styles.centerCard}>
            <Text style={styles.sectionHeader}>Pairing Code Display</Text>
            <Text style={styles.cardSubtitle}>
              Scan this QR code with Sender to establish a private, authenticated link.
            </Text>

            {generating ? (
              <View style={styles.qrPlaceholder}>
                <ActivityIndicator size="large" color="#2563EB" />
                <Text style={styles.mutedText}>Generating secure session...</Text>
              </View>
            ) : pairingPayload && timeLeft > 0 ? (
              <View style={styles.qrContainer}>
                <View style={styles.qrWrapper}>
                  <QRCode value={pairingPayload} size={210} />
                </View>
                <View style={styles.timerRow}>
                  <StatusBadge
                    label={`Expires in ${Math.floor(timeLeft / 60)}m ${timeLeft % 60}s`}
                    variant={timeLeft > 60 ? 'info' : 'warning'}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.emptySession}>
                <Text style={styles.emptyText}>
                  {timeLeft === 0 && pairingPayload
                    ? 'Session expired. Generate a new code to continue.'
                    : 'Tap below to create a secure pairing session.'}
                </Text>
                <PrimaryButton
                  title="Create Pairing Session"
                  onPress={handleStartPairingSession}
                  variant="primary"
                  style={{ width: '100%' }}
                />
              </View>
            )}

            {pairingPayload && timeLeft > 0 && (
              <PrimaryButton
                title="Regenerate Pairing Code"
                onPress={handleStartPairingSession}
                variant="outline"
                style={{ marginTop: 10, width: '100%' }}
              />
            )}
          </Card>

          {/* Quick Active Session History Timeline */}
          {sessionEvents.length > 0 && (
            <Card style={styles.timelineCard}>
              <View style={styles.timelineHeaderRow}>
                <Text style={styles.sectionHeader}>Recent Session Events</Text>
                <TouchableOpacity onPress={() => setActiveTab('history')}>
                  <Text style={styles.viewAllLink}>View All ({sessionEvents.length}) →</Text>
                </TouchableOpacity>
              </View>
              <SessionTimeline events={sessionEvents} limit={3} />
            </Card>
          )}
        </View>
      )}

      {/* Mode 2: Scan QR with Camera (Sender) */}
      {activeTab === 'scan' && (
        <View>
          <Card style={{ padding: 16 }}>
            <Text style={styles.sectionHeader}>Scan Receiver Code</Text>
            <Text style={styles.cardSubtitle}>
              Point your camera at the QR code displayed on Receiver.
            </Text>

            {!permission?.granted ? (
              <View style={styles.permissionBox}>
                <Text style={styles.permissionText}>
                  Camera permission is required to scan the pairing QR code.
                </Text>
                <PrimaryButton
                  title="Grant Camera Access"
                  onPress={requestPermission}
                  variant="primary"
                />
                <PrimaryButton
                  title="Enter Code Manually"
                  onPress={() => setActiveTab('manual')}
                  variant="outline"
                  style={{ marginTop: 8 }}
                />
              </View>
            ) : (
              <View style={styles.cameraContainer}>
                <CameraView
                  style={styles.camera}
                  barcodeScannerSettings={{
                    barcodeTypes: ['qr']
                  }}
                  onBarcodeScanned={scanned ? undefined : onBarcodeScanned}
                />
                {completing && (
                  <View style={styles.cameraOverlay}>
                    <ActivityIndicator size="large" color="#FFFFFF" />
                    <Text style={styles.cameraOverlayText}>Verifying credentials...</Text>
                  </View>
                )}
              </View>
            )}

            {permission?.granted && (
              <PrimaryButton
                title="Enter Code Manually Instead"
                onPress={() => setActiveTab('manual')}
                variant="outline"
                style={{ marginTop: 12 }}
              />
            )}
          </Card>

          {/* Quick Active Session History Timeline */}
          {sessionEvents.length > 0 && (
            <Card style={styles.timelineCard}>
              <View style={styles.timelineHeaderRow}>
                <Text style={styles.sectionHeader}>Recent Session Events</Text>
                <TouchableOpacity onPress={() => setActiveTab('history')}>
                  <Text style={styles.viewAllLink}>View All ({sessionEvents.length}) →</Text>
                </TouchableOpacity>
              </View>
              <SessionTimeline events={sessionEvents} limit={3} />
            </Card>
          )}
        </View>
      )}

      {/* Mode 3: Manual Code Fallback */}
      {activeTab === 'manual' && (
        <Card style={{ padding: 16 }}>
          <Text style={styles.sectionHeader}>Manual Pairing Entry</Text>
          <Text style={styles.cardSubtitle}>
            Fallback when camera is unavailable. Enter the relay URL and single-use token.
          </Text>

          <Text style={styles.inputLabel}>Relay Server URL</Text>
          <TextInput
            style={styles.input}
            placeholder="http://192.168.1.X:4000"
            placeholderTextColor="#94A3B8"
            value={manualServerUrl}
            onChangeText={setManualServerUrl}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.inputLabel}>Pairing Token</Text>
          <TextInput
            style={styles.input}
            placeholder="Paste pairing token..."
            placeholderTextColor="#94A3B8"
            value={manualToken}
            onChangeText={setManualToken}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <PrimaryButton
            title={completing ? 'Pairing...' : 'Complete Pairing'}
            onPress={() => handleCompletePairing(manualServerUrl, manualToken)}
            loading={completing}
          />

          <TouchableOpacity
            style={styles.backLink}
            onPress={() => setActiveTab('scan')}
          >
            <Text style={styles.backLinkText}>← Back to Camera Scanner</Text>
          </TouchableOpacity>
        </Card>
      )}

      {/* Mode 4: Dedicated Full Session History Tab */}
      {activeTab === 'history' && (
        <Card style={{ padding: 16 }}>
          <View style={styles.historyHeaderRow}>
            <View>
              <Text style={styles.sectionHeader}>Active Session History</Text>
              <Text style={styles.cardSubtitle}>
                Chronological record of connection and pairing events.
              </Text>
            </View>
            {sessionEvents.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  Alert.alert(
                    'Clear History',
                    'Clear all recorded session history events?',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Clear',
                        style: 'destructive',
                        onPress: () => sessionHistoryService.clearHistory()
                      }
                    ]
                  );
                }}
              >
                <Text style={styles.clearHistoryText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>

          <SessionTimeline events={sessionEvents} />
        </Card>
      )}
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
  tabsRow: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 4,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8
  },
  tabBtnActive: {
    backgroundColor: '#EFF6FF'
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B'
  },
  tabBtnTextActive: {
    color: '#2563EB',
    fontWeight: '700'
  },
  centerCard: {
    alignItems: 'center',
    padding: 16,
    marginVertical: 4
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 14,
    textAlign: 'center',
    lineHeight: 18
  },
  qrContainer: {
    alignItems: 'center',
    paddingVertical: 8
  },
  qrWrapper: {
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  timerRow: {
    marginTop: 12
  },
  emptySession: {
    alignItems: 'center',
    paddingVertical: 14,
    width: '100%'
  },
  emptyText: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 12,
    textAlign: 'center'
  },
  qrPlaceholder: {
    paddingVertical: 36,
    alignItems: 'center'
  },
  mutedText: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 10
  },
  permissionBox: {
    paddingVertical: 16,
    alignItems: 'center'
  },
  permissionText: {
    fontSize: 13,
    color: '#475569',
    textAlign: 'center',
    marginBottom: 14
  },
  cameraContainer: {
    height: 270,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative'
  },
  camera: {
    flex: 1
  },
  cameraOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  cameraOverlayText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginTop: 8,
    marginBottom: 4
  },
  input: {
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  backLink: {
    alignItems: 'center',
    paddingVertical: 10
  },
  backLinkText: {
    fontSize: 13,
    color: '#2563EB',
    fontWeight: '600'
  },
  timelineCard: {
    padding: 16,
    marginTop: 12
  },
  timelineHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10
  },
  viewAllLink: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563EB'
  },
  historyHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12
  },
  clearHistoryText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#DC2626'
  }
});
