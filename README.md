# @fsstudio-org/google-credential-manager

[![CI](https://github.com/fsstudio-org/google-credential-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/fsstudio-org/google-credential-manager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Sign in with Google for React Native — **Android via [Jetpack Credential Manager](https://developer.android.com/identity/sign-in/credential-manager-siwg)**, **iOS via [GoogleSignIn-iOS](https://github.com/google/GoogleSignIn-iOS)**. One JS API, two native back-ends, one payload shape.

Returns a Google ID token you hand straight to your backend (Supabase, Firebase, your own server) for verification.

```sh
npm install @fsstudio-org/google-credential-manager
```

> **Read this before you depend on it.** This library was vibe-coded: written
> almost entirely by AI coding agents ([Claude Code](https://claude.com/claude-code))
> and checked against Google's SDK headers and documentation. The Android
> sign-in path has been tested on a device. **iOS has not been tested on a
> device at all**, and three Android APIs have not been either. See
> [platform status](#platform-status).
>
> If something behaves oddly, it is probably a real bug.
> [Open an issue](https://github.com/fsstudio-org/google-credential-manager/issues);
> bug reports are the most useful contribution right now.
>
> Every rejection's `message` and `hint` state the likely cause and the fix, and
> [AGENTS.md](AGENTS.md) documents each error code for agents and humans alike.

## Why another one

Google has [deprecated](https://developer.android.com/identity/sign-in/legacy-gsi-migration) the legacy Google Sign-In for Android (`GoogleSignInClient`, in `play-services-auth`) in favour of Credential Manager, and plans to remove it in a future release.

- **`id` is the OIDC `sub` claim on both platforms.** On Android, the credential's `.id` field is the user's *email*. Email is mutable, so it is a poor primary key. This module decodes the ID token to read `sub`.
- **Both Credential Manager flows.** `GetGoogleIdOption` for the one-tap bottom sheet *and* `GetSignInWithGoogleOption` for the branded chooser, with an automatic fallback between them. On Android 14+ with several Google accounts on the device, the bottom sheet can fail with a [`TransactionTooLargeException`](#signinwithchooser) on older Play services; the chooser is not affected.

## Platform status

What has been tested. "It compiles" is not the same as "it works":

| | Status |
|---|---|
| **Android** — `signIn`, `signInWithChooser`, `signOut` | **Tested on an Android device.** |
| **Android** — `signInSilently`, `requestAuthorization`, `revokeAccess` | Compiles in CI. **Not yet exercised on a device.** Verification protocol: [docs/manual-verification.md](docs/manual-verification.md) |
| **iOS** — everything | **Not tested on a device.** The code follows the GoogleSignIn 9.x headers, but nobody has run it yet |

The JS facade has full unit coverage, and CI compiles the example app for both Android and iOS on every pull request and every push to `main`. A CI runner cannot complete a Google consent screen, so none of that shows that a sign-in sheet appears. That is why the table is split by platform and method.

iOS reports are especially welcome. If you hit something, [open an issue](https://github.com/fsstudio-org/google-credential-manager/issues) — a stack trace and your `configure()` call (minus the client IDs) is enough to start. If you have a device and want to help close a row of this table, [docs/manual-verification.md](docs/manual-verification.md) is a paste-ready protocol for doing it.

## Requirements

| | Minimum |
|---|---|
| React Native | 0.83 (New Architecture only — Legacy was removed in RN 0.82). `peerDependencies` enforces `>=0.83.0` |
| Android | minSdk 24, Play services on device |
| iOS | 15.1 (React Native 0.83's own floor, which the podspec inherits), GoogleSignIn `~> 9.0` (pinned by the podspec) |

Native dependency versions are pinned in the library, not your app: `androidx.credentials:1.6.0`, `googleid:1.1.1`, `play-services-auth:21.4.0` in [android/build.gradle](android/build.gradle).

This library contains native code, so it does **not** run in Expo Go. Use a [development build](https://docs.expo.dev/develop/development-builds/introduction/).

## Google Cloud setup

You need up to three OAuth clients in [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials):

| Client type | Needed for | Where it goes |
|---|---|---|
| **Web** | Both platforms | `configure({ webClientId })` |
| **Android** | Android | Nowhere in code — register your package name + SHA-1 on it |
| **iOS** | iOS | `configure({ iosClientId })` and the URL scheme |

The **web** client ID is what you pass as `webClientId` on both platforms. On Android it's Credential Manager's `serverClientId`; on iOS it becomes `GIDConfiguration.serverClientID`, which the GoogleSignIn headers document as becoming the ID token's `aud` claim. That's deliberate — your backend verifies one audience regardless of platform.

Register the SHA-1 of **every** keystore you sign with on the Android client: debug, upload, and Play App Signing. A missing Play App Signing SHA-1 is the classic "works in debug, fails in production" cause.

## Setup

### Expo

Add the config plugin to your `app.json` / `app.config.js`:

```js
{
  "plugins": [
    [
      "@fsstudio-org/google-credential-manager",
      {
        "iosClientId": "YOUR_IOS_CLIENT_ID.apps.googleusercontent.com",
        "webClientId": "YOUR_WEB_CLIENT_ID.apps.googleusercontent.com"
      }
    ]
  ]
}
```

Then `npx expo prebuild`. The plugin registers the reversed-client-ID URL scheme in `Info.plist`, records the client IDs there, and enables modular headers for the Swift pods GoogleSignIn depends on (see [Bare React Native](#bare-react-native) for why). Android needs nothing — Credential Manager identifies your app by package name and signing certificate, not by a manifest entry.

Re-run `prebuild` after changing the client IDs; they're baked in at prebuild time. The plugin only ever adds a scheme, so after *changing* `iosClientId` use `npx expo prebuild --clean` or the old scheme stays registered.

### Bare React Native

Android needs no manual setup. On iOS you need two things before `pod install`.

**1. Modular headers for GoogleSignIn's Swift dependencies.** GoogleSignIn 9 depends on a Swift pod (`AppCheckCore`) that imports `GoogleUtilities` and `RecaptchaInterop`, which do not define modules. In a static-library build, which is the default, `pod install` then fails with "The following Swift pods cannot yet be integrated as static libraries". Add these lines inside your app target in `ios/Podfile`:

```ruby
target 'YourApp' do
  pod 'GoogleUtilities', :modular_headers => true
  pod 'RecaptchaInterop', :modular_headers => true
  pod 'AppCheckCore', :modular_headers => true
  # ... the rest of your target
end
```

If your app already uses `use_frameworks!` or `use_modular_headers!`, you can skip this. If it also uses react-native-firebase, check [its notes on static libraries](https://github.com/invertase/react-native-firebase/issues/6332) first, because enabling modular headers can conflict with Firebase pods.

**2. The URL scheme**, added to `Info.plist`:

```xml
<!-- ios/<YourApp>/Info.plist -->
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>com.googleusercontent.apps.YOUR_IOS_CLIENT_ID</string>
    </array>
  </dict>
</array>
```

That's the **iOS** client ID reversed — `123-abc.apps.googleusercontent.com` becomes `com.googleusercontent.apps.123-abc`. It must match the `iosClientId` you pass to `configure()`, or the OAuth redirect has nowhere to land. If the scheme is missing, sign-in rejects with `NOT_CONFIGURED` and names the scheme it expected, instead of crashing the app.

## Usage

```ts
import {
  GoogleCredentialLogin,
  GoogleCredentialLoginError,
  type User,
} from '@fsstudio-org/google-credential-manager';

// 1. Configure once at app startup.
GoogleCredentialLogin.configure({
  webClientId: 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com',
  iosClientId: 'YOUR_IOS_CLIENT_ID.apps.googleusercontent.com', // required on iOS
});

// 2. Try to restore an existing session before showing a login screen.
async function restoreSession(): Promise<User | null> {
  try {
    return await GoogleCredentialLogin.signInSilently();
  } catch (err) {
    if (
      err instanceof GoogleCredentialLoginError &&
      err.code === 'NO_CREDENTIAL'
    ) {
      return null; // Expected on first run — show the login screen.
    }
    throw err; // Anything else is a real failure, not "no session".
  }
}

// 3. Sign in, from a button handler.
async function onSignInPress(): Promise<User | null> {
  try {
    // Verify user.idToken on your backend, e.g. supabase.auth.signInWithIdToken.
    return await GoogleCredentialLogin.signIn();
  } catch (err) {
    if (
      err instanceof GoogleCredentialLoginError &&
      err.code === 'SIGN_IN_CANCELLED'
    ) {
      return null; // The user dismissed the sheet; not an error.
    }
    throw err;
  }
}

// 4. Sign out (local only), or revoke (drops the OAuth grant entirely). Revoke
// first: once you have signed out, the account is forgotten.
async function onDisconnectPress(): Promise<void> {
  await GoogleCredentialLogin.revokeAccess();
  await GoogleCredentialLogin.signOut();
}
```

A runnable version of all of the above is in [example/](example/).

### `User`

```ts
interface User {
  idToken: string;            // The JWT to verify on your backend.
  id: string;                 // OIDC `sub` — stable per-account identifier.
  email: string;              // Display only; users can change it.
  displayName?: string;
  givenName?: string;
  familyName?: string;
  profilePictureUri?: string;
  phoneNumber?: string;       // Android only.
  serverAuthCode?: string;    // With `offlineAccess`. See the note below.
  accessToken?: string;       // With `scopes`.
  grantedScopes?: string[];   // With `scopes`.
}
```

## API

### `configure(config)`

Returns immediately and is safe to call more than once. Must precede every other method except `signOut()`. There is nothing to await: the native side applies the config asynchronously, but always before any call you make after this one.

Invalid values throw a `GoogleCredentialLoginError` with code `NOT_CONFIGURED` here, before anything reaches native code: a non-string ID, a non-boolean flag, or a scope that is not a non-empty string. String values are trimmed, so a stray newline from a `.env` file does no harm.

```ts
configure(config: {
  webClientId: string;
  iosClientId?: string;              // Required on iOS.
  nonce?: string;                    // Replay protection; your server must validate it.
  filterByAuthorizedAccounts?: boolean; // Android-only. Default true.
  hostedDomain?: string;             // Restrict to a Workspace domain.
  offlineAccess?: boolean;           // Request a serverAuthCode.
  forceCodeForRefreshToken?: boolean; // Android-only. Reissue a refresh token even if already consented. Needs offlineAccess.
  scopes?: string[];                 // Additional OAuth scopes.
}): void
```

A `nonce` is fixed when `configure()` runs and reused for every sign-in after it, so on its own it does not stop a replayed token. If you need a fresh nonce per attempt, call `configure()` again with a new value before each sign-in.

### `signIn()`

The Credential Manager bottom sheet on Android, falling back to the branded chooser when no authorized credential exists. The GoogleSignIn browser flow on iOS.

### `signInWithChooser()`

Same contract, but **always** the branded chooser. Use it behind an explicit "Sign in with Google" button, or to work around the `TransactionTooLargeException` crash `GetGoogleIdOption` can hit on Android 14+ when many Google accounts are on the device ([b/341690734](https://developer.android.com/identity/sign-in/credential-manager-troubleshooting-guide), fixed in Play services 24.40+). Ignores `filterByAuthorizedAccounts` and never auto-selects.

On iOS this is identical to `signIn()` — GIDSignIn always shows the chooser.

### `signInSilently()`

Restores a session with no user gesture. Rejects `NO_CREDENTIAL` when there's nothing to restore — that's the "show the login screen" path, not an error.

**This is not equally silent on both platforms.** iOS uses `restorePreviousSignIn` and shows nothing. On Android, Credential Manager decides: with one authorized account it auto-selects, but with several it may still present the one-tap sheet. Android has no truly headless variant.

Neither platform opens a consent screen from here. If `scopes` or `offlineAccess` need consent that has not been given, Android resolves the user **without** `accessToken` / `serverAuthCode` rather than interrupting a session restore; call `requestAuthorization()` from a user gesture to get them.

On iOS, only a missing stored session (or one whose refresh token Google has rejected) is `NO_CREDENTIAL`. A network failure comes back as `SIGN_IN_FAILED`, which says nothing about whether a session exists, so don't clear your app's session on it.

### `requestAuthorization(scopes)`

Incremental consent for additional scopes, resolving `{ accessToken, grantedScopes, serverAuthCode? }`. Also how you refresh an expired access token — they last about an hour and nothing refreshes them for you.

Check `grantedScopes` before calling the API you wanted. Users can decline individual scopes.

### `signOut()`

Clears local state — the credential provider cache on Android, `GIDSignIn.signOut()` on iOS. Best-effort, always resolves. **Does not revoke the OAuth grant**, and forgets which account was signed in, so call `revokeAccess()` *before* it, not after.

It also settles anything in flight: a pending sign-in rejects `SIGN_IN_CANCELLED` and a pending authorization rejects `AUTHORIZATION_CANCELLED`, rather than being left hanging or resolving after the session ended.

### `revokeAccess()`

Revokes the grant, so the next sign-in shows the consent screen again. This is what a "disconnect" or "delete my account" flow needs. Call it while the user is still signed in.

iOS calls `GIDSignIn.disconnect`, which is a true revoke. With nothing stored to revoke it signs out and resolves.

Android uses the Authorization API's own revoke, which drops every scope granted to your app for that account and clears its cached tokens. It needs the account: the one that signed in, or one Google can name without showing any UI. It needs Play services and network access. On failure it rejects with `REVOKE_FAILED` on both platforms; local credential state is still cleared, but the grant may survive, so **revoke server-side with the refresh token if that matters to you**. After `signOut()`, or on a device with several Google accounts and no remembered sign-in, expect `REVOKE_FAILED`.

Like `signOut()`, it settles any sign-in or authorization still in flight.

## The branded button

```tsx
import { GoogleSignInButton } from '@fsstudio-org/google-credential-manager/button';

<GoogleSignInButton onPress={handleSignIn} />
<GoogleSignInButton onPress={handleSignIn} variant="icon" theme="dark" shape="pill" />
<GoogleSignInButton onPress={handleSignIn} size="large" label="continue" fullWidth />
```

Requires `react-native-svg` (an optional peer dependency). Prefer a recent one: 15.12.1 imports `buffer` without declaring it, which breaks the bundle under strict installs such as pnpm's unless your app adds `buffer` itself; 15.15.5 does not. It lives behind a subpath export on purpose: Metro resolves statically, so merely re-exporting it from the main entry would break the bundle for everyone who hasn't installed svg.

### Props

| Prop | Type | Default | |
|---|---|---|---|
| `onPress` | `() => void` | — | Required. |
| `variant` | `'standard' \| 'icon'` | `'standard'` | `icon` is a square, logo-only button. |
| `theme` | `'light' \| 'dark'` | `'light'` | |
| `shape` | `'rectangular' \| 'pill'` | `'rectangular'` | |
| `size` | `'small' \| 'medium' \| 'large'` | `'medium'` | 32 / 40 / 48pt tall. |
| `label` | `'signin' \| 'signup' \| 'continue'` | `'signin'` | The three strings Google permits. |
| `text` | `string` | — | Overrides the label outright. |
| `fullWidth` | `boolean` | `false` | Ignored by `variant="icon"`. |
| `style` | `StyleProp<ViewStyle>` or Pressable's function form | — | Merged over the defaults. |
| `textStyle` | `StyleProp<TextStyle>` | — | Merged over the label style. |
| `logoSize` | `number` | from `size` | |
| `logo` | `ReactNode` | the Google G | Replaces the mark. |
| `children` | `ReactNode` or `(state) => ReactNode` | — | Replaces all content, keeping the pressable surface. |

Any remaining `Pressable` prop (`onLongPress`, `hitSlop`, `testID`, accessibility props…) passes straight through.

### Building your own

The pieces are exported, so you don't have to fight the component if it doesn't fit:

```tsx
import {
  GoogleGLogo,
  googleSignInButtonThemes,
  googleSignInButtonSizes,
  googleSignInButtonLabels,
} from '@fsstudio-org/google-credential-manager/button';

<GoogleGLogo size={24} />;
googleSignInButtonThemes.dark.background; // '#131314'
```

A word of warning on all of this: the defaults follow [Google's branding guidelines](https://developers.google.com/identity/branding-guidelines), and the overrides exist because you may have a good reason. The further you drift from the defaults, the more likely OAuth verification is to object. That call is yours.

## Scopes and offline access

Worth understanding before you turn these on, because the platforms differ structurally:

**Credential Manager only ever returns an ID token.** Access tokens, additional scopes and `serverAuthCode` come from Google's separate [Authorization API](https://developer.android.com/identity/authorization) — Google's own guidance is that authentication and authorization are two distinct flows. Setting `scopes` or `offlineAccess` makes this library run that second leg after sign-in, which may show a consent screen.

Consequences:

- Android takes on a `play-services-auth` dependency. It's compiled in whether or not you use these options.
- `serverAuthCode` appears on Android **only** with `offlineAccess: true`. On iOS it comes back whenever `webClientId` is set, because the SDK returns it alongside `serverClientID`. Don't infer configuration from its presence.
- `signInSilently()` on iOS never returns `serverAuthCode` — `restorePreviousSignIn` hands back a user, not a sign-in result.
- `signInSilently()` on Android never shows consent, so it returns `accessToken` / `serverAuthCode` only when Google needs no new consent for them. With `forceCodeForRefreshToken` that is never, because it forces consent every time; use `requestAuthorization()` from a user gesture instead.
- `hostedDomain` is checked on both platforms: after every sign-in, the ID token's `hd` claim is compared with it (ignoring case), and a mismatch rejects `HOSTED_DOMAIN_MISMATCH` and leaves the user signed out. An account with no `hd` claim, such as a personal Gmail address, never matches. On Android the explicit chooser (`signInWithChooser()`, and `signIn()` after its fallback) and the consent screen also filter by domain up front; the first bottom sheet of `signIn()` / `signInSilently()` cannot, and on iOS the domain is only passed to GoogleSignIn as a hint, so on those paths the user can still pick a non-matching account and be rejected afterwards. **Verify `hd` on your backend either way** — client-side checks are UX, not security.

## Error codes

**Every rejection from every method is a `GoogleCredentialLoginError`**, including the ones that originate natively — the facade re-wraps them, preserving the native error as `.cause`. So `err instanceof GoogleCredentialLoginError` always narrows, and `.code` is the stable string to branch on.

Each error also carries its own remedy. `.hint` is the likely cause and the fix as a string, and `.message` is the native message with both appended, so a logged stack trace already tells you what to do:

```
No Google credential was available on this device
→ Cause: Nothing to return: no previous session to restore (signInSilently(); on
  iOS also a stored session whose refresh token was revoked or expired), or no
  Google account on the device (signIn(), after its chooser fallback also found
  nothing).
→ Fix: Expected on first launch — show your sign-in screen. For signIn() the
  chooser fallback has already run, so the device has no usable Google account…
→ Docs: …/AGENTS.md#no_credential
```

The long form of every entry below — with setup preconditions and the mistakes that produce them — is in [AGENTS.md](AGENTS.md).

| Code | Platform | When |
|---|---|---|
| `NOT_CONFIGURED` | Both | A method was called before `configure()`, or `configure()` got an invalid value (empty `webClientId`, missing `iosClientId` on iOS, a scope that isn't a non-empty string). On iOS also when the URL scheme for `iosClientId` isn't in `Info.plist`. |
| `IN_PROGRESS` | Both | Another request is already pending — guard against double-taps. On iOS this includes `signInSilently()`. |
| `SIGN_IN_CANCELLED` | Both | User dismissed the sheet or chooser, or `signOut()` / `revokeAccess()` cancelled it. Treat as a no-op. |
| `SIGN_IN_FAILED` | Both | Catch-all for other native sign-in failures. On iOS this includes network failures. |
| `PARSE_ERROR` | Both | Malformed native payload, or the ID token's `sub` couldn't be decoded. |
| `NO_CREDENTIAL` | Both | Nothing to restore (`signInSilently`), or no Google account and the chooser fallback also failed. |
| `HOSTED_DOMAIN_MISMATCH` | Both | The account isn't in the configured `hostedDomain`, or has no `hd` claim at all. |
| `AUTHORIZATION_FAILED` | Both | Scope authorization failed, or no access token was issued. |
| `AUTHORIZATION_CANCELLED` | Both | User dismissed the consent screen, or `signOut()` / `revokeAccess()` cancelled it. |
| `REVOKE_FAILED` | Both | The OAuth grant could not be revoked. Local state was still cleared. |
| `NOT_SIGNED_IN` | iOS | `requestAuthorization()` was called before signing in. |
| `AUTHORIZATION_REQUIRED` | Android | Consent was needed where it couldn't be shown. Normally not seen: `revokeAccess` reports it as `REVOKE_FAILED`, and `signInSilently` resolves without tokens. |
| `NO_ACTIVITY` | Android | No usable Activity: none yet, or it was finishing or destroyed. |
| `REQUEST_BUILD_FAILED` | Android | Could not assemble the request. Check your `googleid` version. |
| `UNEXPECTED_CREDENTIAL` | Android | Credential Manager returned an unexpected credential type. |
| `SIGN_IN_INTERRUPTED` | Android | Retryable transient failure. |
| `PROVIDER_CONFIGURATION_ERROR` | Android | Credential provider misconfigured or unavailable. |
| `UNSUPPORTED` | Both | The native module isn't linked (Expo Go, web, or a stale build), or Credential Manager is unavailable on this Android device. |
| `VIEW_CONTROLLER_MISSING` | iOS | No presenting `UIViewController` — usually a timing bug; retry next tick. |
| `NO_USER` | iOS | GIDSignIn completed without an error but returned no user. |
| `NO_ID_TOKEN` | iOS | Sign-in succeeded but no ID token was issued. Check that your iOS client exists alongside the web client. |
| `UNKNOWN` | Both | The rejection carried no recognised code. Inspect `.cause` and please report it — it means this table is missing an entry. |

## Development logs

In development builds (`__DEV__`) the library prints every error itself, cause and fix included, so you don't need to catch and log it to see what went wrong. Nothing is printed in production, and tokens and profile data are never logged.

- **Android:** `adb logcat -s ReactNativeJS:V GoogleCredentialMgr:V`. The `[google-credential-manager] CODE: …` line in `ReactNativeJS` carries the cause and fix; `GoogleCredentialMgr` carries the native side's own lines.
- **iOS:** the Metro terminal or the Xcode console. Native lines are prefixed `[GoogleCredentialManagerLogin]`.

Outcomes you are expected to handle (`SIGN_IN_CANCELLED`, `AUTHORIZATION_CANCELLED`, `NO_CREDENTIAL`) are logged at `log` level rather than `warn`, so dismissing the sheet doesn't raise a LogBox warning every time.

## Testing your app

The package ships compiled ES modules (`lib/module`), which Jest does not transform inside `node_modules` by default, and the native module doesn't exist under Jest. Importing it unmodified fails with "Must use import to load ES Module". Either mock the package in your tests:

```js
jest.mock('@fsstudio-org/google-credential-manager', () => ({
  GoogleCredentialLogin: {
    configure: jest.fn(),
    signIn: jest.fn(),
    signInSilently: jest.fn(),
    signInWithChooser: jest.fn(),
    requestAuthorization: jest.fn(),
    signOut: jest.fn(),
    revokeAccess: jest.fn(),
  },
  GoogleCredentialLoginError: class extends Error {},
}));
```

or, to run the real facade, let Jest transform the package and give it a fake native module:

```js
// jest.config.js — add the package to the allow-list of transformed modules.
transformIgnorePatterns: [
  'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@fsstudio-org/google-credential-manager)/)',
],
```

With pnpm the pattern also has to account for the `.pnpm` directory in the path. Then, in a `setupFiles` entry, which must run before the package is first imported, make `TurboModuleRegistry.get('GoogleCredentialManagerLogin')` from `react-native` return your fake. Mocking the package's internal `NativeGoogleCredentialManagerLogin` file does not work: its `exports` map blocks deep imports.

## How this was built

This library was vibe-coded: written almost entirely by AI coding agents ([Claude Code](https://claude.com/claude-code)) and checked against Google's SDK headers and documentation.

The JS layer has unit tests, and CI compiles both native modules inside the example app. The Android sign-in path has been tested on a device. The rest of the native code has been checked against the SDK sources only, and iOS has never been run on a device (see [platform status](#platform-status)).

If something behaves oddly, it is more likely to be a real bug than your setup. Please [report it](https://github.com/fsstudio-org/google-credential-manager/issues).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports from iOS devices are the single most useful contribution right now.

Found a security problem? Please don't open a public issue — see [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
