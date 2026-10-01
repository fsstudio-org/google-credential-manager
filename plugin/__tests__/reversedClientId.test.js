const { reversedClientId } = require('../reversedClientId');

describe('reversedClientId', () => {
  it('reverses a Google iOS OAuth client ID', () => {
    expect(reversedClientId('123456-abcdef.apps.googleusercontent.com')).toBe(
      'com.googleusercontent.apps.123456-abcdef'
    );
  });

  it('tolerates surrounding whitespace', () => {
    expect(reversedClientId('  123-abc.apps.googleusercontent.com \n')).toBe(
      'com.googleusercontent.apps.123-abc'
    );
  });

  it('returns null for a non-Google identifier', () => {
    expect(reversedClientId('not-a-client-id')).toBeNull();
  });

  // The most likely misconfiguration is pasting the web client ID here. It has
  // the same suffix, so it can't be told apart by shape — this only documents
  // that the function does not pretend to catch it.
  it('cannot distinguish a web client ID by shape alone', () => {
    expect(reversedClientId('999-web.apps.googleusercontent.com')).toBe(
      'com.googleusercontent.apps.999-web'
    );
  });

  it('returns null for the bare suffix', () => {
    expect(reversedClientId('.apps.googleusercontent.com')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(reversedClientId(undefined)).toBeNull();
    expect(reversedClientId(null)).toBeNull();
    expect(reversedClientId(42)).toBeNull();
  });
});
