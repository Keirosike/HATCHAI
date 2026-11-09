# HATCHAI manual phone notification test

Local implementation only. No Worker/Hosting deployment, D1 migration, secret provisioning, ESP32 change or real notification send was performed by this task.

## Deployment findings

Public read-only checks during this task found:

- Worker root and `/health`: HTTP 200; D1 connected, zero enabled registrations.
- Hosted page and `push.js`: HTTP 200, but the deployed page has no LCD-code pairing form.
- Hosted `/pairing-client.js`: HTTP 404.
- Worker preflights for `/pairing/redeem`, `/register` and `/registration/test-notification`: HTTP 404 without the required CORS headers.
- All four configured Firebase 13.2.0 app/messaging modular/compat SDK URLs: HTTP 200.
- Existing Cloudflare CLI session: not authenticated. Actual deployed version, secret names, D1 pairing tables, rate bindings and cron configuration remain unverified.

The current public deployment cannot complete the locally implemented enrollment workflow. A healthy `/health` endpoint proves neither enrollment authorization nor FCM delivery readiness.

## Implemented flow

1. The existing controller authenticates device pairing with its HMAC identity and shows a five-minute, single-use code on the physical LCD.
2. The HTTPS page redeems the code using its existing non-extractable browser signing key, requests notification permission on a user action, obtains an FCM token and registers it in existing D1 tables.
3. After confirmed registration, **Send Test Notification** requests `/registration/challenge` and signs `POST /registration/test-notification` with the registration ID, nonce and version.
4. The Worker verifies browser ownership, controller key/role, 90-day authorization, enabled registration, origin, rate limits and exact allowed fields. A transactional D1 nonce/version transition fences concurrent requests and replays before any Google send.
5. The Worker selects only that registration's token. The browser cannot choose tokens, recipients, topics, title or body. No broadcast path is added.
6. The Worker signs an RS256 service-account JWT, obtains/caches a short-lived Google OAuth token and submits one FCM HTTP v1 message. Redirects are not followed; response sizes and deadlines are bounded. No automatic send retry occurs.

Fixed notification:

> **HATCHAI Test Notification**  
> Your HATCHAI notification system is working.

Success means **FCM accepted the message**, not that Android displayed it. The foreground handler uses the service-worker display API; background notification messages use Firebase's automatic display. Explicit manual-test data messages have a safe fixed-content fallback. Chick data messages are ignored by that fallback.

`POST /chick-detected` remains disabled. No ESP32, camera, sensor, heater, motor, PID, thermal safety, watchdog, SD logic or firmware artifact is changed.

## Required configuration

Worker secrets (values must never be displayed or committed):

- `NOTIFICATION_DEVICE_KEYS` — existing controller identity/key-ID map; must match the flashed controller's selected NVS credential. Preserve any existing approved entries. Do not rotate or replace it blindly.
- `PAIRING_HASH_KEY` — existing independent pairing-code/grant protection key; preserve it when already configured.
- `FCM_SERVICE_ACCOUNT_JSON` — server-side Firebase service-account JSON for the existing Firebase project. It must have permission to send FCM messages. The code accepts only the configured project and Google's standard OAuth endpoint, with a PKCS#8 RSA key of at least 2048 bits.

Non-secret configuration:

- Existing `DB` binding to `hatchai-devices` and existing `push_tokens` records.
- Existing additive `pairing_sessions` and `push_registration_auth` migrations, including retention indexes, if not already installed.
- All seven native rate bindings from `cloudflare-worker/wrangler.jsonc`, including new `TEST_NOTIFICATION_LIMITER` (namespace 834316). Review namespace uniqueness in the account.
- `MANUAL_TEST_NOTIFICATIONS_ENABLED=true` for approved manual testing; checked-in default is `false`.
- Firebase Cloud Messaging HTTP v1 API enabled, and the service account authorized for `cloudmessaging.messages.create` (the documented Firebase Cloud Messaging API Admin role includes this permission).
- Existing public Firebase configuration and public VAPID key remain unchanged. No Firebase user account or Cloud Function is required.

The manual test adds **no D1 schema or migration**. It reuses the existing nonce/version authorization columns and preserves the 90-day hard expiry. Its three-per-minute IP and owner limits are independent of unregister/pairing budgets. Cloudflare native limits are approximate and location-scoped, not strict global quotas.
Revocation blocks new authorization; a send already admitted before revocation may finish. There is no durable outbox or guarantee of delivery after a lost response.

## Approved deployment sequence — commands are instructions, not executed actions

Stop until deployment, missing secret configuration and any missing production migrations are explicitly approved. Run from the project root after approval:

```powershell
# Read-only account/configuration checks first
npx wrangler@4.158.0 whoami
npx wrangler@4.158.0 secret list --config .\cloudflare-worker\wrangler.jsonc
npx wrangler@4.158.0 d1 migrations list hatchai-devices --remote --config .\cloudflare-worker\wrangler.jsonc
npx wrangler@4.158.0 d1 execute hatchai-devices --remote --config .\cloudflare-worker\wrangler.jsonc --command "SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%';"
```

Authenticate through the normal Cloudflare CLI login if needed. These checks must identify the intended account, Worker and existing database. Do not print token rows. Confirm the existing `push_tokens` schema and review the two additive migration files before applying missing migrations. Preserve production backups and existing registrations.

```powershell
# Only if the existing pairing migrations are missing, and separately approved:
npx wrangler@4.158.0 d1 migrations apply hatchai-devices --remote --config .\cloudflare-worker\wrangler.jsonc

# Configure only missing secrets through protected interactive input or secure stdin.
# These commands change production secrets; do not run them merely to inspect configuration.
npx wrangler@4.158.0 secret put NOTIFICATION_DEVICE_KEYS --config .\cloudflare-worker\wrangler.jsonc
npx wrangler@4.158.0 secret put PAIRING_HASH_KEY --config .\cloudflare-worker\wrangler.jsonc
npx wrangler@4.158.0 secret put FCM_SERVICE_ACCOUNT_JSON --config .\cloudflare-worker\wrangler.jsonc

# Deploy the existing Worker with the reviewed feature enabled.
npx wrangler@4.158.0 deploy --config .\cloudflare-worker\wrangler.jsonc --var MANUAL_TEST_NOTIFICATIONS_ENABLED:true

# Deploy only Hosting, not Functions or Firestore.
firebase deploy --only hosting --project hatchai-8d34c
```

Never store the service-account file in `public/`, `data/`, source, logs, screenshots or a shell command argument. Preserve existing pairing secrets; changing their values can invalidate pairing or browser authorization. Standard secret updates may affect the current deployment, so perform them only in the approved change window.

The flashed controller must already report `credentialsReady`, `utcReady` and `networkReady` through its authenticated pairing status. If the selected NVS credential is missing, stop: ordinary dashboard login cannot replace it. Secure matching credential provisioning needs its own explicit approval; it does not require adding a firmware feature or relaxing authentication.

After deployment, verify root/health and pairing preflights, the hosted LCD form and signing client, and an actual controller pairing. Do not invoke `/chick-detected` to test delivery.

To disable manual sending later, redeploy without the `--var` override (the checked-in default is false), or set the variable to false through the approved configuration process. This does not revoke registrations or enable camera delivery.

## Android Chrome test checklist

1. Use a supervised running controller; do not operate incubation controls for this test. Confirm controller STA internet access and valid system UTC. Its AP alone does not supply internet to the phone.
2. Open the local dashboard, log in, and tap **Enable Notifications**. Confirm a fresh 16-character code appears only on physical LCD row 4; safety warnings have priority.
3. Open the existing Firebase HTTPS page. If the phone cannot reach it on the AP, switch the phone to an internet-connected network after the code is issued. The controller itself must stay online through STA.
4. Enter the LCD code within five minutes and tap **Verify LCD Code**. Tap **Enable Notifications**, then allow Android/Chrome notifications. Do not clear site data: that deletes the browser ownership key.
5. Wait for confirmed server registration. The manual-test button must stay disabled before confirmation. After a reload, tap Enable Notifications to confirm/refresh the token before testing again.
6. Tap **Send Test Notification** once. Expect the exact title/body above, and a page status that says FCM accepted the request without claiming display confirmation. Check the Android notification shade.
7. For a background check, send another test and immediately switch Chrome to the background. Record whether receipt happened before or after backgrounding; repeat after the rate window if necessary. Check Chrome/site/Android notification settings and Do Not Disturb if acceptance succeeds but no alert appears.
8. A timeout or error is not permission to assume the send failed. Check the phone before intentionally sending another test. No automatic retries or durable delivery queue are implemented; FCM is not exactly-once. TTL is five minutes and repeated manual tests share a notification tag.
9. If desired, pair a second phone with a fresh code. Each phone's button must target only itself. Disabling one phone must leave the other registration intact.
10. Record observed foreground/background display separately from FCM acceptance. Keep camera notification delivery disabled throughout.

## Local verification commands

```powershell
npm --prefix cloudflare-worker test
node test/notification-pairing/phone-worker.mjs
node test/notification-pairing/browser-integration.cjs
node test/notification-pairing/run.mjs
# With the documented installed Miniflare and browser paths configured:
npm --prefix cloudflare-worker run test:runtime
```

Tests use ephemeral signing material, temporary databases and intercepted Google calls. They prove authorization and request construction, not actual Android delivery. Real delivery remains pending approved deployment/configuration and an observed phone test.

## Verification results for this implementation

- Worker automated tests: 72 passed, zero failed (including manual-send ownership, replay, race, provider failure/timeout/redirect/size checks and service-worker behavior).
- Notification browser integration: 49 checks passed, including mobile layouts, button gating, signed test calls, foreground display and no automatic retry.
- Actual browser signing client against Worker/SQLite: 40 checks passed, including two phones sending independent manual tests through an intercepted provider.
- Native pairing tests: 113 passed; cross-language signing vectors: 25 passed, with five native signatures accepted by the actual Worker verifier.
- Workerd/D1 runtime smoke: 19 requests passed, including real RSA signing and a single fenced self-test against a fake Google provider.
- Workerd/D1 hardening: 205 requests and 11 scenarios passed. Total runtime API requests: 224.
- Changed JavaScript syntax and whitespace checks passed.
- Wrangler 4.158.0 bundle dry run passed: 30.17 KiB uncompressed / 8.47 KiB gzip, with DB, seven native rate bindings and the disabled-by-default feature flag. This did not deploy or verify production bindings.
- Main firmware artifact remained unchanged: SHA-256 `FE836BEBF3799713FD8F2194DA83327BF97B883C5F0922161FA6163B5CA28C84`.

## Files changed by this task

New files:

- `cloudflare-worker/src/test-notification.js`
- `cloudflare-worker/test/test-notification.test.js`
- `docs/MANUAL_TEST_NOTIFICATION.md`

Modified files:

- `cloudflare-worker/src/pairing.js`
- `cloudflare-worker/wrangler.jsonc`
- `cloudflare-worker/README.md`
- `cloudflare-worker/test/pairing.test.js`
- `cloudflare-worker/test/runtime-smoke.mjs`
- `cloudflare-worker/test/runtime-hardening.mjs`
- `public/index.html`
- `public/pairing-client.js`
- `public/push.js`
- `public/firebase-messaging-sw.js`
- `test/notification-pairing/browser-integration.cjs`
- `test/notification-pairing/phone-worker.mjs`

Existing unrelated working-tree changes were preserved. Firebase configuration, public VAPID settings, D1 migration files and all firmware/control source files were unchanged by this task.

## Protocol references

- [Firebase FCM HTTP v1 authentication and sending](https://firebase.google.com/docs/cloud-messaging/send/v1-api)
- [Cloudflare Workers request and redirect behavior](https://developers.cloudflare.com/workers/runtime-apis/request/)
- [Cloudflare Web Crypto support](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
