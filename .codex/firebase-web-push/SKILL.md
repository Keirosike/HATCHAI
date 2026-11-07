
---
name: firebase-web-push
description: Implement Firebase Cloud Messaging web push notifications for HATCHAI, including Android permission, FCM tokens, Cloudflare D1 registration, and background alerts.
---

# HATCHAI Firebase Web Push

## Purpose

Implement secure Firebase Cloud Messaging notifications for multiple Android browsers using one HATCHAI system.

Each authorized Android browser that enables notifications receives chick-detection alerts automatically.

## Architecture

- Firebase project: `hatchai-8d34c`
- Firebase Hosting: `https://hatchai-8d34c.web.app`
- Firebase Cloud Messaging: Web Push
- Firebase Web SDK: Existing project version
- Cloudflare Worker: Notification API
- Cloudflare D1: `hatchai-devices`
- D1 binding: `env.DB`
- D1 table: `push_tokens`
- ESP32-S3: Chick-detection event source

## Required Registration Flow

1. User opens the Firebase-hosted notification page.
2. Verify the user's enrollment authorization.
3. User clicks Enable Notifications.
4. Request browser notification permission.
5. Register `firebase-messaging-sw.js`.
6. Generate an FCM token using `getToken()`.
7. Send the token to the Cloudflare Worker `/register` endpoint.
8. Worker verifies authorization and registration security.
9. Worker stores the token in Cloudflare D1.
10. Display success only after the backend confirms registration.

## Multiple Android Support

- Each Android browser has its own FCM token.
- Do not overwrite other registered devices.
- Store tokens using a unique constraint.
- Support token updates and re-registration.
- Send notifications to all enabled authorized tokens.
- Do not require users to manually copy FCM tokens.
- One shared HATCHAI account does not imply one FCM token.

## Frontend Requirements

Inspect:

- `public/push.js`
- `public/firebase-config.js`
- `public/push-settings.js`
- `public/firebase-messaging-sw.js`
- `firebase.json`

Preserve the existing Firebase configuration.

Use the existing VAPID public key.

Request notification permission only after a user action.

Automatically refresh and synchronize an existing permitted token when the website opens, provided enrollment authorization remains valid.

## Cloudflare Worker

Implement:

- `GET /health`
- `POST /register`
- `POST /unregister`
- `POST /chick-detected`

Registration must include:

- Valid enrollment authorization
- Input validation
- Cloudflare Turnstile verification where appropriate
- Rate limiting
- Restricted CORS origins
- D1 token upsert
- Safe error responses

Turnstile alone is not user authentication.

Do not allow arbitrary internet users to subscribe to private HATCHAI alerts.

## D1 Storage

Use the existing `push_tokens` table.

Preserve existing records and schema unless a migration is explicitly approved.

Store:

- Unique FCM token
- Optional device name
- Enabled status
- Created timestamp
- Updated timestamp

Do not return full token values from public API endpoints.

## Notification Delivery

1. ESP32-S3 detects a chick.
2. ESP32 sends an authenticated detection event to the Worker.
3. Worker validates the device credential.
4. Worker checks event IDs to prevent duplicate alerts.
5. Worker retrieves enabled FCM tokens from D1.
6. Worker sends notifications using Firebase Cloud Messaging HTTP v1.
7. Android browsers receive the alert in the foreground or background.

Use server-side Firebase credentials only.

Never expose Firebase service-account private keys in browser code or firmware.

## Disable Notifications

When a user disables notifications:

1. Call the authenticated `/unregister` endpoint.
2. Remove or disable the corresponding D1 registration.
3. Delete the local FCM token when appropriate.
4. Prevent automatic re-registration until the user enables notifications again.

Do not report successful disabling if backend revocation fails.

## Security

- HTTPS for cloud requests
- No shared account passwords in public JavaScript
- No Firebase Admin credentials in the browser
- No FCM tokens in URLs
- No unauthenticated device registration
- No public access to token lists
- Rate limiting on registration and event endpoints
- Restrict allowed origins, but do not rely on CORS as authentication
- Protect ESP32 event submission with a device-specific credential

## Testing

Test:

- First Android subscription
- Second and third Android subscriptions
- Permission denied
- Permission previously granted
- Notification modal dismissed
- Browser closed/background notification
- Duplicate token registration
- Token refresh
- Disable and unregister
- Offline/reconnection behavior
- Invalid authorization
- Invalid Turnstile response
- Invalid ESP32 event credentials
- Duplicate chick-detection events

Verify D1 registered device counts and actual FCM delivery.

## Deployment Rules

- Preserve Firebase Spark compatibility.
- Do not require Firebase Blaze or Cloud Functions.
- Do not deploy Firebase Hosting or Cloudflare Worker without user approval.
- Do not modify ESP32 control logic unnecessarily.
- Keep incubation controls operational when internet access is unavailable.

## Completion

Report changed files, test results, deployment status, and any remaining security or delivery limitations.
