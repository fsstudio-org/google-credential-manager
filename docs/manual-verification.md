# Manual device verification

Three Android APIs ship compiled but not device-proven: `signInSilently()`,
`requestAuthorization()` and `revokeAccess()`, along with how `signOut()` and
`revokeAccess()` settle a request that is still in flight. This document is how
they get promoted from "compiles" to "exercised", and it is deliberately
hostile to false passes — every step names the evidence that distinguishes
*worked* from *did not visibly fail*.

Run it inside a real app that already consumes this package. Nothing here can
be run from this repo: there is no native build target at the root. CI does
prebuild the example app and compile it for Android (`gradlew assembleDebug`)
and iOS (`xcodebuild`), so the native code is known to *compile* — that is the
entire claim, and it is a long way from "a sign-in sheet appears".

## Why the paranoia

Every check below asks for an observed value, not a verdict. The failure mode
this guards against is specific: a promise that resolves proves the bridge
returned, not that Google did anything. A
`revokeAccess()` that resolves while the OAuth grant survives on Google's side
is indistinguishable from a working revoke *from inside the app*. The only
proof is the Google account permissions page.

## Preconditions

| | |
|---|---|
| Build | A development build or release build of a real consuming app — **not** Expo Go |
| Package version | Record the `version` from this package's `package.json` in your report. Build the app against the ref you are verifying (`file:../path`, a git ref, or the published version) |
| Device | A physical Android device with Play services. Emulators with Play Store work, but account state is less representative |
| Accounts | At least **two** Google accounts added to the device — several checks only differ when more than one account qualifies |
| Logs | `adb logcat -s GoogleCredentialMgr:V ReactNativeJS:V` running in a second terminal for the whole session |

Before starting, confirm the app's `configure()` call and note whether `scopes`
or `offlineAccess` are set. They change the expected result of several of these
checks — `signInSilently()` in particular resolves without tokens when they
would need consent.

In a development build the library prints every error, cause and fix included,
as a `[google-credential-manager]` line in the `ReactNativeJS` log. Paste those
lines into the report verbatim.

## The prompt

Paste this into an agent session opened in the *consuming app's* repo.

---

> I need to device-verify some APIs of `@fsstudio-org/google-credential-manager`
> that have never been run on hardware. Treat this as evidence gathering, not
> as a bug hunt — I want to know what actually happens, including when it is
> boring.
>
> Add a temporary debug screen to this app with one button per scenario below.
> Every handler must log the **full** outcome, not a summary:
>
> ```ts
> const report = (label: string, value: unknown) => {
>   if (value instanceof Error) {
>     console.log(label, JSON.stringify({
>       name: value.name,
>       code: (value as any).code,
>       hint: (value as any).hint,
>       message: value.message,
>       cause: String((value as any).cause ?? ''),
>     }, null, 2));
>   } else {
>     console.log(label, JSON.stringify(value, null, 2));
>   }
> };
> ```
>
> For a successful `User` or `AuthorizationResult`, log `Object.keys(result)`
> and the **length** of every token field — never the token itself, it goes in
> a report I will paste elsewhere. Log `id` and `email` in full; they are needed
> to prove identity is stable across calls.
>
> Run the scenarios in `docs/manual-verification.md` of the library repo in
> order, and for each one report: what appeared on screen (sheet, chooser,
> consent screen, or nothing at all), the logged object verbatim, and the
> `ReactNativeJS` and `GoogleCredentialMgr` logcat lines from the same moment. If a scenario's
> observed result differs from its "Expected" column, say so explicitly and do
> not adjust the app to make it pass — the mismatch is the finding.
>
> Do not modify the library inside `node_modules`.

---

## Scenarios

### A — `signInSilently()` with nothing to restore

Precondition: no account on the device has ever granted this app access.
Check <https://myaccount.google.com/permissions> on each account, or run
`revokeAccess()` first. Clearing the app's data does not remove Google's own
record of a grant, so an account that signed in before can still qualify, and
the call would then resolve — which is a different scenario, not a failure.

1. `adb shell pm clear <your.app.id>` (wipes the app's own data)
2. Launch, call `signInSilently()` before any sign-in.

| | |
|---|---|
| Expected | Rejects `NO_CREDENTIAL`. No UI at all. |
| Evidence | The logged `code`, and the absence of any sheet on screen |
| Failure signal | A visible account sheet on a *fresh* install. That would mean `filterByAuthorizedAccounts` is not being applied. |

### B — `signInSilently()` restoring a real session

1. Complete a normal `signIn()`. Record the returned `id`.
2. Kill the app from the recents switcher (not a JS reload).
3. Relaunch, call `signInSilently()` before anything else.

| | |
|---|---|
| Expected | Resolves with **the same `id`** as step 1, and a fresh `idToken` |
| Evidence | Both `id` values, side by side, and `idToken.length` from each call |
| Known-acceptable | A one-tap sheet appearing instead of a silent resolve, **if** more than one account has previously signed in to this app. Android has no headless variant; note which it did. |
| Failure signal | A different `id` for the same account — that would mean `sub` extraction is unstable, which is the bug this library exists to avoid |

Repeat B with the second Google account signed in at some point, so the
multiple-qualifying-accounts branch is actually exercised rather than assumed.

### C — `requestAuthorization()` granting a new scope

Use a scope the app has never requested, e.g.
`https://www.googleapis.com/auth/drive.readonly`.

1. Sign in normally.
2. `requestAuthorization(['https://www.googleapis.com/auth/drive.readonly'])`

| | |
|---|---|
| Expected | A Google consent screen appears; on approval resolves with `accessToken` and `grantedScopes` containing the requested scope |
| Evidence | `accessToken.length`, the full `grantedScopes` array, and whether `serverAuthCode` was present |
| Note | `serverAuthCode` should be present **only** if `offlineAccess: true` is configured. If it appears without that, say so — it would contradict the README. |

### D — `requestAuthorization()` declined

Repeat C, but dismiss the consent screen with the back gesture rather than
approving.

| | |
|---|---|
| Expected | Rejects `AUTHORIZATION_CANCELLED` |
| Failure signal | `AUTHORIZATION_FAILED`, or a promise that never settles at all. A hung promise here is the more serious finding — it means the activity result never came back. |

### E — `requestAuthorization()` on an already-granted scope

Immediately after a successful C, call it again with the same scope.

| | |
|---|---|
| Expected | Resolves with **no consent screen** and a non-empty `accessToken` |
| Evidence | Confirm nothing appeared on screen, and that `accessToken.length > 0` |
| Why it matters | This is the documented way to refresh an expired access token. If it re-prompts every time, that guidance in the README is wrong. |

### F — `revokeAccess()` while signed in

1. Sign in normally. Do **not** call `signOut()`.
2. `revokeAccess()`

| | |
|---|---|
| Expected | Resolves. No consent screen — the library revokes the account it remembers from the sign-in, through the Authorization API. |
| **Evidence that actually proves it** | Open <https://myaccount.google.com/permissions> on the signed-in account and confirm the app is **no longer listed**. A resolved promise alone proves nothing. |
| Then | Call `signIn()` again. The **consent screen must reappear**. If it signs straight back in, the grant survived and the revoke silently did nothing. |
| Acceptable failure | `REVOKE_FAILED` — that is an acceptable rejection. Report its `message`, which distinguishes "Google did not report which account holds the grant", "needed consent" and "Google rejected the revoke request". |

### G — `revokeAccess()` after `signOut()`, and after a restart

`signOut()` forgets the account, so the revoke has to find one without showing
any UI. Run both variants and record which each did.

1. Sign in, call `signOut()`, then `revokeAccess()`.
2. Sign in, kill the app from recents, relaunch, `configure()`, then call
   `revokeAccess()` without signing in.

| | |
|---|---|
| Expected | Either resolves (Google could name the account without UI) or rejects `REVOKE_FAILED` — with several Google accounts on the device, `REVOKE_FAILED` is the likely result. Both leave local state cleared. |
| Evidence | The outcome of each variant, the `message`, and the permissions page for whether the grant survived |
| Failure signal | A consent screen or account chooser appearing. Discovery must never show UI. |

### H — Double-tap guard

Fire `signIn()` twice in the same tick (two buttons pressed programmatically,
or an intentional double-call).

| | |
|---|---|
| Expected | The second rejects `IN_PROGRESS` while the first continues normally |
| Failure signal | Both rejecting, or the sheet appearing twice |

### I — Double `requestAuthorization()`

Fire `requestAuthorization([...])` twice in the same tick, with a scope that has
not been granted.

| | |
|---|---|
| Expected | The second rejects `IN_PROGRESS`; exactly **one** consent screen appears and settles the first call |
| Failure signal | Two consent screens stacked, or a call that never settles |

### J — `signOut()` while a sheet is showing

Call `signIn()` and, while the sheet is on screen, trigger `signOut()`.

| | |
|---|---|
| Expected | The `signIn()` promise **rejects `SIGN_IN_CANCELLED`**, and the user is not signed in afterwards |
| Failure signal | A `signIn()` promise that never settles, or one that resolves after `signOut()` |

### K — `signInSilently()` with scopes that need consent

Configure `scopes: ['https://www.googleapis.com/auth/drive.readonly']` (or
`offlineAccess: true`) on an account that has never granted them, then call
`signInSilently()` with a stored session.

| | |
|---|---|
| Expected | Resolves the user **without** `accessToken` / `serverAuthCode`, and **no consent screen** opens |
| Evidence | `Object.keys(result)` and what was on screen |
| Failure signal | A consent screen at launch without any user gesture |

## Reporting

Copy this table into the issue or PR with the observed column filled in.
"Pass" with no observed value is not a result.

| Scenario | Expected | Observed (code / keys / what appeared) | Verdict |
|---|---|---|---|
| A — silent, nothing to restore | `NO_CREDENTIAL`, no UI | | |
| B — silent restore | same `id` | | |
| B2 — silent, multiple accounts | sheet or silent — which? | | |
| C — new scope | consent, `accessToken` | | |
| D — declined | `AUTHORIZATION_CANCELLED` | | |
| E — already granted | no consent, token | | |
| F — revoke while signed in | resolves + gone from permissions page | | |
| G — revoke after signOut / restart | resolves or `REVOKE_FAILED`, no UI | | |
| H — double tap | `IN_PROGRESS` | | |
| I — double requestAuthorization | `IN_PROGRESS`, one consent screen | | |
| J — signOut during the sheet | `SIGN_IN_CANCELLED` | | |
| K — silent with scopes | user without tokens, no consent | | |

Device, Android version, Play services version and the package version belong
at the top of the report. Play services version matters more than it looks —
the `TransactionTooLargeException` workaround in `signInWithChooser()` exists
because of a bug fixed in 24.40, so "which build" is the first question anyone
will ask about an odd chooser result.

Get it from: `adb shell dumpsys package com.google.android.gms | grep versionName | head -1`

## iOS

Nothing here has been run on iOS either, but iOS has a different gap: it is
unverified end to end, not per-API. Scenarios B through F, H and I apply
unchanged, with platform differences worth recording rather than treating as
failures:

- `signInSilently()` uses `restorePreviousSignIn` and never shows UI — no
  sheet, ever, unlike Android. Offline, it rejects `SIGN_IN_FAILED`, not
  `NO_CREDENTIAL`; record which it gave, since that is worth confirming.
- `serverAuthCode` comes back whenever `webClientId` is set, regardless of
  `offlineAccess`, except from `signInSilently()` which never returns one.
- `revokeAccess()` with nothing stored resolves, and on failure still signs the
  user out before rejecting `REVOKE_FAILED`.
- With `hostedDomain` configured, picking an account outside it rejects
  `HOSTED_DOMAIN_MISMATCH` **and leaves the user signed out**: confirm that a
  following `signInSilently()` rejects `NO_CREDENTIAL` rather than restoring the
  refused account. A personal Gmail address has no `hd` claim and must be
  rejected too. On iOS the domain is only a hint to Google, so the picker will
  still offer non-matching accounts; the rejection happens afterwards.
- `signIn()` with the URL scheme missing from `Info.plist` rejects
  `NOT_CONFIGURED`, naming the scheme, instead of crashing. Worth trying once
  deliberately.
- Scenarios G, J and K are Android-specific.

The first iOS run should start with plain `signIn()`. If the OAuth redirect
does not land back in the app, stop and check the reversed-client-ID URL scheme
in `Info.plist` against `iosClientId` before going any further — every
subsequent scenario depends on that one working.
