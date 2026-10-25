import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Switch,
  ActivityIndicator,
  TouchableOpacity,
  Alert
} from 'react-native';
import { getInstalledApplications, InstalledAppInfo } from '../modules/notification-listener';
import { StorageService } from '../services/storage';
import { carrierRegistry, CarrierRegistrySnapshot } from '../services/carrier-registry';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { PrimaryButton } from '../components/PrimaryButton';

export default function SelectAppsScreen() {
  const [apps, setApps] = useState<InstalledAppInfo[]>([]);
  const [registrySnapshot, setRegistrySnapshot] = useState<CarrierRegistrySnapshot | null>(null);
  const [forwardAllCarriers, setForwardAllCarriers] = useState<boolean>(true);
  const [selectedTargetPackages, setSelectedTargetPackages] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshingDefault, setRefreshingDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [installedApps, snapshot, forwardAll, storedTargetApps] = await Promise.all([
        getInstalledApplications(),
        carrierRegistry.refresh(),
        StorageService.isForwardAllCarriers(),
        StorageService.getTargetApps()
      ]);

      setApps(installedApps);
      setRegistrySnapshot(snapshot);
      setForwardAllCarriers(forwardAll);
      setSelectedTargetPackages(new Set(storedTargetApps.map((a) => a.packageName)));
    } catch {
      // Fallback defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefreshDefaultSms = async () => {
    setRefreshingDefault(true);
    try {
      const snapshot = await carrierRegistry.refresh();
      setRegistrySnapshot(snapshot);
      if (snapshot.defaultSms) {
        Alert.alert(
          'Default SMS Detected',
          `Current default SMS application: ${snapshot.defaultSms.appName} (${snapshot.defaultSms.packageName})`
        );
      } else {
        Alert.alert('No Default SMS', 'Could not detect an active default SMS application on this device.');
      }
    } catch {
      Alert.alert('Error', 'Failed to refresh default SMS status');
    } finally {
      setRefreshingDefault(false);
    }
  };

  const handleToggleDefaultSms = async (enabled: boolean) => {
    await carrierRegistry.setDefaultSmsEnabled(enabled);
    setRegistrySnapshot(carrierRegistry.getSnapshot());
  };

  const handleToggleOtherSms = async (packageName: string, enabled: boolean) => {
    await carrierRegistry.setOtherSmsEnabled(packageName, enabled);
    setRegistrySnapshot(carrierRegistry.getSnapshot());
  };

  const handleToggleGmail = async (enabled: boolean) => {
    await carrierRegistry.setGmailEnabled(enabled);
    setRegistrySnapshot(carrierRegistry.getSnapshot());
  };

  const toggleTargetPackage = (pkgName: string) => {
    setSelectedTargetPackages((prev) => {
      const next = new Set(prev);
      if (next.has(pkgName)) {
        next.delete(pkgName);
      } else {
        next.add(pkgName);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const targetAppsToSave = apps
        .filter((a) => selectedTargetPackages.has(a.packageName))
        .map((a) => ({ packageName: a.packageName, appName: a.appName }));

      const activeCarriers = carrierRegistry.getActivePackageNames();

      await Promise.all([
        StorageService.setCarrierPackages(activeCarriers),
        StorageService.setForwardAllCarriers(forwardAllCarriers),
        StorageService.setTargetApps(targetAppsToSave)
      ]);

      Alert.alert(
        'Configuration Saved',
        `${activeCarriers.length} active carriers enabled. ${targetAppsToSave.length} target services selected.`
      );
    } catch {
      Alert.alert('Error', 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const filteredApps = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return apps;
    return apps.filter(
      (app) =>
        app.appName.toLowerCase().includes(q) ||
        app.packageName.toLowerCase().includes(q)
    );
  }, [apps, searchQuery]);

  const defaultSms = registrySnapshot?.defaultSms;
  const otherSmsList = registrySnapshot?.otherSms || [];
  const gmailInfo = registrySnapshot?.gmail;
  const activeCarrierCount = registrySnapshot?.activePackages.size || 0;

  const renderHeader = () => (
    <View>
      {/* Top Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Carrier & Service Architecture</Text>
        <Text style={styles.subtitle}>
          Configure dynamic message carriers (Default SMS, secondary SMS apps, and Gmail) and target services for OTP extraction.
        </Text>
      </View>

      {/* SECTION 1: Default SMS App */}
      <View style={styles.sectionContainer}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>1. Default SMS Application</Text>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={handleRefreshDefaultSms}
            disabled={refreshingDefault}
          >
            <Text style={styles.refreshBtnText}>
              {refreshingDefault ? 'Scanning...' : '↻ Refresh'}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionDesc}>
          Automatically resolved from Android's default SMS role. The active default SMS application receives priority routing.
        </Text>

        {defaultSms ? (
          <Card style={styles.defaultCarrierCard}>
            <View style={styles.appRow}>
              <View style={styles.appInfo}>
                <View style={styles.carrierTitleRow}>
                  <Text style={styles.appName}>{defaultSms.appName}</Text>
                  <StatusBadge
                    label={defaultSms.enabled ? 'ACTIVE' : 'DISABLED'}
                    variant={defaultSms.enabled ? 'success' : 'neutral'}
                  />
                </View>
                <Text style={styles.pkgName} numberOfLines={1}>
                  {defaultSms.packageName}
                </Text>
                <Text style={styles.limitationNote}>
                  Role: System Default SMS Handler • Dynamic Resolution
                </Text>
              </View>
              <Switch
                value={defaultSms.enabled}
                onValueChange={handleToggleDefaultSms}
                trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
                thumbColor={defaultSms.enabled ? '#2563EB' : '#94A3B8'}
              />
            </View>
          </Card>
        ) : (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              No default SMS application detected. Tap Refresh after setting your default SMS app in Android Settings.
            </Text>
          </Card>
        )}
      </View>

      {/* SECTION 2: Other SMS Apps */}
      <View style={styles.sectionContainer}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>2. Other SMS Applications</Text>
          <View style={styles.carrierCountBadge}>
            <Text style={styles.carrierCountText}>
              {otherSmsList.filter((a) => a.enabled).length} of {otherSmsList.length} enabled
            </Text>
          </View>
        </View>
        <Text style={styles.sectionDesc}>
          Eligible SMS and messaging apps discovered on this device. Enable individual apps you use to receive OTPs:
        </Text>

        {otherSmsList.length > 0 ? (
          otherSmsList.map((carrier) => (
            <Card key={carrier.packageName} style={styles.otherCarrierCard}>
              <View style={styles.appRow}>
                <View style={styles.appInfo}>
                  <Text style={styles.appName}>{carrier.appName}</Text>
                  <Text style={styles.pkgName} numberOfLines={1}>
                    {carrier.packageName}
                  </Text>
                  <Text style={styles.limitationNote}>
                    {carrier.limitations}
                  </Text>
                </View>
                <Switch
                  value={carrier.enabled}
                  onValueChange={(val) => handleToggleOtherSms(carrier.packageName, val)}
                  trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
                  thumbColor={carrier.enabled ? '#2563EB' : '#94A3B8'}
                />
              </View>
            </Card>
          ))
        ) : (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              No secondary SMS applications detected on this device.
            </Text>
          </Card>
        )}
      </View>

      {/* SECTION 3: Gmail */}
      <View style={styles.sectionContainer}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>3. Gmail Integration</Text>
          {gmailInfo ? (
            <StatusBadge
              label={gmailInfo.enabled ? 'ENABLED' : 'DISABLED'}
              variant={gmailInfo.enabled ? 'success' : 'neutral'}
            />
          ) : (
            <StatusBadge label="NOT INSTALLED" variant="warning" />
          )}
        </View>
        <Text style={styles.sectionDesc}>
          Extracts OTP verification codes from incoming Gmail notifications.
        </Text>

        {gmailInfo ? (
          <Card style={styles.gmailCard}>
            <View style={styles.appRow}>
              <View style={styles.appInfo}>
                <Text style={styles.appName}>Gmail</Text>
                <Text style={styles.pkgName}>com.google.android.gm</Text>
                <Text style={styles.limitationNote}>
                  Processes accessible notification text only. No mailbox OAuth, credentials, or Google account permissions required.
                </Text>
              </View>
              <Switch
                value={gmailInfo.enabled}
                onValueChange={handleToggleGmail}
                trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
                thumbColor={gmailInfo.enabled ? '#2563EB' : '#94A3B8'}
              />
            </View>
          </Card>
        ) : (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              Gmail is not installed on this device.
            </Text>
          </Card>
        )}

        {/* Forward All Switch Card */}
        <Card style={styles.forwardAllCard}>
          <View style={styles.appRow}>
            <View style={styles.appInfo}>
              <Text style={styles.forwardAllTitle}>Forward all OTPs from active carriers</Text>
              <Text style={styles.forwardAllSubtitle}>
                {forwardAllCarriers
                  ? 'All verified OTPs from active carriers will be forwarded to Phone B.'
                  : 'Only OTPs matching your selected target services below will be forwarded.'}
              </Text>
            </View>
            <Switch
              value={forwardAllCarriers}
              onValueChange={setForwardAllCarriers}
              trackColor={{ false: '#CBD5E1', true: '#86EFAC' }}
              thumbColor={forwardAllCarriers ? '#16A34A' : '#94A3B8'}
            />
          </View>
        </Card>
      </View>

      {/* SECTION 4: Target Services / Specific Apps */}
      <View style={styles.sectionContainer}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>4. Target Services & Applications</Text>
          <View style={styles.targetCountBadge}>
            <Text style={styles.targetCountText}>
              {selectedTargetPackages.size} selected
            </Text>
          </View>
        </View>
        <Text style={styles.sectionDesc}>
          Select specific services (e.g. Swiggy, Uber, Amazon, Banking apps) if you want to forward OTPs only for specific applications.
        </Text>

        <TextInput
          style={styles.searchInput}
          placeholder="Search installed apps (e.g. Amazon, Uber, Bank)..."
          placeholderTextColor="#94A3B8"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={styles.summaryBar}>
          <Text style={styles.summaryText}>
            Showing {filteredApps.length} installed apps
          </Text>
          {selectedTargetPackages.size > 0 ? (
            <TouchableOpacity onPress={() => setSelectedTargetPackages(new Set())}>
              <Text style={styles.clearText}>Clear Selected</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={styles.loadingText}>Scanning dynamic carrier registry...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredApps}
          keyExtractor={(item) => item.packageName}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={renderHeader}
          renderItem={({ item }) => {
            const isSelected = selectedTargetPackages.has(item.packageName);
            return (
              <Card style={styles.appCard}>
                <View style={styles.appRow}>
                  <View style={styles.appInfo}>
                    <Text style={styles.appName}>{item.appName}</Text>
                    <Text style={styles.pkgName} numberOfLines={1}>
                      {item.packageName}
                    </Text>
                    {item.isSystemApp ? (
                      <Text style={styles.systemBadge}>System App</Text>
                    ) : null}
                  </View>
                  <Switch
                    value={isSelected}
                    onValueChange={() => toggleTargetPackage(item.packageName)}
                    trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
                    thumbColor={isSelected ? '#2563EB' : '#94A3B8'}
                  />
                </View>
              </Card>
            );
          }}
        />
      )}

      {/* Floating Save Button */}
      <View style={styles.footer}>
        <PrimaryButton
          title={
            saving
              ? 'Saving Configuration...'
              : `Save Configuration (${activeCarrierCount} Carriers Active)`
          }
          onPress={handleSave}
          loading={saving}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC'
  },
  header: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0'
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A'
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
    lineHeight: 18
  },
  sectionContainer: {
    marginTop: 16,
    paddingHorizontal: 16
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B'
  },
  sectionDesc: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 10,
    lineHeight: 17
  },
  refreshBtn: {
    backgroundColor: '#EFF6FF',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#BFDBFE'
  },
  refreshBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563EB'
  },
  carrierCountBadge: {
    backgroundColor: '#EFF6FF',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2
  },
  carrierCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB'
  },
  targetCountBadge: {
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2
  },
  targetCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155'
  },
  defaultCarrierCard: {
    marginVertical: 4,
    padding: 14,
    borderLeftWidth: 4,
    borderLeftColor: '#2563EB',
    backgroundColor: '#FFFFFF'
  },
  otherCarrierCard: {
    marginVertical: 4,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#64748B',
    backgroundColor: '#FFFFFF'
  },
  gmailCard: {
    marginVertical: 4,
    padding: 14,
    borderLeftWidth: 4,
    borderLeftColor: '#EA4335',
    backgroundColor: '#FFFFFF'
  },
  emptyCard: {
    marginVertical: 4,
    padding: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed'
  },
  emptyText: {
    fontSize: 12,
    color: '#64748B',
    fontStyle: 'italic',
    lineHeight: 18
  },
  limitationNote: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 4,
    lineHeight: 15
  },
  carrierTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  forwardAllCard: {
    marginTop: 12,
    marginBottom: 4,
    padding: 14,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0'
  },
  forwardAllTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#166534'
  },
  forwardAllSubtitle: {
    fontSize: 12,
    color: '#15803D',
    marginTop: 2,
    lineHeight: 16
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
    marginTop: 6
  },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 6
  },
  summaryText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B'
  },
  clearText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#DC2626'
  },
  listContent: {
    paddingBottom: 90
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  loadingText: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 12
  },
  appCard: {
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 12
  },
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  appInfo: {
    flex: 1,
    paddingRight: 12
  },
  appName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1E293B'
  },
  pkgName: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2
  },
  systemBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginTop: 4
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0'
  }
});
