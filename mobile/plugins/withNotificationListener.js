const { withAndroidManifest } = require('@expo/config-plugins');

function withNotificationListener(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults.manifest;

    // Ensure permissions
    if (!androidManifest['uses-permission']) {
      androidManifest['uses-permission'] = [];
    }

    const permissionsToAdd = [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.CAMERA'
    ];

    for (const perm of permissionsToAdd) {
      const exists = androidManifest['uses-permission'].some(
        (p) => p.$ && p.$['android:name'] === perm
      );
      if (!exists) {
        androidManifest['uses-permission'].push({
          $: { 'android:name': perm }
        });
      }
    }

    // Add queries for launcher intent so installed apps can be discovered on Android 11+ (API 30+)
    if (!androidManifest.queries) {
      androidManifest.queries = [];
    }
    const hasIntentQuery = androidManifest.queries.some(
      (q) => q.intent && q.intent.some(
        (i) => i.action && i.action.some((a) => a.$ && a.$['android:name'] === 'android.intent.action.MAIN')
      )
    );
    if (!hasIntentQuery) {
      androidManifest.queries.push({
        intent: [
          {
            action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
            category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }]
          }
        ]
      });
    }

    // Find <application> tag
    const app = androidManifest.application && androidManifest.application[0];
    if (app) {
      if (!app.service) {
        app.service = [];
      }

      const serviceName = 'expo.modules.notificationlistener.BridgeNotificationListenerService';
      const serviceExists = app.service.some(
        (s) => s.$ && s.$['android:name'] === serviceName
      );

      if (!serviceExists) {
        app.service.push({
          $: {
            'android:name': serviceName,
            'android:label': 'OTP Bridge Notification Listener',
            'android:permission': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
            'android:exported': 'true'
          },
          'intent-filter': [
            {
              action: [
                {
                  $: {
                    'android:name': 'android.service.notification.NotificationListenerService'
                  }
                }
              ]
            }
          ]
        });
      }
    }

    return config;
  });
}

module.exports = withNotificationListener;
