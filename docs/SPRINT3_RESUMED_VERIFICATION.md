# Sprint 3 resumed implementation — local release record

No production SQL, secrets, deployments, device provisioning, flashes, or actuator operations were performed.

## Completed and connected

- Controller samples -> signed HTTPS REST -> existing Worker -> backend-only Supabase RPC -> owner-authorized shared dashboard.
- Compact controller telemetry serialization uses the exact canonical field order. Generic signer is the comparison oracle. It saves 10,400 bytes in the linked application versus 1,296,341 bytes. The unsupported LTO experiment was removed; tools/firmware-lto.py is intentionally absent. platformio.ini has no LTO flags or hooks.
- CloudSyncRecovery is used by the real task: lost/invalid ACK retains the event ID; bounded exponential retry, long 429/503 Retry-After, monotonic rollover, authentication pause and invalid-payload discard are covered by native tests.
- Upper/Lower camera-scoped signing cannot authorize controller pairing. Independent IDs, key maps and database registry determine placement/incubator.
- Camera cloud task is connected after inference initialization. It reads only dedicated camera credentials, uses validated HTTPS and recent UTC, resolves DNS asynchronously, and bounds DNS to 2 s, connection/TLS to 6 s, and total request to 12 s. No controller task or lock is used.
- Four persistent camera event slots use a versioned 52-byte CRC record bound to Upper/Lower camera identity, NVS commit and readback. CRC detects corruption; it is not encryption/authentication. Stable UUIDs survive restarts and lost acknowledgements. Corrupt slots disable cloud delivery; no automatic erasure or replacement is attempted.
- At most four event JPEGs plus two queued JPEGs are retained in PSRAM, 128 KiB each. Images are not persisted across camera reboot. Events survive reboot; image recovery does not. Captures are attempted up to three times. Full queue drops additional cloud captures, independently of local inference and incubation.
- Private capture endpoints are routed in index.js: POST /device/camera-captures, GET /online/incubators/:id/captures, GET /online/incubators/:id/captures/:captureId. They verify signatures, content hash, bytes, JPEG bounds, camera role, owner, revocation and database reservation. No Storage object path or signing credential is returned publicly.
- Uploads are immutable (no overwrite), reconciled through download/hash readback. Duplicate completion succeeds without extending retention. Pending uploads expire after 15 minutes; confirmed captures after seven days. Retained quota: 512/incubator, serialized across both cameras. Cleanup leases hide expired records and delete database metadata only after Storage deletion is confirmed. Cleanup handles one object/minute; sustained quota pressure requires operational capacity review.
- Shared camera UI supports local LAN previews and owner-authenticated latest stored cloud captures using the same canonical HTML/CSS/component. Desktop horizontal/mobile vertical, zero gap; automatic initialization, preview slide switch, independent status, authenticated Blob images, object URL cleanup and late-response fencing are tested. Cloud captures are snapshots, not live video streams. Synthetic JPEG decoding is verified in Chrome; real camera JPEG operation remains a hardware test.
- Optional camera router Wi-Fi/controller address is read from hatchai-wifi without writing credentials or exposing them. Legacy camera push remains disabled.

## Final firmware/artifacts

- Linked application: 1,285,937 bytes; static RAM: 68,444 / 327,680 bytes.
- Actual firmware.bin: 1,292,512 bytes. App 0 from generated partition table: 1,310,720 bytes at 0x10000. Actual image headroom: 18,208 bytes, up from 7,808.
- SHA-256 firmware.bin: A43F8D7FA3C8A5E330568E47DC19361FBE9FB47C6886CFABFAFBFCD5C35F8E7C5.
- Controller task stack: 12,288 bytes; camera cloud stack: 16,384 bytes. Heap admission: 100 KiB free internal and 48 KiB largest block. Stack high-water marks, TLS peak heap and physical timing have NOT been measured.
- Controller firmware and SPIFFS builds passed. Partition layout was not changed. Existing camera.bin is not a new reviewed camera cloud image.
- Upper and Lower ESP-IDF 5.4.4 camera/cloud/signer source checks passed (12 compile checks). Both complete camera firmware builds and image sizing have now passed; see final camera build record below. Compile checks do not prove physical camera operation.
- Hosting package: dist/myhatchai/site, 46 allowlisted public files, verified against source. No firmware, credentials, backups, tools or tests included.

## Test results actually run

- Worker suite: 144 passed, 0 failed; capture PostgreSQL tests rerun after duplicate-completion correction.
- Frontend/package tests: 50 passed, 0 failed.
- Native protocol/state: 116 passed, 0 failed; 30 signing vectors, including both camera IDs and capture/event routes; 10 signatures accepted by actual Worker verifier.
- Native controller retry/camera record tests passed: lost ACK, long Retry-After, bounded backoff, rollover, authentication, truncation and every-byte corruption.
- Shared dashboard browser: 367 passed; camera preview/isolation: 13; auth: 35; native push UI: 23. Synthetic browser/backend fixtures; no real device notification claim.
- workerd/D1: 19 smoke requests; 205 hardening requests/11 scenarios; online owner/redirect tests; eight native crypto/API checks; eight telemetry requests; seven capture requests. Production compatibility date 2026-11-07, flags []. Real cloud services were not called.
- Offline recovery fault model: 5,707 passed. DHT22 GPIO waveform/recovery, dual motor request regression, and 14 incubation compile files passed. This does not replace real relay/sensor/SD tests.

## Remaining limitations

- No verified production batch schema/mapping was supplied. Captures/events do not invent batch ownership or hatch counts; batch association remains pending actual schema inspection.
- No public/live cloud camera stream is implemented; online preview is the latest stored authenticated capture.
- Controller telemetry backlog is RAM-only (eight samples). It is lost at reboot. Existing SD logs are preserved; no SD backlog importer is claimed.
- Camera JPEGs are volatile; a reboot can deliver a durable event without its photo. NVS wear/free pages, interruption behavior and capture queue pressure need bench tests.
- Camera task currently pauses on authentication rejection; credential review and restart are required. No old notification credential provisioner is used.
- Android native push display remains separately unverified. Camera event ingestion/delivery and capture gates remain false.
- No full camera cloud image was flashed or physically tested.

## Exact production prerequisites and approval sequence

1. Review migrations 202611100003_telemetry_REVIEW.sql, 202611100004_camera_outbox_REVIEW.sql and 202611100005_camera_captures_REVIEW.sql as additive changes. Verify SHA-256, then request separate execution approval. Run as postgres/BYPASSRLS; run supabase/verify_sprint3_REST_READ_ONLY.sql afterward. Stop on any grant/ownership/RLS mismatch.
2. Inspect actual Supabase Storage bucket metadata/policies. Choose a dedicated PRIVATE bucket; enforce JPEG-only and 131072-byte object limit. Confirm no existing permissive browser Storage policy exposes it. No bucket is created by these migrations. Approve bucket/policy setup separately.
3. Approve exact registry rows for controller/cam01/cam02, their real incubator UUID and independent key IDs. Provision TELEMETRY_DEVICE_KEYS and CAMERA_EVENT_KEYS as Worker secrets through approved secure means. Keep SUPABASE_BACKEND_KEY server-only. Never paste keys into chat/source.
4. Set CAMERA_CAPTURE_BUCKET to the reviewed private bucket ID; CAMERA_CAPTURE_STORAGE_REVIEWED remains false until live policy review passes. Keep TELEMETRY_ENABLED, CAMERA_EVENTS_ENABLED, CAMERA_CAPTURES_ENABLED, NATIVE_PUSH_DELIVERY_ENABLED false during initial deployment.
5. Record current Worker/Hosting rollback versions, then separately approve deployment of cloudflare-worker/wrangler.jsonc (existing hatchai Worker) and the 46-file myhatchai Hosting package. Preserve existing approved test-notification production settings explicitly; checked-in defaults are false.
6. Controller dedicated NVS hatchai-sync: enabled bool, exact controller device string, key-id string, 32 raw key bytes. Camera hatchai-cloud: enabled u8=1, exact role-matching device string, key-id string, 32 raw key bytes. Provisioning needs its own review/approval. Camera CMake HATCHAI_CAMERA_POSITION upper/lower must match each provisioned identity. Optional router NVS hatchai-wifi: ssid/password/controller-url; no plaintext credential logs.
7. Review the two complete camera images built in this verification and match each to its physical board. Separately approve supervised controller firmware/SPIFFS and camera uploads with existing configuration-preservation safeguards. Do not change partitions/eFuses.
8. Bench-test before enabling ingestion: invalid credentials/UTC/TLS, AP+STA/router reconnection, offline queue/full/restart, NVS interrupted commits, duplicate/lost ACK, SD logging, watchdog and incubation timing, independent cameras, capture failures, ownership denial, private object access, long Retry-After, cleanup, and real image decoding.
9. Enable telemetry first after approval and verify actual fresh readings with the authorized account. Enable camera events/captures only after role and private Storage review. Keep /chick-detected disabled. Enable native delivery only after separately approved real-device receipt/background/click tests.
10. Rollback by disabling new gates first, reverting Worker/Hosting versions, and retaining additive records. Do not drop tables or replace whole NVS/flash as routine rollback.

## Files for this resumed phase

- Corrected: supabase/migrations/202611100005_camera_captures_REVIEW.sql (idempotent completion); cloudflare-worker/test/camera-captures.test.js; esp32-devcam/camera/main/camera_cloud.cpp (startup gate, key erasure, retry/conflict handling); data/js/cameraView.js and test/camera-view-browser.cjs (preserved independent status and JPEG decoding).
- Added: cloudflare-worker/test/runtime-camera-captures.mjs and cloudflare-worker/test/camera-capture-failures.test.js; package.json adds this isolated runtime check.
- Existing interrupted work preserved: camera-captures.js, public/camera-api.js, compact protocol signer, camera_cloud.cpp/.hpp, camera_event_record.hpp, CloudSyncRecovery.h, shared camera view, camera migration and all other uncommitted files.
- This report supersedes older Sprint 3 size/test counts. Cleanup is documented separately in CAMERA_BUILD_CLEANUP.md. No further generated camera build cleanup was performed during this resumption; current paths were preserved.

Additional resumed changes: camera cloud retry now honors 503 Retry-After and pauses on 409 conflict instead of replaying a conflicting event indefinitely. Two failure tests added for stalled-upload cancellation and public-bucket denial. Full isolated camera build is running separately; final result follows below.

Capture migration SHA-256: 31CC8AB5067DBC069041CDF33A3C73AC286EFF489E4B31B1202AA9029CF0C4EB

Startup refinement: camera cloud submit remains disabled until all persistent event slots pass validation; JPEG ownership cannot be transferred during failed initialization. Camera key bytes are erased when the cloud task enters its terminal failure drain. Latest-capture labels preserve the independent connected/offline status.

## Existing camera build files preserved on resumption

The following tracked generated paths were already modified at this resumption and are left unchanged by the isolated build; no claim is made that their pre-existing content is disposable.

- esp32-devcam/camera/build/.ninja_log
- esp32-devcam/camera/build/CMakeFiles/CMakeConfigureLog.yaml
- esp32-devcam/camera/build/bootloader/.ninja_log
- esp32-devcam/camera/build/bootloader/gdbinit/symbols
- esp32-devcam/camera/build/gdbinit/symbols

Networking prerequisite: the camera default station network is the controller AP, which does not itself provide Internet/NAT. For direct camera-to-Worker HTTPS, configure each camera for an Internet-connected router using its approved hatchai-wifi NVS record, and use the controller router-side private IP for local heartbeats. This requires separate provisioning approval; the code does not pretend the AP supplies Internet.

SDK integration correction: IDF 5.4.4 esp_tls_low_level_conn initializes rset/wset once, then select() clears them on timeout. The camera adapter now restores those sets only in ESP_TLS_CONNECTING, matching the controller workaround. This uses a private SDK structure with an exact ESP-IDF 5.4.4 compile-time guard; an SDK change intentionally requires review. CMake retains compact-style warnings for the shared legacy parser/signer instead of treating this existing formatting as a build error. Runtime validation, TLS verification and timeouts are unchanged.

Durable record hardening: CEV2 records include camera placement identity and reject a queue from the other camera role. Previous local-only CEV1 records fail closed, rather than being silently reassigned. Reassigning an existing camera to another incubator still requires an administrative review of pending events.

Additional implementation limits: a camera JPEG over 128 KiB is rejected by submit, and no cloud event is queued from that frame. A full four-slot event outbox/two-item handoff queue can drop subsequent events. Neither loss policy is presented as guaranteed delivery. Measure real VGA JPEG sizes and event pressure before enabling production; essential local detection remains independent.

## Final complete camera build record

Both Upper and Lower images built successfully from ESP-IDF 5.4.4 in the separate test/.build/camera-sprint3 directory. No original camera build inputs or images were overwritten. Both images fit the 4,194,304-byte application partition. Each is 1331664 bytes, leaving 2862640 bytes free. Existing model/camera-config initializer warnings remain; a debugger-only ROM ELF environment warning occurred during initial generation, not firmware image validation. No physical board test is implied.

- upper: test\.build\camera-images\upper.bin / SHA-256 56C61CC5719B99A22E6B9ED8267CD05FE914A9DC9AE1EFA38AB7512DD643C4AA
- lower: test\.build\camera-images\lower.bin / SHA-256 1F4B17AA3942FC982C21B32D02B1E078DCBE770828368D20A6788ACC6A206502

Camera source changes for this resumed verification: camera_cloud.cpp, camera_event_record.hpp, camera/main/CMakeLists.txt; compile helper expanded to all shared parser/transport sources. The CMake adjustment is limited to the camera target and pins the reviewed private TLS compatibility shim to IDF 5.4.4.

Final SPIFFS image: 1441792 bytes / SHA-256 B9B84BAB86AC97461613E5D19551A4373440D3A376E6B34EF663C51835C4CD0C. It was rebuilt after the final shared camera UI change.
