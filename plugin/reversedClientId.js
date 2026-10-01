const GOOGLE_CLIENT_SUFFIX = '.apps.googleusercontent.com';

/**
 * Turns `123-abc.apps.googleusercontent.com` into
 * `com.googleusercontent.apps.123-abc`, the scheme GoogleSignIn redirects to.
 * Returns null for anything else so the caller can raise a useful error rather
 * than register a scheme that will never match.
 */
function reversedClientId(iosClientId) {
  if (typeof iosClientId !== 'string') {
    return null;
  }
  const trimmed = iosClientId.trim();
  if (!trimmed.endsWith(GOOGLE_CLIENT_SUFFIX)) {
    return null;
  }
  const id = trimmed.slice(0, -GOOGLE_CLIENT_SUFFIX.length);
  if (id.length === 0) {
    return null;
  }
  return `com.googleusercontent.apps.${id}`;
}

module.exports = { reversedClientId, GOOGLE_CLIENT_SUFFIX };
