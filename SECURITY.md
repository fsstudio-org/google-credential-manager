# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately instead, using either of these:

- GitHub's private reporting: the **Security** tab of this repository, then
  **Report a vulnerability**
  ([direct link](https://github.com/fsstudio-org/google-credential-manager/security/advisories/new)).
- Email **contact@funstuff.studio**.

Include the package version, the platform (Android or iOS) and what you can
demonstrate. **Never include a real ID token, access token or `serverAuthCode`** —
a redacted header or a description of the claim is enough.

This is a small project, maintained by people with other work. Reports are read
and taken seriously, but there is no guaranteed response time.

## What is in scope

This library handles sign-in credentials, so problems in how it does that are
exactly what to report. For example:

- a token, `serverAuthCode`, email or other personal data being logged, cached or
  passed to something it should not reach
- the `id` (OIDC `sub`), `nonce` or `hostedDomain` handling letting an account or
  a replayed token through where it should not
- a way to make `signOut()` or `revokeAccess()` report success while leaving a
  session or grant in place
- anything that lets another app or a web page obtain a user's credentials through
  this library's flows

## What is not

- Vulnerabilities in Google's SDKs or services (Credential Manager, the
  Authorization API, GoogleSignIn-iOS, AppAuth). Report those to Google; if this
  library makes one easier to hit, that part is in scope.
- Consequences of a misconfigured OAuth client, for example a missing SHA-1 or an
  overly broad scope.
- Anything that depends on the ID token not being verified on your backend.
  Verifying `idToken` server-side is required, and `hostedDomain` checks in this
  library are a convenience, not a security boundary.

## Supported versions

Fixes go into the latest release only. The package is pre-1.0, so expect to
upgrade rather than to receive backports.

## A note on trust

This library was written almost entirely by AI coding agents and is only partly
device-tested — see [platform status](README.md#platform-status). Careful review
of its token handling is especially welcome.
