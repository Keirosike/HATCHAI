# Registration rollout and controlled-test candidate

## Confirmed test blocker and approved correction

The user's live test returned test_subject_format: the configured VAPID subject
was not an accepted mailto/HTTPS contact. With explicit approval, only
NATIVE_PUSH_VAPID_SUBJECT was updated to https://myhatchai.web.app using Wrangler
secret put. Public/private VAPID keys and existing subscriptions were not changed.
Resulting serving Worker version: 58764c98-66ee-483a-b0d1-e828bab8ec32.
Read-only version metadata confirms NATIVE_PUSH_TEST_ENABLED=true,
NATIVE_PUSH_DELIVERY_ENABLED=false and MANUAL_TEST_NOTIFICATIONS_ENABLED=false.
The prior diagnostic version is 90424be5-5b3a-4827-8a97-7ea91dceff3f.
No live send or physical display was performed by this correction; a new explicit
browser test is needed. Subject-format failure occurred before the signing-pair
and encryption checks, so those production checks are not yet confirmed.

## Controlled-test production update

User exports (16)–(18) verify the additional test-subscription function installed
as postgres+BYPASSRLS, SECURITY DEFINER with pg_catalog; only owner/backend ACL,
browser EXECUTE=false, backend=true. One subscription exists and is enabled.
Existing table ownership and RLS remain unchanged.

Controlled-test Worker deployed: 644bfad5-6d71-4da0-af8c-900056a34211.
Deployment used the explicit override NATIVE_PUSH_TEST_ENABLED=true; checked-in
default remains false. General chick delivery and legacy FCM manual sending are
both false. All DB/limiter/cron bindings preserved. Health=200; test preflight=204;
unauthenticated test=401. No notification was sent by automated verification.

Final test Hosting version: aa349e7aff43b670, release 1794256174521000.
27-file package verified; served client/modal/native worker hashes match it.
The client explicitly checks for an updated native worker before testing so an
already-registered browser can display the new test type. Firebase worker intact.
Immediate registration-only rollback references: Worker
95a5e339-33ad-4244-a588-1830e2f28508 and Hosting 0599b2e6df964e53.
Do not automatically roll back or change the original Hosting site.

Focused deployment regressions: 16 Worker tests and 7 client tests passed.
Full candidate suite previously passed 127 Worker tests and 234 runtime requests;
16 mocked browser checks passed. Physical Android display, tab-closed delivery,
notification click navigation and unsubscribe still await user observations.

## Production changes performed

- Worker hatchai deployed using cloudflare-worker/wrangler.jsonc, Wrangler 4.159.0.
- Serving version: 95a5e339-33ad-4244-a588-1830e2f28508.
- Prior Worker rollback reference: 697afc3b-fdaf-4792-8b52-05b17a6de465.
- Existing D1 DB binding, limiter namespaces, minute cron, CORS origins and secrets
  preserved. NATIVE_PUSH_DELIVERY_ENABLED=false and legacy
  MANUAL_TEST_NOTIFICATIONS_ENABLED=false. Chick ingestion remains disabled.
- Hosting deployment only to myhatchai, project hatchai-8d34c, from the verified
  27-file package. Version 0599b2e6df964e53, release 1794254665999000.
- Prior Hosting rollback reference: version e1a0f3cc13e271ed, release 1794212127918000.
- Public HTML/native client/native service worker/Firebase service worker returned
  200, correct MIME types and hashes matching the deployed candidate. Firebase
  messaging source was not changed or unregistered.
- Live Worker health=200, approved preflight=204 with exact origin and required
  headers, missing/invalid Auth=401, foreign origin=403.
- User's Android screenshot shows authenticated incubator and Notifications Enabled.
  This confirms backend-confirmed registration through the deployed app, not actual
  notification delivery. Production unsubscribe, independent table aggregate,
  background display and click navigation are not yet physically verified.

## Local controlled-test addition — NOT deployed

Existing registration RPCs intentionally never return encryption capabilities.
The new review-only RPC selects one enabled subscription by SHA-256 endpoint
reference after checking current incubator ownership. Only backend/owner EXECUTE
is permitted; capability fields remain inside the server request and are never
returned through the browser API. No table grants or schema changes are proposed.

Review file: supabase/migrations/202611100002_native_push_test_subscription_REVIEW.sql.
SHA-256: CA7C3CAF4A229E583076C66DE5554ABACA0B986F7CC2A23702FC6C1E4515699A.
This is a NEW migration: prior approval for the installed RPC file does not apply.
After separate approval, execute as postgres, then run
supabase/verify_native_push_test_rpc_READ_ONLY.sql and review owner/ACL/search_path.
Expected: postgres+BYPASSRLS, SECURITY DEFINER, pg_catalog, browser EXECUTE false,
backend true; current subscription counts unchanged.

The prepared /online/push/test endpoint requires verified Supabase Auth, current
ownership, this browser's registered endpoint hash and the existing separate
test limiter (3/minute; approximate/location-scoped). Its new dedicated
NATIVE_PUSH_TEST_ENABLED flag defaults false. Chick delivery and old FCM testing
remain false. The native sender validates matching VAPID key pairs before sending,
encrypts fixed native-test payloads and returns acceptance without claiming display.
No automatic retry follows ambiguous sends. Repeated explicit tests can produce
multiple notifications. A 404/410 disables only matching subscription keys.

The local modal adds Send Test Notification only usable after registration.
Service-worker test title/body: HATCHAI Test Notification / Your HATCHAI notification
system is working. Click destination is fixed same-origin online-login.html.
Existing chick-notification validation and Firebase worker remain preserved.

After approved SQL and its verification: deploy the reviewed candidate with only
NATIVE_PUSH_TEST_ENABLED=true, then the regenerated 27-file Hosting candidate.
User must click Send Test Notification and report actual display. Acceptance alone
is not Android display proof; tab-closed delivery and click navigation require
separate observations. Do not automatically send or claim a result without them.

## Camera status

Current camera source posts a legacy event ID and shared-key request; it does not
implement the signed camera/incubator/batch envelope expected by the cloud core.
Independent camera authentication, administrative batch mapping and durable
transactional outbox remain prerequisites before public ingestion. No camera or
controller firmware changed in this rollout. No new camera credentials provisioned.
