import {
  DOCS_URL,
  ERROR_REMEDIES,
  GoogleCredentialLoginError,
  normalizeError,
} from '../errors';

/** Mimics what React Native hands back when a native promise rejects. */
function nativeRejection(code: string, message: string) {
  return Object.assign(new Error(message), { code, userInfo: null });
}

describe('GoogleCredentialLoginError', () => {
  it('carries the code and preserves the cause', () => {
    const cause = new Error('root cause');
    const error = new GoogleCredentialLoginError('PARSE_ERROR', 'boom', {
      cause,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('GoogleCredentialLoginError');
    expect(error.code).toBe('PARSE_ERROR');
    expect(error.cause).toBe(cause);
  });

  it('exposes the remedy for a known code as a hint', () => {
    const error = new GoogleCredentialLoginError('NO_CREDENTIAL', 'none here');

    expect(error.hint).toContain(ERROR_REMEDIES.NO_CREDENTIAL!.fix);
  });

  it('appends cause, fix and a docs anchor to the message', () => {
    const error = new GoogleCredentialLoginError('NO_CREDENTIAL', 'none here');

    expect(error.message).toContain('none here');
    expect(error.message).toContain(ERROR_REMEDIES.NO_CREDENTIAL!.cause);
    expect(error.message).toContain(ERROR_REMEDIES.NO_CREDENTIAL!.fix);
    expect(error.message).toContain(`${DOCS_URL}#no_credential`);
  });

  it('leaves the message alone for a code it has no remedy for', () => {
    const error = new GoogleCredentialLoginError('SOME_FUTURE_CODE', 'bare');

    expect(error.message).toBe('bare');
    expect(error.hint).toBeUndefined();
  });

  it('keeps the original message first so existing matchers still work', () => {
    const error = new GoogleCredentialLoginError('NO_CREDENTIAL', 'none here');

    expect(error.message.startsWith('none here')).toBe(true);
  });
});

describe('ERROR_REMEDIES', () => {
  const codes = Object.keys(ERROR_REMEDIES);

  it('documents every code the native modules and facade can reject with', () => {
    // Kept in lockstep with the table in README.md and AGENTS.md.
    expect(codes).toEqual(
      expect.arrayContaining([
        'NOT_CONFIGURED',
        'IN_PROGRESS',
        'SIGN_IN_CANCELLED',
        'SIGN_IN_FAILED',
        'PARSE_ERROR',
        'NO_CREDENTIAL',
        'HOSTED_DOMAIN_MISMATCH',
        'AUTHORIZATION_FAILED',
        'AUTHORIZATION_CANCELLED',
        'REVOKE_FAILED',
        'NOT_SIGNED_IN',
        'AUTHORIZATION_REQUIRED',
        'NO_ACTIVITY',
        'REQUEST_BUILD_FAILED',
        'UNEXPECTED_CREDENTIAL',
        'SIGN_IN_INTERRUPTED',
        'PROVIDER_CONFIGURATION_ERROR',
        'UNSUPPORTED',
        'VIEW_CONTROLLER_MISSING',
        'NO_USER',
        'NO_ID_TOKEN',
        'UNKNOWN',
      ])
    );
  });

  it.each(Object.entries(ERROR_REMEDIES))(
    '%s has a non-empty cause and fix',
    (_code, remedy) => {
      expect(remedy.cause.trim().length).toBeGreaterThan(0);
      expect(remedy.fix.trim().length).toBeGreaterThan(0);
    }
  );
});

describe('normalizeError', () => {
  it('returns an existing GoogleCredentialLoginError unchanged', () => {
    const original = new GoogleCredentialLoginError('PARSE_ERROR', 'boom');

    expect(normalizeError(original)).toBe(original);
  });

  it('wraps a native rejection, keeping its code', () => {
    const native = nativeRejection('SIGN_IN_CANCELLED', 'User cancelled');
    const error = normalizeError(native);

    expect(error).toBeInstanceOf(GoogleCredentialLoginError);
    expect(error.code).toBe('SIGN_IN_CANCELLED');
  });

  it('keeps the native error as the cause', () => {
    const native = nativeRejection('SIGN_IN_FAILED', 'went wrong');

    expect(normalizeError(native).cause).toBe(native);
  });

  it('adds the remedy to a native rejection', () => {
    const error = normalizeError(
      nativeRejection('NO_CREDENTIAL', 'No Google credential was available')
    );

    expect(error.hint).toBeDefined();
    expect(error.message).toContain('No Google credential was available');
    expect(error.message).toContain(ERROR_REMEDIES.NO_CREDENTIAL!.fix);
  });

  it('preserves an unrecognised native code rather than flattening it', () => {
    const error = normalizeError(nativeRejection('BRAND_NEW_CODE', 'hmm'));

    expect(error.code).toBe('BRAND_NEW_CODE');
  });

  it('falls back to UNKNOWN for an Error with no code', () => {
    const error = normalizeError(new Error('plain failure'));

    expect(error.code).toBe('UNKNOWN');
    expect(error.message).toContain('plain failure');
  });

  it('falls back to UNKNOWN for a thrown non-Error', () => {
    const error = normalizeError('just a string');

    expect(error.code).toBe('UNKNOWN');
    expect(error.message).toContain('just a string');
  });

  it('ignores a non-string code', () => {
    const error = normalizeError(Object.assign(new Error('odd'), { code: 42 }));

    expect(error.code).toBe('UNKNOWN');
  });
});
