import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator
} from 'react-native';
import { useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { StorageService } from '../services/storage';
import { ApiClient } from '../services/api';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { StatusBadge } from '../components/StatusBadge';

type PairingTab = 'generate' | 'scan' | 'manual';

export default function PairingScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<PairingTab>('generate');

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

  // Countdown timer for pairing token
  useEffect(() => {
    if (!expiresAt) return;

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  // Auto-detect pairing completion when Phone A scans this QR code
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
          if (isMounted && res.ok && res.device?.pairedWithId) {
            clearInterval(pollInterval);
            await StorageService.saveCredentials({
              pairedWithId: res.device.pairedWithId
            });
            Alert.alert(
              'Pairing Successful!',
              `Phone A (${res.device.pairedWithId}) has successfully paired with this receiver.`,
              [{ text: 'Go to Receiver Mode', onPress: () => router.replace('/receiver') }]
            );
          }
        }
      } catch {
        // Ignore network hiccups while polling
      }
    }, 2000);

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
          'Receiver Phone B',
          creds.deviceId || undefined,
          creds.deviceToken || undefined
        );
      } catch (err: any) {
        if (
          err.message?.includes('Invalid receiver credentials') ||
          err.message?.includes('401')
        ) {
          // Stale credentials from prior server run; clear credentials and retry fresh
          await StorageService.clearCredentials();
          result = await ApiClient.startPairing(
            creds.serverUrl,
            'Receiver Phone B'
          );
        } else {
          throw err;
        }
      }

      // Save receiver credentials locally
      await StorageService.saveCredentials({
        role: 'receiver',
        deviceId: result.receiverDevice.id,
        deviceToken: result.receiverDevice.token || creds.deviceToken,
        serverUrl: result.serverUrl
      });

      // Construct compact QR payload with single-use pairing token
      const qrData = JSON.stringify({
        s: result.serverUrl,
        t: result.pairingToken
      });

      setPairingPayload(qrData);
      setExpiresAt(result.expiresAt);
      setTimeLeft(Math.floor((result.expiresAt - Date.now()) / 1000));
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
    try {
      const result = await ApiClient.completePairing(serverUrl, token, 'Sender Phone A');

      // Save sender credentials locally
      await StorageService.saveCredentials({
        role: 'sender',
        deviceId: result.senderDevice.id,
        deviceToken: result.senderDevice.token,
        pairedWithId: result.senderDevice.pairedWithReceiverId,
        serverUrl
      });

      Alert.alert(
        'Pairing Successful',
        'This device is now securely paired as Sender (Phone A).',
        [{ text: 'Go to Sender Dashboard', onPress: () => router.replace('/sender') }]
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
      // If plain token format
      if (data.length >= 16) {
        StorageService.getCredentials().then((creds) => {
          handleCompletePairing(creds.serverUrl, data);
        });
        return;
      }
    }

    Alert.alert('Invalid QR Code', 'This QR code is not an OTP Bridge pairing code.');
    setScanned(false);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Tabs */}
      <View style={styles.tabsRow}>
        <PrimaryButton
          title="Display QR (Receiver)"
          onPress={() => setActiveTab('generate')}
          variant={activeTab === 'generate' ? 'primary' : 'outline'}
          style={styles.tabBtn}
        />
        <PrimaryButton
          title="Scan QR (Sender)"
          onPress={() => setActiveTab('scan')}
          variant={activeTab === 'scan' ? 'primary' : 'outline'}
          style={styles.tabBtn}
        />
      </View>

      {/* Mode 1: Generate QR (Receiver Phone B) */}
      {activeTab === 'generate' && (
        <Card style={styles.centerCard}>
          <Text style={styles.cardTitle}>Receiver Pairing Display</Text>
          <Text style={styles.cardSubtitle}>
            Scan this QR code with Phone A (Sender) to establish an authenticated, single-use binding.
          </Text>

          {generating ? (
            <View style={styles.qrPlaceholder}>
              <ActivityIndicator size="large" color="#2563EB" />
              <Text style={styles.mutedText}>Generating secure pairing session...</Text>
            </View>
          ) : pairingPayload && timeLeft > 0 ? (
            <View style={styles.qrContainer}>
              <View style={styles.qrWrapper}>
                <QRCode value={pairingPayload} size={220} />
              </View>
              <View style={styles.timerRow}>
                <StatusBadge
                  label={`Expires in: ${Math.floor(timeLeft / 60)}m ${timeLeft % 60}s`}
                  variant={timeLeft > 60 ? 'info' : 'warning'}
                />
              </View>
              <Text style={styles.expiryHint}>
                Single-use token expires automatically to prevent replay attacks.
              </Text>
            </View>
          ) : (
            <View style={styles.emptySession}>
              <Text style={styles.emptyText}>
                {timeLeft === 0 && pairingPayload
                  ? 'Pairing session expired. Generate a new session to continue.'
                  : 'Tap below to create a fresh pairing session.'}
              </Text>
              <PrimaryButton
                title="Create New Pairing Session"
                onPress={handleStartPairingSession}
                variant="primary"
              />
            </View>
          )}

          {pairingPayload && timeLeft > 0 && (
            <PrimaryButton
              title="Regenerate Pairing Code"
              onPress={handleStartPairingSession}
              variant="outline"
              style={{ marginTop: 12 }}
            />
          )}
        </Card>
      )}

      {/* Mode 2: Scan QR with Camera (Sender Phone A) */}
      {activeTab === 'scan' && (
        <Card>
          <Text style={styles.cardTitle}>Scan Receiver QR Code</Text>
          <Text style={styles.cardSubtitle}>
            Point your camera at the QR code displayed on Phone B (Receiver).
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
                title="Use Manual Code Input Instead"
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
                  <Text style={styles.cameraOverlayText}>Completing pairing...</Text>
                </View>
              )}
            </View>
          )}

          {permission?.granted && (
            <PrimaryButton
              title="Enter Code Manually"
              onPress={() => setActiveTab('manual')}
              variant="outline"
              style={{ marginTop: 12 }}
            />
          )}
        </Card>
      )}

      {/* Mode 3: Manual Code Fallback */}
      {activeTab === 'manual' && (
        <Card>
          <Text style={styles.cardTitle}>Manual Code Entry</Text>
          <Text style={styles.cardSubtitle}>
            Fallback in case camera is unavailable. Enter the server URL and the high-entropy pairing token.
          </Text>

          <Text style={styles.inputLabel}>Backend Server URL</Text>
          <TextInput
            style={styles.input}
            placeholder="http://192.168.1.X:4000"
            placeholderTextColor="#94A3B8"
            value={manualServerUrl}
            onChangeText={setManualServerUrl}
            autoCapitalize="none"
          />

          <Text style={styles.inputLabel}>Pairing Token</Text>
          <TextInput
            style={styles.input}
            placeholder="Paste raw pairing token..."
            placeholderTextColor="#94A3B8"
            value={manualToken}
            onChangeText={setManualToken}
            autoCapitalize="none"
          />

          <PrimaryButton
            title={completing ? 'Pairing...' : 'Complete Pairing'}
            onPress={() => handleCompletePairing(manualServerUrl, manualToken)}
            loading={completing}
          />
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
    paddingBottom: 40
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12
  },
  tabBtn: {
    flex: 1,
    marginVertical: 0
  },
  centerCard: {
    alignItems: 'center'
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 16,
    textAlign: 'center',
    lineHeight: 18
  },
  qrContainer: {
    alignItems: 'center',
    paddingVertical: 12
  },
  qrWrapper: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  timerRow: {
    marginTop: 16
  },
  expiryHint: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 8,
    textAlign: 'center'
  },
  emptySession: {
    alignItems: 'center',
    paddingVertical: 20
  },
  emptyText: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 16,
    textAlign: 'center'
  },
  qrPlaceholder: {
    paddingVertical: 40,
    alignItems: 'center'
  },
  mutedText: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 12
  },
  permissionBox: {
    paddingVertical: 20,
    alignItems: 'center'
  },
  permissionText: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    marginBottom: 16
  },
  cameraContainer: {
    height: 300,
    borderRadius: 16,
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
    marginTop: 12,
    marginBottom: 4
  },
  input: {
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A'
  }
});
