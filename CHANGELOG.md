# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-10-01

### Fixed

- iOS: `pod install` failed in apps built with static libraries (the default),
  because GoogleSignIn 9's Swift dependency `AppCheckCore` needs modular headers
  for `GoogleUtilities` and `RecaptchaInterop`. The Expo config plugin now enables
  them at prebuild; bare React Native apps add three Podfile lines, shown in the
  README.

## [0.1.0] - 2026-10-01

Initial release.
