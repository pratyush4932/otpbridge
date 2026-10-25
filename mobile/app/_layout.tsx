import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { notificationPipeline } from '../services/notification-pipeline';
import { StorageService } from '../services/storage';

export default function RootLayout() {
  useEffect(() => {
    StorageService.getCredentials().then((creds) => {
      if (creds.role === 'sender') {
        notificationPipeline.start();
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
          headerTitleStyle: {
            fontWeight: '700',
            fontSize: 18
          },
          headerShadowVisible: false,
          contentStyle: {
            backgroundColor: '#F8FAFC'
          }
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: 'OTP Bridge',
            headerLargeTitle: false
          }}
        />
        <Stack.Screen
          name="sender"
          options={{
            title: 'Sender (Phone A)'
          }}
        />
        <Stack.Screen
          name="receiver"
          options={{
            title: 'Receiver (Phone B)'
          }}
        />
        <Stack.Screen
          name="select-apps"
          options={{
            title: 'Allowed Applications'
          }}
        />
        <Stack.Screen
          name="pairing"
          options={{
            title: 'Device Pairing'
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            title: 'Settings'
          }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
