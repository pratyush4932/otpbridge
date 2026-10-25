import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SessionEvent, SessionEventType } from '../services/session-history';

interface SessionTimelineProps {
  events: SessionEvent[];
  style?: ViewStyle;
  limit?: number;
}

function getEventIcon(type: SessionEventType): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 'pairing_created':
      return 'qr-code-outline';
    case 'qr_generated':
    case 'qr_regenerated':
      return 'refresh-circle-outline';
    case 'pairing_attempt':
      return 'scan-outline';
    case 'pairing_completed':
      return 'checkmark-circle-outline';
    case 'connection_established':
      return 'link-outline';
    case 'connection_lost':
      return 'cloud-offline-outline';
    case 'connection_restored':
      return 'cloud-done-outline';
    case 'pairing_expired':
      return 'time-outline';
    case 'device_unlinked':
    case 'session_ended':
      return 'unlink-outline';
    default:
      return 'information-circle-outline';
  }
}

function getEventColor(status: 'success' | 'warning' | 'error' | 'info') {
  switch (status) {
    case 'success':
      return { icon: '#16A34A', bg: '#DCFCE7', line: '#BBF7D0' };
    case 'warning':
      return { icon: '#D97706', bg: '#FEF9C3', line: '#FDE68A' };
    case 'error':
      return { icon: '#DC2626', bg: '#FEE2E2', line: '#FECACA' };
    default:
      return { icon: '#2563EB', bg: '#EFF6FF', line: '#BFDBFE' };
  }
}

function formatEventTime(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) {
    return `Today, ${timeStr}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();

  if (isYesterday) {
    return `Yesterday, ${timeStr}`;
  }

  const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${dateStr}, ${timeStr}`;
}

export function SessionTimeline({ events, style, limit }: SessionTimelineProps) {
  const displayEvents = limit ? events.slice(0, limit) : events;

  if (displayEvents.length === 0) {
    return (
      <View style={[styles.emptyContainer, style]}>
        <Ionicons name="git-commit-outline" size={24} color="#94A3B8" />
        <Text style={styles.emptyTitle}>No session events recorded yet</Text>
        <Text style={styles.emptyDesc}>
          Events will appear here as pairing actions and connection state changes occur.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      {displayEvents.map((item, index) => {
        const isLast = index === displayEvents.length - 1;
        const colors = getEventColor(item.status);
        const iconName = getEventIcon(item.type);

        return (
          <View key={item.id} style={styles.timelineRow}>
            {/* Left Node & Vertical Connector Line */}
            <View style={styles.nodeColumn}>
              <View style={[styles.iconCircle, { backgroundColor: colors.bg }]}>
                <Ionicons name={iconName} size={16} color={colors.icon} />
              </View>
              {!isLast && <View style={styles.connectingLine} />}
            </View>

            {/* Right Event Content */}
            <View style={[styles.contentColumn, !isLast && styles.contentSpacing]}>
              <View style={styles.titleRow}>
                <Text style={styles.eventTitle}>{item.title}</Text>
                <Text style={styles.eventTime}>{formatEventTime(item.timestamp)}</Text>
              </View>

              {item.detail ? (
                <Text style={styles.eventDetail}>{item.detail}</Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4
  },
  timelineRow: {
    flexDirection: 'row'
  },
  nodeColumn: {
    alignItems: 'center',
    width: 32,
    marginRight: 10
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1
  },
  connectingLine: {
    flex: 1,
    width: 2,
    backgroundColor: '#E2E8F0',
    marginVertical: 4
  },
  contentColumn: {
    flex: 1,
    paddingTop: 2
  },
  contentSpacing: {
    paddingBottom: 16
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  eventTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
    flex: 1,
    marginRight: 8
  },
  eventTime: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500'
  },
  eventDetail: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 16
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    marginTop: 8
  },
  emptyDesc: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16
  }
});
