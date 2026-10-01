// `expo/config-plugins`, not `@expo/config-plugins`: it resolves to the copy that
// belongs to the project's Expo SDK, so the plugin never runs against a
// different version from the one driving prebuild. `expo` is an optional peer
// dependency for that reason.
const {
  createRunOncePlugin,
  withInfoPlist,
  withPodfile,
  WarningAggregator,
} = require('expo/config-plugins');

const pkg = require('../package.json');
const { addModularHeaders } = require('./modularHeaders');
const {
  reversedClientId,
  GOOGLE_CLIENT_SUFFIX,
} = require('./reversedClientId');

/** Lets `pod install` integrate GoogleSignIn's Swift dependencies. */
const withModularHeaders = (config) =>
  withPodfile(config, (cfg) => {
    const updated = addModularHeaders(cfg.modResults.contents);
    if (updated === null) {
      WarningAggregator.addWarningIOS(
        pkg.name,
        'Could not find a `target` block in the Podfile, so modular headers were ' +
          'not enabled for GoogleUtilities, RecaptchaInterop and AppCheckCore. ' +
          '`pod install` will fail until you add them by hand — see the README.'
      );
    } else {
      cfg.modResults.contents = updated;
    }
    return cfg;
  });

/**
 * Prepares the iOS project: enables modular headers for GoogleSignIn's Swift
 * dependencies and registers the reversed-client-ID URL scheme. Android needs
 * nothing: Credential Manager identifies the app by package name and signing
 * certificate, so there is no manifest entry to inject.
 */
const withGoogleCredentialManager = (baseConfig, props = {}) => {
  const { iosClientId, webClientId } = props;
  const config = withModularHeaders(baseConfig);

  if (!iosClientId) {
    WarningAggregator.addWarningIOS(
      pkg.name,
      'No `iosClientId` was passed to the config plugin, so no URL scheme was ' +
        'registered. iOS sign-in will fail until you add one — see the README.'
    );
    return config;
  }

  const scheme = reversedClientId(iosClientId);
  if (!scheme) {
    throw new Error(
      `[${pkg.name}] "${iosClientId}" does not look like an iOS OAuth client ID. ` +
        `Expected it to end with "${GOOGLE_CLIENT_SUFFIX}". Note this must be the ` +
        'iOS client, not the web client.'
    );
  }

  return withInfoPlist(config, (cfg) => {
    const infoPlist = cfg.modResults;

    infoPlist.CFBundleURLTypes = infoPlist.CFBundleURLTypes || [];
    const alreadyRegistered = infoPlist.CFBundleURLTypes.some(
      (entry) =>
        Array.isArray(entry.CFBundleURLSchemes) &&
        entry.CFBundleURLSchemes.includes(scheme)
    );
    if (!alreadyRegistered) {
      infoPlist.CFBundleURLTypes.push({ CFBundleURLSchemes: [scheme] });
    }

    // Not read by this library, which configures GIDSignIn from JS — but the SDK
    // and various debugging tools look them up, and their presence makes a
    // misconfigured build visible in the built Info.plist. Trimmed, like the
    // scheme above, so a stray newline from a `.env` file cannot make the two
    // disagree.
    infoPlist.GIDClientID = iosClientId.trim();
    if (typeof webClientId === 'string' && webClientId.trim()) {
      infoPlist.GIDServerClientID = webClientId.trim();
    }

    return cfg;
  });
};

module.exports = createRunOncePlugin(
  withGoogleCredentialManager,
  pkg.name,
  pkg.version
);
