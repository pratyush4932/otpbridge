import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export type BadgeVariant = 'success' | 'warning' | 'error' | 'neutral' | 'info';

interface StatusBadgeProps {
  label: string;
  variant?: BadgeVariant;
}

export function StatusBadge({ label, variant = 'neutral' }: StatusBadgeProps) {
  const badgeStyles = {
    success: { bg: '#DCFCE7', text: '#166534', dot: '#22C55E' },
    warning: { bg: '#FEF9C3', text: '#854D0E', dot: '#EAB308' },
    error: { bg: '#FEE2E2', text: '#991B1B', dot: '#EF4444' },
    info: { bg: '#DBEAFE', text: '#1E40AF', dot: '#3B82F6' },
    neutral: { bg: '#F1F5F9', text: '#475569', dot: '#94A3B8' }
  }[variant];

  return (
    <View style={[styles.badge, { backgroundColor: badgeStyles.bg }]}>
      <View style={[styles.dot, { backgroundColor: badgeStyles.dot }]} />
      <Text style={[styles.text, { color: badgeStyles.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: 'flex-start'
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2
  }
});
