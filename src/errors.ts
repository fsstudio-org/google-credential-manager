/**
 * Error codes are a contract shared by the two native modules, this facade and
 * the tables in README.md and AGENTS.md. Adding a code means adding it here
 * too — the remedy is what turns a stack trace into something actionable
 * without leaving the log, which is most of what a reader (human or agent)
 * gets from a field report.
 */

export interface Remedy {
  /** Why this happened, in the terms the caller can check. */
  cause: string;
  /** What to do about it. Concrete enough to act on without further lookup. */
  fix: string;
}

export const DOCS_URL =
  'https://github.com/fsstudio-org/google-credential-manager/blob/main/AGENTS.md';

export const ERROR_REMEDIES: Record<string, Remedy> = {
  NOT_CONFIGURED: {
    cause:
      'configure() has not run, or it was given an invalid value (empty webClientId, missing ' +
      'iosClientId on iOS, a scope that is not a non-empty string). On iOS it is also raised ' +
      'when the URL scheme for iosClientId is not registered in Info.plist.',
    fix:
      'Call GoogleCredentialLogin.configure({ webClientId, iosClientId }) once at startup, ' +
      'before any other method. webClientId is the *Web* OAuth client — the Android and iOS ' +
      'client IDs will not work in its place. On iOS also register the reversed-client-ID URL ' +
      'scheme: the Expo config plugin does it at prebuild (list the package in `plugins` with ' +
      'iosClientId, then run `npx expo prebuild`); a bare app adds it to Info.plist by hand.',
  },
  IN_PROGRESS: {
    cause:
      'A sign-in or authorization request is still pending; the module serves one at a time ' +
      '(on iOS that includes signInSilently()).',
    fix:
      'Disable the button while the promise is in flight, and do not call signIn() from an ' +
      'effect that can re-run on render.',
  },
  SIGN_IN_CANCELLED: {
    cause: 'The user dismissed the sheet or chooser.',
    fix:
      'Not a failure — return quietly. Do not show an alert and do not retry automatically; ' +
      'a retry loop re-opens the sheet the user just closed.',
  },
  SIGN_IN_FAILED: {
    cause:
      'The native SDK failed for a reason it did not classify further. The wrapped cause has the ' +
      'detail. On iOS this also covers network and token-endpoint failures, including from ' +
      'signInSilently(), where it says nothing about whether a session exists.',
    fix:
      'On Android the usual reason is a certificate the OAuth client does not know: register ' +
      'the SHA-1 of every keystore you sign with — debug, upload and Play App Signing — on the ' +
      'Android OAuth client. This is the classic "works in debug, fails in production" cause. ' +
      'Run `adb logcat -s ReactNativeJS:V GoogleCredentialMgr:V` for the underlying exception.',
  },
  PARSE_ERROR: {
    cause:
      'The native payload could not be read, or the ID token had no decodable `sub` claim.',
    fix:
      'Usually a JS/native version mismatch. Rebuild the app after upgrading the package — ' +
      'reloading Metro does not relink native code. If it persists on a fresh build, report it ' +
      'with the ID token header (never the whole token).',
  },
  NO_CREDENTIAL: {
    cause:
      'Nothing to return: no previous session to restore (signInSilently(); on iOS also a ' +
      'stored session whose refresh token was revoked or expired), or no Google account on the ' +
      'device (signIn(), after its chooser fallback also found nothing).',
    fix:
      'Expected on first launch — show your sign-in screen. For signIn() the chooser fallback ' +
      'has already run, so the device has no usable Google account: ask the user to add one in ' +
      'system settings, or offer another sign-in method.',
  },
  HOSTED_DOMAIN_MISMATCH: {
    cause:
      "The chosen account's `hd` claim does not match the configured hostedDomain, or it has " +
      'no `hd` claim at all, as a personal Gmail address does.',
    fix:
      'Sign in with an account in that Workspace domain. After sign-in both platforms compare ' +
      "the ID token's `hd` claim, ignoring case. Android also filters up front in the explicit " +
      'chooser (signInWithChooser(), and signIn() after its fallback) and on the consent ' +
      'screen, but the first bottom sheet of signIn() and signInSilently() cannot filter, and ' +
      'iOS only passes the domain to Google as a hint. Verify `hd` on your backend either ' +
      'way — client-side checks are UX, not security.',
  },
  AUTHORIZATION_FAILED: {
    cause:
      "Google's Authorization API failed, or completed without issuing an access token.",
    fix:
      'Check that every scope is a full URL (https://www.googleapis.com/auth/…), that the API ' +
      'is enabled in Cloud Console, and that the OAuth consent screen lists the scope. ' +
      'Sensitive scopes need app verification before users outside your test list can grant them.',
  },
  AUTHORIZATION_CANCELLED: {
    cause: 'The user dismissed the consent screen.',
    fix:
      'Treat as a no-op and leave the feature unavailable. Check grantedScopes before calling ' +
      'the API you wanted — users can decline individual scopes while granting others.',
  },
  REVOKE_FAILED: {
    cause:
      'The OAuth grant could not be revoked: the library did not know which account to revoke ' +
      '(signOut() forgets it, and none could be found without showing UI), consent would have ' +
      "been required, or Google's revoke call failed. Local credential state was cleared either " +
      'way.',
    fix:
      'Call revokeAccess() while the user is still signed in — before signOut() — so the ' +
      'account is known. If an account-deletion flow depends on it, also revoke server-side ' +
      'with the refresh token: that is the only path that does not depend on the device.',
  },
  NOT_SIGNED_IN: {
    cause: 'requestAuthorization() was called before anyone signed in (iOS).',
    fix: 'Await signIn() or signInSilently() first, then request the extra scopes.',
  },
  AUTHORIZATION_REQUIRED: {
    cause:
      'Consent was needed where it could not be shown: revokeAccess() looking up the account, ' +
      'or signInSilently() requesting tokens. Neither opens a consent screen unprompted (Android).',
    fix:
      'Internal, and normally not seen by callers: revokeAccess() reports it as REVOKE_FAILED, ' +
      'and signInSilently() absorbs it and resolves the user without accessToken or ' +
      'serverAuthCode. Call requestAuthorization() from a user gesture to obtain them.',
  },
  NO_ACTIVITY: {
    cause:
      'No usable Activity was available — none yet, or it is finishing or destroyed. Called ' +
      'before the first screen, from the background, or across a configuration change (Android).',
    fix:
      'Call from a mounted screen, not from a module body, a headless task, or a push handler. ' +
      'If it happens on rotation, the Activity was recreated mid-flow; retry.',
  },
  REQUEST_BUILD_FAILED: {
    cause:
      'The credential or authorization request could not be assembled, usually a version skew ' +
      'between androidx.credentials and googleid (Android).',
    fix:
      'Do not override the versions this library pins in android/build.gradle from your app, ' +
      'then clean and rebuild.',
  },
  UNEXPECTED_CREDENTIAL: {
    cause:
      'Credential Manager returned a credential that was not a Google ID token — a passkey or ' +
      'saved password from another provider (Android).',
    fix:
      'Expected if your app registers other credential options against the same request. If it ' +
      'does not, report it with the credential type from the message.',
  },
  SIGN_IN_INTERRUPTED: {
    cause:
      'A transient interruption — the credential provider restarted, or the React context was ' +
      'torn down mid-request.',
    fix: 'Retryable. Retry once on an explicit user action rather than automatically.',
  },
  PROVIDER_CONFIGURATION_ERROR: {
    cause:
      'No working credential provider: Play services missing, disabled or out of date (Android).',
    fix:
      'Have the user update Google Play services. Devices without Google services cannot run ' +
      'this flow at all — offer another sign-in method rather than retrying.',
  },
  UNSUPPORTED: {
    cause:
      'The native module is not linked in this app (Expo Go, web, or a build made before the ' +
      'package was installed), or Credential Manager is unavailable on this device (Android).',
    fix:
      'Use a development build, not Expo Go, and rebuild the native app after installing the ' +
      'package (`npx expo prebuild`, then `npx expo run:android` or `run:ios`). If it is a ' +
      'device limitation, hide the Google button and fall back to another sign-in method.',
  },
  VIEW_CONTROLLER_MISSING: {
    cause:
      'No presenting UIViewController was found — the key window had no root when the call was ' +
      'made (iOS).',
    fix:
      'Call from a mounted screen rather than during module initialisation. If it happens on a ' +
      'cold start, defer one tick and retry.',
  },
  NO_USER: {
    cause: 'GIDSignIn completed with neither an error nor a user (iOS).',
    fix: 'Should not happen — please report it with the GoogleSignIn pod version.',
  },
  NO_ID_TOKEN: {
    cause:
      'Sign-in succeeded but Google issued no ID token, which normally means serverClientID was ' +
      'not set (iOS).',
    fix:
      'Make sure webClientId is passed to configure() — it becomes serverClientID — and that a ' +
      'Web OAuth client exists in the same Cloud project as the iOS client.',
  },
  UNKNOWN: {
    cause: 'The failure carried no recognised error code.',
    fix:
      'Inspect `error.cause` for the original rejection and report it — an unrecognised code ' +
      'means the native side rejected with something this table does not know about yet.',
  },
};

function describe(code: string, message: string): string {
  const remedy = ERROR_REMEDIES[code];
  if (!remedy) return message;
  return (
    `${message}\n` +
    `→ Cause: ${remedy.cause}\n` +
    `→ Fix: ${remedy.fix}\n` +
    `→ Docs: ${DOCS_URL}#${code.toLowerCase()}`
  );
}

// `cause` is declared here rather than inherited because the inherited one only
// exists under `lib: es2022`, and the emitted declarations are read under each
// consumer's own `lib`.
export interface GoogleCredentialLoginError {
  cause?: unknown;
}

export class GoogleCredentialLoginError extends Error {
  public readonly code: string;
  /** The remedy for {@link code}, also appended to `message`. */
  public readonly hint?: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    // Not `super(message, options)`: that form needs an ES2022 `Error`, and a
    // silently dropped `cause` is exactly what this class exists to prevent.
    super(describe(code, message));
    // Keeps `instanceof` working when Error subclasses are transpiled.
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'GoogleCredentialLoginError';
    this.code = code;
    if (options && 'cause' in options) {
      Object.defineProperty(this, 'cause', {
        value: options.cause,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
    const remedy = ERROR_REMEDIES[code];
    if (remedy) this.hint = `${remedy.cause} ${remedy.fix}`;
  }
}

/**
 * React Native rejects native promises with a plain `Error` carrying a `code`
 * property, so without this every native failure would arrive as something
 * `instanceof GoogleCredentialLoginError` is false for — which is exactly the
 * check the docs tell callers to write.
 */
export function normalizeError(error: unknown): GoogleCredentialLoginError {
  if (error instanceof GoogleCredentialLoginError) return error;

  const code = (error as { code?: unknown } | null)?.code;
  const message =
    error instanceof Error ? error.message : String(error ?? 'Unknown error');

  return new GoogleCredentialLoginError(
    typeof code === 'string' && code ? code : 'UNKNOWN',
    message,
    { cause: error }
  );
}
