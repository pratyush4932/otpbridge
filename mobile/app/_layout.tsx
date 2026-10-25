import React, { useEffect } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { notificationPipeline } from '../services/notification-pipeline';
import { receiverSocketClient } from '../services/receiver-socket';
import { StorageService } from '../services/storage';

function HeaderTitleWithLogo() {
  return (
    <View style={headerStyles.container}>
      <Image
        source={require('../assets/otpbridge.png')}
        style={headerStyles.logo}
        resizeMode="contain"
      />
      <Text style={headerStyles.title}>OTP Bridge</Text>
    </View>
  );
}

export default function RootLayout() {
  useEffect(() => {
    StorageService.getCredentials().then((creds) => {
      if (creds.role === 'sender') {
        notificationPipeline.start();
      } else if (
        creds.role === 'receiver' &&
        creds.serverUrl &&
        creds.deviceId &&
        creds.deviceToken
      ) {
        receiverSocketClient.connect(creds.serverUrl, creds.deviceId, creds.deviceToken);
      }
    });
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: '#FFFFFF'
          },
          headerTintColor: '#0F172A',
          headerTitle: () => <HeaderTitleWithLogo />,
          headerShadowVisible: false,
          contentStyle: {
            backgroundColor: '#F8FAFC'
          }
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            headerTitle: () => <HeaderTitleWithLogo />,
            headerLargeTitle: false
          }}
        />
        <Stack.Screen
          name="sender"
          options={{
            headerTitle: () => <HeaderTitleWithLogo />
          }}
        />
        <Stack.Screen
          name="receiver"
          options={{
            headerTitle: () => <HeaderTitleWithLogo />
          }}
        />
        <Stack.Screen
          name="select-apps"
          options={{
            headerTitle: () => <HeaderTitleWithLogo />
          }}
        />
        <Stack.Screen
          name="pairing"
          options={{
            headerTitle: () => <HeaderTitleWithLogo />
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            headerTitle: () => <HeaderTitleWithLogo />
          }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}

const headerStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  logo: {
    width: 26,
    height: 26,
    marginRight: 8
  },
  title: {
    fontWeight: '700',
    fontSize: 18,
    color: '#0F172A',
    letterSpacing: -0.3
  }
});
