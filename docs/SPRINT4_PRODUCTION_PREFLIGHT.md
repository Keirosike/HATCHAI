# Sprint 4 — production preparation and first approval gate

Status: HOLD at Supabase verification/migration approval. No production mutations, secret changes, deployments, provisioning or flashing performed.

## Verified production baseline

- Supabase project configured in the deployed Worker: https://dihufafcztqjuudjeqdm.supabase.co. Actual current database metadata is UNVERIFIED: no Supabase management token or database connection is available in this process. Existing schema screenshots/history are not a replacement for the current inspection.
- Cloudflare account: ecf0870e81b2fb48e1f05cdc9b34eab8. Worker hatchai; production version 27f16ea3-d995-47df-8c6c-89240ca2c294, deployment 01a8b10f-0b3b-4803-935e-db2fa92e5b74 (100%). Captured via authenticated read-only Wrangler commands.
- Deployed compatibility date: 2026-11-07. D1 binding DB -> ba5ac6e4-5fce-4201-bdb6-eeb4ebf3214d (hatchai-devices). Existing eight native rate-limit bindings match the local existing budgets. New Sprint 3 limiter namespaces are not yet deployed.
- Production native flags: NATIVE_PUSH_TEST_ENABLED=true; NATIVE_PUSH_DELIVERY_ENABLED=false; MANUAL_TEST_NOTIFICATIONS_ENABLED=false. The four new telemetry/camera gate bindings are absent from this version; new code must explicitly deploy them as false. Do not silently replace the approved native test setting with the checked-in false default.
- Existing secret binding NAMES verified: PAIRING_HASH_KEY, TURNSTILE_SECRET, SUPABASE_BACKEND_KEY, NATIVE_PUSH_VAPID_PUBLIC_KEY, NATIVE_PUSH_VAPID_PRIVATE_KEY, NATIVE_PUSH_VAPID_SUBJECT. No values read or displayed. TELEMETRY_DEVICE_KEYS and CAMERA_EVENT_KEYS are not present in this deployed version.
- ONLINE_ALLOWED_ORIGINS includes http://127.0.0.1:8080, https://hatchai-8d34c.web.app and https://myhatchai.web.app.
- Firebase project hatchai-8d34c contains DEFAULT site hatchai-8d34c and USER site myhatchai. Only myhatchai is the proposed target.
- Current live Hosting version: 141e7d90f48059fb; release projects/hatchai-8d34c/sites/myhatchai/channels/live/releases/1794286386827000. Release timestamp 2026-11-10T04:53:06.827Z (12:53 PM Asia/Manila). Current release has 44 files; the prepared new package has 46 public assets.
- Current Worker cron timing is UNVERIFIED by the version API. The local proposed schedule remains once per minute. Read-only confirmation of production trigger timing remains required before deploying.

Safe public checks: GET /health -> 200; GET /online/incubators without auth -> 401; authorized-origin OPTIONS -> 204 with exact origin, GET and Authorization; foreign-origin OPTIONS -> 403. Website GET -> 200. No real user token or notification was used. This does not verify real-user login or device ingestion.

## Confirmed local production fix

The actual live Hosting policy has img-src 'self', which blocks authenticated Blob capture previews. firebase.online.json now permits img-src 'self' blob: locally. script-src remains self-only; object-src remains none. No wildcard, data URL permission or LAN camera access was introduced. Browser tests reproduced failure under the old policy and real JPEG decoding under the prepared policy. This change is NOT deployed.

Files modified for Sprint 4: firebase.online.json; test/online-release.test.mjs; test/camera-view-browser.cjs. Added: test/camera-csp-browser.cjs, supabase/inspect_sprint4_PRE_MIGRATION_READ_ONLY.sql, this report. Generated release manifest was rebuilt against the new configuration.

## Migration review — exact ordered files

1. supabase/migrations/202611100003_telemetry_REVIEW.sql
   SHA-256 D6EA9878114264AFFF716883A219502DD9C4288CEA4D4B3958470D4D278811D2
   Creates device registry, telemetry, nonce tables; controller uniqueness, freshness/dedup/read/cleanup RPCs.
2. supabase/migrations/202611100004_camera_outbox_REVIEW.sql
   SHA-256 3ED22D2C7D7758CEFCFBF3B6353E2C3BE48107E3F3AB73E1FAC15CECBA3C3751
   Creates camera event, cooldown and delivery-outbox tables; event acceptance, owner read, lease/finish and cleanup RPCs.
3. supabase/migrations/202611100005_camera_captures_REVIEW.sql
   SHA-256 31CC8AB5067DBC069041CDF33A3C73AC286EFF489E4B31B1202AA9029CF0C4EB
   Creates capture metadata, reserve/complete/read/cleanup RPCs; replaces only the new camera cleanup function from step 2 so object cleanup is respected.

Combined consequences: seven additive application tables and seven explicit indexes (plus automatic constraint indexes); backend-only SECURITY DEFINER RPCs with fixed pg_catalog search_path; forced RLS; browser/public execution revoked; direct table access revoked. Existing incubator/subscription data, D1 records and Firebase configuration are not overwritten. No device registry rows or Storage bucket are seeded. No cleanup function runs during migration installation.

Dependencies: existing public.incubators UUID id/owner/device columns, public.web_push_subscriptions contract and auth.users. Executor must be postgres with SUPERUSER/BYPASSRLS. Current production prerequisites, effective grants, defaults, constraints, storage policies and registry state remain UNVERIFIED until the read-only inspection is reviewed. Local PostgreSQL tests passing is not production verification.

Each file is separately transactional and intentionally refuses blind reruns. If step 2 or 3 fails after an earlier file committed, stop, keep gates false and inspect. Do not drop successful additive tables or rerun blindly.

## First step now — read-only results needed

Open supabase/inspect_sprint4_PRE_MIGRATION_READ_ONLY.sql. In Supabase SQL Editor, verify project dihufafcztqjuudjeqdm, select postgres, and run each numbered SELECT section separately. Export each result with its section label. Section 11 is optional and must run only if section 2 confirms the registry exists. No endpoints, encryption keys, passwords, session tokens or user IDs are returned. Section 9 returns the actual non-secret incubator UUID rather than inventing one.

After these results pass review, request explicit approval to execute ONLY the three hash-matched files above, in order. Production SQL execution is unavailable from this process currently; do not provide private keys in chat. Existing authenticated dashboard access or a supported secure connection can be used after approval.

After approved installation, execute supabase/verify_sprint3_REST_READ_ONLY.sql. Expect seven tables, 13 unique new functions, postgres owners, forced RLS, browser execute=false, backend execute=true, valid indexes. Stop if any differ.

## Later gated actions — NOT authorized by this report

- Storage: inspect all existing bucket and object-policy expressions first. Propose a dedicated PRIVATE bucket with JPEG MIME restriction and 131072-byte file limit. Broad existing browser policies can still expose a private bucket; do not approve storage_reviewed merely because public=false. Worker validates JPEG/hash/dimensions, uses immutable paths, and serves images only after ownership verification. Seven-day confirmed / 15-minute pending retention, 512/incubator quota, bounded cleanup. Request separate bucket/policy approval.
- Registry: confirm actual incubator UUID and owner. Controller hatchai-inc01-controller; Upper hatchai-inc01-cam01; Lower hatchai-inc01-cam02. Prepare exact enabled roles/placements/key IDs only after metadata review; no row inserted yet.
- Credentials: independent TELEMETRY_DEVICE_KEYS and CAMERA_EVENT_KEYS, dedicated device NVS, no old notification provisioner. Request approval before generating/installing production keys, changing registry or touching NVS. Preserve all six existing secrets.
- Network: cameras need Internet-capable router STA, not an assumed NAT connection through the controller AP. Preserve controller AP+STA/offline control. Confirm actual router-side controller address before camera provisioning.
- Worker: after database/Storage/credential prerequisites and separate deployment approval, deploy existing configuration with new gates false. Explicitly preserve NATIVE_PUSH_TEST_ENABLED=true. Proposed command (DO NOT RUN UNTIL APPROVED):
  node C:/Users/LENOVO/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/bin/wrangler.js deploy --config cloudflare-worker/wrangler.jsonc --var NATIVE_PUSH_TEST_ENABLED:true
- Hosting: node tools/package-online-release.mjs; node tools/verify-online-release.mjs. After separate approval: firebase deploy --project hatchai-8d34c --config firebase.online.json --only hosting. Only myhatchai is targeted.
- Controller/cameras: separately approve target board, freshly verified artifact/hash, credentials and configuration-preserving upload procedure. No hardware inspected or flashed in Sprint 4. Sprint 3 artifacts remain local candidates, not current physical verification.
- Enable telemetry first after supervised network/TLS/control checks. Cameras separately, then both together. Notifications require real device receipt testing. Keep /chick-detected disabled and remote hardware control unavailable.

## Rollback references — commands are not executed

Worker:
node C:/Users/LENOVO/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/bin/wrangler.js rollback 27f16ea3-d995-47df-8c6c-89240ca2c294 --config cloudflare-worker/wrangler.jsonc

Hosting:
firebase hosting:clone hatchai-8d34c:myhatchai@141e7d90f48059fb hatchai-8d34c:myhatchai:live --project hatchai-8d34c

Recheck live references immediately before deploying, since another actor could publish a newer version. Disable affected new ingestion gates first if a problem occurs, preserve data/backups, and roll back code/site only with approval. Additive tables remain; no routine destructive SQL or whole-NVS restoration.

## Fresh verification

- 13 telemetry/event/capture tests passed, including actual local PostgreSQL migration/RPC behavior.
- 4 release-package tests passed; 46 public files verified, 343935 bytes.
- 13 shared camera UI checks passed with the Firebase CSP enforced locally.
- CSP negative/positive browser control passed: live policy blocks Blob images; prepared policy permits real JPEG decoding.
- No new firmware changes or rebuild were necessary before the first database gate. Earlier Sprint 3 build/hardware caveats remain in SPRINT3_RESUMED_VERIFICATION.md.


## Updated supplied production verification and accelerated preparation

Supplied CSVs 30–32 verify the installed seven tables (postgres, forced RLS, no direct browser/backend DML), 13 backend-only pg_catalog definer functions, and 17 valid indexes. Subsequent screenshots verify private hatchai-camera-captures bucket, 131072-byte JPEG-only restrictions, and zero storage.objects policies. Earlier UNVERIFIED statements above describe the initial baseline and are superseded for these exact checks. Production registry row contents and device connectivity remain unverified.

Prepared grouped operations in SPRINT4_APPROVAL_PACKAGES.md; no package executed. Registry draft inserts disabled records only and is tested in local PostgreSQL. Key tooling is DPAPI protected with explicit separate actions, replacement refusal, current-account guard and private stdin upload; only synthetic test credentials generated. It does not provision NVS. A dedicated preservation-tested telemetry/camera NVS writer remains a physical rollout blocker; never reuse the retired notification provisioner or replace NVS wholesale.

Fresh accelerated-run checks: 2 PostgreSQL registry tests, 4 artifact parser tests, 4 synthetic DPAPI checks, 4 Hosting release tests passed. PowerShell syntax passed; production upload path not executed/tested live. Hosting package 46 public files, 343933 bytes. Existing backend integration tests were not rerun because backend runtime code was unchanged. Controller firmware 1292528 bytes, App0 1310720 bytes, free 18192; filesystem 1441792 bytes fits exactly its fixed-size image partition. Static controller RAM remains 68444 bytes from last successful build. Camera images remain 1331664 bytes each and match previously reviewed hashes. No new firmware build needed during this accelerated run.


## Independent device provisioner implemented locally

The previous missing NVS-writer limitation is superseded by tools/device-provisioner. It is separate from the retired notification utility and does not modify the application firmware. Implements three board-specific RAM agents, encrypted host session and DPAPI bundle/backup handling, exact role/MAC confirmation, raw partition/NVS validation, closed startup write gates, no sector erase, pending-plan journal, enable-last commits and fresh readback/preservation. 65 native assertions and 15 host tests passed; three IDF 5.4.4 builds and image manifests verified. See its README/RELEASE.json and docs/SPRINT4_PACKAGE_A_EXECUTION.md. Crowded/damaged NVS fails closed, not auto-repaired. No hardware was accessed. Physical startup diagnostics, actual credential installation and any firmware uploads remain separately approval-gated.


MAC-bound provisioning update: verified Upper d885accba598 / Lower d885acca0c00, with independent host and agent enforcement. 67 native assertions and 18 host tests passed; three rebuilt RAM images/manifests passed verification. Firmware, production registry, secrets and deployments unchanged. See current RELEASE.json, which supersedes earlier RAM hashes.
