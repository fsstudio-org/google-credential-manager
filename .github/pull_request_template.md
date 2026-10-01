## What and why

<!-- One change per PR. For API or behaviour changes, link the issue where it was discussed. -->

## What I ran this on

<!-- Name the platform(s) and the device or emulator. "Untested on iOS" is a fine answer; guessing isn't. -->

- [ ] Android — device / emulator:
- [ ] iOS — device / simulator:
- [ ] JS only, no native behaviour changed

## Checklist

- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass
- [ ] `CHANGELOG.md` has an entry under "Unreleased"
- [ ] If I added or renamed a field on `User`, I updated all three places: `User` + `parseUser` in `src/index.tsx`, the Android module, and the iOS module
- [ ] If I added an error code, it is in `ERROR_REMEDIES`, `AGENTS.md` and the README table
- [ ] Docs that describe anything I changed are updated in this PR
