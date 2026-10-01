package com.googlecredentialmanagerlogin

import android.accounts.Account
import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.CancellationSignal
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.CredentialOption
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialInterruptedException
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException
import androidx.credentials.exceptions.GetCredentialUnsupportedException
import androidx.credentials.exceptions.NoCredentialException
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.auth.api.identity.RevokeAccessRequest
import com.google.android.gms.common.api.Scope
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import org.json.JSONArray
import org.json.JSONObject
import java.lang.reflect.InvocationHandler
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Proxy
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

class GoogleCredentialManagerLoginModule(
  reactContext: ReactApplicationContext
) : NativeGoogleCredentialManagerLoginSpec(reactContext), ActivityEventListener {

  private val credentialManager: CredentialManager = CredentialManager.create(reactContext)

  /** The host app's flag, not this library's BuildConfig, which is always a release build. */
  private val isDebuggableHost: Boolean =
    (reactContext.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

  @Volatile
  private var webClientId: String? = null

  @Volatile
  private var nonce: String? = null

  @Volatile
  private var filterByAuthorizedAccounts: Boolean = true

  @Volatile
  private var hostedDomain: String? = null

  @Volatile
  private var offlineAccess: Boolean = false

  @Volatile
  private var forceCodeForRefreshToken: Boolean = false

  @Volatile
  private var configuredScopes: List<String> = emptyList()

  /**
   * The account behind the current session. Pins authorization to the same
   * account as the ID token, and is what [revokeAccess] revokes — the revoke
   * API is keyed by account, so without it there is nothing to name.
   */
  @Volatile
  private var signedInAccount: Account? = null

  /** At most one sign-in runs at a time; the reference is also its identity. */
  private val activeSignIn = AtomicReference<SignInFlow?>(null)

  /** At most one authorization runs at a time, including a consent screen on display. */
  private val activeAuthorization = AtomicReference<PendingAuthorization?>(null)

  init {
    reactContext.addActivityEventListener(this)
  }

  /**
   * Credential Manager stops calling back once its signal is cancelled, so the
   * cancel paths settle [promise] themselves. Every terminal path goes through
   * [claimSignIn], and a callback that loses the claim belongs to a flow that
   * was already settled and must drop its result.
   */
  private class SignInFlow(val promise: Promise) {
    val settled = AtomicBoolean(false)

    @Volatile
    var cancellationSignal: CancellationSignal? = null
  }

  /**
   * `onResult`/`onError` settle at most once and release [activeAuthorization]
   * as they do, so every terminal path — including a cancel from [signOut] —
   * frees the slot for the next caller.
   */
  private inner class PendingAuthorization(
    private val deliverResult: (AuthorizationResult) -> Unit,
    private val deliverError: (code: String, message: String, cause: Exception?) -> Unit
  ) {
    private val settled = AtomicBoolean(false)

    /** Only a consent screen this authorization launched may resolve it. */
    @Volatile
    var consentLaunched: Boolean = false

    val isSettled: Boolean
      get() = settled.get()

    private fun claim(): Boolean {
      if (!settled.compareAndSet(false, true)) return false
      activeAuthorization.compareAndSet(this, null)
      return true
    }

    fun onResult(result: AuthorizationResult) {
      if (claim()) deliverResult(result)
    }

    fun onError(code: String, message: String, cause: Exception?) {
      if (claim()) deliverError(code, message, cause)
    }
  }

  /**
   * Logs each rejection in debuggable host apps, where `adb logcat` is often
   * the only place a developer looks. Wrapping once at the method entry keeps
   * every reject call site a literal error code, which docs.test.tsx scans for.
   */
  private fun Promise.logged(): Promise {
    if (!isDebuggableHost) return this
    val delegate = this
    // A dynamic proxy rather than `Promise by delegate` plus overrides: React
    // Native 0.83 declares `reject(code: String, …)` and 0.86 declares
    // `reject(code: String?, …)`, and Kotlin only accepts an override whose
    // parameter types match exactly, so no hand-written override compiles on both.
    return Proxy.newProxyInstance(
      Promise::class.java.classLoader,
      arrayOf(Promise::class.java),
      InvocationHandler { _, method, args ->
        if (method.name == "reject" && args != null) logRejectCall(method.parameterTypes, args)
        try {
          method.invoke(delegate, *(args ?: emptyArray()))
        } catch (e: InvocationTargetException) {
          throw e.targetException
        }
      },
    ) as Promise
  }

  /** Logs only the (code, message), (code, throwable) and (code, message, throwable) overloads. */
  private fun logRejectCall(types: Array<Class<*>>, args: Array<out Any?>) {
    val code = args[0] as? String ?: return
    when {
      args.size == 2 && types[1] == String::class.java ->
        logRejection(code, args[1] as String?, null)
      args.size == 2 && types[1] == Throwable::class.java ->
        logRejection(code, null, args[1] as Throwable?)
      args.size == 3 && types[1] == String::class.java && types[2] == Throwable::class.java ->
        logRejection(code, args[1] as String?, args[2] as Throwable?)
    }
  }

  /**
   * Messages carry no tokens or emails; the throwable is Google's own exception.
   * Outcomes an app handles in normal use log at info, matching the JS side's
   * devLog, so a closed sheet does not read as a warning.
   */
  private fun logRejection(code: String, message: String?, throwable: Throwable?) {
    val line = "$code: ${message ?: throwable?.message ?: "(no message)"} — full cause and fix: " +
      "see the [google-credential-manager] line in the ReactNativeJS log, or " +
      "AGENTS.md#${code.lowercase()}"
    if (code in EXPECTED_REJECTIONS) {
      Log.i(TAG, line, throwable)
    } else {
      Log.w(TAG, line, throwable)
    }
  }

  /**
   * Void TurboModule methods run asynchronously, so a throw here cannot reach
   * JS — it would crash the app instead. The facade validates first, so this
   * only guards against a JS/native version skew.
   */
  @Synchronized
  override fun configure(configJson: String) {
    val config = try {
      JSONObject(configJson)
    } catch (e: Exception) {
      Log.e(TAG, "configure() received malformed JSON; keeping the previous configuration", e)
      return
    }

    webClientId = config.optString("webClientId").trim().ifBlank { null }
    nonce = config.optString("nonce").trim().ifBlank { null }
    filterByAuthorizedAccounts = config.optBoolean("filterByAuthorizedAccounts", true)
    hostedDomain = config.optString("hostedDomain").trim().ifBlank { null }
    offlineAccess = config.optBoolean("offlineAccess", false)
    forceCodeForRefreshToken = config.optBoolean("forceCodeForRefreshToken", false)
    configuredScopes = config.optJSONArray("scopes").toStringList()
  }

  private data class SignInPreflight(
    val activity: Activity,
    val clientId: String,
    val requestNonce: String?,
    val flow: SignInFlow,
  )

  /** On success registers the flow as [activeSignIn]; [claimSignIn] releases it. */
  private fun beginSignIn(jsPromise: Promise): SignInPreflight? {
    val promise = jsPromise.logged()

    val activity = getSafeActivity()
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "No active Activity is available for sign-in")
      return null
    }

    val clientId = webClientId?.trim()
    if (clientId.isNullOrEmpty()) {
      promise.reject("NOT_CONFIGURED", "Google Credential Manager is not configured with a valid webClientId")
      return null
    }

    val flow = SignInFlow(promise)
    if (!activeSignIn.compareAndSet(null, flow)) {
      promise.reject("IN_PROGRESS", "A sign-in request is already in progress")
      return null
    }

    return SignInPreflight(activity, clientId, nonce?.trim()?.ifBlank { null }, flow)
  }

  override fun signIn(promise: Promise) {
    val pre = beginSignIn(promise) ?: return
    runCredentialFlow(
      activity = pre.activity,
      option = buildGoogleIdOption(pre.clientId, pre.requestNonce, filterByAuthorizedAccounts, autoSelect = false),
      clientId = pre.clientId,
      requestNonce = pre.requestNonce,
      allowSiwgFallback = true,
      silent = false,
      flow = pre.flow
    )
  }

  /** Skipping GetGoogleIdOption also avoids its many-accounts crash, b/341690734. */
  override fun signInWithChooser(promise: Promise) {
    val pre = beginSignIn(promise) ?: return
    runCredentialFlow(
      activity = pre.activity,
      option = buildSignInWithGoogleOption(pre.clientId, pre.requestNonce),
      clientId = pre.clientId,
      requestNonce = pre.requestNonce,
      allowSiwgFallback = false,
      silent = false,
      flow = pre.flow
    )
  }

  /**
   * Only silent when a single authorized account qualifies; Android has no
   * headless variant. The authorization leg never shows consent here, since a
   * session restore at launch must not open a Google screen unprompted.
   */
  override fun signInSilently(promise: Promise) {
    val pre = beginSignIn(promise) ?: return
    runCredentialFlow(
      activity = pre.activity,
      option = buildGoogleIdOption(pre.clientId, pre.requestNonce, authorizedOnly = true, autoSelect = true),
      clientId = pre.clientId,
      requestNonce = pre.requestNonce,
      allowSiwgFallback = false,
      silent = true,
      flow = pre.flow
    )
  }

  /** First caller wins; a stale or cancelled callback gets false and must drop its result. */
  private fun claimSignIn(flow: SignInFlow): Boolean {
    if (!flow.settled.compareAndSet(false, true)) return false
    activeSignIn.compareAndSet(flow, null)
    return true
  }

  /** Returns the promise to settle, or null when no sign-in was left to cancel. */
  private fun cancelActiveSignIn(): Promise? {
    val flow = activeSignIn.get() ?: return null
    if (!claimSignIn(flow)) return null
    // Read after claiming: runCredentialFlow stores the signal before checking
    // `settled`, so one side always sees the other and the sheet is cancelled.
    flow.cancellationSignal?.cancel()
    return flow.promise
  }

  private fun runCredentialFlow(
    activity: Activity,
    option: CredentialOption,
    clientId: String,
    requestNonce: String?,
    allowSiwgFallback: Boolean,
    silent: Boolean,
    flow: SignInFlow
  ) {
    val promise = flow.promise

    val request = try {
      GetCredentialRequest.Builder().addCredentialOption(option).build()
    } catch (e: Exception) {
      Log.e(TAG, "Failed to build credential request", e)
      if (claimSignIn(flow)) {
        promise.reject("REQUEST_BUILD_FAILED", "Failed to build credential request: ${e.message}", e)
      }
      return
    }

    val cancellationSignal = CancellationSignal()
    flow.cancellationSignal = cancellationSignal
    if (flow.settled.get()) {
      cancellationSignal.cancel()
      return
    }

    try {
      credentialManager.getCredentialAsync(
        activity,
        request,
        cancellationSignal,
        ContextCompat.getMainExecutor(activity),
        object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
          override fun onResult(result: GetCredentialResponse) {
            if (flow.settled.get()) return
            handleSignInResult(result, silent, flow)
          }

          override fun onError(e: GetCredentialException) {
            if (flow.settled.get()) return

            if (e is NoCredentialException && allowSiwgFallback) {
              val retryActivity = getSafeActivity()
              if (retryActivity == null) {
                if (claimSignIn(flow)) {
                  promise.reject("NO_ACTIVITY", "Activity was lost before retrying sign-in")
                }
                return
              }
              runCredentialFlow(
                activity = retryActivity,
                option = buildSignInWithGoogleOption(clientId, requestNonce),
                clientId = clientId,
                requestNonce = requestNonce,
                allowSiwgFallback = false,
                silent = silent,
                flow = flow
              )
              return
            }

            if (claimSignIn(flow)) rejectCredentialError(e, promise)
          }
        }
      )
    } catch (e: Exception) {
      // An unsettled flow would hold the sign-in slot, and every later call
      // would fail IN_PROGRESS until the app restarts.
      Log.e(TAG, "Credential Manager refused the request", e)
      if (claimSignIn(flow)) {
        promise.reject("SIGN_IN_FAILED", "Credential Manager refused the request: ${e.message}", e)
      }
    }
  }

  /** GetGoogleIdOption has no hosted-domain filter; buildUserPayload's check is all there is. */
  private fun buildGoogleIdOption(
    clientId: String,
    requestNonce: String?,
    authorizedOnly: Boolean,
    autoSelect: Boolean
  ): GetGoogleIdOption {
    val builder = GetGoogleIdOption.Builder()
      .setServerClientId(clientId)
      .setFilterByAuthorizedAccounts(authorizedOnly)
      .setAutoSelectEnabled(autoSelect && authorizedOnly)
    if (!requestNonce.isNullOrBlank()) {
      builder.setNonce(requestNonce)
    }
    return builder.build()
  }

  private fun buildSignInWithGoogleOption(
    clientId: String,
    requestNonce: String?
  ): GetSignInWithGoogleOption {
    val builder = GetSignInWithGoogleOption.Builder(clientId)
    if (!requestNonce.isNullOrBlank()) {
      builder.setNonce(requestNonce)
    }
    hostedDomain?.let { builder.setHostedDomainFilter(it) }
    return builder.build()
  }

  private fun handleSignInResult(result: GetCredentialResponse, silent: Boolean, flow: SignInFlow) {
    val promise = flow.promise
    val credential = result.credential

    if (credential !is CustomCredential ||
      credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
    ) {
      val describe = (credential as? CustomCredential)?.type ?: credential::class.java.name
      Log.e(TAG, "Unexpected credential: $describe")
      if (claimSignIn(flow)) {
        promise.reject("UNEXPECTED_CREDENTIAL", "Unexpected credential: $describe")
      }
      return
    }

    val user = try {
      buildUserPayload(credential)
    } catch (e: GoogleIdTokenParsingException) {
      Log.e(TAG, "Failed to parse Google ID token credential", e)
      if (claimSignIn(flow)) {
        promise.reject(
          "PARSE_ERROR",
          "Failed to parse Google ID token credential. Check your googleid library version.",
          e
        )
      }
      return
    } catch (e: Exception) {
      Log.e(TAG, "Unexpected error while parsing Google credential", e)
      if (claimSignIn(flow)) {
        promise.reject("PARSE_ERROR", "Failed to parse Google ID token credential: ${e.message}", e)
      }
      return
    }

    when (user) {
      is PayloadResult.Failure -> {
        if (claimSignIn(flow)) promise.reject(user.code, user.message)
      }

      is PayloadResult.Success -> {
        val account = user.email.takeIf { it.isNotBlank() }?.let { Account(it, GOOGLE_ACCOUNT_TYPE) }

        // Credential Manager only returns an ID token; tokens and server auth
        // codes need a second leg through the Authorization API.
        if (!offlineAccess && configuredScopes.isEmpty()) {
          if (claimSignIn(flow)) {
            signedInAccount = account
            promise.resolve(user.json.toString())
          }
          return
        }

        authorize(
          scopes = configuredScopes.ifEmpty { DEFAULT_SCOPES },
          withOfflineAccess = offlineAccess,
          allowUserInteraction = !silent,
          account = account,
          onResult = { authResult ->
            if (claimSignIn(flow)) {
              signedInAccount = account
              user.json.merge(authResult.toJson())
              promise.resolve(user.json.toString())
            }
          },
          onError = { code, message, cause ->
            if (claimSignIn(flow)) {
              if (silent && code == "AUTHORIZATION_REQUIRED") {
                // The user is signed in; only the tokens needed consent. They
                // stay absent and requestAuthorization() can ask for them.
                signedInAccount = account
                promise.resolve(user.json.toString())
              } else {
                promise.reject(code, message, cause)
              }
            }
          }
        )
      }
    }
  }

  private sealed interface PayloadResult {
    data class Success(val json: JSONObject, val email: String) : PayloadResult
    data class Failure(val code: String, val message: String) : PayloadResult
  }

  private fun buildUserPayload(credential: CustomCredential): PayloadResult {
    val googleIdTokenCredential = GoogleIdTokenCredential.createFrom(credential.data)
    val claims = decodeIdTokenPayload(googleIdTokenCredential.idToken)
      ?: return PayloadResult.Failure("PARSE_ERROR", "Failed to decode the Google ID token payload")

    val sub = claims.optString("sub").takeIf { it.isNotEmpty() }
      ?: return PayloadResult.Failure("PARSE_ERROR", "Failed to read 'sub' claim from Google ID token")

    // Domains are case-insensitive, and `hostedDomain` is free text from the app.
    val requiredDomain = hostedDomain
    if (requiredDomain != null &&
      !claims.optString("hd").trim().equals(requiredDomain.trim(), ignoreCase = true)
    ) {
      return PayloadResult.Failure(
        "HOSTED_DOMAIN_MISMATCH",
        "Account is not a member of the required hosted domain '$requiredDomain'"
      )
    }

    // The credential's own `id` field is the email, not a stable identifier.
    val email = googleIdTokenCredential.id

    return PayloadResult.Success(
      JSONObject().apply {
        put("idToken", googleIdTokenCredential.idToken)
        put("id", sub)
        put("email", email)

        googleIdTokenCredential.displayName?.let { put("displayName", it) }
        googleIdTokenCredential.profilePictureUri?.toString()?.let { put("profilePictureUri", it) }
        googleIdTokenCredential.givenName?.let { put("givenName", it) }
        googleIdTokenCredential.familyName?.let { put("familyName", it) }
        googleIdTokenCredential.phoneNumber?.let { put("phoneNumber", it) }
      },
      email
    )
  }

  override fun requestAuthorization(scopesJson: String, promise: Promise) {
    authorizeScopes(scopesJson, promise.logged())
  }

  private fun authorizeScopes(scopesJson: String, promise: Promise) {
    if (webClientId?.trim().isNullOrEmpty()) {
      promise.reject("NOT_CONFIGURED", "Google Credential Manager is not configured with a valid webClientId")
      return
    }

    val scopes = try {
      JSONArray(scopesJson).toStringList()
    } catch (e: Exception) {
      promise.reject("AUTHORIZATION_FAILED", "Malformed scopes payload", e)
      return
    }

    if (scopes.isEmpty()) {
      promise.reject("AUTHORIZATION_FAILED", "At least one scope is required")
      return
    }

    authorize(
      scopes = scopes,
      withOfflineAccess = offlineAccess,
      allowUserInteraction = true,
      account = signedInAccount,
      onResult = { result ->
        val json = result.toJson()
        if (json.has("accessToken")) {
          result.grantedAccount()?.let { signedInAccount = it }
          promise.resolve(json.toString())
        } else {
          promise.reject("AUTHORIZATION_FAILED", "Authorization succeeded but no access token was issued")
        }
      },
      onError = { code, message, cause -> promise.reject(code, message, cause) }
    )
  }

  /**
   * With [allowUserInteraction] false, a required consent is reported as
   * AUTHORIZATION_REQUIRED rather than shown. [account], when known, pins the
   * grant to the signed-in account so tokens cannot come from a different one
   * than the ID token.
   */
  private fun authorize(
    scopes: List<String>,
    withOfflineAccess: Boolean,
    allowUserInteraction: Boolean,
    account: Account?,
    onResult: (AuthorizationResult) -> Unit,
    onError: (code: String, message: String, cause: Exception?) -> Unit
  ) {
    val activity = getSafeActivity()
    if (activity == null) {
      onError("NO_ACTIVITY", "No active Activity is available for authorization", null)
      return
    }

    val clientId = webClientId?.trim()
    if (clientId.isNullOrEmpty()) {
      onError("NOT_CONFIGURED", "Missing webClientId", null)
      return
    }

    // Claimed before any async work, so a double tap cannot start a second
    // authorization that would orphan the first one's promise.
    val auth = PendingAuthorization(onResult, onError)
    if (!activeAuthorization.compareAndSet(null, auth)) {
      onError("IN_PROGRESS", "An authorization request is already in progress", null)
      return
    }

    val requiredDomain = hostedDomain
    val request = try {
      AuthorizationRequest.builder()
        .setRequestedScopes(scopes.map { Scope(it) })
        .apply {
          if (withOfflineAccess) {
            // Deprecated from play-services-auth 21.5.0 in favour of setPrompt; 21.4.0 is pinned.
            requestOfflineAccess(clientId, forceCodeForRefreshToken)
          }
          if (account != null) setAccount(account)
          if (requiredDomain != null) filterByHostedDomain(requiredDomain)
        }
        .build()
    } catch (e: Exception) {
      Log.e(TAG, "Failed to build authorization request", e)
      auth.onError("REQUEST_BUILD_FAILED", "Failed to build authorization request: ${e.message}", e)
      return
    }

    Identity.getAuthorizationClient(activity)
      .authorize(request)
      .addOnSuccessListener { result ->
        // Cancelled by signOut() / revokeAccess() while Google was answering.
        if (auth.isSettled) return@addOnSuccessListener

        if (!result.hasResolution()) {
          auth.onResult(result)
          return@addOnSuccessListener
        }

        if (!allowUserInteraction) {
          auth.onError("AUTHORIZATION_REQUIRED", "Google requires user consent for the requested scopes", null)
          return@addOnSuccessListener
        }

        val pendingIntent = result.pendingIntent
        if (pendingIntent == null) {
          auth.onError("AUTHORIZATION_FAILED", "Authorization needs consent but no intent was provided", null)
          return@addOnSuccessListener
        }

        val resolveActivity = getSafeActivity()
        if (resolveActivity == null) {
          auth.onError("NO_ACTIVITY", "Activity was lost before the consent screen could be shown", null)
          return@addOnSuccessListener
        }

        auth.consentLaunched = true
        try {
          resolveActivity.startIntentSenderForResult(pendingIntent.intentSender, RC_AUTHORIZE, null, 0, 0, 0)
        } catch (e: Exception) {
          Log.e(TAG, "Failed to launch authorization consent intent", e)
          auth.onError("AUTHORIZATION_FAILED", "Could not present the consent screen: ${e.message}", e)
        }
      }
      .addOnFailureListener { e ->
        Log.e(TAG, "Authorization request failed", e)
        auth.onError("AUTHORIZATION_FAILED", "Authorization failed: ${e.message}", e)
      }
  }

  override fun onActivityResult(
    activity: Activity,
    requestCode: Int,
    resultCode: Int,
    data: Intent?
  ) {
    if (requestCode != RC_AUTHORIZE) return

    // A result for a consent screen whose authorization was already cancelled
    // must not settle a newer authorization that has not shown one yet.
    val pending = activeAuthorization.get() ?: return
    if (!pending.consentLaunched) return

    if (resultCode != Activity.RESULT_OK) {
      pending.onError("AUTHORIZATION_CANCELLED", "User cancelled the authorization consent screen", null)
      return
    }

    try {
      val result = Identity.getAuthorizationClient(reactApplicationContext)
        .getAuthorizationResultFromIntent(data)
      pending.onResult(result)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to read authorization result", e)
      pending.onError("AUTHORIZATION_FAILED", "Failed to read authorization result: ${e.message}", e)
    }
  }

  override fun onNewIntent(intent: Intent) {
    // Both flows return via onActivityResult.
  }

  /**
   * Settles whatever is in flight, so a pending signIn() cannot resolve after
   * the session it would have created was ended, and a consent result that
   * never arrives cannot hold the authorization slot until the app restarts.
   */
  private fun cancelInFlight(caller: String) {
    cancelActiveSignIn()?.reject("SIGN_IN_CANCELLED", "Sign-in was cancelled by $caller")
    activeAuthorization.get()?.onError("AUTHORIZATION_CANCELLED", "Authorization was cancelled by $caller", null)
  }

  override fun signOut(promise: Promise) {
    cancelInFlight("signOut()")
    signedInAccount = null
    clearCredentialState { promise.resolve(null) }
  }

  private fun clearCredentialState(onDone: () -> Unit) {
    credentialManager.clearCredentialStateAsync(
      ClearCredentialStateRequest(),
      CancellationSignal(),
      ContextCompat.getMainExecutor(reactApplicationContext),
      object : CredentialManagerCallback<Void?, ClearCredentialException> {
        override fun onResult(result: Void?) = onDone()

        override fun onError(e: ClearCredentialException) {
          // Non-fatal: only affects future account-selection behaviour.
          Log.w(TAG, "Failed to clear credential provider state", e)
          onDone()
        }
      }
    )
  }

  /**
   * The Authorization API's revoke drops every scope granted to the app for
   * that account and clears its cached tokens. It needs the account, so this
   * uses the signed-in one, or asks Google for it without showing any UI.
   */
  override fun revokeAccess(promise: Promise) {
    revokeGrant(promise.logged())
  }

  private fun revokeGrant(promise: Promise) {
    val known = signedInAccount
    cancelInFlight("revokeAccess()")

    if (known != null) {
      revokeForAccount(known, promise)
      return
    }

    // Prompting someone to grant access in order to revoke it is nonsense, so
    // discovery never shows consent.
    authorize(
      scopes = DEFAULT_SCOPES,
      withOfflineAccess = false,
      allowUserInteraction = false,
      account = null,
      onResult = { result ->
        val account = result.grantedAccount()
        if (account == null) {
          finishFailedRevoke(promise, "Google did not report which account holds the grant", null)
        } else {
          revokeForAccount(account, promise)
        }
      },
      onError = { _, message, cause -> finishFailedRevoke(promise, message, cause) }
    )
  }

  private fun revokeForAccount(account: Account, promise: Promise) {
    val request = try {
      RevokeAccessRequest.builder()
        .setAccount(account)
        .setScopes(configuredScopes.ifEmpty { DEFAULT_SCOPES }.map { Scope(it) })
        .build()
    } catch (e: Exception) {
      Log.e(TAG, "Failed to build revoke request", e)
      finishFailedRevoke(promise, "Failed to build revoke request: ${e.message}", e)
      return
    }

    Identity.getAuthorizationClient(reactApplicationContext)
      .revokeAccess(request)
      .addOnSuccessListener {
        signedInAccount = null
        clearCredentialState { promise.resolve(null) }
      }
      .addOnFailureListener { e ->
        Log.e(TAG, "Google rejected the revoke request", e)
        finishFailedRevoke(promise, "Google rejected the revoke request: ${e.message}", e)
      }
  }

  private fun finishFailedRevoke(promise: Promise, message: String, cause: Exception?) {
    signedInAccount = null
    clearCredentialState {
      promise.reject(
        "REVOKE_FAILED",
        "$message. Local credential state was cleared, but the OAuth grant may still exist. " +
          "Call revokeAccess() while the user is still signed in — before signOut() — so the " +
          "library knows which account to revoke, or revoke server-side with the refresh token.",
        cause
      )
    }
  }

  private fun decodeIdTokenPayload(idToken: String): JSONObject? {
    val parts = idToken.split(".")
    if (parts.size != 3) return null
    return try {
      JSONObject(
        String(Base64.decode(parts[1], Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP))
      )
    } catch (e: Exception) {
      null
    }
  }

  private fun rejectCredentialError(error: GetCredentialException, promise: Promise) {
    val (code, message) = when (error) {
      is GetCredentialCancellationException ->
        "SIGN_IN_CANCELLED" to "User cancelled sign-in"

      is NoCredentialException ->
        "NO_CREDENTIAL" to "No Google credential was available on this device"

      is GetCredentialInterruptedException ->
        "SIGN_IN_INTERRUPTED" to "Sign-in was interrupted. Please try again."

      is GetCredentialProviderConfigurationException ->
        "PROVIDER_CONFIGURATION_ERROR" to "Credential provider is unavailable or misconfigured on this device"

      is GetCredentialUnsupportedException ->
        "UNSUPPORTED" to "Credential Manager is unsupported on this device"

      // `type` is what actually varies here: the unclassified case is usually
      // GetCredentialCustomException, whose class name says nothing, while its
      // type carries the provider's own error string. Both, since a field
      // report is the only place anyone will read this.
      else ->
        "SIGN_IN_FAILED" to
          "Sign-in failed (${error::class.java.simpleName}, type=${error.type}): ${error.message}"
    }
    promise.reject(code, message, error)
  }

  override fun invalidate() {
    reactApplicationContext.removeActivityEventListener(this)
    cancelActiveSignIn()?.reject("SIGN_IN_INTERRUPTED", "The React context was torn down")
    activeAuthorization.get()?.onError("SIGN_IN_INTERRUPTED", "The React context was torn down", null)
    super.invalidate()
  }

  private fun getSafeActivity(): Activity? =
    (currentActivity ?: reactApplicationContext.currentActivity)
      ?.takeUnless { it.isFinishing || it.isDestroyed }

  /** The Authorization API reports its account only through this deprecated type. */
  @Suppress("DEPRECATION")
  private fun AuthorizationResult.grantedAccount(): Account? = toGoogleSignInAccount()?.account

  private fun AuthorizationResult.toJson(): JSONObject = JSONObject().apply {
    accessToken?.let { put("accessToken", it) }
    serverAuthCode?.let { put("serverAuthCode", it) }
    put("grantedScopes", JSONArray(grantedScopes))
  }

  private fun JSONObject.merge(other: JSONObject) {
    other.keys().forEach { put(it, other.get(it)) }
  }

  private fun JSONArray?.toStringList(): List<String> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { optString(it).trim().ifBlank { null } }
  }

  companion object {
    const val NAME = NativeGoogleCredentialManagerLoginSpec.NAME
    private const val TAG = "GoogleCredentialMgr"
    private const val RC_AUTHORIZE = 0x6743
    private const val GOOGLE_ACCOUNT_TYPE = "com.google"

    /** Mirrors EXPECTED_CODES in src/devLog.ts. */
    private val EXPECTED_REJECTIONS = setOf("SIGN_IN_CANCELLED", "AUTHORIZATION_CANCELLED", "NO_CREDENTIAL")

    /** Already covered by the SiWG grant, so re-requesting them shows no consent screen. */
    private val DEFAULT_SCOPES = listOf("email", "profile")
  }
}
