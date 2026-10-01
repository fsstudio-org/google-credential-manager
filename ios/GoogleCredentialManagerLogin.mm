#import "GoogleCredentialManagerLogin.h"
#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <GoogleSignIn/GoogleSignIn.h>
#import <React/RCTUtils.h>

// AppAuth's values, spelled out rather than imported: GoogleSignIn does not
// re-export AppAuth's headers, and how they are reachable depends on whether
// the app links pods as frameworks. Both are part of AppAuth's public API.
static NSString *const kAppAuthOAuthTokenErrorDomain = @"org.openid.appauth.oauth_token";
static const NSInteger kAppAuthOAuthInvalidGrant = -10;

/** Trimmed, or nil when absent, not a string, or blank. */
static NSString *TrimmedStringOrNil(id value) {
    if (![value isKindOfClass:[NSString class]]) {
        return nil;
    }
    NSString *trimmed = [(NSString *)value stringByTrimmingCharactersInSet:
                            [NSCharacterSet whitespaceAndNewlineCharacterSet]];
    return trimmed.length > 0 ? trimmed : nil;
}

/**
 * Only non-blank strings survive: anything else in the array would be handed
 * to GoogleSignIn as a scope, which expects NSString and does not check.
 */
static NSArray<NSString *> *CleanScopes(id value) {
    if (![value isKindOfClass:[NSArray class]]) {
        return @[];
    }
    NSMutableArray<NSString *> *scopes = [NSMutableArray new];
    for (id element in (NSArray *)value) {
        NSString *scope = TrimmedStringOrNil(element);
        if (scope != nil && ![scopes containsObject:scope]) {
            [scopes addObject:scope];
        }
    }
    return [scopes copy];
}

static NSArray *ParseJSONArray(NSString *json) {
    NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
    if (data == nil) {
        return nil;
    }
    id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    return [parsed isKindOfClass:[NSArray class]] ? parsed : nil;
}

/**
 * The ID token's payload, or nil when it cannot be decoded. Read only for the
 * `hd` claim of a token Google has just issued; it is never treated as verified,
 * which is the backend's job.
 */
static NSDictionary *IDTokenClaims(NSString *idToken) {
    NSArray<NSString *> *parts = [idToken componentsSeparatedByString:@"."];
    if (parts.count != 3) {
        return nil;
    }
    // base64url to base64, padded to a multiple of four.
    NSMutableString *base64 = [parts[1] mutableCopy];
    [base64 replaceOccurrencesOfString:@"-" withString:@"+" options:0 range:NSMakeRange(0, base64.length)];
    [base64 replaceOccurrencesOfString:@"_" withString:@"/" options:0 range:NSMakeRange(0, base64.length)];
    while (base64.length % 4 != 0) {
        [base64 appendString:@"="];
    }
    NSData *data = [[NSData alloc] initWithBase64EncodedString:base64 options:0];
    if (data == nil) {
        return nil;
    }
    id claims = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    return [claims isKindOfClass:[NSDictionary class]] ? claims : nil;
}

/**
 * The callback scheme GoogleSignIn derives from a client ID: its dot-separated
 * components reversed, lowercased. For `<id>.apps.googleusercontent.com` that
 * is `com.googleusercontent.apps.<id>`, the scheme the config plugin registers.
 * Computed the SDK's way so this check fails exactly when the SDK would throw.
 */
static NSString *CallbackSchemeForClientID(NSString *clientID) {
    NSArray<NSString *> *parts = [clientID componentsSeparatedByString:@"."];
    return [[[parts reverseObjectEnumerator] allObjects] componentsJoinedByString:@"."]
        .lowercaseString;
}

static BOOL AppRegistersURLScheme(NSString *scheme) {
    id urlTypes = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleURLTypes"];
    if (![urlTypes isKindOfClass:[NSArray class]]) {
        return NO;
    }
    for (id urlType in (NSArray *)urlTypes) {
        if (![urlType isKindOfClass:[NSDictionary class]]) {
            continue;
        }
        id schemes = ((NSDictionary *)urlType)[@"CFBundleURLSchemes"];
        if (![schemes isKindOfClass:[NSArray class]]) {
            continue;
        }
        for (id candidate in (NSArray *)schemes) {
            if ([candidate isKindOfClass:[NSString class]] &&
                [((NSString *)candidate).lowercaseString isEqualToString:scheme]) {
                return YES;
            }
        }
    }
    return NO;
}

/**
 * Debug builds echo every rejection to the Xcode console, since a rejection JS
 * swallows, or one that lands before Metro attaches, is otherwise invisible.
 * Codes, messages and error descriptions only — never tokens or profile data.
 */
static RCTPromiseRejectBlock LoggingReject(RCTPromiseRejectBlock reject) {
#if DEBUG
    return ^(NSString *code, NSString *message, NSError *error) {
        NSString *underlying = error != nil
            ? [NSString stringWithFormat:@" (underlying %@ %ld: %@)",
                  error.domain, (long)error.code, error.localizedDescription]
            : @"";
        NSLog(@"[GoogleCredentialManagerLogin] %@: %@%@ — full cause and fix: see the "
              @"[google-credential-manager] line in the JS console (Metro/Xcode), or AGENTS.md#%@",
              code, message, underlying, code.lowercaseString);
        reject(code, message, error);
    };
#else
    return reject;
#endif
}

/**
 * Module state is read and written only on the main queue. TurboModule methods
 * arrive on the module's serial method queue and hop to main in call order, so
 * a configure() issued before a signIn() is still applied before it.
 */
@implementation GoogleCredentialManagerLogin {
    NSString *_webClientId;
    NSString *_iosClientId;
    NSString *_nonce;
    NSString *_hostedDomain;
    NSArray<NSString *> *_scopes;
    BOOL _offlineAccess;
    // GIDSignIn tracks one flow at a time in shared state, and a second
    // sign-in, silent restore or add-scopes call overwrites the first one's
    // completion, leaving its promise unsettled. So all three share this slot.
    BOOL _requestInProgress;
}

#pragma mark - Configuration

- (void)configure:(NSString *)configJson {
    NSData *data = [configJson dataUsingEncoding:NSUTF8StringEncoding];
    id parsed = data != nil ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    if (![parsed isKindOfClass:[NSDictionary class]]) {
        NSLog(@"[GoogleCredentialManagerLogin] configure() received malformed JSON");
        return;
    }
    NSDictionary *config = parsed;

    // Trimmed like Android: a CRLF .env value would otherwise reach
    // GIDConfiguration intact, while the config plugin registers the trimmed
    // scheme, and the two would never match.
    NSString *webClientId = TrimmedStringOrNil(config[@"webClientId"]);
    NSString *iosClientId = TrimmedStringOrNil(config[@"iosClientId"]);
    NSString *nonce = TrimmedStringOrNil(config[@"nonce"]);
    NSString *hostedDomain = TrimmedStringOrNil(config[@"hostedDomain"]);
    NSArray<NSString *> *scopes = CleanScopes(config[@"scopes"]);
    id offlineValue = config[@"offlineAccess"];
    BOOL offlineAccess = [offlineValue isKindOfClass:[NSNumber class]] && [offlineValue boolValue];

    dispatch_async(dispatch_get_main_queue(), ^{
        self->_webClientId = webClientId;
        self->_iosClientId = iosClientId;
        self->_nonce = nonce;
        self->_hostedDomain = hostedDomain;
        self->_scopes = scopes;
        self->_offlineAccess = offlineAccess;

        if (iosClientId == nil) {
            NSLog(@"[GoogleCredentialManagerLogin] iosClientId is missing — sign-in will fail.");
            return;
        }

        // clientID must be this app's iOS client and match the reversed-client-ID URL
        // scheme in Info.plist. serverClientID is the web client, and per the SDK
        // headers it becomes the ID token's `aud`, which is what makes the token
        // verify identically to one issued on Android.
        [GIDSignIn sharedInstance].configuration =
            [[GIDConfiguration alloc] initWithClientID:iosClientId
                                        serverClientID:webClientId
                                          hostedDomain:hostedDomain
                                           openIDRealm:nil];
    });
}

#pragma mark - Sign-in

- (void)signIn:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    reject = LoggingReject(reject);
    dispatch_async(dispatch_get_main_queue(), ^{
        if (self->_iosClientId == nil) {
            reject(@"NOT_CONFIGURED", @"Call configure() with an iosClientId first", nil);
            return;
        }

        if (![self checkNotInProgress:reject]) {
            return;
        }

        if (![self checkCallbackSchemeForClientID:[GIDSignIn sharedInstance].configuration.clientID
                                           reject:reject]) {
            return;
        }

        UIViewController *presentingViewController = RCTPresentedViewController();
        if (presentingViewController == nil) {
            reject(@"VIEW_CONTROLLER_MISSING", @"No presenting view controller found", nil);
            return;
        }

        // Claimed only once nothing below can return early; the completion
        // releases it before settling.
        self->_requestInProgress = YES;

        void (^completion)(GIDSignInResult * _Nullable, NSError * _Nullable) =
            ^(GIDSignInResult * _Nullable signInResult, NSError * _Nullable error) {
                self->_requestInProgress = NO;

                if (error) {
                    [self rejectSignInError:error reject:reject];
                    return;
                }

                GIDGoogleUser *user = signInResult.user;
                if (user == nil) {
                    reject(@"NO_USER", @"No user returned", nil);
                    return;
                }

                [self resolveUser:user
                   serverAuthCode:signInResult.serverAuthCode
                          resolve:resolve
                           reject:reject];
            };

        NSArray<NSString *> *additionalScopes = self->_scopes.count > 0 ? self->_scopes : nil;

        if (self->_nonce != nil || additionalScopes != nil) {
            // The hint:additionalScopes:nonce: overload is GoogleSignIn 9.0+.
            [[GIDSignIn sharedInstance] signInWithPresentingViewController:presentingViewController
                                                                      hint:nil
                                                          additionalScopes:additionalScopes
                                                                     nonce:self->_nonce
                                                                completion:completion];
        } else {
            [[GIDSignIn sharedInstance] signInWithPresentingViewController:presentingViewController
                                                                completion:completion];
        }
    });
}

/** GIDSignIn always shows the chooser, so this is signIn. */
- (void)signInWithChooser:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    // signIn wraps reject for logging itself.
    [self signIn:resolve reject:reject];
}

- (void)signInSilently:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    reject = LoggingReject(reject);
    dispatch_async(dispatch_get_main_queue(), ^{
        if (self->_iosClientId == nil) {
            reject(@"NOT_CONFIGURED", @"Call configure() with an iosClientId first", nil);
            return;
        }

        // No UI, but the restore runs through the same GIDSignIn flow state
        // as an interactive sign-in, so it takes the same slot.
        if (![self checkNotInProgress:reject]) {
            return;
        }
        self->_requestInProgress = YES;

        [[GIDSignIn sharedInstance] restorePreviousSignInWithCompletion:
            ^(GIDGoogleUser * _Nullable user, NSError * _Nullable error) {
                self->_requestInProgress = NO;

                if (error != nil) {
                    // Google rejecting the stored refresh token (revoked from
                    // the account page, password change, expiry) means the
                    // session is gone for good, which is NO_CREDENTIAL. Any
                    // other failure — offline, server error — says nothing
                    // about the session, so it must not read as "signed out".
                    if ([error.domain isEqualToString:kAppAuthOAuthTokenErrorDomain] &&
                        error.code == kAppAuthOAuthInvalidGrant) {
                        reject(@"NO_CREDENTIAL", @"The stored Google session is no longer valid", error);
                        return;
                    }
                    [self rejectSignInError:error reject:reject];
                    return;
                }

                if (user == nil) {
                    reject(@"NO_CREDENTIAL", @"No previous Google session to restore", nil);
                    return;
                }

                // No serverAuthCode here: this returns a user, not a GIDSignInResult.
                [self resolveUser:user serverAuthCode:nil resolve:resolve reject:reject];
            }];
    });
}

#pragma mark - Authorization

- (void)requestAuthorization:(NSString *)scopesJson
                     resolve:(RCTPromiseResolveBlock)resolve
                      reject:(RCTPromiseRejectBlock)reject {
    reject = LoggingReject(reject);
    NSArray<NSString *> *scopes = CleanScopes(ParseJSONArray(scopesJson));

    dispatch_async(dispatch_get_main_queue(), ^{
        if (scopes.count == 0) {
            reject(@"AUTHORIZATION_FAILED", @"At least one non-empty scope string is required", nil);
            return;
        }

        if (self->_iosClientId == nil) {
            reject(@"NOT_CONFIGURED", @"Call configure() with an iosClientId first", nil);
            return;
        }

        GIDGoogleUser *user = [GIDSignIn sharedInstance].currentUser;
        if (user == nil) {
            reject(@"NOT_SIGNED_IN", @"Sign in before requesting additional scopes", nil);
            return;
        }

        if (![self checkNotInProgress:reject]) {
            return;
        }

        NSSet *granted = [NSSet setWithArray:user.grantedScopes ?: @[]];
        if ([[NSSet setWithArray:scopes] isSubsetOfSet:granted]) {
            self->_requestInProgress = YES;
            [user refreshTokensIfNeededWithCompletion:
                ^(GIDGoogleUser * _Nullable refreshed, NSError * _Nullable error) {
                    self->_requestInProgress = NO;
                    if (error != nil || refreshed == nil) {
                        reject(@"AUTHORIZATION_FAILED", @"Could not refresh the access token", error);
                        return;
                    }
                    [self resolveAuthorizationForUser:refreshed
                                       serverAuthCode:nil
                                              resolve:resolve
                                               reject:reject];
                }];
            return;
        }

        // addScopes runs under the configuration the user signed in with, so
        // that is the client whose scheme GoogleSignIn will insist on.
        if (![self checkCallbackSchemeForClientID:user.configuration.clientID reject:reject]) {
            return;
        }

        UIViewController *presentingViewController = RCTPresentedViewController();
        if (presentingViewController == nil) {
            reject(@"VIEW_CONTROLLER_MISSING", @"No presenting view controller found", nil);
            return;
        }

        self->_requestInProgress = YES;
        [user addScopes:scopes
            presentingViewController:presentingViewController
                          completion:^(GIDSignInResult * _Nullable signInResult, NSError * _Nullable error) {
            self->_requestInProgress = NO;
            if (error != nil) {
                // Domain first: AppAuth's codes overlap GIDSignIn's, and
                // GIDSignIn passes token-exchange errors through unwrapped.
                if ([error.domain isEqualToString:kGIDSignInErrorDomain] &&
                    error.code == kGIDSignInErrorCodeCanceled) {
                    reject(@"AUTHORIZATION_CANCELLED", @"User cancelled the consent screen", error);
                } else {
                    reject(@"AUTHORIZATION_FAILED",
                           error.localizedDescription ?: @"Authorization failed",
                           error);
                }
                return;
            }
            if (signInResult.user == nil) {
                reject(@"AUTHORIZATION_FAILED", @"Consent completed but no user was returned", nil);
                return;
            }
            [self resolveAuthorizationForUser:signInResult.user
                               serverAuthCode:signInResult.serverAuthCode
                                      resolve:resolve
                                       reject:reject];
        }];
    });
}

#pragma mark - Sign-out and revocation

- (void)signOut:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    dispatch_async(dispatch_get_main_queue(), ^{
        [[GIDSignIn sharedInstance] signOut];
        resolve(nil);
    });
}

/**
 * With nothing stored to revoke, GIDSignIn signs out and reports success: the
 * end state — no grant this device can use, no local session — is the one the
 * caller asked for.
 */
- (void)revokeAccess:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    reject = LoggingReject(reject);
    dispatch_async(dispatch_get_main_queue(), ^{
        [[GIDSignIn sharedInstance] disconnectWithCompletion:^(NSError * _Nullable error) {
            if (error != nil) {
                // GIDSignIn signs out only when the revoke succeeds. Callers are
                // promised local state is cleared either way, and a user who
                // asked to disconnect must not stay signed in because the
                // network dropped.
                [[GIDSignIn sharedInstance] signOut];
                NSString *message = [NSString stringWithFormat:
                    @"%@. Local credential state was cleared, but the OAuth grant may still exist — "
                    @"revoke it server-side with the refresh token.",
                    error.localizedDescription ?: @"Revocation failed"];
                reject(@"REVOKE_FAILED", message, error);
                return;
            }
            resolve(nil);
        }];
    });
}

#pragma mark - Helpers

/** Rejects IN_PROGRESS and returns NO when another request holds the slot. */
- (BOOL)checkNotInProgress:(RCTPromiseRejectBlock)reject {
    if (_requestInProgress) {
        reject(@"IN_PROGRESS", @"A sign-in or authorization request is already in progress", nil);
        return NO;
    }
    return YES;
}

/**
 * GIDSignIn raises NSInvalidArgumentException — an app crash, since it happens
 * inside our main-queue block — when the client's reversed ID is not a URL
 * scheme in Info.plist. That is the usual state of a bare React Native app, or
 * of one whose config plugin was given a different iosClientId than
 * configure(), so it is checked here and rejected instead.
 */
- (BOOL)checkCallbackSchemeForClientID:(NSString *)clientID reject:(RCTPromiseRejectBlock)reject {
    if (clientID.length == 0) {
        reject(@"NOT_CONFIGURED", @"GoogleSignIn has no iOS client ID configured", nil);
        return NO;
    }
    NSString *scheme = CallbackSchemeForClientID(clientID);
    if (!AppRegistersURLScheme(scheme)) {
        NSString *message = [NSString stringWithFormat:
            @"Info.plist does not register the URL scheme \"%@\" that GoogleSignIn redirects to. "
            @"Add it under CFBundleURLTypes > CFBundleURLSchemes, or with Expo add the config "
            @"plugin and re-run prebuild. It must be derived from the same iosClientId passed to "
            @"configure().",
            scheme];
        reject(@"NOT_CONFIGURED", message, nil);
        return NO;
    }
    return YES;
}

/**
 * `id` is the ID token's `sub`, which GIDGoogleUser.userID decodes on every
 * read and returns nil when it cannot. An empty id would collapse every such
 * account onto one key, so it is a PARSE_ERROR, as on Android.
 */
- (void)resolveUser:(GIDGoogleUser *)user
     serverAuthCode:(NSString *)serverAuthCode
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject {
    NSString *idToken = user.idToken.tokenString;
    if (idToken == nil) {
        reject(@"NO_ID_TOKEN", @"Google returned a session with no ID token", nil);
        return;
    }

    NSString *userID = user.userID;
    if (userID.length == 0) {
        reject(@"PARSE_ERROR", @"The ID token has no decodable `sub` claim", nil);
        return;
    }

    // GoogleSignIn only sends `hostedDomain` to Google as a hint, so a user can
    // still pick another account. Checked here the way Android does, ignoring
    // case. An account with no `hd` claim at all, such as a personal Gmail
    // address, is not in any hosted domain.
    if (_hostedDomain != nil) {
        NSString *hd = TrimmedStringOrNil(IDTokenClaims(idToken)[@"hd"]);
        if (hd == nil || [hd caseInsensitiveCompare:_hostedDomain] != NSOrderedSame) {
            // GIDSignIn has already stored the session it just created. Left in
            // place, signInSilently() would restore an account the app refused.
            [[GIDSignIn sharedInstance] signOut];
            reject(@"HOSTED_DOMAIN_MISMATCH",
                   [NSString stringWithFormat:@"Account is not a member of the required hosted domain '%@'",
                                              _hostedDomain],
                   nil);
            return;
        }
    }

    NSMutableDictionary *userData = [NSMutableDictionary new];
    userData[@"idToken"] = idToken;
    userData[@"id"] = userID;
    userData[@"email"] = user.profile.email ?: @"";

    if (user.profile.name) userData[@"displayName"] = user.profile.name;
    if (user.profile.givenName) userData[@"givenName"] = user.profile.givenName;
    if (user.profile.familyName) userData[@"familyName"] = user.profile.familyName;
    if ([user.profile hasImage]) {
        NSURL *imageURL = [user.profile imageURLWithDimension:128];
        if (imageURL) userData[@"profilePictureUri"] = imageURL.absoluteString;
    }

    // Only surfaced when scopes were asked for, matching Android.
    if (_scopes.count > 0 || _offlineAccess) {
        if (user.accessToken.tokenString) userData[@"accessToken"] = user.accessToken.tokenString;
        if (user.grantedScopes) userData[@"grantedScopes"] = user.grantedScopes;
    }

    if (serverAuthCode != nil) {
        userData[@"serverAuthCode"] = serverAuthCode;
    }

    [self resolveJSON:userData resolve:resolve reject:reject];
}

- (void)resolveAuthorizationForUser:(GIDGoogleUser *)user
                     serverAuthCode:(NSString *)serverAuthCode
                            resolve:(RCTPromiseResolveBlock)resolve
                             reject:(RCTPromiseRejectBlock)reject {
    NSString *accessToken = user.accessToken.tokenString;
    if (accessToken == nil) {
        reject(@"AUTHORIZATION_FAILED", @"Authorization succeeded but no access token was issued", nil);
        return;
    }

    NSMutableDictionary *payload = [NSMutableDictionary new];
    payload[@"accessToken"] = accessToken;
    payload[@"grantedScopes"] = user.grantedScopes ?: @[];
    if (serverAuthCode != nil) {
        payload[@"serverAuthCode"] = serverAuthCode;
    }

    [self resolveJSON:payload resolve:resolve reject:reject];
}

- (void)resolveJSON:(NSDictionary *)payload
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject {
    NSError *jsonError = nil;
    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:payload options:0 error:&jsonError];
    if (jsonError || jsonData == nil) {
        reject(@"PARSE_ERROR", @"Failed to serialize native payload", jsonError);
        return;
    }
    resolve([[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding]);
}

/**
 * The code means nothing without the domain: AppAuth's OIDErrorCodeNetworkError
 * is -5, the same as kGIDSignInErrorCodeCanceled, and GIDSignIn passes
 * token-exchange errors through unwrapped. Read by code alone, a network drop
 * after the user picked an account would be reported as a cancellation.
 */
- (void)rejectSignInError:(NSError *)error reject:(RCTPromiseRejectBlock)reject {
    if ([error.domain isEqualToString:kGIDSignInErrorDomain]) {
        switch (error.code) {
            case kGIDSignInErrorCodeCanceled:
                reject(@"SIGN_IN_CANCELLED", @"User cancelled sign-in", error);
                return;
            case kGIDSignInErrorCodeHasNoAuthInKeychain:
                reject(@"NO_CREDENTIAL", @"No Google session is stored on this device", error);
                return;
            default:
                break;
        }
    }
    reject(@"SIGN_IN_FAILED", error.localizedDescription ?: @"Sign-in failed", error);
}

#pragma mark - TurboModule

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::NativeGoogleCredentialManagerLoginSpecJSI>(params);
}

+ (NSString *)moduleName
{
  return @"GoogleCredentialManagerLogin";
}

@end
