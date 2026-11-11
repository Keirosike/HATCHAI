# Online integration — local implementation, production HOLD

No production SQL, registry, secret, deployment, notification, serial retry or firmware upload was performed during this run. The previously confirmed controller MAC b03fd35b6134 remains pinned; older hardware history is retained. The failed COM3 diagnostic stopped during the first snapshot before RAM transfer. This report does not authorize another attempt.

## Implemented this run

Controller: background DHT22 acquisition on core 0, priority 1, 3072-byte task stack, two one-element POD queues. Each GPIO receive remains bounded (~6.5 ms), with a 2.1-second inter-attempt delay. This is not an asynchronous electrical protocol: the background task blocks briefly; the main control loop uses zero-wait queue snapshots. Existing five-second control processing schedule, failed-read recovery interval, PID, heater GPIO14, buzzer GPIO27, motor pins and safety thresholds are unchanged. Snapshot creation/queue failure fails closed. Actual sensor timing, task stack high-water and Wi-Fi contention require hardware verification.

Telemetry: existing task samples/uploads at five seconds; queue remains eight bounded RAM frames, signed protocol unchanged, dedicated key only, validated TLS/UTC and admission heap guards preserved. Accepted/dropped/failed/rejected counters are sanitized. No offline SD replay; reset loses this RAM queue. Internet loss never blocks control. Queue saturation can drop newer frames; this limitation is visible and not guaranteed delivery.

Database 006 draft: one latest payload/incubator; immutable event/hash receipts retained eight days for seven-day accepted captures; existing 24-hour nonce protection; weighted sums/counts/min/max in 30-minute UTC windows. At most one valid upload per five-second slot (360/window). Invalid frames do not enter averages. Captured times determine the slot; first valid committed sample wins a slot, including out-of-order requests. Existing raw historical table is not overwritten or deleted by v2 cleanup; new ingest no longer appends raw samples. Delayed samples still update latest only when newer. Windows accept lateness until interval_end+10 minutes; after that, no summary revision. Cron finalizes at most 100 eligible windows/run. Count 360 means complete; lower counts are partial. Empty windows are represented as chart gaps, not invented records. Samples are uploaded latest-valid states; short permitted DHT retention can repeat a measured state and does not claim every upload is a new physical conversion. Current open windows are not final history. One window/incubator/interval, about 48/day/1440 per 30 days when data exists. Finalized history retention 30 days.

Conditional history: owner-checked read_v2 returns historyVersion; matching versions omit history rows, while latest state still returns. Worker returns ETag and supports If-None-Match with explicit CORS. Ownership/session is checked before 304. Browser has a per-session five-second cache with monotonically re-aged status and two-second render polling. A two-second render is NOT a new measurement. Account lookup is cached at most a minute, but every network telemetry read independently checks ownership. Normalized state distinguishes online (<15 s), stale (15–90 s), offline (>=90 s), unavailable. Charts draw UTC 30-minute averages with null gaps and retain the canonical layout. No online controls enabled.

Database 007 draft: backend-only alert rules/state/events/durable per-subscription outbox. Fresh telemetry evaluates high/critical/low temperature and configured humidity rules; sensor failure/staleness and controller-offline are separate kinds. Debounce, warmup and recovery hysteresis are rule-controlled. One event per active/resolved transition; no periodic repeat spam. Observe serializes by controller; tick scans at most 20 controllers/run (one approved incubator currently; larger fleets need scheduling review). Fresh per-upload observe plus cron handles missed observations/disconnection. Each delivery rechecks device, current incubator owner, enabled rule and subscription. Three attempts, durable lease fencing; expired leased jobs become unknown and are not blindly resent. Per-scheduler dispatcher handles one job/run: multiple subscribers can have minutes of delivery latency under backlog. This is not a life-safety alarm; local cutoffs remain authoritative. Push provider acceptance does not prove visible Android receipt.

Native push: same verified VAPID/encryption sender, added fixed telemetry-alert payload type and safe same-origin click handling in separate native worker. Existing Firebase messaging worker preserved. TELEMETRY_ALERTS_ENABLED, TELEMETRY_ROLLUPS_ENABLED and NATIVE_PUSH_DELIVERY_ENABLED remain false locally; no rules are seeded by 007. Proposed disabled temperature/sensor/offline rules are in supabase/sprint4_alert_rules_REVIEW.sql. They use existing Config.h values (high38.5/clear38, critical39/clear37.5, low36.5/clear37 with 30-min warmup and10-min delay). Critical notification recovery is observational; it does not acknowledge the physical controller's latched trip. Humidity/phase-specific thresholds are NOT defined by the current verified contract; humidity rules are implemented but cannot be configured/activated until those values are supplied/reviewed. No batch identifier or phase is invented.

Cameras: existing independent identities, MAC-bound provisioning, signed ingestion, durable event queues, 128 KiB JPEGs, private storage, retention and owner retrieval preserved; no camera source/build changed this run. Images remain reviewed Upper/Lower snapshots, not cloud live video. Router/controller local communication depends on actual private LAN address, no client isolation, and existing independently configured local camera keys. The existing local camera HTTP header-key channel is a private-LAN trust boundary, not certificate-validated TLS; never expose it through public forwarding. No new gateway/ESP-NOW implementation added.

Provisioning: no hardware retry. Host now reports flash_read_failed with bounded offset/length and allowlisted exception class, never raw serial exception text or buffers. Existing full snapshots, DPAPI encryption, MAC checks and RAM/write gates retained.

## Review hashes — not executed

- supabase\migrations\202611100006_telemetry_rollups_REVIEW.sql
  SHA-256 7AA01CB3E95363102F3E4F8467F5E7947181622E87EF0CC4BB521FADEC1E3A6B
- supabase\migrations\202611100007_telemetry_alerts_REVIEW.sql
  SHA-256 50D148F1BB388105C59C017DE127CF4F35A833F153235E629E2BC2E603FEEF3D

006 replaces only the existing ingest function and adds v2 read/finalize/cleanup; 007 adds alert objects. Both require postgres/BYPASSRLS and preserve browser-denied forced RLS/backend-only definer RPCs with fixed pg_catalog search_path. Post-install metadata SELECTs: supabase/verify_online_rollups_READ_ONLY.sql. Existing migrations003–005 are already supplied/verified: never rerun them. Rule insert draft is a separate approval, not part of migration007. Package A registry review remains unchanged.

## Quotas and deployment order

At five-second cadence: 17280 uploads/day/controller. Two-second render with five-second cache normally fetches every six seconds (14400 telemetry reads/day/visible tab); hidden dashboard polling stops. Incubator-list lookup adds at most1440/day continuously visible. Conditional history avoids serializing 48 averages on every response; empty 304 responses still require authenticated database lookups. Camera status pages add their own requests. Five continuously open tabs plus controller are already close to100000/day before camera/API overhead. Rate limits are approximate/location-scoped, not global quotas. Supabase write work is roughly nonce+receipt+latest+window per accepted valid upload plus optional alert-state work, not merely48 writes/day. Dedup receipt/index retention, database vacuum/bloat, egress and Worker CPU must be monitored; no cost-free unlimited-capacity claim.

Official quota references checked during this run: https://developers.cloudflare.com/workers/platform/limits/ (Free100000/day and10ms CPU/request); https://supabase.com/docs/guides/platform/billing-on-supabase (Free500MB database); https://supabase.com/docs/guides/platform/manage-your-usage/egress. Actual project usage is not available from local tests. Before activation, measure database size/indexes and real crypto CPU/egress on the chosen plan.

Shortest gated path:
1. Review/approve only new migrations006/007, verify installed metadata; no ingestion enabled.
2. Approve Package A disabled registry records, proposed rule configuration (humidity remains blocked), and Package B independent key generation/private upload/deployment with all new ingestion/rollup/alert gates false. Preserve NATIVE_PUSH_TEST_ENABLED=true from verified production, six existing secrets, DB binding, CORS and cron.
3. Separately approve a read-only controller diagnostic retry using the improved safe error reporter. Resolve flash-read reliability before NVS writes. Then approve credential provisioning and firmware/filesystem upload for the current MAC. Loads remain isolated until normal firmware/control/safety are verified. Loading RAM pauses incubation.
4. After physical UTC/TLS/router/control tests, approve controller registry activation and TELEMETRY_ENABLED + TELEMETRY_ROLLUPS_ENABLED together. Keep alerts/cameras/push disabled. Verify actual dashboard data, invalid/stale behavior and a completed+late-grace history interval.
5. After rule review and controlled real-device push receipt, separately enable telemetry alerts/live delivery. Never infer Android display from provider acceptance.
6. Approve cameras one at a time: MAC/role read-only diagnostic, router+key provisioning, reviewed role firmware, local communication, then camera event/capture gates. Verify stored private JPEGs and durable outbox; only then real Upper/Lower detection notifications. No production batch association until schema is verified.

Rollback: first disable affected new gates; preserve old Worker/Hosting rollback versions and all data. Old Worker with006 installed cannot read latest/window data through its old raw-read path, so keep telemetry disabled until a separately reviewed compatibility rollback is approved. Do not drop tables, restore whole NVS or rerun003 as a rollback. Revert code/site with recorded approved versions; new tables/history remain intact.


## Final local results and files

Final full suites: 152 Worker tests passed, 0 failed; 53 frontend tests passed, 0 failed. A frontend cache regression was found and corrected before the final run. Native protocol/state tests116 passed, signing vectors30 passed (10 actual verifier signatures plus tamper checks), PID/sensor-grace/sampling compile assertions passed, DHT GPIO-waveform and actual background-task mock tests passed, recovery policy checks passed. Provisioner67 native assertions/20 host tests passed, including safe flash-read failure reporting; no serial accesses. Browser367 shared-page checks,13 camera checks,7 new telemetry/UTC-history/stale/polling checks passed. Isolated workerd requests:8 existing telemetry,7 capture,5 new conditional rollup/alert requests passed using configured production compatibility date and synthetic outbound services. These are mocks/local PostgreSQL, not a physically concurrent multi-connection production database or real Android receipt proof.

Controller firmware build and SPIFFS build passed. Controller firmware.bin1293760 bytes; App0 partition1310720; remaining16960. Linked flash1287177 bytes (98.2%); static RAM68460. Background sensor adds3072-byte task stack plus two queue allocations; existing cloud task12288 bytes remains, and TLS free-heap/largest-block admission remains. Runtime free heap/stack high-water/timing under Wi-Fi+SD+sensor faults remains hardware-only validation. SPIFFS image1441792 bytes equals its partition by design, not zero filesystem free space. Camera images were unchanged and not rebuilt unnecessarily; both1331664 bytes, reviewed hashes unchanged.

Changed in this run:
- include/Dht22Sensor.h; src/Dht22Sensor.cpp; src/IncubatorController.cpp; src/main.cpp; include/CloudSync.h; src/CloudSync.cpp.
- cloudflare-worker/src/telemetry.js; cloudflare-worker/src/telemetry-alerts.js (new); cloudflare-worker/src/index.js; cloudflare-worker/src/native-push-delivery.js; cloudflare-worker/wrangler.jsonc.
- public/telemetry-api.js; public/native-push/service-worker.js; public/online-dashboard.js; data/js/dashboard.js; data/js/dashboardAdapters.js. Canonical public/shared assets and ignored dist release regenerated by existing packaging scripts; no second dashboard.
- supabase/migrations/202611100006_telemetry_rollups_REVIEW.sql and202611100007_telemetry_alerts_REVIEW.sql (new); supabase/sprint4_alert_rules_REVIEW.sql (new); supabase/verify_online_rollups_READ_ONLY.sql (new).
- tools/device-provisioner/provision.py; tools/device-provisioner/tests/test_host.py.
- cloudflare-worker/test/telemetry-rollups.test.js; cloudflare-worker/test/telemetry-alerts.test.js; cloudflare-worker/test/runtime-rollups.mjs (new); test/telemetry-api.test.mjs; test/native-push-worker.test.mjs; test/dht22-driver.cjs; test/online-telemetry-browser.cjs (new).
- This report. Unrelated existing changes preserved.

Next approval-dependent cloud step: review006+007 exact hashes above and approve their production installation, then run verify_online_rollups_READ_ONLY.sql and stop on failure. Registry, rule configuration, secrets, Worker/Hosting deployment, device diagnostics/provisioning/flashing and feature activation remain separate approval gates. Earlier approval for003–005 is not approval for006/007.

Cloud low-temperature warmup begins with its first rule observation, not an inferred physical reboot; the current protocol has no boot/phase identifier. The cloud rule must not be represented as an exact replacement for local low-temperature/recovery logic. Phase-aware humidity and batch correlation remain blocked on actual configuration/schema.

Final artifact hashes:
- .pio/build/esp32dev/firmware.bin SHA-256 3171B46AD3E911194B235EBE37BCB710C052816794F6658A6FFFD48F63418D0F
- .pio/build/esp32dev/spiffs.bin SHA-256 F93163DC1DFBDCE2A73DF613E4CCCB2BD99FD2927BFC4D11CE34C4DDAC483C40
- test/.build/camera-images/upper.bin SHA-256 56C61CC5719B99A22E6B9ED8267CD05FE914A9DC9AE1EFA38AB7512DD643C4AA
- test/.build/camera-images/lower.bin SHA-256 1F4B17AA3942FC982C21B32D02B1E078DCBE770828368D20A6788ACC6A206502

Hosting release: 46 public assets; target myhatchai only; manifest verification passed. No deployment.
