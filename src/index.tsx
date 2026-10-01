import { Platform } from 'react-native';
import NativeModule, { type Spec } from './NativeGoogleCredentialManagerLogin';
import { GoogleCredentialLoginError, normalizeError } from './errors';
import { logDevError } from './devLog';

export { GoogleCredentialLoginError, ERROR_REMEDIES, DOCS_URL } from './errors';
export type { Remedy } from './errors';

// GoogleSignInButton is not re-exported here: Metro resolves statically, so
// merely referencing react-native-svg would break the bundle for anyone who
// hasn't installed it. Import it from the '/button' subpath.

export interface User {
  idToken: string;
  /** OIDC `sub` claim — stable per-account identifier, same on both platforms. */
  id: string;
  email: string;
  displayName?: string;
  givenName?: string;
  familyName?: string;
  profilePictureUri?: string;
  /** Android only. */
  phoneNumber?: string;
  /**
   * Code your backend exchanges for a refresh token. Requires `offlineAccess` on
   * Android; never returned by `signInSilently()` on iOS, and absent from
   * `signInSilently()` on Android when Google would need to ask for consent.
   */
  serverAuthCode?: string;
  /**
   * Requires `scopes`. Absent from `signInSilently()` on Android when Google
   * would need to ask for consent — call `requestAuthorization()` for it.
   */
  accessToken?: string;
  /** What the user actually granted — may be less than requested. */
  grantedScopes?: string[];
}

export interface AuthorizationResult {
  accessToken: string;
  grantedScopes: string[];
  /** Requires `offlineAccess`. */
  serverAuthCode?: string;
}

export interface GoogleCredentialManagerLoginConfig {
  /**
   * Web OAuth client ID, used on both platforms. Becomes Credential Manager's
   * `serverClientId` on Android and `GIDConfiguration.serverClientID` on iOS, so
   * the ID token's `aud` claim is the same either way.
   */
  webClientId: string;
  /**
   * Required on iOS, ignored on Android. The GoogleSignIn SDK derives the OAuth
   * redirect scheme from it, so it must match the `com.googleusercontent.apps.…`
   * entry in Info.plist. The web client ID will not work here.
   */
  iosClientId?: string;
  /**
   * Cryptographically random; your server must validate it if you set one. It is
   * fixed when `configure()` runs and reused for every sign-in after it, so on
   * its own it does not stop a replayed token — call `configure()` again with a
   * fresh value before each attempt if you need that.
   */
  nonce?: string;
  /** Android-only bottom-sheet account filter. Default true. */
  filterByAuthorizedAccounts?: boolean;
  /** Restrict to a Google Workspace domain, e.g. `example.com`. */
  hostedDomain?: string;
  /** Request a `serverAuthCode`. On Android this runs Google's Authorization API. */
  offlineAccess?: boolean;
  /**
   * Android only. Reissue a refresh token even if already consented. Needs
   * `offlineAccess`.
   */
  forceCodeForRefreshToken?: boolean;
  /** Extra OAuth scopes; makes `accessToken` and `grantedScopes` available. */
  scopes?: string[];
}

let isConfigured = false;

/**
 * Builds, logs (development builds only) and throws in one step, so that
 * failures raised by the facade itself are visible in `adb logcat` / the Metro
 * console with their cause and fix, exactly like native ones.
 */
function fail(
  code: string,
  message: string,
  options?: { cause?: unknown }
): never {
  const error = new GoogleCredentialLoginError(code, message, options);
  logDevError(error);
  throw error;
}

/**
 * React Native rejects with a plain `Error` carrying a `code`, so every native
 * failure has to pass through here for `instanceof GoogleCredentialLoginError`
 * to hold — and for the remedy to reach the caller's log.
 */
async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const normalized = normalizeError(error);
    logDevError(normalized);
    throw normalized;
  }
}

/**
 * `get` returns null where the native module is not linked, which is the normal
 * situation in Expo Go and on web.
 */
function native(): Spec {
  if (NativeModule == null) {
    return fail(
      'UNSUPPORTED',
      'The GoogleCredentialManagerLogin native module is not linked in this app.'
    );
  }
  return NativeModule;
}

function assertConfigured(): void {
  if (!isConfigured) {
    fail(
      'NOT_CONFIGURED',
      'GoogleCredentialLogin not configured. Call configure() first.'
    );
  }
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/** A missing value stays missing; a wrong type is an error, not a silent drop. */
function optionalTrimmed(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    return fail('NOT_CONFIGURED', `${name} must be a string`);
  }
  return value.trim() || undefined;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    return fail('NOT_CONFIGURED', `${name} must be a boolean`);
  }
  return value;
}

/**
 * Every element must be a non-empty string. The platforms disagree about
 * anything else — Android drops blanks, iOS would hand an `NSNull` to
 * GoogleSignIn — so it is rejected here rather than behaving differently.
 */
function cleanScopes(value: unknown, code: string, label: string): string[] {
  if (!Array.isArray(value)) {
    return fail(code, `${label} must be an array of strings`);
  }
  return value.map((scope: unknown, index) => {
    const trimmed = typeof scope === 'string' ? scope.trim() : '';
    if (!trimmed) {
      return fail(code, `${label}[${index}] must be a non-empty string`);
    }
    return trimmed;
  });
}

function normalizeConfig(
  config: GoogleCredentialManagerLoginConfig
): GoogleCredentialManagerLoginConfig {
  if (!config || typeof config !== 'object') {
    return fail('NOT_CONFIGURED', 'configure() requires a config object');
  }

  const webClientId = optionalTrimmed(config.webClientId, 'webClientId');
  if (!webClientId) {
    return fail('NOT_CONFIGURED', 'webClientId is required');
  }

  // Trimmed here because the native sides and the Expo plugin would otherwise
  // each trim (or not) on their own, and a stray newline from a `.env` file
  // would make iOS disagree with the URL scheme the plugin registered.
  const iosClientId = optionalTrimmed(config.iosClientId, 'iosClientId');
  if (Platform.OS === 'ios' && !iosClientId) {
    return fail(
      'NOT_CONFIGURED',
      'iosClientId is required on iOS. It must match the reversed-client-ID URL ' +
        'scheme in your Info.plist; the web client ID will not work here.'
    );
  }

  const normalized: GoogleCredentialManagerLoginConfig = { webClientId };
  if (iosClientId) normalized.iosClientId = iosClientId;

  const nonce = optionalTrimmed(config.nonce, 'nonce');
  if (nonce) normalized.nonce = nonce;

  const hostedDomain = optionalTrimmed(config.hostedDomain, 'hostedDomain');
  if (hostedDomain) normalized.hostedDomain = hostedDomain;

  const filter = optionalBoolean(
    config.filterByAuthorizedAccounts,
    'filterByAuthorizedAccounts'
  );
  if (filter !== undefined) normalized.filterByAuthorizedAccounts = filter;

  const offlineAccess = optionalBoolean(config.offlineAccess, 'offlineAccess');
  if (offlineAccess !== undefined) normalized.offlineAccess = offlineAccess;

  const forceCode = optionalBoolean(
    config.forceCodeForRefreshToken,
    'forceCodeForRefreshToken'
  );
  if (forceCode !== undefined) normalized.forceCodeForRefreshToken = forceCode;

  if (config.scopes !== undefined) {
    normalized.scopes = cleanScopes(config.scopes, 'NOT_CONFIGURED', 'scopes');
  }

  return normalized;
}

/**
 * `Shape` is the handful of fields the check reads, typed explicitly so the
 * check does not rely on property access into an index signature (which
 * `noPropertyAccessFromIndexSignature` rejects).
 */
function parseNative<T, Shape extends object>(
  json: string,
  what: string,
  expectation: string,
  isValid: (raw: Shape) => boolean
): T {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause) {
    fail('PARSE_ERROR', `Native module returned malformed JSON for ${what}`, {
      cause,
    });
  }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    Array.isArray(raw) ||
    !isValid(raw as Shape)
  ) {
    fail(
      'PARSE_ERROR',
      `Native module returned an unexpected ${what} shape: ${expectation}`
    );
  }
  return raw as T;
}

type RawUser = { idToken?: unknown; id?: unknown; email?: unknown };

// An empty `id` is rejected, not passed through: it is the account's stable key,
// so an empty one would make every such account the same user.
const parseUser = (json: string) =>
  parseNative<User, RawUser>(
    json,
    'user',
    'idToken and id must be non-empty strings and email a string',
    (raw) =>
      isNonEmptyString(raw.idToken) &&
      isNonEmptyString(raw.id) &&
      typeof raw.email === 'string'
  );

type RawAuthorization = { accessToken?: unknown; grantedScopes?: unknown };

const parseAuthorizationResult = (json: string) =>
  parseNative<AuthorizationResult, RawAuthorization>(
    json,
    'authorization',
    'accessToken must be a string and grantedScopes an array',
    (raw) =>
      typeof raw.accessToken === 'string' && Array.isArray(raw.grantedScopes)
  );

export const GoogleCredentialLogin = {
  /**
   * Returns immediately and is safe to call more than once. The native side
   * applies the config asynchronously (React Native dispatches void methods off
   * the JS thread), but always before any call made after this one, so there is
   * nothing to await. Invalid values throw here; nothing can fail natively.
   */
  configure: (config: GoogleCredentialManagerLoginConfig): void => {
    const normalized = normalizeConfig(config);
    native().configure(JSON.stringify(normalized));
    isConfigured = true;
  },

  /**
   * The Credential Manager bottom sheet on Android, falling back to the branded
   * chooser when no authorized credential exists. The browser flow on iOS.
   */
  signIn: async (): Promise<User> =>
    guard(async () => {
      assertConfigured();
      return parseUser(await native().signIn());
    }),

  /**
   * Always the branded chooser. On Android this also sidesteps the
   * `TransactionTooLargeException` crash `GetGoogleIdOption` can hit with many
   * accounts on the device (b/341690734). Identical to {@link signIn} on iOS.
   */
  signInWithChooser: async (): Promise<User> =>
    guard(async () => {
      assertConfigured();
      return parseUser(await native().signInWithChooser());
    }),

  /**
   * Restores a session without a user gesture, rejecting `NO_CREDENTIAL` when
   * there is nothing to restore. Never shows UI on iOS; on Android the sheet
   * may still appear when several accounts qualify, and it never opens a consent
   * screen — if `scopes` or `offlineAccess` need one, the user resolves without
   * `accessToken` / `serverAuthCode` and you call {@link requestAuthorization}.
   */
  signInSilently: async (): Promise<User> =>
    guard(async () => {
      assertConfigured();
      return parseUser(await native().signInSilently());
    }),

  /**
   * Incremental authorization for additional scopes. Also how you refresh an
   * expired access token — they last about an hour and nothing refreshes them
   * for you.
   */
  requestAuthorization: async (
    scopes: string[]
  ): Promise<AuthorizationResult> =>
    guard(async () => {
      assertConfigured();
      const cleaned = cleanScopes(
        scopes,
        'AUTHORIZATION_FAILED',
        'requestAuthorization scopes'
      );
      if (cleaned.length === 0) {
        fail(
          'AUTHORIZATION_FAILED',
          'requestAuthorization requires a non-empty array of scopes'
        );
      }
      return parseAuthorizationResult(
        await native().requestAuthorization(JSON.stringify(cleaned))
      );
    }),

  /** Clears the local session only. Use {@link revokeAccess} to drop the grant. */
  signOut: async (): Promise<void> => guard(() => native().signOut()),

  /**
   * Revokes the OAuth grant, so the next sign-in asks for consent again. Call it
   * while the user is still signed in — after {@link signOut} the account is
   * forgotten. Rejects `REVOKE_FAILED` if the grant survived, in which case
   * local state was still cleared.
   */
  revokeAccess: async (): Promise<void> =>
    guard(() => {
      assertConfigured();
      return native().revokeAccess();
    }),

  /** Testing only. */
  _reset: (): void => {
    isConfigured = false;
  },
};
