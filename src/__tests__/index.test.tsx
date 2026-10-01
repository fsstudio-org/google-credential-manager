import { Platform } from 'react-native';
import {
  ERROR_REMEDIES,
  GoogleCredentialLogin,
  GoogleCredentialLoginError,
} from '../index';
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

const WEB_CLIENT_ID = 'test-client-id';
const IOS_CLIENT_ID = 'test-ios-client-id';

const MOCK_USER = {
  idToken: 'mock-token',
  id: 'mock-id',
  email: 'test@example.com',
};

/** Every sign-in variant shares one JSON contract, so table-drive them. */
const SIGN_IN_METHODS = [
  ['signIn', 'signIn'],
  ['signInWithChooser', 'signInWithChooser'],
  ['signInSilently', 'signInSilently'],
] as const;

function configured() {
  GoogleCredentialLogin.configure({ webClientId: WEB_CLIENT_ID });
}

function nativeMock(name: string) {
  return (GoogleCredentialManagerLogin as unknown as Record<string, jest.Mock>)[
    name
  ] as jest.Mock;
}

/** Mimics what React Native hands back when a native promise rejects. */
function nativeRejection(code: string, message: string) {
  return Object.assign(new Error(message), { code, userInfo: null });
}

function callFacade(name: string) {
  return (
    GoogleCredentialLogin as unknown as Record<string, () => Promise<unknown>>
  )[name]!();
}

describe('GoogleCredentialLogin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'android';
    GoogleCredentialLogin._reset();
  });

  describe('configure', () => {
    it('rejects an empty webClientId with NOT_CONFIGURED', () => {
      expect(() =>
        GoogleCredentialLogin.configure({ webClientId: '' })
      ).toThrow(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
    });

    it('rejects a whitespace-only webClientId', () => {
      expect(() =>
        GoogleCredentialLogin.configure({ webClientId: '   ' })
      ).toThrow(GoogleCredentialLoginError);
    });

    // React Native dispatches void TurboModule methods asynchronously, so a
    // native throw can never reach this call — validation has to happen here.
    it('never reaches the native module with an invalid config', () => {
      expect(() =>
        GoogleCredentialLogin.configure({ webClientId: '' })
      ).toThrow();
      expect(nativeMock('configure')).not.toHaveBeenCalled();
    });

    it('stays unconfigured after a rejected configure()', () => {
      expect(() =>
        GoogleCredentialLogin.configure({ webClientId: '' })
      ).toThrow();

      return expect(GoogleCredentialLogin.signIn()).rejects.toMatchObject({
        code: 'NOT_CONFIGURED',
      });
    });

    it('trims client IDs, nonce and hostedDomain before sending them', () => {
      Platform.OS = 'ios';
      GoogleCredentialLogin.configure({
        webClientId: `  ${WEB_CLIENT_ID}\r\n`,
        iosClientId: `${IOS_CLIENT_ID}\n`,
        nonce: ' n ',
        hostedDomain: ' example.com ',
      });

      const [json] = nativeMock('configure').mock.calls[0]!;
      expect(JSON.parse(json)).toEqual({
        webClientId: WEB_CLIENT_ID,
        iosClientId: IOS_CLIENT_ID,
        nonce: 'n',
        hostedDomain: 'example.com',
      });
    });

    it('omits a blank nonce rather than sending an empty string', () => {
      GoogleCredentialLogin.configure({
        webClientId: WEB_CLIENT_ID,
        nonce: ' ',
      });

      const [json] = nativeMock('configure').mock.calls[0]!;
      expect(JSON.parse(json)).toEqual({ webClientId: WEB_CLIENT_ID });
    });

    it.each([
      ['webClientId', { webClientId: 123 }],
      ['iosClientId', { webClientId: WEB_CLIENT_ID, iosClientId: 123 }],
      ['nonce', { webClientId: WEB_CLIENT_ID, nonce: 123 }],
      ['hostedDomain', { webClientId: WEB_CLIENT_ID, hostedDomain: {} }],
    ])(
      'rejects a non-string %s with NOT_CONFIGURED, not a TypeError',
      (_n, bad) => {
        expect(() =>
          GoogleCredentialLogin.configure(
            bad as unknown as Parameters<
              typeof GoogleCredentialLogin.configure
            >[0]
          )
        ).toThrow(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
      }
    );

    it.each([
      'filterByAuthorizedAccounts',
      'offlineAccess',
      'forceCodeForRefreshToken',
    ])('rejects a non-boolean %s', (key) => {
      expect(() =>
        GoogleCredentialLogin.configure({
          webClientId: WEB_CLIENT_ID,
          [key]: 'yes',
        } as unknown as Parameters<typeof GoogleCredentialLogin.configure>[0])
      ).toThrow(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
    });

    it.each([[['']], [['   ']], [[42]], [[null]], [['ok', undefined]]])(
      'rejects scopes %j that contain a blank or non-string entry',
      (scopes) => {
        expect(() =>
          GoogleCredentialLogin.configure({
            webClientId: WEB_CLIENT_ID,
            scopes: scopes as unknown as string[],
          })
        ).toThrow(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
      }
    );

    it('trims scopes and accepts an empty list', () => {
      GoogleCredentialLogin.configure({
        webClientId: WEB_CLIENT_ID,
        scopes: [' email '],
      });
      GoogleCredentialLogin.configure({
        webClientId: WEB_CLIENT_ID,
        scopes: [],
      });

      const calls = nativeMock('configure').mock.calls;
      expect(JSON.parse(calls[0]![0])).toMatchObject({ scopes: ['email'] });
      expect(JSON.parse(calls[1]![0])).toMatchObject({ scopes: [] });
    });

    it('serialises the config to JSON for the native module', () => {
      GoogleCredentialLogin.configure({
        webClientId: WEB_CLIENT_ID,
        nonce: 'test-nonce',
        filterByAuthorizedAccounts: true,
      });

      expect(nativeMock('configure')).toHaveBeenCalledTimes(1);
      const [json] = nativeMock('configure').mock.calls[0]!;
      expect(JSON.parse(json)).toEqual({
        webClientId: WEB_CLIENT_ID,
        nonce: 'test-nonce',
        filterByAuthorizedAccounts: true,
      });
    });

    it('passes offlineAccess and scopes through', () => {
      GoogleCredentialLogin.configure({
        webClientId: WEB_CLIENT_ID,
        offlineAccess: true,
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      });

      const [json] = nativeMock('configure').mock.calls[0]!;
      expect(JSON.parse(json)).toMatchObject({
        offlineAccess: true,
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      });
    });

    it('rejects a non-array scopes value', () => {
      expect(() =>
        GoogleCredentialLogin.configure({
          webClientId: WEB_CLIENT_ID,
          scopes: 'drive' as unknown as string[],
        })
      ).toThrow(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
    });

    // Passing the web client ID as GIDConfiguration.clientID silently breaks the
    // OAuth redirect, so failing loudly here is the point of the check.
    it('requires iosClientId on iOS', () => {
      Platform.OS = 'ios';
      expect(() =>
        GoogleCredentialLogin.configure({ webClientId: WEB_CLIENT_ID })
      ).toThrow(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
    });

    it('rejects a whitespace-only iosClientId on iOS', () => {
      Platform.OS = 'ios';
      expect(() =>
        GoogleCredentialLogin.configure({
          webClientId: WEB_CLIENT_ID,
          iosClientId: '   ',
        })
      ).toThrow(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
    });

    it('accepts iosClientId on iOS', () => {
      Platform.OS = 'ios';
      expect(() =>
        GoogleCredentialLogin.configure({
          webClientId: WEB_CLIENT_ID,
          iosClientId: IOS_CLIENT_ID,
        })
      ).not.toThrow();
    });

    it('does not require iosClientId on Android', () => {
      expect(() =>
        GoogleCredentialLogin.configure({ webClientId: WEB_CLIENT_ID })
      ).not.toThrow();
    });
  });

  describe.each(SIGN_IN_METHODS)('%s', (facadeName, nativeName) => {
    it('rejects with NOT_CONFIGURED before configure()', async () => {
      await expect(callFacade(facadeName)).rejects.toMatchObject({
        name: 'GoogleCredentialLoginError',
        code: 'NOT_CONFIGURED',
      });
      expect(nativeMock(nativeName)).not.toHaveBeenCalled();
    });

    it('parses the native JSON into a User', async () => {
      configured();
      nativeMock(nativeName).mockResolvedValue(JSON.stringify(MOCK_USER));

      await expect(callFacade(facadeName)).resolves.toEqual(MOCK_USER);
    });

    it('preserves optional profile and token fields', async () => {
      configured();
      const full = {
        ...MOCK_USER,
        displayName: 'Test User',
        givenName: 'Test',
        familyName: 'User',
        profilePictureUri: 'https://example.com/avatar.png',
        phoneNumber: '+15550100',
        serverAuthCode: 'auth-code',
        accessToken: 'access-token',
        grantedScopes: ['email', 'profile'],
      };
      nativeMock(nativeName).mockResolvedValue(JSON.stringify(full));

      await expect(callFacade(facadeName)).resolves.toEqual(full);
    });

    it('wraps a native rejection in GoogleCredentialLoginError', async () => {
      configured();
      nativeMock(nativeName).mockRejectedValue(
        nativeRejection('SIGN_IN_CANCELLED', 'User cancelled sign-in')
      );

      await expect(callFacade(facadeName)).rejects.toBeInstanceOf(
        GoogleCredentialLoginError
      );
    });

    it('keeps the native code, message and cause when wrapping', async () => {
      configured();
      const native = nativeRejection('NO_CREDENTIAL', 'Nothing available');
      nativeMock(nativeName).mockRejectedValue(native);

      await expect(callFacade(facadeName)).rejects.toMatchObject({
        code: 'NO_CREDENTIAL',
        cause: native,
      });
      await expect(callFacade(facadeName)).rejects.toThrow('Nothing available');
    });

    it('attaches a remedy hint to a native rejection', async () => {
      configured();
      nativeMock(nativeName).mockRejectedValue(
        nativeRejection('SIGN_IN_FAILED', 'something broke')
      );

      await expect(callFacade(facadeName)).rejects.toMatchObject({
        hint: expect.stringContaining(ERROR_REMEDIES.SIGN_IN_FAILED!.fix),
      });
    });

    it('rejects with PARSE_ERROR on malformed JSON', async () => {
      configured();
      nativeMock(nativeName).mockResolvedValue('not-json');

      await expect(callFacade(facadeName)).rejects.toMatchObject({
        name: 'GoogleCredentialLoginError',
        code: 'PARSE_ERROR',
      });
    });

    it('rejects with PARSE_ERROR when required fields are missing', async () => {
      configured();
      nativeMock(nativeName).mockResolvedValue(
        JSON.stringify({ idToken: 'only-token' })
      );

      const error = (await callFacade(facadeName).catch(
        (e) => e
      )) as GoogleCredentialLoginError;
      expect(error).toBeInstanceOf(GoogleCredentialLoginError);
      expect(error.code).toBe('PARSE_ERROR');
    });

    // `id` is the account's stable key; an empty one would merge every account
    // that hits it into a single user.
    it.each(['id', 'idToken'])(
      'rejects with PARSE_ERROR when %s is empty',
      async (field) => {
        configured();
        nativeMock(nativeName).mockResolvedValue(
          JSON.stringify({ ...MOCK_USER, [field]: '' })
        );

        const error = (await callFacade(facadeName).catch(
          (e) => e
        )) as GoogleCredentialLoginError;
        expect(error).toBeInstanceOf(GoogleCredentialLoginError);
        expect(error.code).toBe('PARSE_ERROR');
      }
    );

    it('rejects with PARSE_ERROR when the payload is an array', async () => {
      configured();
      nativeMock(nativeName).mockResolvedValue(JSON.stringify([MOCK_USER]));

      await expect(callFacade(facadeName)).rejects.toMatchObject({
        code: 'PARSE_ERROR',
      });
    });

    it('rejects with PARSE_ERROR when the payload is not an object', async () => {
      configured();
      nativeMock(nativeName).mockResolvedValue(JSON.stringify(null));

      await expect(callFacade(facadeName)).rejects.toMatchObject({
        code: 'PARSE_ERROR',
      });
    });

    it('calls only its own native method', async () => {
      configured();
      nativeMock(nativeName).mockResolvedValue(JSON.stringify(MOCK_USER));

      await callFacade(facadeName);

      for (const [, other] of SIGN_IN_METHODS) {
        if (other === nativeName) {
          expect(nativeMock(other)).toHaveBeenCalledTimes(1);
        } else {
          expect(nativeMock(other)).not.toHaveBeenCalled();
        }
      }
    });
  });

  describe('requestAuthorization', () => {
    const RESULT = {
      accessToken: 'access-token',
      grantedScopes: ['https://www.googleapis.com/auth/drive.file'],
    };

    it('rejects with NOT_CONFIGURED before configure()', async () => {
      await expect(
        GoogleCredentialLogin.requestAuthorization(['drive'])
      ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    });

    it('rejects an empty scope list without touching the native module', async () => {
      configured();
      await expect(
        GoogleCredentialLogin.requestAuthorization([])
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_FAILED' });
      expect(nativeMock('requestAuthorization')).not.toHaveBeenCalled();
    });

    it.each([[['']], [[42]], [[undefined]], ['drive']])(
      'rejects scopes %j that are not an array of non-empty strings',
      async (scopes) => {
        configured();
        await expect(
          GoogleCredentialLogin.requestAuthorization(
            scopes as unknown as string[]
          )
        ).rejects.toMatchObject({ code: 'AUTHORIZATION_FAILED' });
        expect(nativeMock('requestAuthorization')).not.toHaveBeenCalled();
      }
    );

    it('trims scopes before sending them', async () => {
      configured();
      nativeMock('requestAuthorization').mockResolvedValue(
        JSON.stringify(RESULT)
      );

      await GoogleCredentialLogin.requestAuthorization([' email ']);
      expect(nativeMock('requestAuthorization')).toHaveBeenCalledWith(
        JSON.stringify(['email'])
      );
    });

    it('serialises scopes and parses the result', async () => {
      configured();
      nativeMock('requestAuthorization').mockResolvedValue(
        JSON.stringify(RESULT)
      );

      await expect(
        GoogleCredentialLogin.requestAuthorization(RESULT.grantedScopes)
      ).resolves.toEqual(RESULT);
      expect(nativeMock('requestAuthorization')).toHaveBeenCalledWith(
        JSON.stringify(RESULT.grantedScopes)
      );
    });

    it('rejects with PARSE_ERROR when grantedScopes is not an array', async () => {
      configured();
      nativeMock('requestAuthorization').mockResolvedValue(
        JSON.stringify({ accessToken: 'a', grantedScopes: 'email' })
      );

      await expect(
        GoogleCredentialLogin.requestAuthorization(['email'])
      ).rejects.toMatchObject({ code: 'PARSE_ERROR' });
    });

    it('rejects with PARSE_ERROR when accessToken is missing', async () => {
      configured();
      nativeMock('requestAuthorization').mockResolvedValue(
        JSON.stringify({ grantedScopes: [] })
      );

      await expect(
        GoogleCredentialLogin.requestAuthorization(['email'])
      ).rejects.toMatchObject({ code: 'PARSE_ERROR' });
    });

    it('wraps a native rejection in GoogleCredentialLoginError', async () => {
      configured();
      nativeMock('requestAuthorization').mockRejectedValue(
        nativeRejection('AUTHORIZATION_CANCELLED', 'User cancelled')
      );

      await expect(
        GoogleCredentialLogin.requestAuthorization(['email'])
      ).rejects.toBeInstanceOf(GoogleCredentialLoginError);
    });
  });

  describe('signOut', () => {
    // Usable before configure(): clearing state should never throw in a logout path.
    it('calls native signOut without requiring configure()', async () => {
      await GoogleCredentialLogin.signOut();
      expect(nativeMock('signOut')).toHaveBeenCalled();
    });

    it('wraps a native rejection in GoogleCredentialLoginError', async () => {
      nativeMock('signOut').mockRejectedValue(
        nativeRejection('SIGN_IN_FAILED', 'clear failed')
      );

      await expect(GoogleCredentialLogin.signOut()).rejects.toBeInstanceOf(
        GoogleCredentialLoginError
      );
    });
  });

  describe('revokeAccess', () => {
    it('rejects with NOT_CONFIGURED before configure()', async () => {
      await expect(GoogleCredentialLogin.revokeAccess()).rejects.toMatchObject({
        code: 'NOT_CONFIGURED',
      });
    });

    it('calls native revokeAccess once configured', async () => {
      configured();
      nativeMock('revokeAccess').mockResolvedValue(undefined);

      await GoogleCredentialLogin.revokeAccess();
      expect(nativeMock('revokeAccess')).toHaveBeenCalled();
    });

    it('propagates REVOKE_FAILED from the native side as a typed error', async () => {
      configured();
      const failure = nativeRejection('REVOKE_FAILED', 'no grant');
      nativeMock('revokeAccess').mockRejectedValue(failure);

      await expect(GoogleCredentialLogin.revokeAccess()).rejects.toMatchObject({
        code: 'REVOKE_FAILED',
        cause: failure,
      });
      await expect(GoogleCredentialLogin.revokeAccess()).rejects.toBeInstanceOf(
        GoogleCredentialLoginError
      );
    });
  });

  // The error class itself is covered in errors.test.tsx; this only proves the
  // facade re-exports the same class the wrapped rejections are instances of.
  it('re-exports the error class used for native rejections', async () => {
    configured();
    nativeMock('signIn').mockRejectedValue(
      nativeRejection('SIGN_IN_CANCELLED', 'cancelled')
    );

    const error = await GoogleCredentialLogin.signIn().catch((e) => e);
    expect(error).toBeInstanceOf(GoogleCredentialLoginError);
  });
});
