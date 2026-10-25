import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  TouchableOpacity
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StorageService, AppCredentials, DEFAULT_SERVER_URL } from '../services/storage';
import { ApiClient } from '../services/api';
import { sessionHistoryService } from '../services/session-history';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { PrimaryButton } from '../components/PrimaryButton';

export default function SettingsScreen() {
  const router = useRouter();
  const [credentials, setCredentials] = useState<AppCredentials | null>(null);
  const [serverUrl, setServerUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const load = useCallback(async () => {
    const creds = await StorageService.getCredentials();
    setCredentials(creds);
    setServerUrl((prev) => (prev ? prev : creds.serverUrl || DEFAULT_SERVER_URL));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    load();
    const interval = setInterval(() => {
      load();
    }, 3000);
    return () => clearInterval(interval);
  }, [load]);

  const handleTestConnection = async () => {
    setTesting(true);
    const ok = await ApiClient.checkHealth(serverUrl);
    setTesting(false);

    if (ok) {
      Alert.alert('Connection Successful', `Connected to server:\n${serverUrl}`);
    } else {
      Alert.alert(
        'Connection Failed',
        `Unable to reach server at:\n${serverUrl}\n\nEnsure your relay server is running and accessible over your local network or Tailscale.`
      );
    }
  };

  const handleSaveServerUrl = async () => {
    setSaving(true);
    const cleaned = serverUrl.trim().replace(/\/+$/, '');
    await StorageService.saveCredentials({ serverUrl: cleaned });
    setServerUrl(cleaned);
    setSaving(false);
    Alert.alert('Saved', 'Server URL updated successfully.');
  };

  const handleRevokeDevice = () => {
    Alert.alert(
      'Revoke Device Credentials',
      'This will unlink this device and delete all local credentials. You will need to re-pair to resume forwarding.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke and Reset',
          style: 'destructive',
          onPress: async () => {
            setRevoking(true);
            try {
              if (credentials?.deviceId && credentials?.deviceToken) {
                await ApiClient.revokeDevice(
                  credentials.serverUrl,
                  credentials.deviceId,
                  credentials.deviceToken
                );
              }
            } catch {
              // Ignore network errors on local wipe
            } finally {
              await sessionHistoryService.recordEvent(
                'device_unlinked',
                'Device unlinked',
                'Credentials revoked and local identity cleared'
              );
              await sessionHistoryService.recordEvent(
                'session_ended',
                'Session ended',
                'Pairing session terminated by user reset'
              );
              await StorageService.clearCredentials();
              setRevoking(false);
              Alert.alert('Device Reset', 'All credentials cleared.');
              router.replace('/');
            }
          }
        }
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Server Configuration */}
      <Card>
        <Text style={styles.cardTitle}>Backend Relay Server</Text>
        <Text style={styles.cardSubtitle}>
          Configure your self-hosted Fastify server URL.
        </Text>

        <Text style={styles.inputLabel}>Server URL</Text>
        <TextInput
          style={styles.input}
          placeholder="http://192.168.1.X:4000"
          placeholderTextColor="#94A3B8"
          value={serverUrl}
          onChangeText={setServerUrl}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={styles.btnRow}>
          <PrimaryButton
            title={testing ? 'Testing...' : 'Test Connection'}
            onPress={handleTestConnection}
            variant="secondary"
            loading={testing}
            style={styles.halfBtn}
          />
          <PrimaryButton
            title={saving ? 'Saving...' : 'Save URL'}
            onPress={handleSaveServerUrl}
            variant="primary"
            loading={saving}
            style={styles.halfBtn}
          />
        </View>
      </Card>

      {/* Device Identity */}
      <Card>
        <Text style={styles.cardTitle}>Device Identity</Text>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Configured Role</Text>
          <StatusBadge
            label={credentials?.role ? credentials.role.toUpperCase() : 'UNASSIGNED'}
            variant={credentials?.role ? 'info' : 'neutral'}
          />
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Pairing Status</Text>
          <StatusBadge
            label={credentials?.pairedWithId ? 'PAIRED' : 'UNPAIRED'}
            variant={credentials?.pairedWithId ? 'success' : 'warning'}
          />
        </View>

        {/* Expandable Advanced Diagnostics Toggle */}
        <TouchableOpacity
          style={styles.diagnosticsToggle}
          onPress={() => setShowDiagnostics(!showDiagnostics)}
          activeOpacity={0.7}
        >
          <Text style={styles.diagnosticsToggleText}>
            {showDiagnostics ? 'Hide Advanced Diagnostics' : 'Show Advanced Diagnostics'}
          </Text>
          <Ionicons
            name={showDiagnostics ? 'chevron-up-outline' : 'chevron-down-outline'}
            size={16}
            color="#2563EB"
          />
        </TouchableOpacity>

        {showDiagnostics && (
          <View style={styles.diagnosticsBox}>
            <View style={styles.diagRow}>
              <Text style={styles.diagLabel}>Device ID:</Text>
              <Text style={styles.diagValue} numberOfLines={1}>
                {credentials?.deviceId || 'Not generated'}
              </Text>
            </View>
            <View style={styles.diagRow}>
              <Text style={styles.diagLabel}>Partner ID:</Text>
              <Text style={styles.diagValue} numberOfLines={1}>
                {credentials?.pairedWithId || 'None'}
              </Text>
            </View>
            <View style={styles.diagRow}>
              <Text style={styles.diagLabel}>Security Keystore:</Text>
              <Text style={styles.diagValue}>Android Keystore Active</Text>
            </View>
          </View>
        )}
      </Card>

      {/* Revocation & Danger Zone */}
      <Card style={styles.dangerCard}>
        <Text style={styles.dangerTitle}>Security Reset</Text>
        <Text style={styles.dangerDesc}>
          Unlink this device and clear all cryptographic keys from secure storage.
        </Text>

        <PrimaryButton
          title={revoking ? 'Revoking...' : 'Revoke & Clear Credentials'}
          onPress={handleRevokeDevice}
          variant="danger"
          loading={revoking}
          style={{ marginVertical: 0 }}
        />
      </Card>
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
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 10
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 4
  },
  input: {
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
    marginBottom: 10
  },
  btnRow: {
    flexDirection: 'row',
    gap: 8
  },
  halfBtn: {
    flex: 1,
    marginVertical: 0
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9'
  },
  infoLabel: {
    fontSize: 13,
    color: '#475569'
  },
  diagnosticsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    paddingBottom: 4
  },
  diagnosticsToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563EB'
  },
  diagnosticsBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  diagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4
  },
  diagLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500'
  },
  diagValue: {
    fontSize: 12,
    color: '#0F172A',
    fontWeight: '600',
    maxWidth: 180
  },
  dangerCard: {
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    padding: 14
  },
  dangerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#991B1B',
    marginBottom: 4
  },
  dangerDesc: {
    fontSize: 13,
    color: '#B91C1C',
    lineHeight: 18,
    marginBottom: 12
  }
});
