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
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getInstalledApplications, InstalledAppInfo } from '../modules/notification-listener';
import { StorageService } from '../services/storage';
import { carrierRegistry, CarrierRegistrySnapshot } from '../services/carrier-registry';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { PrimaryButton } from '../components/PrimaryButton';
import { AppIcon } from '../components/AppIcon';
import { EmptyState } from '../components/EmptyState';

type ActiveTab = 'carriers' | 'targets';

export default function SelectAppsScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [activeTab, setActiveTab] = useState<ActiveTab>(
    params.tab === 'targets' ? 'targets' : 'carriers'
  );

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
      // Fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

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
          `${snapshot.defaultSms.appName} (${snapshot.defaultSms.packageName})`
        );
      } else {
        Alert.alert('No Default SMS', 'No active default SMS application detected on this device.');
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

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={styles.loadingText}>Scanning eligible applications...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Segmented Tab Switcher */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'carriers' && styles.tabItemActive]}
          onPress={() => setActiveTab('carriers')}
          activeOpacity={0.8}
        >
          <Text
            style={[styles.tabText, activeTab === 'carriers' && styles.tabTextActive]}
          >
            Carriers ({activeCarrierCount} Active)
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'targets' && styles.tabItemActive]}
          onPress={() => setActiveTab('targets')}
          activeOpacity={0.8}
        >
          <Text
            style={[styles.tabText, activeTab === 'targets' && styles.tabTextActive]}
          >
            Target Apps ({selectedTargetPackages.size})
          </Text>
        </TouchableOpacity>
      </View>

      {/* TAB 1: CARRIERS */}
      {activeTab === 'carriers' && (
        <FlatList
          data={[1]} // single scroll container
          keyExtractor={() => 'carriers_list'}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.carrierContent}
          renderItem={() => (
            <View>
              {/* Section 1: Default SMS */}
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>1. Default SMS Application</Text>
                <TouchableOpacity
                  style={styles.refreshBtn}
                  onPress={handleRefreshDefaultSms}
                  disabled={refreshingDefault}
                >
                  <Ionicons
                    name="refresh-outline"
                    size={14}
                    color="#2563EB"
                    style={{ marginRight: 4 }}
                  />
                  <Text style={styles.refreshBtnText}>
                    {refreshingDefault ? 'Scanning...' : 'Refresh'}
                  </Text>
                </TouchableOpacity>
              </View>

              {defaultSms ? (
                <Card style={styles.carrierCard}>
                  <View style={styles.appRow}>
                    <AppIcon
                      icon={defaultSms.icon}
                      appName={defaultSms.appName}
                      size={44}
                    />
                    <View style={styles.appInfo}>
                      <View style={styles.titleRow}>
                        <Text style={styles.appName} numberOfLines={1}>
                          {defaultSms.appName}
                        </Text>
                        <StatusBadge
                          label={defaultSms.enabled ? 'ACTIVE' : 'OFF'}
                          variant={defaultSms.enabled ? 'success' : 'neutral'}
                        />
                      </View>
                      <Text style={styles.roleSubtext}>Default System SMS</Text>
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
                    No default SMS app detected. Set one in Android Settings.
                  </Text>
                </Card>
              )}

              {/* Section 2: Other SMS Apps */}
              <View style={[styles.sectionHeader, { marginTop: 16 }]}>
                <Text style={styles.sectionTitle}>2. Other SMS Applications</Text>
                <StatusBadge
                  label={`${otherSmsList.filter((a) => a.enabled).length} Enabled`}
                  variant="neutral"
                />
              </View>

              {otherSmsList.length > 0 ? (
                otherSmsList.map((carrier) => (
                  <Card key={carrier.packageName} style={styles.carrierCard}>
                    <View style={styles.appRow}>
                      <AppIcon
                        icon={carrier.icon}
                        appName={carrier.appName}
                        size={44}
                      />
                      <View style={styles.appInfo}>
                        <Text style={styles.appName} numberOfLines={1}>
                          {carrier.appName}
                        </Text>
                        <Text style={styles.roleSubtext}>Secondary SMS</Text>
                      </View>
                      <Switch
                        value={carrier.enabled}
                        onValueChange={(val) =>
                          handleToggleOtherSms(carrier.packageName, val)
                        }
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

              {/* Section 3: Gmail */}
              <View style={[styles.sectionHeader, { marginTop: 16 }]}>
                <Text style={styles.sectionTitle}>3. Gmail Integration</Text>
                <StatusBadge
                  label={
                    gmailInfo
                      ? gmailInfo.enabled
                        ? 'ACTIVE'
                        : 'OFF'
                      : 'NOT INSTALLED'
                  }
                  variant={gmailInfo?.enabled ? 'success' : 'neutral'}
                />
              </View>

              {gmailInfo ? (
                <Card style={styles.carrierCard}>
                  <View style={styles.appRow}>
                    <AppIcon
                      icon={gmailInfo.icon}
                      appName="Gmail"
                      size={44}
                    />
                    <View style={styles.appInfo}>
                      <Text style={styles.appName}>Gmail</Text>
                      <Text style={styles.roleSubtext}>Notification Listener text only</Text>
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
                  <Text style={styles.emptyText}>Gmail is not installed on this device.</Text>
                </Card>
              )}

              {/* Forward All Carriers Toggle */}
              <Card style={styles.forwardAllCard}>
                <View style={styles.appRow}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={styles.forwardAllTitle}>
                      Forward all OTPs from active carriers
                    </Text>
                    <Text style={styles.forwardAllSubtitle}>
                      {forwardAllCarriers
                        ? 'All verified OTPs from active carriers will be forwarded.'
                        : 'Only OTPs matching your selected target apps will be forwarded.'}
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
          )}
        />
      )}

      {/* TAB 2: TARGET APPLICATIONS */}
      {activeTab === 'targets' && (
        <View style={{ flex: 1 }}>
          {/* Stable Search Input Bar - NEVER UNMOUNTS */}
          <View style={styles.searchBarContainer}>
            <View style={styles.searchBox}>
              <Ionicons
                name="search-outline"
                size={18}
                color="#64748B"
                style={styles.searchIcon}
              />
              <TextInput
                style={styles.searchInput}
                placeholder="Search installed applications..."
                placeholderTextColor="#94A3B8"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity
                  onPress={() => setSearchQuery('')}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={styles.clearBtn}
                >
                  <Ionicons name="close-circle" size={18} color="#94A3B8" />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.filterMetaRow}>
              <Text style={styles.filterMetaText}>
                {filteredApps.length} of {apps.length} applications
              </Text>
              {selectedTargetPackages.size > 0 && (
                <TouchableOpacity
                  onPress={() => setSelectedTargetPackages(new Set())}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.clearSelectedText}>Deselect All</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Installed Apps List */}
          <FlatList
            data={filteredApps}
            keyExtractor={(item) => item.packageName}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.appsListContent}
            initialNumToRender={15}
            maxToRenderPerBatch={20}
            windowSize={10}
            ListEmptyComponent={
              <EmptyState
                title="No applications found"
                description={
                  searchQuery.trim().length > 0
                    ? `No apps matching "${searchQuery.trim()}".`
                    : 'No eligible applications discovered.'
                }
                iconName="search-outline"
              />
            }
            renderItem={({ item }) => {
              const isSelected = selectedTargetPackages.has(item.packageName);
              return (
                <Card style={styles.appCard}>
                  <View style={styles.appRow}>
                    <AppIcon
                      icon={item.icon}
                      appName={item.appName}
                      size={42}
                    />
                    <View style={styles.appInfo}>
                      <Text style={styles.appName} numberOfLines={1}>
                        {item.appName}
                      </Text>
                      {item.isSystemApp && (
                        <Text style={styles.systemTag}>System App</Text>
                      )}
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
        </View>
      )}

      {/* Floating Save Footer */}
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
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8
  },
  tabItem: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent'
  },
  tabItemActive: {
    borderBottomColor: '#2563EB'
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B'
  },
  tabTextActive: {
    color: '#2563EB',
    fontWeight: '700'
  },
  carrierContent: {
    padding: 16,
    paddingBottom: 90
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B'
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#BFDBFE'
  },
  refreshBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563EB'
  },
  carrierCard: {
    marginVertical: 4,
    padding: 12
  },
  forwardAllCard: {
    marginTop: 14,
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
    fontStyle: 'italic'
  },
  searchBarContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0'
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  searchIcon: {
    marginRight: 8
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    height: '100%'
  },
  clearBtn: {
    padding: 4
  },
  filterMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8
  },
  filterMetaText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500'
  },
  clearSelectedText: {
    fontSize: 12,
    color: '#DC2626',
    fontWeight: '600'
  },
  appsListContent: {
    padding: 16,
    paddingBottom: 90
  },
  appCard: {
    marginVertical: 4,
    padding: 12
  },
  appRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  appInfo: {
    flex: 1,
    marginLeft: 12,
    paddingRight: 8
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  appName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1E293B'
  },
  roleSubtext: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2
  },
  systemTag: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC'
  },
  loadingText: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 12
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
