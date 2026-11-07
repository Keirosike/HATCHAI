
---
name: cloudflare-worker-d1
description: Build and maintain HATCHAI Cloudflare Worker APIs, D1 device registrations, and Firebase Cloud Messaging broadcasts.
---

# HATCHAI Cloudflare Worker + D1

## Purpose

Manage automatic FCM token registration for multiple Android phones and broadcast chick-detection notifications using Cloudflare Workers and D1.

## Current Architecture

- Firebase Hosting: https://hatchai-8d34c.web.app
- Firebase project: hatchai-8d34c
- Cloudflare Worker: HATCHAI Push Notification API
- Cloudflare D1 database: hatchai-devices
- D1 binding: env.DB
- D1 table: push_tokens
- Firebase Cloud Messaging: HTTP v1 API
- Firebase Spark plan: Must remain supported

## Required API Endpoints

### GET /health

- Verify D1 connectivity.
- Return the number of enabled registered devices.
- Never expose FCM tokens or credentials.
- Return HTTP 503 if the database is unavailable.

### POST /register

- Accept a validated FCM token.
- Verify secure enrollment authorization.
- Verify Cloudflare Turnstile when required.
- Validate token length and request body size.
- Insert or update the token in D1.
- Preserve other Android device registrations.
- Return success only after D1 confirms the write.

### POST /unregister

- Verify authorization to revoke the registration.
- Disable or remove only the requesting device's token.
- Prevent one browser from unregistering other devices.
- Return a clear success or failure response.

### POST /chick-detected

- Authenticate the ESP32-S3 using a device-specific secret.
- Validate detection event ID and timestamp.
- Reject malformed or unauthorized requests.
- Prevent duplicate event processing.
- Retrieve enabled tokens from D1.
- Send an FCM notification to each subscribed Android browser.
- Record delivery results without exposing secrets.

## D1 Requirements

Use the existing push_tokens table:

```sql
CREATE TABLE IF NOT EXISTS push_tokens (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  device_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- Use parameterized SQL queries.
- Do not delete other device records during registration.
- Use a stable device registration identifier.
- Handle repeated registration idempotently.
- Avoid logging complete FCM tokens.
- Do not change the production schema without approval.

## Firebase FCM Delivery

- Use Firebase HTTP v1.
- Authenticate using server-side service-account credentials.
- Store credentials in Cloudflare Worker secrets.
- Never expose the private key to the browser or ESP32.
- Use short-lived OAuth access tokens.
- Handle invalid or expired FCM tokens.
- Respect Cloudflare Worker execution limits.
- Use bounded batches for large token lists.
- Do not claim delivery until FCM accepts the request.
- Distinguish FCM acceptance from actual Android display.

## CORS

Allow only the configured Firebase Hosting origin.

CORS must not be treated as authentication.

Handle OPTIONS preflight requests correctly.

## Security

- Use HTTPS.
- Validate content types and payload sizes.
- Require enrollment authorization.
- Use Turnstile for abuse prevention.
- Rate-limit registration and detection endpoints.
- Never expose D1 token lists publicly.
- Never return secret credentials in error responses.
- Protect against replayed chick-detection events.

## Files to Inspect

- AGENTS.md
- Existing Cloudflare Worker source
- wrangler configuration, if present
- public/push.js
- public/firebase-config.js
- public/firebase-messaging-sw.js
- D1 migration files, if present

## Verification

1. Confirm GET /health works.
2. Test unauthorized registration rejection.
3. Test authorized registration.
4. Verify multiple tokens remain stored.
5. Test repeated registration.
6. Test unregister behavior.
7. Test authenticated chick-detection events.
8. Test duplicate event rejection.
9. Verify FCM API responses.
10. Test Android foreground/background delivery.

Do not deploy without approval.

## Completion

Report modified files, D1 schema changes, API tests, deployment status, and remaining limitations.
