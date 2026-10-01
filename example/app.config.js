// Client IDs come from the environment so this file stays free of anything
// account-specific. Copy .env.example to .env and fill it in.
const iosClientId = process.env.EXPO_PUBLIC_IOS_CLIENT_ID;
const webClientId = process.env.EXPO_PUBLIC_WEB_CLIENT_ID;

module.exports = {
  expo: {
    name: 'GCM Example',
    slug: 'gcm-example',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      bundleIdentifier: 'studio.funstuff.gcmexample',
      supportsTablet: true,
    },
    android: {
      package: 'studio.funstuff.gcmexample',
    },
    plugins: [
      [
        '@fsstudio-org/google-credential-manager',
        {
          iosClientId,
          webClientId,
        },
      ],
    ],
    extra: {
      iosClientId,
      webClientId,
    },
  },
};
