import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, ViewStyle } from 'react-native';

interface AppIconProps {
  icon?: string;
  appName: string;
  size?: number;
  style?: ViewStyle;
}

export function AppIcon({ icon, appName, size = 40, style }: AppIconProps) {
  const [imageError, setImageError] = useState(false);

  const initial = (appName.trim().charAt(0) || 'A').toUpperCase();
  const borderRadius = Math.round(size * 0.22);

  // If icon is provided as valid data URI or URL and has not errored
  if (icon && icon.trim().length > 0 && !imageError) {
    return (
      <View
        style={[
          styles.iconContainer,
          { width: size, height: size, borderRadius },
          style
        ]}
      >
        <Image
          source={{ uri: icon }}
          style={{ width: size, height: size, borderRadius }}
          resizeMode="cover"
          onError={() => setImageError(true)}
        />
      </View>
    );
  }

  // Consistent fallback monogram with clean modern utility aesthetics
  return (
    <View
      style={[
        styles.fallbackContainer,
        { width: size, height: size, borderRadius },
        style
      ]}
    >
      <Text style={[styles.fallbackText, { fontSize: Math.round(size * 0.44) }]}>
        {initial}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    backgroundColor: '#F1F5F9',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  fallbackContainer: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    alignItems: 'center',
    justifyContent: 'center'
  },
  fallbackText: {
    color: '#1D4ED8',
    fontWeight: '700'
  }
});
