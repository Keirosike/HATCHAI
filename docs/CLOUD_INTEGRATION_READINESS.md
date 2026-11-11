# Cloud integration preparation ? 2026-11-11

Local verification only. No production database, account, device or Worker was
contacted or changed. Production migration application, registry/credential state,
Cloudflare bindings/secrets and a physical controller TLS handshake remain unverified.

## Corrected integration defect

`telemetryRepository` prefixed every RPC with `hatchai_sync_`, including API-key
verification. The reviewed migration defines `hatchai_device_api_key_auth`, not
`hatchai_sync_device_api_key_auth`. A valid key therefore produced 503 with the
real adapter. Existing tests injected a repository mock and missed this boundary.

The local fix maps only that operation to its installed SQL name. Sync ingestion,
read, cleanup and rollup RPC names are unchanged. The new
`cloudflare-worker/test/cloud-integration.test.js` uses real telemetry/registry/API-key
SQL migrations in isolated PGlite and a synthetic PostgREST transport. It reproduces
the original 503 and passes with the routing fix; it does not inject a repository.

## Relevant endpoint inventory

| Endpoint | Method | Access boundary |
| --- | --- | --- |
| `/`, `/health` | GET | Public service/health information; no telemetry mutation |
| `/online/device-enrollment` | POST | Allowed browser origin, verified Supabase user, ownership RPC, rate limits |
| `/device/enroll` | POST | Short-lived owner-issued setup token bound to device/key; verifier-only persistence |
| `/device/telemetry` | POST | API-key authentication when its gate is true; signed HMAC otherwise; registry and replay checks |
| `/online/incubators` | GET | Verified Supabase user and owner-scoped lookup |
| `/online/incubators/:id/telemetry` | GET | Verified user, owner-scoped SQL; authorization precedes conditional 304 |
| `/device/camera-events` | POST | Separate camera HMAC credentials, registry role/placement, gated |
| `/device/camera-captures` | POST | Camera HMAC, bounded JPEG/hash validation, private storage, gated |
| `/online/incubators/:id/camera-events` | GET | Verified user and ownership |
| `/online/incubators/:id/captures[/:captureId]` | GET | Verified user and ownership; private image retrieval |
| `/online/push/public-key`, `/online/push/status` | GET | Verified Supabase user |
| `/online/push/subscribe`, `/online/push/unsubscribe`, `/online/push/test` | POST | Verified user, ownership, rate limits; test delivery separately gated |

Legacy controller pairing and browser registration routes remain separately
protected by HMAC/browser ownership proofs. `/chick-detected` still returns 503.
No cloud route was added for heater, fan, motor, setpoint or other hardware commands.

## Migration and identity

The API-key migration is additive and applies twice successfully against the actual
telemetry table definition plus the reviewed registry seed in isolated PostgreSQL.
The existing suites also verify registry drift rejection, grants, ownership, replay
and retention behavior. This is local compatibility evidence, not an inspection of
live Supabase.

- Logical device ID: `hatchai-inc01-controller`.
- Key ID: `controller-sync-v1` (not the hardware MAC).
- Role: controller; registry seed is disabled initially.
- Firmware enrollment, Worker token issuance and registry seed use the same key ID.
- Firmware persists the 32-byte key in NVS, stages/read-verifies before activation,
  and requires an authenticated local session for `/api/cloud/enroll`.

SQL helpers are SECURITY DEFINER, owned by postgres, with fixed
`search_path=pg_catalog`; execution is restricted to service_role. Enrollment token
and registry tables are not directly exposed to anon/authenticated clients.
Tokens store a peppered hash, expire in five minutes, and are bound to owner,
device and key. Redemption rechecks ownership and locks registry/incubator rows.
Same-key retry is idempotent; a different verifier cannot reuse a redeemed token.

Migration hashes (unchanged):

- Git/LF: `b345624fdd53bc213306b9d015de6aad102ffd12a65308297e26823e7ea03b72`
- Windows CRLF: `766a494da49589c4fdbd71450a75ce12817910671f5ac454cacbedebaf9931d0`

## HTTPS and authentication

Controller CloudSync connects to port 443, attaches the SDK certificate bundle,
sets the expected Worker hostname with common-name checking enabled, requires
zero mbedTLS verification errors, and checks certificate validity windows. Sending
also requires a recently synchronized clock. It does not use an insecure TLS mode.
These are source checks; actual target DNS/SNI/CA/time behavior still needs a
separately authorized device test. The enrollment and telemetry handlers do not independently reject HTTP-scheme
requests, so edge HTTPS-only enforcement must be verified before rollout. Live edge
configuration was not queried.

Worker API keys are 32 bytes encoded as base64url, accepted through the device,
key-ID and API-key headers, hashed with a device-bound server pepper, and verified
through SQL. Body identity must match authenticated headers. RPC calls use the
fixed HTTPS Supabase origin and refuse redirects; backend credentials are not
returned to the browser or device.

The integration regression proves valid API-key ingestion and rejection of missing,
malformed, wrong, mismatched and revoked keys; bearer-only authentication is not
accepted for device uploads. It also proves missing/tampered HMAC rejection and
successful independently authenticated HMAC fallback. Invalid requests do not add
telemetry rows. Disabled telemetry gates do not accept uploads.

## Revocation, ownership and cleanup

API-key revocation sets its revocation timestamp and consumes outstanding setup
tokens. Authentication rejects revoked or disabled registry entries. There is no
public Worker revocation endpoint: revocation is a backend-only SQL operation.
Rotation/re-enrollment of an existing or revoked key is not implemented by the
current enrollment flow; do not clear NVS or registry verifiers to bypass that.

API-key revocation does not revoke the independent HMAC credential. The gate-selected fallback
is preserved; the API-key gate selects the global controller-telemetry mode rather
than retrying a rejected API key through HMAC. Disabling the registry entry blocks ingestion in both modes; changing
or removing HMAC credentials would be a separately authorized operation.

Cleanup deletes used or expired enrollment tokens only after a one-day retention
period, with a maximum of 500 deletions per invocation. Worker cron is every minute;
API token cleanup runs while enrollment OR API-key authentication is enabled.
Ownership checks cover token issuance/redemption, online reads and registry-derived
ingestion; browser-supplied owner/incubator identifiers are not trusted.

## Gates and operational limits

Existing checked-in values are preserved: enrollment=true, API-key auth=false,
telemetry=false; camera/rollup/alert/delivery gates remain false. These are local
configuration values and do not establish live production gate values. In this
configuration telemetry uploads are disabled. If telemetry alone is enabled, its
mode is HMAC; the API-key controller path requires the API-key auth gate as well.

No secret was generated, copied, printed or changed. Missing local backend/pepper/
push credentials remain an operational prerequisite for real integration, not for
isolated tests. No migration, deployment, registry activation or hardware enrollment
was executed.

## Executed validation

- New real-adapter regression: reproduced 503 before the routing fix, then PASS.
- `npm test`: 160 passed, 0 failed, 0 skipped.
- `npm run test:runtime`: all six scripts passed using isolated workerd/services.
- `node test/runtime-rollups.mjs`: PASS (the seventh runtime script).
- Gate configuration and API-key migration compared with HEAD: unchanged.
- `git diff --check`: PASS.

Firmware and prior flash-optimization artifacts were not changed by this phase.
