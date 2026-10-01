# AGENTS.md

Operating notes for coding agents working **with** `@fsstudio-org/google-credential-manager`
in a consuming app. Terse on purpose. The prose version for humans is
[README.md](README.md).

The error tables below mirror `ERROR_REMEDIES` in [src/errors.ts](src/errors.ts),
which is the source of truth. Every thrown error also carries its own cause/fix
text in `error.message` and `error.hint`, so **read the error before searching
for one**.

## What it is

Sign in with Google for React Native. Android uses Jetpack Credential Manager
(`androidx.credentials` + `googleid`); iOS uses the GoogleSignIn pod. One JS
API, one payload shape, New Architecture only.

It returns an ID token for your backend to verify. It is **not** an OAuth
access-token library — access tokens come from a separate authorization leg you
have to opt into.

## Invariants — do not violate

1. **`configure()` runs before everything except `signOut()`.** It returns
   immediately and is idempotent. The native side applies it asynchronously but
   always before any later call, so there is nothing to await. Invalid values
   throw `NOT_CONFIGURED` from `configure()` itself. Call it at module scope or
   in your root component, not inside the sign-in handler.
2. **`webClientId` is the *Web* OAuth client ID on both platforms.** Not the
   Android one, not the iOS one. It becomes the ID token's `aud` claim, so the
   backend verifies one audience regardless of platform.
3. **`user.id` is the OIDC `sub` claim. Use it as the primary key.** `email` is
   mutable and display-only. Never key a database row on `email`.
4. **Never log or transmit `idToken`, `accessToken` or `serverAuthCode`** in
   debug output, issue reports or analytics. Log `.length` if you need to prove
   one exists.
5. **Does not work in Expo Go.** It contains native code; a development build is
   required. Where the native module is not linked, importing the package still
   works; `configure()` throws and every other method rejects `UNSUPPORTED`.
6. **Rebuild native after upgrading the package.** A Metro reload does not
   relink native code, and a JS/native version skew surfaces as `PARSE_ERROR`.

## Correct usage

```ts
import {
  GoogleCredentialLogin,
  GoogleCredentialLoginError,
  type User,
} from '@fsstudio-org/google-credential-manager';

GoogleCredentialLogin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID!,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID!, // required on iOS
});

async function restoreOrPrompt(): Promise<User | null> {
  try {
    return await GoogleCredentialLogin.signInSilently();
  } catch (error) {
    if (
      error instanceof GoogleCredentialLoginError &&
      error.code === 'NO_CREDENTIAL'
    ) {
      return null; // expected on first launch — show the sign-in screen
    }
    throw error;
  }
}

async function handleSignInPress() {
  try {
    const user = await GoogleCredentialLogin.signIn();
    await verifyOnBackend(user.idToken); // the only thing the token is for
  } catch (error) {
    if (error instanceof GoogleCredentialLoginError) {
      if (error.code === 'SIGN_IN_CANCELLED') return; // not a failure
      // error.message already contains the cause and the fix.
    }
    throw error;
  }
}
```

Every rejection from every method is a `GoogleCredentialLoginError`, so the
`instanceof` narrowing above always holds. `error.code` is the stable string to
branch on; `error.cause` holds the original native rejection.

## Reading the logs

In development builds (`__DEV__`) the library prints every error itself, cause
and fix included, so you do not need to catch and log it to see it. Nothing is
printed in production.

- **Android:** `adb logcat -s ReactNativeJS:V GoogleCredentialMgr:V`.
  `ReactNativeJS` carries the `[google-credential-manager] CODE: …` line with the
  cause and fix; `GoogleCredentialMgr` carries the native side's own log lines.
- **iOS:** the Metro terminal or the Xcode console. Native lines are prefixed
  `[GoogleCredentialManagerLogin]`; the JS line is prefixed
  `[google-credential-manager]`.
- Expected outcomes (`SIGN_IN_CANCELLED`, `AUTHORIZATION_CANCELLED`,
  `NO_CREDENTIAL`) are logged with `console.log`; everything else with
  `console.warn`, so a dismissed sheet does not raise a LogBox warning.
- Tokens and profile data are never logged.

## Anti-patterns

| Don't | Do | Why |
|---|---|---|
| `catch { retry() }` around `signIn()` | Check for `SIGN_IN_CANCELLED` and return | A blind retry re-opens the sheet the user just dismissed |
| Key users on `user.email` | Key on `user.id` | `id` is `sub`; email changes |
| Call `signIn()` in a `useEffect` with unstable deps | Call it from an explicit press handler | Concurrent calls reject `IN_PROGRESS` |
| Treat `signOut()` as a revoke | Use `revokeAccess()`, and revoke server-side too | `signOut()` only clears local state |
| Call `signOut()` and then `revokeAccess()` | Call `revokeAccess()` first | Once signed out the account is forgotten, so there is nothing left to revoke |
| Assume `accessToken` is present | Configure `scopes`, then read `grantedScopes` | Credential Manager returns only an ID token |
| Assume `serverAuthCode` implies `offlineAccess` | Check your own config | iOS returns it whenever `webClientId` is set |
| Pin `androidx.credentials` in the app's gradle | Leave the library's pins alone | Version skew gives `REQUEST_BUILD_FAILED` |
| Trust `hostedDomain` client-side | Verify the `hd` claim on the backend | Both platforms compare `hd` after sign-in, but that runs on the device. It is UX, not security |

## Setup preconditions

Check these before debugging any sign-in failure — most "library bugs" are one
of them.

- [ ] A **Web** OAuth client exists, and its ID is what `webClientId` receives.
- [ ] Android: an **Android** OAuth client exists with the app's package name,
      and the SHA-1 of **every** signing key is registered on it — debug,
      upload, *and Play App Signing*. A missing Play App Signing SHA-1 is the
      classic "works in debug, fails in production".
- [ ] iOS: an **iOS** OAuth client exists, `iosClientId` is set, and the
      reversed client ID (`com.googleusercontent.apps.<id>`) is in
      `Info.plist` under `CFBundleURLSchemes`. It must match `iosClientId` —
      the web client ID will not work.
- [ ] iOS: `pod install` succeeds. GoogleSignIn 9 needs modular headers for
      `GoogleUtilities`, `RecaptchaInterop` and `AppCheckCore`; the Expo config
      plugin adds them at prebuild, a bare app adds
      `pod '<name>', :modular_headers => true` for each inside its Podfile
      target (unless it already uses `use_frameworks!` or `use_modular_headers!`).
      Without them `pod install` fails with "Swift pods cannot yet be integrated
      as static libraries".
- [ ] Expo: the config plugin is in `app.json` and `npx expo prebuild` has been
      re-run since the client IDs last changed. They are baked in at prebuild.
- [ ] The app is a development/release build, not Expo Go.
- [ ] The device has Google Play services (Android) and at least one Google
      account added in system settings.

## Error codes

Format: **Platform** — cause — fix. `error.hint` carries the same text at
runtime.

### NOT_CONFIGURED

**Both.** `configure()` has not run, or it was given an invalid value (empty
`webClientId`, missing `iosClientId` on iOS, a non-string ID, a non-boolean flag,
a scope that is not a non-empty string). On iOS it is also raised when the URL
scheme for `iosClientId` is not registered in `Info.plist`; the message names the
scheme it expected.

Call `configure({ webClientId, iosClientId })` once at startup before any other
method. `webClientId` must be the Web OAuth client. On iOS also register the
reversed-client-ID URL scheme: the Expo config plugin does it at prebuild (list
the package in `plugins` with `iosClientId`, then run `npx expo prebuild`); a
bare app adds it to `Info.plist` by hand.

### IN_PROGRESS

**Both.** A sign-in or authorization request is still pending; the module serves
one at a time. On iOS that includes `signInSilently()`.

Disable the button while the promise is in flight. Do not call `signIn()` from
an effect that can re-run on render.

### SIGN_IN_CANCELLED

**Both.** The user dismissed the sheet or chooser.

Not a failure. Return quietly — no alert, no automatic retry.

### SIGN_IN_FAILED

**Both.** The native SDK failed without classifying the reason further. The
wrapped `error.cause` has the detail; on Android the message names the
underlying exception class. On iOS this also covers network and token-endpoint
failures — including from `signInSilently()`, where it says nothing about whether
a session exists, so do not treat it as "signed out".

On Android the usual reason is a certificate the OAuth client does not know:
register the SHA-1 of every keystore (debug, upload, Play App Signing) on the
Android OAuth client. Read `adb logcat -s ReactNativeJS:V GoogleCredentialMgr:V`
for the underlying exception.

### PARSE_ERROR

**Both.** The native payload could not be read, or the ID token had no decodable
`sub` claim.

Almost always a JS/native version skew — rebuild the app after upgrading. If it
survives a clean rebuild, report it.

### NO_CREDENTIAL

**Both.** Nothing to return: no previous session to restore
(`signInSilently()`; on iOS also a stored session whose refresh token was revoked
or expired), or no Google account on the device (`signIn()`, after its chooser
fallback also found nothing).

Expected on first launch — show the sign-in screen. For `signIn()` the chooser
fallback has already run, so the device has no usable Google account: ask the
user to add one in system settings, or offer another sign-in method.

### HOSTED_DOMAIN_MISMATCH

**Both.** The account's `hd` claim does not match the configured `hostedDomain`,
or it has no `hd` claim at all, as a personal Gmail address does. The user is
left signed out.

Sign in with an account in that Workspace domain. After sign-in both platforms
compare the ID token's `hd` claim, ignoring case. Android also filters up front
in the explicit chooser (`signInWithChooser()`, and `signIn()` after its
fallback) and on the consent screen, but the first bottom sheet of `signIn()` and
`signInSilently()` cannot filter, and iOS only passes the domain to Google as a
hint. Verify `hd` on the backend either way — client-side checks are UX, not
security.

### AUTHORIZATION_FAILED

**Both.** Google's Authorization API failed, or issued no access token.

Check each scope is a full URL (`https://www.googleapis.com/auth/…`), the API is
enabled in Cloud Console, and the OAuth consent screen lists the scope.
Sensitive scopes need app verification before non-test users can grant them.

### AUTHORIZATION_CANCELLED

**Both.** The user dismissed the consent screen.

Treat as a no-op and leave the feature unavailable. Check `grantedScopes` before
calling the API — users can decline individual scopes.

### REVOKE_FAILED

**Both.** The grant could not be revoked: the library did not know which account
to revoke (`signOut()` forgets it, and none could be found without showing UI),
consent would have been required, or Google's revoke call failed. Local
credential state was cleared either way.

Call `revokeAccess()` while the user is still signed in — before `signOut()` — so
the account is known. If an account-deletion flow depends on it, also revoke
server-side with the refresh token: the only path that does not depend on the
device. On iOS, revoking with nothing stored succeeds rather than failing.

### NOT_SIGNED_IN

**iOS.** `requestAuthorization()` was called before anyone signed in.

Await `signIn()` or `signInSilently()` first.

### AUTHORIZATION_REQUIRED

**Android.** Consent was needed where it could not be shown: `revokeAccess()`
looking up the account, or `signInSilently()` requesting tokens. Neither opens a
consent screen unprompted.

Normally not seen by callers: `revokeAccess()` reports it as `REVOKE_FAILED`, and
`signInSilently()` absorbs it and resolves the user without `accessToken` or
`serverAuthCode`. Call `requestAuthorization()` from a user gesture to obtain
them.

### NO_ACTIVITY

**Android.** No usable Activity — none yet, or it is finishing or destroyed.
Called before the first screen, from the background, or across a configuration
change.

Call from a mounted screen, not a module body, headless task or push handler.

### REQUEST_BUILD_FAILED

**Android.** The request could not be assembled, usually a version skew between
`androidx.credentials` and `googleid`.

Do not override the library's pinned versions from the app's gradle. Clean and
rebuild.

### UNEXPECTED_CREDENTIAL

**Android.** Credential Manager returned something that was not a Google ID
token — a passkey or saved password from another provider.

Expected if the app registers other credential options on the same request. If
it does not, report it with the credential type from the message.

### SIGN_IN_INTERRUPTED

**Android.** Transient: the credential provider restarted, or the React context
was torn down mid-request.

Retryable, once, on an explicit user action.

### PROVIDER_CONFIGURATION_ERROR

**Android.** No working credential provider — Play services missing, disabled or
out of date.

Prompt the user to update Google Play services. Devices without Google services
cannot run this flow; offer another sign-in method.

### UNSUPPORTED

**Both.** The native module is not linked in this app (Expo Go, web, or a build
made before the package was installed), or Credential Manager is unavailable on
this device (Android).

Use a development build, not Expo Go, and rebuild the native app after installing
the package (`npx expo prebuild`, then `npx expo run:android` or `run:ios`). If it
is a device limitation, hide the Google button and fall back to another method.

### VIEW_CONTROLLER_MISSING

**iOS.** No presenting `UIViewController` — the key window had no root when the
call was made.

Call from a mounted screen rather than during module initialisation. On a cold
start, defer one tick and retry.

### NO_USER

**iOS.** GIDSignIn completed with neither an error nor a user.

Should not happen. Report it with the GoogleSignIn pod version.

### NO_ID_TOKEN

**iOS.** Sign-in succeeded but no ID token was issued, which normally means
`serverClientID` was not set.

Pass `webClientId` to `configure()` (it becomes `serverClientID`), and make sure
a Web OAuth client exists in the same Cloud project as the iOS client.

### UNKNOWN

**Both.** The rejection carried no recognised code — it did not come from this
library's known surface.

Inspect `error.cause` and report it. An `UNKNOWN` means this table is missing a
code.

## Platform differences that are not bugs

- `signInSilently()` shows no UI on iOS (`restorePreviousSignIn`). On Android,
  Credential Manager may still show the one-tap sheet when several accounts
  qualify — there is no headless variant. Neither platform opens a consent
  screen from it; on Android the tokens are simply absent when consent would be
  needed (always, with `forceCodeForRefreshToken`).
- On iOS a network failure during `signInSilently()` is `SIGN_IN_FAILED`, not
  `NO_CREDENTIAL`: do not clear your app's session on it.
- `hostedDomain` is compared against the ID token's `hd` claim on both
  platforms. Android additionally filters the chooser and consent screen up
  front; on iOS the domain is also only a hint to Google, so a non-matching
  account can be picked and is then rejected.
- `phoneNumber` is Android-only.
- `serverAuthCode` requires `offlineAccess` on Android; on iOS it comes back
  whenever `webClientId` is set, except from `signInSilently()`.
- `signInWithChooser()` is identical to `signIn()` on iOS — GIDSignIn always
  shows the chooser.
- `revokeAccess()` on iOS is a true disconnect. On Android it uses the
  Authorization API's revoke, which needs the account (so call it before
  `signOut()`), Play services and network, and can fail. Both platforms clear
  local state even when it does.
- `signOut()` and `revokeAccess()` settle whatever is in flight: a pending
  sign-in rejects `SIGN_IN_CANCELLED`, a pending authorization
  `AUTHORIZATION_CANCELLED`.

## Reporting a bug

Include: package version, platform and OS version, the full `error.code` and
`error.message`, `adb logcat -s ReactNativeJS:V GoogleCredentialMgr:V` output
(Android), and the `configure()` call **with the client IDs redacted**. Never
paste tokens.

This library was vibe-coded: written almost entirely by AI coding agents and
checked against Google's SDK headers and documentation. The Android sign-in
path has been tested on a device; iOS has not been, so an odd behaviour is more
likely a real bug than a misconfiguration on your side. See
[platform status](README.md#platform-status).
