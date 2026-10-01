import { GoogleCredentialLogin, GoogleCredentialLoginError } from '../index';

// Where the native module is not linked (Expo Go, web) TurboModuleRegistry.get
// returns null. Importing the package must still work, and every call must say
// what to do about it.
jest.mock('../NativeGoogleCredentialManagerLogin', () => null);

describe('without the native module', () => {
  beforeEach(() => GoogleCredentialLogin._reset());

  it('can be imported', () => {
    expect(GoogleCredentialLogin).toBeDefined();
  });

  it('configure() throws UNSUPPORTED with the fix attached', () => {
    let error: unknown;
    try {
      GoogleCredentialLogin.configure({ webClientId: 'web-client-id' });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(GoogleCredentialLoginError);
    expect(error).toMatchObject({ code: 'UNSUPPORTED' });
    expect((error as GoogleCredentialLoginError).message).toContain(
      'development build'
    );
  });

  it('signOut() rejects UNSUPPORTED rather than throwing synchronously', async () => {
    await expect(GoogleCredentialLogin.signOut()).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
  });
});
