import { GoogleCredentialLogin } from '../index';
import { GoogleCredentialLoginError } from '../errors';
import { logDevError } from '../devLog';
import GoogleCredentialManagerLogin from '../NativeGoogleCredentialManagerLogin';

jest.mock('../NativeGoogleCredentialManagerLogin', () => ({
  configure: jest.fn(),
  signIn: jest.fn(),
  signInWithChooser: jest.fn(),
  signInSilently: jest.fn(),
  requestAuthorization: jest.fn(),
  signOut: jest.fn(),
  revokeAccess: jest.fn(),
}));

const globals = globalThis as unknown as { __DEV__?: boolean };

function nativeMock(name: string) {
  return (GoogleCredentialManagerLogin as unknown as Record<string, jest.Mock>)[
    name
  ] as jest.Mock;
}

describe('development logging', () => {
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    GoogleCredentialLogin._reset();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    delete globals.__DEV__;
    warn.mockRestore();
    log.mockRestore();
  });

  it('prints nothing outside development', async () => {
    globals.__DEV__ = false;
    nativeMock('signIn').mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'SIGN_IN_FAILED' })
    );
    GoogleCredentialLogin.configure({ webClientId: 'web' });

    await GoogleCredentialLogin.signIn().catch(() => {});

    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('prints nothing where __DEV__ is not defined at all', () => {
    delete globals.__DEV__;
    logDevError(new GoogleCredentialLoginError('SIGN_IN_FAILED', 'x'));

    expect(warn).not.toHaveBeenCalled();
  });

  it('warns with the code, cause and fix for a native failure', async () => {
    globals.__DEV__ = true;
    nativeMock('signIn').mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'SIGN_IN_FAILED' })
    );
    GoogleCredentialLogin.configure({ webClientId: 'web' });

    await GoogleCredentialLogin.signIn().catch(() => {});

    expect(warn).toHaveBeenCalledTimes(1);
    const text = String(warn.mock.calls[0]![0]);
    expect(text).toContain('[google-credential-manager] SIGN_IN_FAILED: boom');
    expect(text).toContain('→ Cause:');
    expect(text).toContain('→ Fix:');
    expect(text).toContain('adb logcat');
  });

  it('logs a failure raised by the facade itself, once', async () => {
    globals.__DEV__ = true;

    await GoogleCredentialLogin.signIn().catch(() => {});

    // Raised by assertConfigured() and then passed through guard(): one line.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('NOT_CONFIGURED');
  });

  it('logs invalid configuration thrown synchronously', () => {
    globals.__DEV__ = true;

    expect(() =>
      GoogleCredentialLogin.configure({ webClientId: '' })
    ).toThrow();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('webClientId is required');
  });

  it.each(['SIGN_IN_CANCELLED', 'AUTHORIZATION_CANCELLED', 'NO_CREDENTIAL'])(
    'logs the expected outcome %s without a warning',
    async (code) => {
      globals.__DEV__ = true;
      nativeMock('signIn').mockRejectedValue(
        Object.assign(new Error('expected'), { code })
      );
      GoogleCredentialLogin.configure({ webClientId: 'web' });

      await GoogleCredentialLogin.signIn().catch(() => {});

      expect(warn).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]![0])).toContain(code);
    }
  );

  it('does not log the tokens in a successful result', async () => {
    globals.__DEV__ = true;
    nativeMock('signIn').mockResolvedValue(
      JSON.stringify({ idToken: 'secret-token', id: '1', email: 'a@b.c' })
    );
    GoogleCredentialLogin.configure({ webClientId: 'web' });

    await GoogleCredentialLogin.signIn();

    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
