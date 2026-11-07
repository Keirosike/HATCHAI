
---
name: hatchai-device-enrollment-security
description: Securely enroll multiple Android notification subscribers for HATCHAI using one shared ESP32 account without exposing credentials.
---

# HATCHAI Device Enrollment Security

## Purpose

Allow multiple Android phones to subscribe to HATCHAI notifications while using one shared ESP32-S3 username and password.

Prevent unauthorized people from registering their devices to receive private chick-detection alerts.

## Authentication Architecture

HATCHAI currently uses one shared ESP32 dashboard account.

Important:

- The ESP32 local dashboard and Firebase Hosting have different origins.
- A local ESP32 login session is not automatically trusted by Cloudflare.
- Browser notification permission is not authentication.
- Cloudflare Turnstile is not authentication.
- CORS restrictions are not authentication.

## Required Enrollment Design

Before implementing registration, inspect the existing ESP32 authentication flow.

Determine whether the ESP32 can securely issue a short-lived enrollment credential.

If the existing login mechanism cannot safely support this, propose an explicit pairing or enrollment-code workflow.

Do not invent a cloud-authenticated session merely because the user logged in locally.

## Recommended Pairing Flow

1. User successfully logs in to the ESP32 dashboard.
2. Dashboard displays the notification enrollment modal.
3. User opens the secure Firebase-hosted notification page.
4. User provides a short-lived enrollment code generated through an authorized process.
5. Cloudflare Worker verifies the code.
6. Worker issues a short-lived, scoped enrollment authorization.
7. User taps Enable Notifications.
8. Browser requests notification permission.
9. Browser obtains an FCM token.
10. Worker verifies authorization and stores the token in D1.

Avoid putting enrollment codes in URL query parameters.

Do not use a permanent shared password as a public registration secret.

## Enrollment Credential Requirements

- Generate codes using cryptographically secure randomness.
- Limit code validity.
- Use one-time or limited-use codes.
- Apply rate limits and attempt limits.
- Store only protected credential representations where practical.
- Bind issued credentials to their intended purpose.
- Prevent replay.
- Use HTTPS for all cloud verification.
- Never log passwords or enrollment secrets.

## Important Network Limitation

The ESP32 local dashboard may operate at http://192.168.4.1.

Firebase Hosting operates over HTTPS.

Do not assume the Firebase-hosted page can directly call the local ESP32 HTTP API.

Do not assume a phone connected only to the ESP32 access point has internet connectivity.

Test AP+STA connectivity and the actual Android network path.

## Token Registration

Only register an FCM token after:

- Enrollment authorization succeeds.
- The user grants notification permission.
- Firebase generates a valid token.
- The Worker validates the request.
- D1 confirms the registration.

Each Android browser must have its own registration.

Do not overwrite existing subscriptions.

## Unregister Security

- Require proof that the requester controls the registration.
- Revoke only the intended device.
- Support expired and revoked enrollment credentials.
- Do not allow one browser to delete all registrations.
- Handle local FCM token deletion separately from D1 revocation.

## Turnstile

Use Cloudflare Turnstile as an additional abuse-prevention control.

- Keep TURNSTILE_SECRET in Worker secrets.
- Verify tokens server-side.
- Validate expected hostname.
- Validate action when configured.
- Reject invalid or expired responses.
- Never expose the Turnstile secret in browser code.

## Existing Account Security

Inspect:

- src/HatchWebServer.cpp
- data/js/login.js
- data/js/authSession.js
- data/js/espApi.js

Preserve the current login experience unless changes are explicitly authorized.

Report any existing insecure password storage, HTTP exposure, or unauthenticated API routes that affect enrollment.

## Verification

- Failed login cannot authorize enrollment.
- Successful login alone does not bypass cloud verification.
- Invalid enrollment codes are rejected.
- Expired codes are rejected.
- Reused one-time codes are rejected.
- Unauthorized browsers cannot register.
- Multiple authorized Android browsers can register.
- Turnstile failures are rejected.
- Revoked devices cannot re-register without authorization.

## Completion

Document the selected enrollment method, threat model, code changes, tests, and remaining security risks.

Never claim the enrollment process is secure without verifying the actual implementation.
