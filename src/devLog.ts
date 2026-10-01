import type { GoogleCredentialLoginError } from './errors';

/**
 * Outcomes an app is expected to handle as part of normal use. They are logged
 * at `log` level so they do not raise a LogBox warning in every development
 * session just because a user closed the sheet.
 */
const EXPECTED_CODES = new Set([
  'SIGN_IN_CANCELLED',
  'AUTHORIZATION_CANCELLED',
  'NO_CREDENTIAL',
]);

const alreadyLogged = new WeakSet<object>();

/**
 * Prints an error, including its cause and fix, where a developer will see it:
 * the Metro / Xcode console on iOS, and `adb logcat -s ReactNativeJS:V` on
 * Android. Development builds only — nothing is written in production.
 *
 * `__DEV__` is undefined outside React Native (for example under Jest), so it is
 * checked with `typeof`.
 */
export function logDevError(error: GoogleCredentialLoginError): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  // One failure can pass through several layers; print it once.
  if (alreadyLogged.has(error)) return;
  alreadyLogged.add(error);

  const log = EXPECTED_CODES.has(error.code) ? console.log : console.warn;
  log(`[google-credential-manager] ${error.code}: ${error.message}`);
}
