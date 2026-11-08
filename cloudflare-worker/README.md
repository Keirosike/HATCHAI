# HATCHAI notification pairing Worker (local implementation)

No deployment or device/Firebase integration is included. Existing `GET /`,
`GET /health`, the `DB` database identity, and disabled `POST /chick-detected`
are preserved. The migration adds two tables; it never creates or rewrites
`push_tokens`. Do not run production migrations or deploy without approval.

## Local verification

Run `npm test` in this directory with Node >=22.13 supporting `node:sqlite`.
Tests generate ephemeral development keys and apply the migration to independent
**in-memory SQLite databases** using the supplied legacy `push_tokens` schema.
The D1 adapter implements prepared statements and transactional batches; it does
not replace SQL constraints with mocks. Rate-limit bindings are simulated with
bounded local counters. No existing `.wrangler` data or remote database is used.
These tests do not establish Android/device behavior.

`npm run test:runtime` additionally runs the Worker modules inside local workerd
with real Miniflare D1 and rate-limit bindings, all storage isolated and temporary.
It runs the regression smoke scenario plus separate hardening scenarios with
fresh native budgets/databases. It verifies concurrent cancellation, redemption,
registration, distinct starts, challenge renewal, refresh/unregister, expiry,
duplicate-token rollback, lost responses, rate-budget isolation, the scheduled
cleanup handler, foreign keys, legacy records and disabled delivery.
It requires an already installed Miniflare package; alternatively set
`HATCHAI_MINIFLARE` to an installed/cached package directory. No dependencies are
downloaded by this script. Both Miniflare 4 and 5 option formats are supported.

For a later explicitly authorized local Wrangler integration test, configure the
following in ignored `.dev.vars` (never reuse production keys):

- `NOTIFICATION_DEVICE_KEYS`: JSON object mapping device ID -> key ID -> base64url
  **32-byte random key**, for example `{"hatchai-inc01-controller":{"key-id":"<generated-key>"}}`.
- `PAIRING_HASH_KEY`: independent base64url **32-byte random key**.

Generate each key independently using a cryptographic random generator. Never
paste keys into source, URLs, screenshots, command arguments or committed files.
The Worker fails closed if required keys or rate-limiter bindings are absent.
Changing/removing a device key requires a **new key ID**: remove the old ID to
revoke pairing and browser authorization originating from it. Replacing the bytes
under an existing ID alone does not revoke that ID's browser registrations.

All six native rate-limit bindings in `wrangler.jsonc` are required; none are
isolate-local maps. Their namespace IDs must be reviewed for account-wide
collisions before deployment. Cloudflare native limits are **approximate and
location-scoped, not strict global quotas**. The 80-bit code space, atomic
consumption and signatures remain the authorization controls.

| Binding | Budget per 60 seconds | Scope and rationale |
| --- | --- | --- |
| DEVICE_PAIRING_LIMITER | 12 | Separate per IP and authenticated device; challenge+start consume two calls, allowing six attempts/minute |
| DEVICE_STATUS_LIMITER | 120 | Separate per IP and authenticated device; supports normal five-second polling with ample headroom |
| DEVICE_CANCEL_LIMITER | 12 | Separate per IP and authenticated device; status/start never consume this reserved cancellation budget |
| BROWSER_REDEEM_LIMITER | 5 | Per IP; limits manual code guesses |
| BROWSER_REGISTER_LIMITER | 10 | Per IP; bounds initial grant/registration processing |
| REGISTRATION_LIMITER | 30 | Independent per-operation IP keys and, after signature verification, per-operation registration keys; challenge traffic cannot consume unregister's budget |

There is deliberately no common IP budget across these categories: that would
reintroduce cancellation starvation. Invalid device signatures consume only their
category's IP budget, not a victim device's authenticated budget. Likewise an
invalid browser signature cannot consume an owner's registration budget. Shared
NATs still share the relevant IP budgets; review sizing against real usage.

The migration is a file only. Local Wrangler currently has only `push_tokens`;
pairing endpoints will return 503 until the additive migration and development
secrets are deliberately configured locally. No automatic schema initialization
runs in request handlers. Never expose Wrangler's development server to untrusted
networks. HTTPS is mandatory except the loopback hostnames for local testing.

## Signing contract

Every protected call is JSON, maximum 8192 encoded bytes. Credentials and query
parameters are rejected in URLs. Browser calls require Origin
`https://hatchai-8d34c.web.app`; this is an additional filter, not authentication.
Device calls reject **all** Origin headers. No cookies or localStorage flags
authorize an operation.

Signing bytes are UTF-8:

```text
HATCHAI-NOTIFY-v1\nPOST\n<exact-path>\n<base64url-SHA256(canonical-body)>
```

Canonical JSON recursively sorts object property names, preserves array order,
uses JSON string/number encoding, and has no whitespace. Omit only the top-level
`signature` property. See `src/security.js` for the interoperable implementation.
Signatures and digests use unpadded base64url. Sign the exact numeric/string types
you submit. Requests are bound to their operation, identifiers and all fields.

Device signatures are HMAC-SHA256. Browser signatures are ECDSA P-256/SHA-256,
64-byte IEEE-P1363 `r || s` (WebCrypto format, not DER). Browser keys must be
generated non-extractable in HTTPS WebCrypto; persist the CryptoKey in IndexedDB.
Only public JWK fields `kty`, `crv`, `x`, `y` are retained by Worker.

## Device endpoints

### Controller-only authorization

The trusted role registry in `src/security.js` recognizes
`hatchai-inc01-controller` as the controller and `hatchai-inc01-cam01` /
`hatchai-inc01-cam02` as cameras. All four `/device/pairing/*` endpoints require
both valid HMAC authentication and the controller role. A request's `role` field,
presence in the credential map, CORS or local login flags cannot grant that role.

`NOTIFICATION_DEVICE_KEYS` keeps its existing device-ID -> key-ID -> key format.
It must contain only controller pairing credentials. No new credential format,
secret binding or database migration is required. Missing device/key entries or
non-string disabled key values reject authentication. Remove the device/key entry
to revoke it; no separate database-backed enabled flag is introduced in this step.
Even an accidentally configured camera key with a valid signature receives 403
from pairing endpoints. Future camera credentials belong in a separate binding;
that binding is not implemented or accepted for pairing. Real camera credentials
are not provisioned by tests (which generate ephemeral negative-test keys only).

Valid controller signatures remain wire-compatible: key encoding, signing bytes,
challenge lifetime and request/response fields are unchanged. The authorized
controller ID must match the approved `hatchai-inc01-controller` identity. Old
arbitrary device IDs are no longer accepted merely because they have a key.
Additional incubators/controllers need an explicit trusted registry update.
Browser grants and management also recheck the originating controller's key and
role. A formerly camera-originated authorization is refused without deleting or
rewriting its stored token. Production data compatibility requires read-only
preflight of existing IDs before any later deployment.

1. `POST /device/pairing/challenge`: signed `{deviceId,keyId,operation,requestId,issuedAt}`.
   `operation` is `start`, `status` or `cancel`. `requestId` is a fresh random
   base64url ID of 20–64 characters. `issuedAt` is UTC Unix seconds within 60
   seconds. Returns `{sessionId,challenge,expiresIn:60}`. Reusing a request ID fails.
2. `POST /device/pairing/start`: signed `{deviceId,keyId,sessionId,challenge}`.
   Atomically consumes the start challenge. Returns `{pairingId,code,expiresIn:300}`
   **only to the authenticated device**. Code contains 16 random Base32 characters;
   firmware may format it in groups of four on LCD row 4. Never proxy this result
   to local HTTP/browser JavaScript, telemetry, logs, or crash diagnostics.
3. Status/cancel: obtain a fresh purpose-specific challenge, then sign
   `{deviceId,keyId,sessionId,challenge,pairingId}` for `/device/pairing/status` or
   `/device/pairing/cancel`. Responses expose state, never codes or grants.

Only one issued/redeemed pairing may be active per device. Simultaneous phones
pair sequentially; completed registrations are independent. Expired sessions
are retired on subsequent issuance. Challenges are consumed atomically.
Lost issuance/redemption responses require cancellation/re-pairing; raw secrets
are never stored for retransmission. See the scheduled retention policy below.

## Browser endpoints

- `/pairing/redeem`: signed `{code,publicKey}`. Only a valid unexpired code can
  bind the signing key. Returns `{pairingId,grant,expiresIn:300}` once. Code and
  grant representations are HMAC protected with distinct purpose prefixes in D1.
- `/register`: signed `{pairingId,grant,token,deviceName?}` with that same key.
  A single fenced D1 batch consumes the grant, creates token and ownership rows,
  and verifies completion. Returns `{registered:true,registrationId,authorizedUntil}`.
  It never returns the token. The grant is not a reusable credential.
- `/registration/challenge`: signed `{registrationId,requestId,issuedAt}`.
  Returns `{registrationId,nonce,expiresAt,version,authorizedUntil}`. After losing
  a successful `/register` response, substitute `pairingId` for `registrationId`
  to discover the registration with the same private key. No public discovery.
- `/registration/refresh`: signed `{registrationId,nonce,version,token,deviceName?}`.
  Reconciles/updates only this token. Identical tokens are safe; conflicting tokens
  fail without consuming the nonce/version. Does not extend authorization expiry.
- `/unregister`: signed `{registrationId,nonce,version}`. Disables only this token
  and revokes this authorization. Obtain a fresh challenge before each mutation.

Each successful mutation atomically consumes the nonce/version. Lost mutation
responses are reconciled with a fresh signed challenge; refreshing the current
token is safe. After an unregister response is lost, further management requests
fail authorization; the UI must not infer network errors mean revocation failed.

Authorization expires exactly 90 days after registration. This backend implements
**hard expiry**, not silent renewal. A new LCD pairing can authorize a new token;
same-token renewal/key-loss takeover remains a separately reviewed recovery flow
and is refused here. No legacy token is silently adopted. Existing records are
never deleted. Lost IndexedDB keys cannot be replaced using only an FCM token.
Existing expired/revoked token rows may remain enabled; future delivery must JOIN
authorization and filter expiry, revocation and device-key status, not merely
query `push_tokens.enabled`. Broadcasting remains disabled.

## Atomicity and limits

Registration's first conditional UPDATE installs a random server attempt ID.
Both INSERTs and the final SELECT require that exact fence. A zero-row claim
cannot produce rows; UNIQUE/FK failures roll back the complete batch. Management
uses a fresh nonce and incremented version as the equivalent transaction fence.
No `INSERT OR IGNORE`, `REPLACE`, or cross-owner upsert is used.

## Retention and cleanup

`src/retention.js` is called by the Worker's scheduled handler. The local config
proposes a once-per-minute cron; it is not active in production until an approved
deployment. `0002_retention_indexes.sql` adds indexes only and does not alter
existing data. Tests apply both migrations only to isolated temporary databases.

- Challenges expire in 60 seconds. Issued codes expire in 300 seconds. Redeemed
  registration grants get their own 300 seconds; cleanup checks **grant expiry**,
  not the earlier code expiry, for redeemed sessions.
- Each cleanup transitions expired challenge/code/grant rows to `expired`, clears
  protected code/grant representations and records the terminal time. Active
  grants are never expired or deleted by this process.
- `expired` and `cancelled` rows are retained for at least **24 hours after their
  terminal transition**, then deleted in bounded batches. This exceeds the signed
  challenge request's entire freshness/skew window; replayed old challenge creation
  requests cannot recreate deleted sessions. Expired/consumed codes never return
  to `issued`. Failed or delayed cron execution does not extend authorization:
  request handlers independently enforce expiry.
- `registered` pairing rows are retained at least **97 days after registration**
  (90-day authorization plus seven days). An explicit active-authorization guard
  preserves the link longer if needed. This preserves pairing-ID lost-response
  reconciliation throughout authorization. On eligible deletion, the FK sets
  `pairing_session_id` to NULL; it never deletes a token or ownership row.
- Registration challenges do not append rows. Expired/revoked management nonces
  are replaced with non-authorizing `retired:` markers, expiry zero, and an
  incremented version. A fresh valid signed challenge issues a new random nonce.
  Cleanup cannot make an old signature valid or revive a revoked/expired owner.
- Each invocation performs at most four rounds of 250 expirations, 250 deletions
  and 250 nonce retirements: **1,000 rows per category**, then stops. Empty queues
  stop early. Aggregate-only logs warn when a work bound is reached. Later cron
  runs drain the backlog. Monitor failures/saturation and increase reviewed
  capacity if sustained arrivals exceed processing; native approximate limits
  alone do not provide a strict global bound on total database size.
- Persistent `push_tokens` and `push_registration_auth` rows are deliberately
  preserved. Legitimate registration storage still grows with registered phones;
  this step removes unbounded *transient session/challenge history*, not durable
  ownership records or user subscriptions.

Cleanup SQL conditions and mutations execute atomically in D1 batches. A concurrent
registration either commits first and becomes ineligible for transient deletion,
or loses to expiry/cancellation and fails closed. LCD codes and signing keys are
never included in scheduled logs.

Errors return bounded generic messages. No raw DB exceptions, codes, tokens,
grants or keys are logged. Invalid JSON/keys, expiry, missing configuration,
revoked devices and denied rate limits fail closed. Device/server clock agreement
is required for signed challenge requests as well as TLS certificate validity.
Supabase/telemetry credentials are not accepted or issued by these endpoints.

Before deployment: repeat local runtime tests for any backend changes; inspect the
actual production schema/triggers; review rate limits and retention; provision
device keys through a separate approved process; verify ESP32 TLS/loop timing and
LCD warning precedence; integrate/test Firebase Hosting and multiple Androids.
