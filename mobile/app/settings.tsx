import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert
} from 'react-native';
import { useRouter } from 'expo-router';
import { StorageService, AppCredentials, DEFAULT_SERVER_URL } from '../services/storage';
import { ApiClient } from '../services/api';
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

  useEffect(() => {
    async function load() {
      const creds = await StorageService.getCredentials();
      setCredentials(creds);
      setServerUrl(creds.serverUrl || DEFAULT_SERVER_URL);
    }
    load();
  }, []);

  const handleTestConnection = async () => {
    setTesting(true);
    const ok = await ApiClient.checkHealth(serverUrl);
    setTesting(false);

    if (ok) {
      Alert.alert('Connection Successful', `Successfully connected to relay server at:\n${serverUrl}`);
    } else {
      Alert.alert(
        'Connection Failed',
        `Unable to reach server at:\n${serverUrl}\n\nPlease check that your server is running and accessible over your local network/Tailscale.`
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
      'This will revoke this device from the server and delete all credentials stored in Keystore. All pairings will be invalidated immediately.',
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
              await StorageService.clearCredentials();
              setRevoking(false);
              Alert.alert('Device Reset', 'All credentials revoked and cleared.');
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
          Configure your self-hosted Fastify server URL (HTTPS/WSS recommended in production).
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

      {/* Device Credentials Info */}
      <Card>
        <Text style={styles.cardTitle}>Device Identity & Keystore</Text>
        <Text style={styles.cardSubtitle}>
          Local credentials stored backed by Android Keystore.
        </Text>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Role</Text>
          <StatusBadge
            label={credentials?.role ? credentials.role.toUpperCase() : 'UNASSIGNED'}
            variant={credentials?.role ? 'info' : 'neutral'}
          />
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Device ID</Text>
          <Text style={styles.infoValue}>
            {credentials?.deviceId || 'Not generated'}
          </Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Paired Partner</Text>
          <Text style={styles.infoValue}>
            {credentials?.pairedWithId || 'None'}
          </Text>
        </View>
      </Card>

      {/* Revocation & Danger Zone */}
      <Card style={styles.dangerCard}>
        <Text style={styles.dangerTitle}>Revocation & Security Reset</Text>
        <Text style={styles.dangerDesc}>
          Revoking will immediately unlink this device and prevent any further notification forwarding or receiving.
        </Text>

        <PrimaryButton
          title={revoking ? 'Revoking...' : 'Revoke & Clear All Credentials'}
          onPress={handleRevokeDevice}
          variant="danger"
          loading={revoking}
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
    paddingBottom: 40
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 12,
    lineHeight: 18
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
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
    marginBottom: 12
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
    fontSize: 14,
    color: '#475569'
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B'
  },
  dangerCard: {
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2'
  },
  dangerTitle: {
    fontSize: 16,
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
