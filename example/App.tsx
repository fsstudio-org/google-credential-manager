import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import {
  GoogleCredentialLogin,
  GoogleCredentialLoginError,
  type User,
} from '@fsstudio-org/google-credential-manager';
import { GoogleSignInButton } from '@fsstudio-org/google-credential-manager/button';

const { iosClientId, webClientId } = (Constants.expoConfig?.extra ?? {}) as {
  iosClientId?: string;
  webClientId?: string;
};

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<string>('Not configured');
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    if (!webClientId) {
      setStatus(
        'Missing EXPO_PUBLIC_WEB_CLIENT_ID. Copy .env.example to .env, fill it in, then rebuild.'
      );
      return;
    }
    try {
      GoogleCredentialLogin.configure({
        webClientId,
        iosClientId,
        // Uncomment to exercise the Authorization API leg:
        // offlineAccess: true,
        // scopes: [DRIVE_SCOPE],
      });
      setConfigured(true);
      setStatus('Configured. Try silent restore first.');
    } catch (error) {
      setStatus(describe(error));
    }
  }, []);

  const run = useCallback(
    async (labelText: string, fn: () => Promise<unknown>) => {
      setBusy(true);
      setStatus(`${labelText}…`);
      try {
        const result = await fn();
        setStatus(`${labelText} ✓`);
        return result;
      } catch (error) {
        // Dismissing the sheet is an outcome, not a failure — the pattern the
        // error remedies ask callers to follow.
        if (
          error instanceof GoogleCredentialLoginError &&
          (error.code === 'SIGN_IN_CANCELLED' ||
            error.code === 'AUTHORIZATION_CANCELLED')
        ) {
          setStatus(`${labelText} — cancelled`);
          return undefined;
        }
        setStatus(`${labelText} ✗ — ${describe(error)}`);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const signIn = () =>
    run('signIn', async () => setUser(await GoogleCredentialLogin.signIn()));

  const signInWithChooser = () =>
    run('signInWithChooser', async () =>
      setUser(await GoogleCredentialLogin.signInWithChooser())
    );

  const signInSilently = () =>
    run('signInSilently', async () =>
      setUser(await GoogleCredentialLogin.signInSilently())
    );

  const requestDriveScope = () =>
    run('requestAuthorization', async () => {
      const result = await GoogleCredentialLogin.requestAuthorization([
        DRIVE_SCOPE,
      ]);
      setUser((current) =>
        current
          ? {
              ...current,
              accessToken: result.accessToken,
              grantedScopes: result.grantedScopes,
            }
          : current
      );
    });

  const signOut = () =>
    run('signOut', async () => {
      await GoogleCredentialLogin.signOut();
      setUser(null);
    });

  const revokeAccess = () =>
    run('revokeAccess', async () => {
      await GoogleCredentialLogin.revokeAccess();
      setUser(null);
    });

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <StatusBar style="auto" />
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>google-credential-manager</Text>
          <Text style={styles.subtitle}>
            {Platform.OS === 'android'
              ? 'Android · Jetpack Credential Manager'
              : 'iOS · GoogleSignIn SDK'}
          </Text>

          <View style={styles.statusBox}>
            {busy ? <ActivityIndicator style={styles.spinner} /> : null}
            <Text style={styles.statusText}>{status}</Text>
          </View>

          <GoogleSignInButton
            fullWidth
            disabled={!configured || busy}
            onPress={signInWithChooser}
          />

          <View style={styles.buttonRow}>
            <GoogleSignInButton
              variant="icon"
              disabled={!configured || busy}
              onPress={signInWithChooser}
            />
            <GoogleSignInButton
              variant="icon"
              theme="dark"
              shape="pill"
              disabled={!configured || busy}
              onPress={signInWithChooser}
            />
            <GoogleSignInButton
              size="small"
              shape="pill"
              label="continue"
              disabled={!configured || busy}
              onPress={signInWithChooser}
            />
          </View>

          <GoogleSignInButton
            theme="dark"
            size="large"
            label="signup"
            fullWidth
            disabled={!configured || busy}
            onPress={signInWithChooser}
          />

          <Action label="signIn()" onPress={signIn} disabled={!configured || busy} />
          <Action
            label="signInSilently()"
            onPress={signInSilently}
            disabled={!configured || busy}
          />
          <Action
            label="requestAuthorization([drive.file])"
            onPress={requestDriveScope}
            disabled={!user || busy}
          />
          <Action label="signOut()" onPress={signOut} disabled={!configured || busy} />
          <Action
            label="revokeAccess()"
            onPress={revokeAccess}
            disabled={!configured || busy}
            destructive
          />

          <Text style={styles.sectionTitle}>User</Text>
          <Text style={styles.code}>
            {user ? JSON.stringify(redact(user), null, 2) : 'null'}
          </Text>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Action({
  label,
  onPress,
  disabled,
  destructive,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.action,
        destructive && styles.actionDestructive,
        pressed && styles.actionPressed,
        disabled && styles.actionDisabled,
      ]}
    >
      <Text
        style={[styles.actionLabel, destructive && styles.actionLabelDestructive]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Tokens are long and sensitive — show enough to confirm they arrived, no more. */
function redact(user: User) {
  const truncate = (value?: string) =>
    value ? `${value.slice(0, 12)}…(${value.length} chars)` : undefined;
  return {
    ...user,
    idToken: truncate(user.idToken),
    accessToken: truncate(user.accessToken),
    serverAuthCode: truncate(user.serverAuthCode),
  };
}

function describe(error: unknown): string {
  if (error instanceof GoogleCredentialLoginError) {
    // message carries a multi-line Cause/Fix/Docs block. That belongs in the
    // log, where development builds already print it in full, not in a status
    // line — this is the pattern to copy.
    return `[${error.code}] ${error.message.split('\n')[0]}`;
  }
  if (error && typeof error === 'object' && 'code' in error) {
    return `[${String((error as { code: unknown }).code)}] ${String(
      (error as { message?: unknown }).message ?? ''
    )}`;
  }
  return String(error);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: '600', color: '#1F1F1F' },
  subtitle: { fontSize: 13, color: '#5F6368', marginBottom: 8 },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F3F4',
    borderRadius: 8,
    padding: 12,
    marginBottom: 4,
  },
  spinner: { marginRight: 10 },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusText: { flex: 1, fontSize: 13, color: '#1F1F1F' },
  action: {
    borderWidth: 1,
    borderColor: '#DADCE0',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  actionDestructive: { borderColor: '#F2B8B5' },
  actionPressed: { backgroundColor: '#F1F3F4' },
  actionDisabled: { opacity: 0.4 },
  actionLabel: { fontSize: 14, color: '#1F1F1F' },
  actionLabelDestructive: { color: '#B3261E' },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5F6368',
    marginTop: 16,
  },
  code: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 11,
    color: '#1F1F1F',
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    padding: 12,
  },
});
