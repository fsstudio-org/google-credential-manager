# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A React Native **native-module library** (`@fsstudio-org/google-credential-manager`) that wraps Sign-in with Google behind one JS API with two native back-ends:

- **Android** — Jetpack Credential Manager (`androidx.credentials` + `com.google.android.libraries.identity.googleid`) for sign-in. Google's separate Authorization API (`play-services-auth`) is used only for access tokens, extra scopes, `serverAuthCode` and revocation.
- **iOS** — the GoogleSignIn-iOS pod, pinned `~> 9.0`.

It returns a Google ID token plus profile fields for backend verification. **New Architecture / TurboModule only** — `peerDependencies` requires **RN >= 0.83.0**. Published to npm as a public scoped package; see [README.md](README.md). It is explicitly described as AI-written; only the Android `signIn` / `signInWithChooser` / `signOut` path has been tested on a device, and iOS never has. Keep README's [platform status](README.md#platform-status) table accurate, not optimistic.

## Commands

The package manager is **pnpm** (`packageManager` in [package.json](package.json); `pnpm-lock.yaml` is committed). The JS scripts below run from the repo root:

- **Test**: `pnpm test` (jest). Single test: `pnpm test -t "rejects an empty webClientId"` or `pnpm test src/__tests__/index.test.tsx`
- **Typecheck**: `pnpm typecheck` (`tsc`, `noEmit`)
- **Lint**: `pnpm lint` (eslint + prettier over `**/*.{js,ts,tsx}`; `example/` is excluded and is neither linted nor typechecked). `pnpm lint --fix` fixes formatting.
- **Build**: `pnpm build` (`bob build` → `lib/module` ESM plus `lib/typescript` declarations; gitignored). `pnpm install` runs it too, through `prepare`.
- **Example sync**: `pnpm example:sync` (build, then reinstall `example/`; see below)
- **Clean**: `pnpm clean` (removes `android/build` and `lib`)

`prepublishOnly` runs lint, typecheck, test and build. The package ships **built output**: `main`/`types`/`exports` point at `lib/`, produced by react-native-builder-bob (config in `package.json`, declarations from `tsconfig.build.json`). It is ESM only, on purpose: a CommonJS build beside it would let an app load the library twice and duplicate `isConfigured`. `src/` ships as well, because codegen reads the TurboModule spec from it and the `source` export condition points at it.

**The native code does not compile from this directory.** Codegen emits the TurboModule spec base class at *app* build time, so `gradle assemble` in [android/](android/) cannot work on its own — the Kotlin only compiles inside a host app. That host is [example/](example/), a standalone Expo app (own dependency tree) that links the library via `file:..`:

```
pnpm --dir example install && pnpm --dir example prebuild && pnpm --dir example android
```

`example/pnpm-workspace.yaml` (`packages: []`) is load-bearing: without it pnpm walks up to the root's `pnpm-workspace.yaml`, treats the repo root as the workspace root, and `pnpm install` inside `example/` silently installs the **root** project — no `example/node_modules`, and `expo prebuild` then fails. The root file also sets `autoInstallPeers: false`, because pnpm 11 would otherwise install the optional `expo` peer into the root at a version that does not pair with RN 0.83.

The example needs `example/.env` (copy `.env.example`) with your own OAuth client IDs; there are no shared test credentials. After changing [plugin/](plugin/), re-run `prebuild` — the config plugin only runs then.

The example runs the **built** package, so it is deliberately a check on what ships. pnpm copies `file:..` into `example/node_modules` and `bob build` deletes and rewrites `lib/`, so after any change to `src/` run `pnpm example:sync`, or the example keeps running the old build. Installing the example before the root has been installed leaves it with no `lib/` at all.

[.github/workflows/ci.yml](.github/workflows/ci.yml) has three jobs: `js` (lint/typecheck/test/build), `android` (prebuild the example, `gradlew assembleDebug`) and `ios` (prebuild on macOS, a separate `pod install` step, `xcodebuild` for the simulator, unsigned), all with placeholder client IDs. That is compile coverage only: a runner cannot complete a Google consent screen, so sign-in itself is never tested in CI. The two native jobs are a matrix, `floor` and `latest`, and also run weekly. **Keep `example/` on the lowest RN the `peerDependencies` range allows** (currently the Expo SDK 55 / RN 0.83 line): that is the `floor` build, and if the example sits above the supported floor, CI cannot catch breaks in the oldest RN native API (e.g. `ActivityEventListener`'s Kotlin nullability). The `latest` build upgrades the runner's copy of the example with `pnpm add expo@latest` and `npx expo install --fix`, which catches the opposite break: RN 0.86 changed `Promise.reject`'s `code` to `String?`, so overrides that compiled on 0.83 failed there. A `latest` failure may be a new Expo release rather than a bug in this repo; check the Expo upgrade step's log first.

[.github/workflows/release.yml](.github/workflows/release.yml) is started by hand (`workflow_dispatch`, on `main`), publishes through npm trusted publishing (OIDC, no token; it needs `id-token: write` and npm >= 11.5.1, so it upgrades the runner's npm), and only proceeds if a CI run for that exact commit succeeded (`gh run list --workflow ci.yml --commit`, which works because no CI job may fail). It then creates the `v<version>` tag and a GitHub Release from the CHANGELOG entry, so do not push the tag yourself. The trusted publisher is configured on npmjs.com and can only be added once the package exists, so 0.1.0 was published by hand.

## Architecture

Four layers joined by one data contract:

1. **JS facade** — [src/index.tsx](src/index.tsx). The `GoogleCredentialLogin` object (`configure`, `signIn`, `signInWithChooser`, `signInSilently`, `requestAuthorization`, `signOut`, `revokeAccess`). Holds module-level `isConfigured` state, validates and normalizes config (`normalizeConfig`: types, trimming, per-element scopes — the native sides disagree about bad input, so it never reaches them), and **parses the JSON string the native side returns** (`parseNative` → `parseUser` / `parseAuthorizationResult`; an empty `id` or `idToken` is a `PARSE_ERROR`). Every method body runs inside `guard()`, which funnels anything thrown through `normalizeError` — RN rejects native promises with a plain `Error` carrying a `code`, so without that wrap `instanceof GoogleCredentialLoginError` is false for exactly the errors callers care about. `configure` is **not** synchronous at the native level: RN dispatches void TurboModule methods asynchronously on both platforms, so a native throw cannot reach JS and all validation has to happen in the facade. Call order is still preserved, which is why there is nothing to await. `native()` turns a missing native module into `UNSUPPORTED`. `_reset()` exists for tests only.
   - **Errors** — [src/errors.ts](src/errors.ts). `GoogleCredentialLoginError` (carries `.code`, `.hint`, `.cause`; `cause` is assigned manually so it survives an ES2019 `lib`), `normalizeError`, and `ERROR_REMEDIES`: the code → `{ cause, fix }` table whose text is appended to every error's `message`. Re-exported from the entry point.
   - **Dev logging** — [src/devLog.ts](src/devLog.ts). In `__DEV__` only, every error is printed once (`fail()` and `guard()` both call it; a `WeakSet` dedupes) as `[google-credential-manager] CODE: message`, with the cause and fix, via `console.warn` — or `console.log` for the expected outcomes, so a dismissed sheet does not raise a LogBox warning. That is what reaches `adb logcat -s ReactNativeJS:V`. `__DEV__` is checked with `typeof` because it is undefined under Jest.
   - **Button** — [src/GoogleSignInButton.tsx](src/GoogleSignInButton.tsx) is deliberately *not* re-exported from the entry point: it needs `react-native-svg` (an optional peer), and Metro resolves statically, so importing it from the root would break bundles that haven't installed svg. It is exposed via the `./button` subpath in `package.json` `exports`.
2. **TurboModule spec** — [src/NativeGoogleCredentialManagerLogin.ts](src/NativeGoogleCredentialManagerLogin.ts). Everything crosses the bridge as a **JSON string** (config in, `User` / `AuthorizationResult` out), not codegen structs, so adding a field never changes a native signature. The facade is what turns strings into typed objects. The module is fetched with `TurboModuleRegistry.get`, not `getEnforcing`, so importing the package where it is not linked (Expo Go, web) does not throw.
3. **Native implementations**:
   - Android: [GoogleCredentialManagerLoginModule.kt](android/src/main/java/com/googlecredentialmanagerlogin/GoogleCredentialManagerLoginModule.kt). Sign-in goes through `runCredentialFlow`: `GetGoogleIdOption` bottom sheet → on `NoCredentialException`, recurse into `GetSignInWithGoogleOption` (explicit chooser), gated by its `allowSiwgFallback` argument. `signIn` passes `true`; `signInWithChooser` goes straight to the chooser (which also avoids the many-accounts `TransactionTooLargeException`); `signInSilently` passes `false` and `silent = true`, so its authorization leg never shows consent (it resolves the user without tokens instead). Each sign-in is a `SignInFlow`: every terminal path goes through `claimSignIn`, so a flow settles exactly once, and `signOut` / `revokeAccess` / `invalidate` cancel it by claiming it and rejecting — Credential Manager itself stops calling back once its signal is cancelled. `requestAuthorization` and the tokens leg use the Authorization API through `authorize()`, which claims a single `activeAuthorization` slot up front and releases it on every exit; the consent result returns via `onActivityResult` (the module implements `ActivityEventListener`). `revokeAccess` calls `AuthorizationClient.revokeAccess` for the remembered `signedInAccount` (or an account found by a no-UI authorize), not an HTTP call. `Promise.logged()` wraps the promise in a `java.lang.reflect.Proxy` in debuggable host apps only, so rejections reach `adb logcat` without touching the literal `promise.reject("CODE", …)` call sites. It is a proxy, not `Promise by delegate` with overrides, on purpose: RN 0.83 declares `reject(code: String, …)` and 0.86 declares `reject(code: String?, …)`, Kotlin accepts only an exact-match override, so a hand-written override compiled on one and failed on the other (`'reject' overrides nothing`). CI cannot catch that, since the example sits on 0.83.
   - iOS: [GoogleCredentialManagerLogin.mm](ios/GoogleCredentialManagerLogin.mm). `signIn` calls `signInWithPresentingViewController:…` (the `…:nonce:…` overload when a nonce is configured); `signInWithChooser` is identical to `signIn`; `signInSilently` is `restorePreviousSignIn`; `revokeAccess` is `disconnect`, plus a `signOut` if it fails. Module state is touched only on the main queue. One `_requestInProgress` flag covers sign-in, silent restore and authorization, because GIDSignIn keeps a single shared flow and a second call overwrites the first one's completion. `hostedDomain` is enforced in `resolveUser:` by decoding the ID token's `hd` claim (GIDSignIn only sends it to Google as a hint), mirroring Android's post-check, and a mismatch also signs out so `signInSilently` cannot restore the refused account. Errors are mapped by **domain and code** (AppAuth's codes overlap GIDSignIn's). Before any interactive flow it checks the callback URL scheme is in `Info.plist`, since GIDSignIn raises an uncatchable exception otherwise. `LoggingReject()` wraps the reject block once per method in `DEBUG` builds.
4. **Expo config plugin** — [plugin/withGoogleCredentialManager.js](plugin/withGoogleCredentialManager.js), entered via [app.plugin.js](app.plugin.js). iOS only: derives the reversed-client-ID URL scheme from `iosClientId` and writes it, plus `GIDClientID` / `GIDServerClientID`, into `Info.plist` (all trimmed). It also adds `:modular_headers => true` pod lines for `GoogleUtilities`, `RecaptchaInterop` and `AppCheckCore` to the Podfile ([plugin/modularHeaders.js](plugin/modularHeaders.js)), always, even without `iosClientId`: GoogleSignIn 9's Swift dependency `AppCheckCore` otherwise makes `pod install` fail in static-library builds. A bare app needs the same three lines by hand (README). It imports `expo/config-plugins` (Expo's documented path for library plugins), so `expo` is an optional peer dependency. Its tests live in `plugin/__tests__` (babel-jest) and mock `expo/config-plugins` as a virtual module, since `expo` is not installed at the root; the JS tests use ts-jest.

### The user-payload contract (cross-cutting)

The returned user object is assembled independently in three places that must stay in sync. **To add or rename a returned field, edit all of:**

- the `User` interface + `parseUser` validation — [src/index.tsx](src/index.tsx)
- the `JSONObject` built in `buildUserPayload` — Android module
- `resolveUser:` — iOS `.mm`

`id` is the **OIDC `sub` claim on both platforms** (stable per-account key; `email` is mutable and display-only). This alignment is deliberate and load-bearing:

- Android: the credential's `.id` field is actually the *email*, so the module base64-decodes the ID-token JWT payload to pull `sub` (`decodeIdTokenPayload`, read in `buildUserPayload`).
- iOS: `id` comes from `user.userID`.

`phoneNumber` is Android-only. `iosClientId` is required on iOS and is `GIDConfiguration.clientID`; `webClientId` is `serverClientID`, which is what makes the token's `aud` match across platforms.

### Error codes

The `.code` strings (`SIGN_IN_CANCELLED`, `NO_CREDENTIAL`, `PARSE_ERROR`, `NOT_CONFIGURED`, …) are a documented shared contract: native rejects with them and the facade re-wraps them, preserving the native error as `.cause`.

A code lives in **three** places, enforced by `src/__tests__/docs.test.tsx`:

- `ERROR_REMEDIES` in [src/errors.ts](src/errors.ts) — source of truth, and the cause/fix text that ends up in `error.message` and `error.hint`
- a `### CODE` heading in [AGENTS.md](AGENTS.md) — the anchor `DOCS_URL#<lowercased code>` points at, so the heading must be the bare code
- the table in [README.md](README.md)

The same test also **regex-scans the Kotlin and Objective-C sources** for literal codes passed to `reject` / `onError` / `Failure` / `"CODE" to "…"` and fails if any lacks an `ERROR_REMEDIES` entry. So a new native rejection code fails CI until it is documented; write the rejection in one of those call shapes or the scan will not see it. The scan reads comments too: a comment containing a literal `reject("CODE", …)` counts as a rejection of a code called `CODE` and fails the test.

`UNKNOWN` is the fallback for a rejection with no usable code; seeing one in the wild means the table is missing an entry.

### Codegen

`package.json` → `codegenConfig.name: "GcmLoginSpec"` generates the spec base types: the Kotlin `NativeGoogleCredentialManagerLoginSpec` superclass and the `GcmLoginSpec/GcmLoginSpec.h` header imported by [ios/GoogleCredentialManagerLogin.h](ios/GoogleCredentialManagerLogin.h). The runtime module name registered with RN is `GoogleCredentialManagerLogin`; Android registers it via [GoogleCredentialManagerLoginPackage.kt](android/src/main/java/com/googlecredentialmanagerlogin/GoogleCredentialManagerLoginPackage.kt), and iOS via `codegenConfig.ios.modulesProvider` (there is deliberately no `RCT_EXPORT_MODULE`; without the provider iOS only finds the class through a fallback React Native says it will remove).

## Conventions / gotchas

- Native dependency pins live in library source, not consumer config: `androidx.credentials:1.6.0`, `googleid:1.1.1` and `play-services-auth:21.4.0` in [android/build.gradle](android/build.gradle); `GoogleSignIn ~> 9.0` in the [podspec](GoogleCredentialManagerLogin.podspec) (the 9.0 API is required).
- Bumping the `package.json` `version` drives the podspec version, the podspec's git tag (`v<version>`) and the config plugin's run-once version. The podspec also derives its author and git URL from `package.json`. Release steps are in [CONTRIBUTING.md](CONTRIBUTING.md).
- Consumers read the emitted `.d.ts` under their own compiler flags and `lib`, so keep the public types free of things stricter settings reject (nothing that needs a newer `lib` than ES2019, no `undefined` assigned to optional properties). Nothing in CI checks that. Because the build is ESM, Jest inside `node_modules` needs the package allow-listed for transform; the README documents that and how to mock it, and note its `exports` map blocks deep imports, so the internal native-module file cannot be mocked by path.
- `react-native-svg` 15.12.1 (what Expo SDK 55 pins) imports `buffer` without declaring it, which breaks a JS bundle under pnpm's strict layout; 15.15.5 does not. The example declares `buffer` itself. CI never notices, because debug builds do not bundle JS.
- The npm tarball is controlled by the `files` allowlist in `package.json`: it ships `lib`, `src`, `android`, `ios`, `plugin`, `AGENTS.md` and `CHANGELOG.md`, but not tests, mocks, `docs/`, `example/`, `tsconfig*` or this file. `docs/` stays on GitHub only, so a shipped file must not depend on it: the README's relative links to it resolve to GitHub on the npm page, and AGENTS.md, which is read inside `node_modules`, does not link to it at all. Keep repo-internal material (CI, the example, contributor steps) out of shipped files; it belongs in CONTRIBUTING.md and this file. Check with `pnpm pack --dry-run`.
- [AGENTS.md](AGENTS.md) is published documentation for agents *using* the package (invariants, setup preconditions, every error code) — not instructions for working on this repo. Keep it current with behaviour changes.
- Tests mock the native module (`jest.mock('../NativeGoogleCredentialManagerLogin')`; `unsupported.test.tsx` mocks it as `null`) and run under `tsconfig.spec.json` (commonjs). The native default export is nullable, so tests reach it through the `nativeMock()` helper. There are no native/integration tests in this repo, and the native code in particular has never been compiled outside CI; device verification is a manual protocol in [docs/manual-verification.md](docs/manual-verification.md).
- `CHANGELOG.md` follows Keep a Changelog; add entries under "Unreleased".
