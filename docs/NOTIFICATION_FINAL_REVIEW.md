# HATCHAI notification integration: final local review

Review date: 2026-11-08 (Asia/Manila). Local implementation and software verification
only. No board was flashed, no production credential was read/generated/provisioned,
no cloud configuration or database was changed, and no actuator was operated.

## Review outcome

The controller, local dashboard and phone enrollment sources are integrated.
Production readiness remains conditional on the commissioning and physical checks
below. A compiled firmware image is not evidence of on-device TLS, timing, memory
or Android enrollment success. Chick-detection delivery remains disabled.

Targeted corrections made during the final review:

1. The installed Arduino/ESP-IDF configuration defines MBEDTLS_HAVE_TIME but not
   MBEDTLS_HAVE_TIME_DATE. The prebuilt TLS library therefore cannot be assumed
   to reject expired/not-yet-valid certificates. After authenticated TLS handshake,
   the transport now explicitly checks UTC validity windows of the retained leaf
   and presented intermediate certificates before writing the signed HTTP body.
   Missing certificates, invalid dates, reversed windows, out-of-window UTC and
   more than eight presented certificates fail closed. A compile guard requires
   retained peer certificates. Native tests cover UTC conversion, Gregorian leap
   rules, invalid calendar fields and exact notBefore/notAfter boundaries.
2. Pending cancellation suppresses the physical-display snapshot both when it is
   published and when the main loop consumes it. A task publishing an old visible
   state cannot restore the LCD code after cancellation was requested.
3. Browser requests reject redirects. Malformed successful HTTP responses produce
   a fixed sanitized message instead of exposing JSON parser response snippets.

## Sources inspected

Firmware integration: src/main.cpp, src/HatchWebServer.cpp,
include/HatchWebServer.h, src/LcdStatusDisplay.cpp, include/LcdStatusDisplay.h,
include/NotificationPairingClient.h, include/NotificationHttpsTransport.h,
src/NotificationHttpsTransport.cpp, include/NotificationRuntime.h,
src/NotificationRuntime.cpp and include/NotificationIntegrationPolicy.h.
The earlier protocol, credential codec, UTC, streaming parser, ownership,
coordinator and retry modules were also reviewed as dependencies.

Web integration: data/dashboard.html, data/js/authSession.js,
data/js/notificationPairing.js, public/index.html, public/push.js and
public/pairing-client.js. Firebase configuration, VAPID settings and service worker
remain unchanged. Worker endpoint/security/migration sources were read, not edited.

Verification: test/notification-pairing/native.cpp, phone-worker.mjs,
browser-integration.cjs and the existing fixtures in test/ui-regression.cjs,
test/recovery-ui.cjs and test/camera-push.cjs. The pre-existing .env work was not
read or modified. Earlier-step untracked modules are not newly recreated work.

## TLS, deadlines and task ownership

- Only the fixed Worker hostname on port 443 is used. The request path is bound
  to an allowed pairing operation and signed exactly as the existing Worker expects.
- Asynchronous lwIP DNS is scheduled with tcpip_try_callback; persistent callback
  storage and generation checks reject late callbacks. DNS has a two-second limit.
- ESP-TLS receives a numeric resolved address, while common_name remains the
  original Worker hostname, preserving SNI and hostname validation.
- The installed ESP-IDF CA bundle is attached; skip_common_name is false, no
  insecure/plaintext fallback exists, and successful TLS must have zero verification
  flags plus the explicit certificate-date checks above.
- Nonblocking TCP/TLS progresses in the background. TCP connection is limited to
  two seconds, combined connect/handshake phase to six seconds, and transport work
  to 11.5 seconds from dispatch. The coordinator independently enforces twelve
  seconds from enqueue, including queue wait. Progress does not extend deadlines.
- Connection: close is requested. A fully framed response is not published until
  EOF; late extra bytes and premature EOF are rejected by the existing streaming
  parser. Peer refusal to close ends in a bounded timeout, not false success.
- One core-0, priority-1 task owns the client, UTC gate, coordinator and TLS client.
  It has a 16,384-byte stack and yields between iterations. It neither registers
  itself with nor feeds/reconfigures the incubation watchdog.
- The main loop exchanges only a bounded RAM display snapshot. Cloud DNS, TLS,
  signatures, JSON parsing and Preferences reads execute in the background task.
  Dedicated short mailbox/snapshot locks are released before network operations.

These are source/build findings. Heap allocator contention, critical-section
duration, shared core-0 SD/Wi-Fi scheduling, TLS CPU cost and actual control-loop
jitter require physical measurement. The existing synchronous local HTTP server
also remains part of the original control loop; this review does not certify all
legacy HTTP handling as nonblocking.

## Credentials, authentication and privacy

Read-only Preferences namespace: hatchai-pair. Commissioning contract:

| Key | Required stored value/type |
| --- | --- |
| active | U8, exactly 0 or 1 |
| enabled | U8, exactly 1; missing/other values disable enrollment |
| generation | U32, nonzero and matching the selected record |
| slot0 or slot1 | Blob produced by the existing versioned credential codec, at most 160 bytes |

The selected record must contain hatchai-inc01-controller, a valid versioned key
ID matching the Worker registry, and exactly 32 raw HMAC key bytes. No inactive
slot is searched as fallback. Reads occur once in the task; changed provisioning
requires a separately approved restart. Missing/corrupt credentials leave pairing
Unavailable and do not gate incubation. No credential export or write route exists.

CRC detects corruption only. Preferences is not evidence of encrypted storage.
Secure Boot, encrypted NVS/flash, debug access and physical extraction resistance
have not been commissioned or verified. No eFuses were changed. Decide the approved
physical-access threat model before putting production keys on a board.

POST /api/notifications/start, /status and /cancel require the current server-side
session and bounded matching X-HatchAI-Session header. Cross-origin requests are
rejected, query/body arguments are not accepted and responses are no-store. A local
HTTP bearer/session can be observed on an untrusted LAN; it is not cloud identity.
Cloud authorization still requires the device HMAC and possession of the LCD code.

No reviewed notification source embeds or logs production keys. Codes never enter
dashboard responses, URL parameters, browser JavaScript from the controller, serial
or SD logs. Row 4 displays PIN plus 16 code characters only when no existing safety
warning occupies that row. Cancellation, expiry and stale background snapshots
clear the display bridge; physical clearing follows the existing LCD refresh.

## Phone/Worker compatibility

The HTTPS phone page uses non-extractable P-256 private keys persisted in IndexedDB.
The raw private key is not exported. Recursive canonicalization and the signed
method/path tuple match the unchanged Worker. Browser requests use these endpoints:

- /pairing/redeem: signed LCD code + public key; permission is not requested before
  enrollment authorization succeeds.
- /register: signed browser-key-bound grant + FCM token. Success appears only after
  the Worker confirms its transactional D1 registration.
- /registration/challenge and /registration/refresh: signed nonce/version management
  and lost-response reconciliation using the same private key and pairing ID.
- /unregister: signed per-browser revocation; local token cleanup follows server
  confirmation. Lost-key takeover is not implemented.

Each phone has independent ownership. One phone cannot overwrite another's token.
The hard 90-day authorization is not extended by refresh. No Firebase user accounts
were added. No shared ESP32 password is sent to Hosting. A phone using only the
controller AP may need mobile data or router Wi-Fi to reach the HTTPS page.

## Resources and flash

Final local verification:

| Check | Result |
| --- | --- |
| Native notification checks | 113 passed, 0 failed |
| Cross-language vectors | 25 passed |
| Worker automated tests | 53 passed |
| Actual phone signing client + Worker/SQLite | 31 checks passed |
| Isolated notification Chrome checks | 27 passed |
| Existing dashboard / recovery Chrome checks | 152 / 50 passed |
| Existing camera and legacy cloud mocks | Passed |
| Control/safety compile checks | 12 translation units passed |
| Recovery fault model | 5,707 checks passed |
| Local workerd/D1 | Smoke plus 11 hardening scenarios passed; 220 requests in this run |
| Firmware / SPIFFS builds | Both passed |

Rate-limit-exhaustion request counts vary by runtime bucket behavior; the current
run's observed count is recorded instead of reusing the earlier 320-request result.

Linked static RAM: 85,860 / 327,680 bytes (26.2%). Linked flash: 1,299,033 /
1,310,720 bytes (99.1%). The packaged firmware.bin is 1,305,616 bytes: it fits the
existing app slot with only 5,104 bytes remaining after image overhead. This is
tighter than the linker's 11,687-byte unused section budget. SPIFFS image size is
1,441,792 bytes, matching its existing partition. No partition resizing was done.

Final artifact SHA-256 values:

- firmware.bin: `235AC9C3887CA3026C146F6228353DECB948EC148645E15F8B7E4B814A940A2B`
- spiffs.bin: `4019F36FC70A784A965349415DDE0D42C8853634FAB2A24DDC98003DE5A2B064`

The original app/SPIFFS/NVS partition layout and platformio.ini are preserved.
The firmware fits, with very little application flash headroom; see the final
build figures in the completion report. No certificate checks or safety/control
features were removed to recover space. No optional size optimization was applied.

If more headroom becomes necessary, first compare an isolated LTO/link-map-guided
build and rerun the full checks. A smaller maintained CA bundle requires verifying
the actual issuer chain and renewal plan; do not blindly prune roots. Partition
changes can relocate existing data and are not a safe automatic size fix.

Runtime memory beyond linked static RAM includes the 16-KiB task stack, queues,
strings and TLS allocations. TLS planning allowance remains approximately 60–100
KiB, not a measured result. Admission requires at least 100 KiB free internal heap
and a 48-KiB largest internal block before a new connection. The authenticated
status reports minimumInternalHeap, largestInternalBlock, networkStackRemaining
and a sanitized transportOutcome enum for bench observations. No physical values
have been collected. Never infer free runtime heap from the static RAM percentage.

## Exact commissioning and physical test checklist

All deployment, provisioning, flashing and hardware steps below require separate
approval. None have been performed by this review.

1. Record the current deployed Worker version and verify its actual D1 binding,
   additive migrations, required native rate-limit bindings and secret names.
   Confirm the reviewed pairing backend is deployed; local tests do not establish
   that. Preserve push_tokens records. Keep /chick-detected returning disabled.
2. Approve the device-key/storage threat model and commissioning process. Configure
   a unique controller key in Worker secret storage and the matching selected
   credential record/metadata in the dedicated NVS namespace. Do not display key
   values or use the shared dashboard password as a device key. Do not alter fuses
   or security settings as part of an ordinary firmware upload.
3. Separately approve publishing only the reviewed Hosting sources. Preserve the
   Firebase project/configuration, VAPID key, service worker and Worker endpoints.
4. Prepare a supervised bench with heating/motor loads disconnected or otherwise
   safely isolated. Record firmware/partition backup and existing device settings.
   Separately approve firmware and SPIFFS uploads. Confirm existing NVS, recovery
   records, batches and SD data survive; do not erase/format storage.
5. First boot without enrollment credentials/internet: verify local monitoring,
   watchdog completion, sensor-fault handling, offline dashboard and SD behavior
   remain operational. Pairing must stay unavailable, with no code or false success.
6. Connect controller STA to an internet router while retaining its AP. Verify
   SNTP-derived system UTC readiness; the RTC's UTC+8 wall-clock value must not be
   used as signing/TLS UTC. Invalid/stale/jumped time must stop cloud enrollment.
7. Verify unauthorized/missing/wrong/expired dashboard session requests cannot
   start, inspect or cancel pairing. Verify successful login offers Enable
   Notifications and Not Now, dismissal works, and the HTTPS handoff contains no
   token, password, key, grant or pairing code in its URL.
8. Start pairing once. Check row 4 shows PIN plus exactly 16 characters and browser
   responses contain no code. Exercise warning priority through a safe bench fault
   simulation, never by deliberately overheating the incubator. A warning must hide
   the code. Cancel and wait for expiry; neither late responses nor warning recovery
   may restore a cancelled/expired code. Check duplicate starts remain single-flight.
9. On Android Chrome with internet, enter the physical code, verify it, then tap
   Enable Notifications. Test permission denial first: no registration success.
   With permission granted, success must follow Worker/D1 confirmation. Confirm one
   new row and matching ownership authorization without printing the FCM token.
10. Repeat with a second phone using a new LCD code. Both registrations must remain
    present. Reload each page to verify IndexedDB ownership, refresh its token, and
    disable one phone. Only that phone's cloud registration may be disabled.
11. Test wrong, expired, cancelled and reused codes; request/response loss; DNS
    failure; Wi-Fi loss; absent internet; refused connections; invalid hostname/CA;
    expired/not-yet-valid certificates; and rate limits in a controlled test setup.
    Fail closed without insecure TLS fallback, repeated sessions or controller
    reboot. Do not substitute production secret rotation to simulate failures.
12. During successful and failing handshakes, record heap minimum/largest block,
    task stack margin, watchdog/reset reason, control-loop latency, PID/relay-window
    timing, sensor cadence and SD queue/checkpoint behavior against an offline
    baseline. Stop if stack/heap margins erode, deadlines are missed or resets occur.
    Repeated pairing/cancellation cycles must not leak memory. Only after passing
    the bench review should supervised actuator/load testing be separately approved.

Passing this checklist demonstrates enrollment, not chick-alert delivery. Camera
authentication, event ingestion, FCM broadcasting and observed Android alerts need
their separate approval while /chick-detected remains disabled.
