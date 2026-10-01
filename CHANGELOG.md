# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.3] - 2026-10-01

### Fixed

- Android: stopped reading the module's own `currentActivity`, which React Native
  deprecated in 0.80 and will remove. The activity now comes from
  `reactApplicationContext.currentActivity`, which the code already fell back to.

## [0.1.2] - 2026-10-01

### Fixed

- Android: the module did not compile against React Native 0.86
  (`'reject' overrides nothing`). RN 0.86 declares `Promise.reject`'s `code`
  parameter as `String?` where 0.83 declares `String`, and Kotlin only accepts an
  override with identical parameter types, so the debug-build rejection logger
  could not compile on both. It is now a dynamic proxy, which does not name the
  signature.

## [0.1.1] - 2026-10-01

### Fixed

- iOS: `pod install` failed in apps built with static libraries (the default),
  because GoogleSignIn 9's Swift dependency `AppCheckCore` needs modular headers
  for `GoogleUtilities` and `RecaptchaInterop`. The Expo config plugin now enables
  them at prebuild; bare React Native apps add three Podfile lines, shown in the
  README.

## [0.1.0] - 2026-10-01

Initial release.
