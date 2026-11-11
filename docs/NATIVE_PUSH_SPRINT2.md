# Native Web Push — local implementation review, 2026-11-10

## Release status

Local implementation and synthetic interoperability tests pass. **Not deployed,
not operational push delivery, and not approved for live sends.** No Supabase
migration or production secret operation was performed. No ESP32 files were
changed in this sprint; the preceding firmware cleanup remains a separate change.

| Phase | Local result | Remaining boundary |
| --- | --- | --- |
| Subscription backend | Implemented and tested | Review actual production table columns/constraints and apply the reviewed RPC migration only after approval |
| Notification modal/client | Implemented and tested in Chrome with mocked Push APIs | Real Android permission/subscription verification after approved deployment |
| Separate service worker | Existing reviewed implementation reused and packaged | Actual browser push delivery remains unverified |
| VAPID/encryption | Independent Node and workerd interoperability passed | Stable approved keys and separately approved live-send test |
| Integration tests | API, SQL, browser and existing regressions pass | Exact production-date runtime tests now pass; production verification remains pending |
| Camera dispatch preparation | Validation/authorization and repository-based dispatcher implemented, mocked tests pass | Actual camera authenticator and durable event/outbox repository are NOT wired or implemented here; no ingestion route enabled |

The camera registry, camera-to-batch association and event/outbox database contract
are not established by the supplied `incubators` and subscription schema. The
dispatcher therefore requires injected authorization and durable repository
implementations. Its repository must atomically bind camera/event ID and immutable
content, enqueue at most one delivery per enabled authorized subscription, lease
work, recheck camera revocation/incubator ownership, persist attempt/result counts,
and disable expired subscriptions with key-version matching. Mock deduplication is
not production cross-isolate deduplication. This is a concrete camera-integration
blocker; do not activate a route or scheduler around the mock repository.

## Subscription contract

Authenticated Supabase sessions are checked through the existing Auth verifier.
Incubator access is read using the user's token and existing RLS. Backend-only
RPCs independently lock and check current `incubators.owner_id`. The verified user
ID is derived by the Worker, never accepted from browser JSON.

The database implementation uses the existing versioned subscription schema in
`supabase/migrations/202611090002_native_push_subscriptions.sql`. It does not
recreate that table, alter its RLS, grant browser INSERT, or change existing data.
Actual managed-production metadata has not been queried during this task; compare
that table's columns/constraints against this contract before approving migration.

| API | Request | Success |
| --- | --- | --- |
| GET `/online/push/public-key` | User bearer token | Public VAPID key only |
| POST `/online/push/subscribe` | `{incubatorId, subscription:{endpoint, keys:{p256dh,auth}, expirationTime?}, deviceLabel}` | `{registered:true}` after database confirmation |
| GET `/online/push/status?incubatorId=<UUID>` | User bearer token | Own endpoint hashes and enabled flags; no endpoints or encryption keys |
| POST `/online/push/unsubscribe` | `{incubatorId,endpoint}` | `{registered:false}` after backend confirmation |

All endpoints require authentication. Query parameters contain only a non-secret
incubator UUID, never credentials. Endpoint URLs and keys travel only in HTTPS
request bodies. Requests are bounded to 4,096 bytes, backend responses to 16,384,
and browser responses to 8,192. Origin, method, body shape, UUIDs, canonical
base64url keys and P-256 points are validated. Unknown response bodies are not
displayed or logged. Missing configuration fails closed.

The Worker uses a secret-key `apikey` header for the backend-only RPC path. It
does not put a secret key in a user bearer header. See [Supabase's API-key migration
guidance](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).
The secret has privileged database access and must remain exclusively in Worker
secrets; a browser publishable key cannot be substituted.

### Atomicity, limits and retention

- Endpoint uniqueness uses the existing database UNIQUE constraint. An upsert's
  WHERE clause refuses a different user or incubator, including simultaneous
  insert conflicts. It never changes endpoint ownership implicitly.
- Incubator row locking serializes quota decisions. At most 20 retained records
  are accepted per incubator, including disabled records. Existing matching
  registrations can be retried/reactivated without consuming another slot.
- Explicit disable updates only the authenticated user's matching record.
  Automatic reconciliation never revives a server-disabled subscription.
- Backend-confirmed provider 404/410 is treated as expired. The reviewed expire
  RPC updates only the matching user's/incubator's endpoint AND matching current
  keys, preventing a stale delivery from disabling a refreshed subscription.
- Cleanup is a backend-only RPC, not connected to cron in this sprint. It deletes
  at most 500 disabled records older than 30 days. Active registrations are never
  age-expired. Once a disabled record is removed, its historical ownership claim
  is no longer retained; an explicitly enabled new registration is checked afresh.
- The existing cron remains pairing cleanup only. Approve a bounded native-push
  maintenance schedule separately. Until then the 20-record quota bounds growth
  per incubator but stale slots may need approved cleanup.
- `NATIVE_PUSH_LIMITER` allows 30 operations/minute per IP key and independently
  per verified user key. Authentication failures cannot consume the user's key.
  Cloudflare limits are [approximate and location-scoped](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), not strict global quotas.

The isolated PGlite test runs the actual SQL, checks denied browser grants,
backend-only execution, duplicate/multiple devices, changed-owner rejection,
key-refresh protection, retention and quota. It is one PostgreSQL engine and does
not prove concurrent managed PostgREST connections or production grants.

## Browser and service-worker behavior

The online dashboard adds one Notifications button. It reuses the exact shared
`data/js/modal.js`, modal CSS, colors and buttons through the packaging step.
No local dashboard files are changed. Requests for permission occur only in the
Enable click handler. Registration becomes Enabled only after backend confirmation.
Existing subscriptions reconcile without another prompt. Denied permission gives
browser-settings guidance. Sign-out tears down handlers and fences late UI updates.

The native worker is registered at `/native-push/service-worker.js` with scope
`/native-push/`. It does not need to control the dashboard page to receive push.
An unrelated registration at that exact scope causes an explicit failure. Existing
root/Firebase registrations are not overwritten or unregistered. Both existing
service-worker source files remain byte-for-byte unchanged.

The only browser-stored value introduced is an optional endpoint SHA-256 disable
preference. It is not an authentication proof. User sessions remain in memory.
Disabling confirms backend removal first and then unsubscribes only this browser.
If browser removal fails, the UI reports failure; server-disabled records and the
local preference prevent automatic reactivation on return.

Provider policy currently permits exact HTTPS hosts/paths for Chrome FCM,
Mozilla autopush and Apple Web Push. Credentials, custom ports, fragments,
queries, other hosts, internal IPs and redirects are rejected. Other providers
(including Windows notification endpoints) require a reviewed policy addition.
This is native browser push and includes no Firebase Messaging SDK in the new flow.
Unsupported browsers show Browser Unsupported. iOS installed-web-app eligibility,
actual provider endpoint formats, Android background delivery and battery policies
still require device testing; no claim is made that a closed-browser alert works.

## Delivery safety and prepared camera flow

The sender uses pinned `@block65/webcrypto-web-push@2.0.0`, rather than custom
encryption/signing. Its [upstream implementation](https://github.com/block65/webcrypto-web-push)
uses RFC 8291 `aes128gcm` and RFC 8292 VAPID. Tests independently decrypt with
`http_ece` and verify ES256 with Node crypto, including ciphertext/signatures
generated inside workerd. Synthetic ephemeral keys never reach a real provider.

No endpoint or scheduler calls the native sender. It additionally requires
`NATIVE_PUSH_DELIVERY_ENABLED=true` and configured stable keys. The default is
false. Provider destinations are validated again at delivery; redirects are not
followed. Sends have an eight-second deadline. Explicit 429/5xx responses preserve numeric or HTTP-date Retry-After as an absolute
minimum deadline, without a five-minute cap or blocking wait. The durable repository
must persist it; maximum three attempts and event expiry bound retries; timeouts/lost responses are terminal unknown outcomes by default.
Delivery results must be durably recorded by that repository. Acceptance is never
reported as Android display confirmation or exactly-once delivery.

Prepared camera events reuse the existing strict detection validator. A future
authenticator must verify signatures, timestamps/nonces and registry roles; the
dispatcher checks enabled status, incubator, camera, placement and batch against
that verified source. Display batch names come from verified server metadata.
Upper/lower messages use the existing native worker's fixed title/body. Event
content cannot provide an arbitrary notification-click destination.

## Configuration requiring separate approval

Worker secret names only:

- `SUPABASE_BACKEND_KEY` — dedicated server-side Supabase secret API key. Do not
  reuse a key previously pasted into chat; revoke/replace exposed secrets through
  an approved secure administration step.
- `NATIVE_PUSH_VAPID_PRIVATE_KEY` — stable raw P-256 private scalar, base64url.

Worker non-secret configuration:

- Existing `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `ONLINE_ALLOWED_ORIGINS`.
- `NATIVE_PUSH_VAPID_PUBLIC_KEY` — matching stable uncompressed P-256 public key.
- `NATIVE_PUSH_VAPID_SUBJECT` — approved `mailto:` contact or HTTPS subject.
- `NATIVE_PUSH_DELIVERY_ENABLED=false` — keep false through registration rollout.
- `NATIVE_PUSH_LIMITER`, namespace `834317` — additive local Wrangler proposal.

No key generation, provisioning or secret-value inspection was performed.

Live read-only checks on the existing deployed `/online/incubators` returned:
OPTIONS 204, allow-origin `https://myhatchai.web.app`, method GET, header
Authorization; unauthenticated GET returned 401 with the same origin header.
The NEW push endpoints are local only; their POST preflights were tested with mocks
and workerd, not claimed deployed.

## Verification

- Worker automated suite: 122 passing tests, including isolated PostgreSQL SQL.
- Frontend/auth/packaging/service-worker suite: 38 passing tests.
- New Chrome notification UI: 16 passing checks (Push APIs/backend mocked).
- Existing shared-dashboard browser: 61 checks; authentication browser: 29 checks.
- Existing workerd/D1: 19 smoke + 205 hardening requests, 11 hardening scenarios.
- Existing online runtime: 2 dispatch requests, mocked upstream.
- New native runtime: 1 crypto + 3 retry + 4 API requests (8 total), mocked upstream.
- Package: 27 explicitly allowlisted public assets; integrity/security check passes.
- Dependency audit: zero known vulnerabilities after pinning patched transitive
  test-tool dependencies. No production key or live provider request was used.

The earlier date-coverage limitation is resolved locally. Miniflare is pinned to
5.20261109.0-beta (test harness only), with workerd 1.20261109.1. All runtime suites
now load the configured production date 2026-11-07 and compatibility flags [] from
wrangler.jsonc. Divergent date overrides are rejected. Production settings are
unchanged, and deployed metadata still needs review before rollout.

Local commands (no deployment):

```powershell
Push-Location cloudflare-worker
npm ci --ignore-scripts
npm test
Remove-Item Env:HATCHAI_RUNTIME_COMPAT_DATE -ErrorAction SilentlyContinue
npm run test:runtime
Pop-Location
node tools/package-online-release.mjs
node tools/verify-online-release.mjs
node --test test/native-push-client.test.mjs test/native-push-worker.test.mjs test/shared-dashboard-package.test.mjs test/online-release.test.mjs test/online-auth.test.mjs test/incubator-read.test.mjs test/dashboard-adapters.test.mjs test/local-session-regression.test.mjs
node test/native-push-browser.cjs
node test/shared-dashboard-browser.cjs
node test/online-auth-browser.cjs
```

## Files in this sprint

Created:

- `cloudflare-worker/package-lock.json`
- `cloudflare-worker/src/native-push.js`
- `cloudflare-worker/src/native-push-delivery.js`
- `cloudflare-worker/test/native-push.test.js`
- `cloudflare-worker/test/native-push-sql.test.js`
- `cloudflare-worker/test/runtime-native-push.mjs`
- `public/native-push/client.js`
- `public/native-push/modal.js`
- `supabase/migrations/202611100001_native_push_rpc_REVIEW.sql`
- `test/native-push-client.test.mjs`
- `test/native-push-browser.cjs`
- `docs/NATIVE_PUSH_SPRINT2.md`

Modified:

- `cloudflare-worker/package.json`
- `cloudflare-worker/src/index.js`
- `cloudflare-worker/wrangler.jsonc`
- `cloudflare-worker/test/runtime-smoke.mjs`
- `cloudflare-worker/test/runtime-hardening.mjs`
- `cloudflare-worker/test/runtime-online.mjs`
- `public/online-dashboard.js`
- `public/online-login.html`
- `tools/package-online-dashboard.mjs`
- `tools/package-online-release.mjs`
- `tools/verify-online-release.mjs`
- `test/shared-dashboard-package.test.mjs`
- `test/online-release.test.mjs`

Generated ignored assets: `public/shared/` and `dist/myhatchai/`. Existing prior
firmware-cleanup changes and untracked DHT22 fixtures were preserved, not rewritten.

## Safe next approvals and order

1. Review the actual managed subscription table metadata and function-owner/grant
   prerequisites, the SQL migration and this security report. Approve only the
   additive RPC migration; do not rerun the existing CREATE TABLE migration.
2. Approve configuring the backend secret and stable VAPID key pair securely.
   Keep delivery disabled. Recheck current runtime compatibility and staged
   concurrent RPC behavior before production deployment.
3. Approve deploying the reviewed Worker configuration/code only, preserving
   existing variables/bindings and endpoints. Verify new CORS/auth/status routes.
4. Approve deploying the verified 27-file package only to Firebase site myhatchai.
   Preserve the existing hatchai-8d34c site and Firebase messaging worker.
5. On Android Chrome with internet: sign in, open Notifications, click Enable,
   grant permission, verify backend-confirmed Enabled. Repeat on a second phone;
   refresh, disable one phone, and confirm the other remains registered.
6. Separately approve a controlled live-push test and its restricted trigger after
   reviewing sender configuration. Do not activate camera ingestion for this test.
7. Review the actual camera registry/authentication and durable event/outbox
   contract before implementing or enabling ingestion and automatic delivery.

No firmware flash, filesystem upload, Supabase production write, secret rotation,
Firebase deployment, Worker deployment or live notification was performed.
