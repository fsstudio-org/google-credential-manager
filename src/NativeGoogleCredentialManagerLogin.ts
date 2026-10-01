import { TurboModuleRegistry, type TurboModule } from 'react-native';

/**
 * JSON strings rather than codegen structs, so adding a config field never
 * changes a native signature — which keeps the generated spec base classes
 * stable across RN versions. Validation lives in the facade.
 */
export interface Spec extends TurboModule {
  /** A JSON `GoogleCredentialManagerLoginConfig`. */
  configure(configJson: string): void;
  /** Resolve with a JSON `User`. */
  signIn(): Promise<string>;
  signInWithChooser(): Promise<string>;
  signInSilently(): Promise<string>;
  /** A JSON array of scopes in; a JSON `AuthorizationResult` out. */
  requestAuthorization(scopesJson: string): Promise<string>;
  signOut(): Promise<void>;
  revokeAccess(): Promise<void>;
}

// `get`, not `getEnforcing`: where the module is not linked (Expo Go, web) the
// latter throws a bare invariant while the package is still being imported, so
// the app cannot even feature-detect. The facade turns `null` into an
// `UNSUPPORTED` error with the fix attached.
export default TurboModuleRegistry.get<Spec>('GoogleCredentialManagerLogin');
