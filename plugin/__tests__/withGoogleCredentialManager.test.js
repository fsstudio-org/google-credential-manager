// `expo` is only a peer dependency and is not installed here, so the plugin API
// is replaced with the smallest stand-in that still runs the plugin's own logic:
// `withInfoPlist` hands the callback a plist and returns the mutated config.
const mockAddWarningIOS = jest.fn();

jest.mock(
  'expo/config-plugins',
  () => ({
    createRunOncePlugin: (plugin) => plugin,
    withInfoPlist: (config, action) =>
      action({ ...config, modResults: config.plist }),
    WarningAggregator: {
      addWarningIOS: (...args) => mockAddWarningIOS(...args),
    },
  }),
  { virtual: true }
);

const withGoogleCredentialManager = require('../withGoogleCredentialManager');

const IOS_CLIENT_ID = '123-ios.apps.googleusercontent.com';
const SCHEME = 'com.googleusercontent.apps.123-ios';

/** Runs the plugin over a plist and returns the plist it produced. */
function run(props, plist = {}) {
  const config = withGoogleCredentialManager({ plist }, props);
  return config.modResults;
}

describe('withGoogleCredentialManager', () => {
  beforeEach(() => mockAddWarningIOS.mockClear());

  it('registers the reversed-client-ID URL scheme', () => {
    const plist = run({ iosClientId: IOS_CLIENT_ID });

    expect(plist.CFBundleURLTypes).toEqual([{ CFBundleURLSchemes: [SCHEME] }]);
  });

  it('keeps URL types another plugin or the app already registered', () => {
    const existing = { CFBundleURLSchemes: ['myapp'], CFBundleURLName: 'app' };
    const plist = run(
      { iosClientId: IOS_CLIENT_ID },
      {
        CFBundleURLTypes: [existing],
      }
    );

    expect(plist.CFBundleURLTypes).toEqual([
      existing,
      { CFBundleURLSchemes: [SCHEME] },
    ]);
  });

  it('is idempotent: a second prebuild does not add a duplicate scheme', () => {
    const first = run({ iosClientId: IOS_CLIENT_ID });
    const second = run({ iosClientId: IOS_CLIENT_ID }, first);

    expect(second.CFBundleURLTypes).toHaveLength(1);
  });

  it('does not add a scheme that is already registered inside a larger entry', () => {
    const plist = run(
      { iosClientId: IOS_CLIENT_ID },
      {
        CFBundleURLTypes: [{ CFBundleURLSchemes: ['myapp', SCHEME] }],
      }
    );

    expect(plist.CFBundleURLTypes).toHaveLength(1);
  });

  it('writes GIDClientID and GIDServerClientID', () => {
    const plist = run({
      iosClientId: IOS_CLIENT_ID,
      webClientId: '456-web.apps.googleusercontent.com',
    });

    expect(plist.GIDClientID).toBe(IOS_CLIENT_ID);
    expect(plist.GIDServerClientID).toBe('456-web.apps.googleusercontent.com');
  });

  it('omits GIDServerClientID when no web client ID is given', () => {
    const plist = run({ iosClientId: IOS_CLIENT_ID });

    expect(plist).not.toHaveProperty('GIDServerClientID');
  });

  // A `.env` with CRLF line endings yields a trailing "\r". The scheme was
  // always trimmed; GIDClientID must agree with it.
  it('trims both IDs so GIDClientID agrees with the registered scheme', () => {
    const plist = run({
      iosClientId: `${IOS_CLIENT_ID}\r\n`,
      webClientId: ' 456-web.apps.googleusercontent.com\n',
    });

    expect(plist.CFBundleURLTypes).toEqual([{ CFBundleURLSchemes: [SCHEME] }]);
    expect(plist.GIDClientID).toBe(IOS_CLIENT_ID);
    expect(plist.GIDServerClientID).toBe('456-web.apps.googleusercontent.com');
  });

  it('warns and leaves the config untouched when iosClientId is missing', () => {
    const plist = {};
    const config = withGoogleCredentialManager({ plist }, {});

    expect(mockAddWarningIOS).toHaveBeenCalledTimes(1);
    expect(mockAddWarningIOS.mock.calls[0][1]).toContain('iosClientId');
    expect(config.modResults).toBeUndefined();
    expect(plist).toEqual({});
  });

  it('throws, naming the expected suffix, for something that is not a client ID', () => {
    expect(() => run({ iosClientId: 'not-a-client-id' })).toThrow(
      '.apps.googleusercontent.com'
    );
  });

  it('throws for a non-string iosClientId instead of registering nothing', () => {
    expect(() => run({ iosClientId: 42 })).toThrow('iOS OAuth client ID');
  });
});
