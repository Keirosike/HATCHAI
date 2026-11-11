# Sprint 3 REST integration - local implementation

Status: locally implemented and tested; NOT deployed, migrated, provisioned, or flashed.

## Data path

Controller -> certificate-validated HTTPS POST /device/telemetry -> existing hatchai Worker -> Supabase REST RPC -> owner-authenticated GET /online/incubators/:id/telemetry -> shared dashboard.

Device signatures cover method, path, canonical payload and timestamps. Separate TELEMETRY_DEVICE_KEYS authenticate controllers. The database registry, not request-supplied owner/incubator IDs, determines authorization. Nonces prevent replay; stable event UUIDs reconcile lost acknowledgements. Database functions are backend-only SECURITY DEFINER with pg_catalog search paths, forced RLS, and no browser table grants.

No Supabase backend key is placed in firmware or browser assets. Existing Firebase messaging worker is preserved. /chick-detected stays disabled.

## Firmware and resources

CloudSync reads dedicated Preferences namespace hatchai-sync in read-only mode: enabled (bool), device (exact hatchai-inc01-controller), key-id (bounded protocol identifier), key (32 raw bytes). Missing or invalid credentials disable the task. The previous notification credential provisioner is NOT used. No provisioning implementation or production credential was created.

A priority-1 task on core 0 exclusively owns TLS, DNS, signing and HTTP parsing. Stack allocation is 12,288 bytes, allocated only when credentials validate. Queue capacity is eight fixed envelopes, sampled every 30 seconds with zero-wait enqueue. DNS deadline 2 s, connection/TLS deadline 6 s, overall operation deadline 12 s. Valid UTC synchronization and certificate/hostname verification are required. Heap admission requires 100 KiB free internal RAM and a 48 KiB contiguous block; this is an initial guard, not measured runtime assurance.

The queue is RAM-only: about four minutes of samples at normal cadence. Full queue drops new samples; reboot loses the queue. Existing SD logs remain independent; automatic SD backlog replay is NOT implemented. No networking runs in the incubation loop. Physical timing, fragmentation, Wi-Fi loss and TLS memory pressure still require supervised bench tests.

Fan is directly powered, so fan feedback is null. Heater/roller values report commanded GPIO states, not electrical current or proof of heating. Sensor validity/age is explicit. Freshness needs capture and receipt within 90 s; old values are not presented as live.

Latest local build: flash 1,296,341 / 1,310,720 bytes (14,379 bytes of linked-code headroom); static RAM 68,444 / 327,680 bytes. Firmware and SPIFFS builds passed. No partition changes.

## Shared camera view

Canonical local UI is reused online. Upper/Lower panels have zero gap, horizontal desktop and vertical mobile, independent statuses and preview switching. Local previews connect only to validated private-LAN URLs. Online mode does not access private IPs and keeps preview disabled until an authenticated cloud media transport exists.

Optional Upper/Lower camera identities use independent local heartbeat keys. Unassigned legacy cameras are never silently labeled Upper or Lower. New camera cloud event REST/outbox code is gated off. Camera firmware changes only add optional identity to the existing heartbeat; a durable camera-to-cloud HMAC sender, verified batch association and private image upload remain unfinished. Metadata history does not imply stored capture images.

## Prepared production changes (approval required)

1. Review supabase/migrations/202611100003_telemetry_REVIEW.sql; apply only after verifying its recorded SHA-256 and production prerequisites.
2. Register the actual controller/incubator/key ID in hatchai_sync_devices using a separately reviewed administrative operation. No registry records are seeded by the migration.
3. Configure TELEMETRY_DEVICE_KEYS through Worker secrets with an independently generated controller-only key, then provision the matching dedicated NVS record by an approved method. Do not reuse the retired notification provisioner.
4. Deploy the existing Worker with TELEMETRY_ENABLED=false, CAMERA_EVENTS_ENABLED=false and NATIVE_PUSH_DELIVERY_ENABLED=false initially. Preserve currently approved test-notification settings explicitly: the checked-in defaults are false.
5. Verify endpoints, registry authorization and existing login/CORS. Enable telemetry separately after controller credential and supervised firmware checks pass.
6. Repackage with node tools/package-online-release.mjs; verify with node tools/verify-online-release.mjs. Hosting target remains myhatchai, package dist/myhatchai/site (45 allowlisted public files). Deploy only that target after approval.
7. Review camera migration 202611100004_camera_outbox_REVIEW.sql separately. Do not activate camera ingestion/delivery yet.

Cloudflare native rate limits are approximate and location-scoped, not global quotas. Added namespaces: telemetry 834318 (20/min), camera 834319 (20/min), preserving existing bindings and minute cron. Cleanup uses bounded batches: telemetry/nonces and retired camera events. Camera outbox leases fence completions, cap attempts at three, preserve Retry-After deadlines, terminate unknown outcomes without blind resend, and re-check current subscription ownership/revocation at claim time. One job is dispatched per minute when explicitly enabled; capacity needs review before production camera use. Revocation cannot recall a request already accepted by a provider.

Rollback: disable TELEMETRY_ENABLED/CAMERA_EVENTS_ENABLED first; roll Worker/Hosting back to recorded versions. Leave additive tables in place; do not drop records or restore an entire NVS/flash image as routine rollback. Record cloud version references before any later deployment.

## Required physical/cloud verification

- Approved migration installation and function grants; actual device registry and dedicated credentials.
- Valid and invalid UTC/TLS, AP+STA connectivity, Wi-Fi outage/reconnection, queue overflow, reset/data loss.
- Control-loop timing, sensor acquisition, heater/roller safety, SD logging and watchdog during TLS handshakes.
- Authenticated online sensor updates and owner isolation on myhatchai.web.app.
- Independent camera heartbeat identities, no public streams, then separately reviewed batch/event/capture integration.
- Real Android background Web Push receipt remains unverified by these local tests.

## Verification record

- Worker automated suite: 135 passed, 0 failed (includes actual local PostgreSQL telemetry/outbox tests).
- Frontend/package suite: 47 passed, 0 failed.
- Shared dashboard browser checks: 367 passed; auth browser: 35 passed; native push browser: 23 passed; camera preview/isolation: 5 passed. Browser APIs/backends mocked; no live-device claims.
- Existing workerd/D1 suites passed: 19 smoke requests, 206 hardening requests/11 scenarios, online ownership/redirect checks, eight native crypto/API requests. New signed telemetry runtime: eight requests, three mock Supabase calls, all passed.
- Native protocol/state tests: 113 passed; 26 vectors passed, including native REST telemetry signing verified by the actual Worker.
- DHT22 waveform/recovery regression, dual-motor browser regression, 13 identifier assertions and 14 incubation compile regression files passed.
- Firmware and SPIFFS builds passed. Final controller build reconfirmed 1,296,341 flash bytes and 68,444 static RAM bytes.

Reviewed-file hashes for identifying these local drafts (not approval to execute):

202611100003_telemetry_REVIEW.sql: D6EA9878114264AFFF716883A219502DD9C4288CEA4D4B3958470D4D278811D2

202611100004_camera_outbox_REVIEW.sql: 3ED22D2C7D7758CEFCFBF3B6353E2C3BE48107E3F3AB73E1FAC15CECBA3C3751

## Source files for this phase

- Firmware: include/CloudSync.h, src/CloudSync.cpp, src/main.cpp, platformio.ini, src/NotificationPairingProtocol.cpp; include/HatchWebServer.h and src/HatchWebServer.cpp (safe sync status and independent camera metadata); include/CameraLinkConfig.h; camera/main/camera.cpp and hatch_link_config.hpp under esp32-devcam.
- Worker: src/telemetry.js, src/camera-events.js, src/index.js, wrangler.jsonc; package.json runtime test command.
- Database: the two additive REVIEW migration files listed above, not executed.
- Shared UI: data/camera.html, data/css/camera.css, data/js/camera.js, data/js/cameraView.js, data/js/dashboard.js, data/js/dashboardAdapters.js; public/telemetry-api.js and public/online-dashboard.js.
- Packaging: tools/package-online-dashboard.mjs, tools/package-online-release.mjs, tools/verify-online-release.mjs, associated package fixture tests. Generated public/shared and dist outputs are reproducible assets.
- Tests: Worker telemetry/camera-events tests, runtime-telemetry.mjs and full-production-bundle runtime fixtures; test/telemetry-api.test.mjs, test/camera-view-browser.cjs and notification-pairing/vectors.json.

Earlier UI, relay, PID, DHT22 and native-push changes in the working tree predate this phase and are preserved.

Actual generated firmware.bin: 1,302,912 bytes; App 0: 1,310,720 bytes; actual image headroom: 7,808 bytes. SHA-256: AEA592B5CA1AEF56AF6104F21A3FE88D07EEDC61C28B2ABB0526F169E6725CA1. SPIFFS SHA-256: 84CAF5928C3FBA8AAF919B58DA694BEE50ACAE62A0A87288FCC5C854AB4BEE55.

A complete camera dependency rebuild was stopped intentionally; this is not a verified new camera firmware image. A targeted changed-source compile is recorded separately.

Post-install metadata inspection is prepared in supabase/verify_sprint3_REST_READ_ONLY.sql; not executed.

Targeted ESP-IDF 5.4.4 camera.cpp object compilation PASSED with existing camera-config initializer warnings. No new complete camera image is claimed.

Generated tracked files under esp32-devcam/camera/build remain modified by the local camera build. Automatic approval review rejected restoring these files from HEAD because it could overwrite uncommitted work. No alternative cleanup was attempted. They must not be treated as source changes or production artifacts.

For current recovered implementation status, image size, tests and production prerequisites, see SPRINT3_RESUMED_VERIFICATION.md; earlier figures in this document are historical.
