# Example app

An Expo dev-client app that exercises every method in the library. The native
projects are **not** committed — `expo prebuild` generates them, so they can't
drift out of sync with the library's native code.

## Prerequisites

You need your own Google Cloud OAuth clients; there are no shared credentials
here. In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials):

- a **Web** OAuth client — this is `webClientId` on both platforms
- an **Android** OAuth client — registered with package name
  `studio.funstuff.gcmexample` and the SHA-1 of your debug keystore
- an **iOS** OAuth client — bundle ID `studio.funstuff.gcmexample`

Get the debug SHA-1 with:

```sh
keytool -list -v -keystore ~/.android/debug.keystore \
  -alias androiddebugkey -storepass android -keypass android
```

## Run it

Install the repo root first (`pnpm install` there builds `lib/`, which this app runs), then run these from this directory (`example/`):

```sh
cp .env.example .env      # then fill in the two client IDs
pnpm install
pnpm prebuild
pnpm android              # or: pnpm ios
```

`pnpm prebuild` must be re-run after changing `.env`, because the config
plugin bakes the iOS URL scheme into `Info.plist` at prebuild time. This
directory has its own `pnpm-workspace.yaml` so that `pnpm install` here installs
the example rather than the library's root project.

The app runs the library's **built** output, which pnpm copies in at install time.
After changing the library's `src/`, run `pnpm example:sync` from the repo root
(it rebuilds and reinstalls), or the app keeps running the old build.

Keep a log open while you press buttons: in development builds the library
prints every error with its cause and fix. On Android that is
`adb logcat -s ReactNativeJS:V GoogleCredentialMgr:V`; on iOS, the Metro terminal.

## What to try

| Button | What it should do |
|---|---|
| Branded button | `signInWithChooser()` — always the explicit account chooser |
| `signIn()` | Bottom sheet on Android, falling back to the chooser if no authorized account |
| `signInSilently()` | Restores a session with no UI. Fails with `NO_CREDENTIAL` before your first sign-in — that's the expected path, not a bug |
| `requestAuthorization` | Incremental consent for `drive.file`. Needs a prior sign-in |
| `signOut()` | Clears local state only; the OAuth grant survives |
| `revokeAccess()` | Drops the grant — the next sign-in should show the consent screen again. Press it while signed in, before `signOut()` |

To exercise the `serverAuthCode` / access-token path, uncomment `offlineAccess`
and `scopes` in the `configure()` call in [App.tsx](App.tsx) and rebuild.

## Status

This app is a host for trying the library, not evidence that it works. On
Android, `signIn()`, `signInWithChooser()` and `signOut()` have been exercised on
a device; the other buttons and all of iOS have not. Expect to hit setup friction
before you hit library bugs, and please open an issue either way. See
[platform status](../README.md#platform-status) in the root README.
