# Offline-first MobileNet camera integration — local implementation

This is a development candidate. Nothing was flashed, deployed, enrolled, or applied to production. Existing production credentials, feature gates, HMAC fallback, actuator logic, controller partitions, and camera partitions are unchanged.

## Model contract

The user confirmed 160×160×3 RGB, direct resize, no center crop, embedded normalization, int8 input/output, one sigmoid output, and chick threshold 0.50. Input quantization is scale 1 / zero point -128, so RGB bytes are converted to int8 by subtracting 128, with no extra normalization. Output probability is `(raw + 128) / 256`.

Model: `esp32-devcam/model/mobilenetv2_full_int8.tflite`, 2,731,136 bytes, SHA-256 `4566b60fb3b81b1a15536a287ca5743e9696a2e1925b3d8db2abc66ad3ce697d`.

The flatbuffer has one subgraph and seven operator types: MUL, ADD, CONV_2D, DEPTHWISE_CONV_2D, MEAN, FULLY_CONNECTED, LOGISTIC. `tools/inspect-camera-model.py --execute` verifies metadata and executes synthetic vectors on the CPU. CPU execution is not evidence of target TFLM compatibility or classification accuracy. The firmware verifies exact tensor types, shapes, scales, and zero points at initialization.

**Accuracy limitation:** black, gray, white, and synthetic noise scored approximately 0.89–0.96 chick probability in CPU testing. Labels and the user's threshold have not been inverted or changed. Uniform frames are rejected as unusable and confirmation requires three valid positive frames, but these guards do not establish an acceptable false-positive rate. Labeled real camera images and supervised validation are required before notifications are enabled.

## Local path

Both boards use the same firmware. Station MAC `d885accba598` is Upper (`hatchai-inc01-cam01`); `d885acca0c00` is Lower (`hatchai-inc01-cam02`). Placement and board MAC are persisted and checked in NVS. An unknown board can run inference but cannot submit an assigned camera event. There is no camera credential-entry flow and no backend credential in the new camera target. Existing controller AP settings are reused.

Camera capture, inference, local HTTP preview, and controller link are separate tasks. Direct numeric gateway requests use `http://<controller AP gateway>:8081/events`; no DNS, NTP, Cloudflare, Firebase, or Supabase is required by the camera path. Automatic Wi-Fi reconnect and bounded HTTP retries run independently of inference. The accepted local MAC-impersonation risk remains: a client on the controller AP can impersonate a camera.

Three valid positive frames latch one episode; five valid negatives rearm it. Detector errors never rearm an episode. The latch and UUID episode record are persisted before forwarding. Reboot while a chick remains present does not deliberately generate another alert. The camera has a 16-event queue and two CRC-protected NVS snapshots. Pending events are never overwritten to make room. Full/failing storage reports unavailable and applies backpressure; detection continues. NVS is never automatically erased.

The controller AP-only receiver uses a separate low-priority task, bounded headers/body, known MAC mapping, validated events, and two read-back-verified persistent snapshots before ACK. Its queue holds 16 records and evicts only cloud-acknowledged entries. Quarantined entries remain retained. CRC/generation recovery chooses a valid snapshot; both-corrupt storage fails closed. Application-level tests cover corruption and lost-ACK recovery; physical power-cut atomicity still requires hardware testing.

The thermal loop observes cached RTC time and submits status without handling camera sockets or writing event NVS. Heater, fan, motor, sensor, RTC, prediction, and scheduling implementations are not modified by this integration. Flash operations can still briefly stall ESP32 execution; actual scheduling jitter needs measurement on hardware.

## Online path

The controller uses its existing API key (`controller-sync-v1`) and verified TLS transport for `/device/controller-camera-events`. This route requires HTTPS, enabled camera/API-key gates, rate limits, a registered controller API key, a current request time, and a unique nonce. The camera event ID and payload remain stable across retries; request nonces change. The Worker validates placement, confidence, confirmation, and timestamp contracts. Atomic SQL rechecks controller key revocation and registry ownership before storing an event.

`supabase/migrations/202611110002_controller_camera_relay_REVIEW.sql` is review-only. It adds relay metadata, owner-scoped reads, durable dedup receipts, and notification enqueueing using the existing subscription/outbox infrastructure. It preserves original valid detection times even for long offline delays. If no valid time survived the outage, detection time remains null and dashboards say “Time unavailable”; upload time is not misrepresented as detection time.

Durable receipts outlive the existing 30-day camera history cleanup so a late retry cannot recreate a notification. These small receipts intentionally grow with accepted episodes; a future retention policy must coordinate device acknowledgement horizons before pruning them. Outbox uniqueness fences repeated uploads. Existing unknown-provider-outcome handling prevents blind retries after an ambiguous push send. This gives deduplicated enqueueing and conservative provider handling, not a promise of exactly-once delivery by Android/browser push providers. Disabling/revoking the controller cancels unclaimed relayed jobs; subscription ownership, enabled camera, and owner checks remain required.

API-key failures pause relay without deleting pending events; network/server/rate-limit failures use bounded retry recovery. Cloud telemetry backoff does not suppress camera relay retries. Existing HMAC telemetry and legacy keyed camera paths are preserved. Public unsigned telemetry remains rejected.

Shared camera dashboards retain event records alongside image captures and show unknown-time records. Events are metadata, not fabricated snapshot images. Existing local preview/snapshot APIs remain; the new controller relay sends event metadata, not JPEGs. Online controls remain read-only.

## Reproducible local checks

- `node test/camera-offline.cjs` with `HATCHAI_ZIG` pointing to the isolated Zig 0.13.0 executable.
- `node --test --test-concurrency=2 cloudflare-worker/test/*.test.js`.
- `node test/camera-view-browser.cjs` and `node test/shared-dashboard-browser.cjs` with `HATCH_PLAYWRIGHT_MODULE` pointing to local Playwright Core.
- PlatformIO: `pio run -e esp32dev`, `pio run -e esp32dev -t buildfs`; no upload command.
- Camera: `python tools/build-camera.py` after installing ESP-IDF 5.4.4 tools into ignored `dist/camera-tools`. The wrapper exports tool environment variables directly and copies the existing sdkconfig into the ignored build workspace. It does not alter Windows execution policy or flash a device. FOMO source files remain available; the new target excludes the FOMO component.

## Hardware evaluation still required

Record both devices' real PSRAM capacity, successful tensor allocation, reported arena usage, free PSRAM, inference latency, temperature of the camera electronics, and uninterrupted repeated capture. Boot logs report allocated arena usage; live classifier status reports pure Invoke duration and free PSRAM. The existing `inferenceMs` preview field includes JPEG decoding, preprocessing, inference, and durable episode handling, so it is a pipeline measurement. The arena currently reserves 4 MiB in PSRAM; this is a budget, not a measured requirement. Check the exact physical board/pin/PSRAM settings against the retained camera project before flashing.

Using a supervised test setup, validate both MAC placements, disconnected internet and external DNS, controller AP reconnect, event queue saturation, camera/controller restarts during NVS commits and HTTP ACK loss, RTC unavailable/time restoration, delayed cloud uploads, revocation, and one notification per episode. Measure controller loop jitter and thermal safety with loads disconnected before any supervised heater test. Production activation and hardware flashing are separate actions requiring explicit authorization under the project debugging skill.

## Supplied dataset evaluation

The supplied `split_dataset_with_labels.zip` has archive SHA-256 `f7c97530046891fa098ff270d8a985accc120ac0413dc16b7d474bc83a1fe000`. Its supplied test split contains 144 images: 121 have class-0 YOLO boxes, 23 have empty labels. For this binary presence evaluation, at least one class-0 annotation is interpreted as chick; an empty annotation is interpreted as no chick. This object annotation ID is separate from classifier output class 1. Two representative images were visually checked against that interpretation. Training images were not included in the accuracy metric.

With the user's unchanged threshold 0.50 and matching direct RGB resize/INT8 preprocessing: TP=119, TN=21, FP=2, FN=2; accuracy 97.22%, precision/recall 98.35%, specificity 91.30%, false-positive rate among negatives 8.70%. See ignored `dist/camera-tools/dataset-report.json` for all image scores and `tools/evaluate-camera-dataset.py` for reproducible evaluation. The test split's independence from model training is unverified; adjacent video frames and augmentations may be correlated. These are single-image CPU measurements, not event-level notification accuracy or target inference latency. Temporal confirmation is tested as state logic; its real false-alert rate needs continuous representative video. No threshold, class mapping, or model weights were changed to improve these metrics.

Exact SHA-256 image comparison found zero identical image files across the supplied train/test splits; this does not rule out related video frames or augmented duplicates. The two false positives are measured against empty annotation files; manual annotation review remains useful before treating them as definitive biological ground truth.

Startup journal snapshots and readback buffers use checked temporary heap allocations, preserving the existing 3,584-byte camera main-task stack setting. The main component emits compiler `.su` stack reports in the ignored build directory. Allocation failure leaves storage unavailable without erasing existing data.

## Final build evidence

Both targets built locally. No hardware upload or production activation was performed.

| Target | Linked flash bytes | Binary bytes | App partition bytes | Binary headroom bytes |
|---|---:|---:|---:|---:|
| camera | 3,980,128 | 3,980,272 | 4,194,304 | 214,032 |
| controller | 1,267,793 | 1,274,368 | 1,310,720 | 36,352 |

The controller therefore remains below the earlier 100 KB headroom target. Its largest linked symbols include status JSON generation, formatted-print routines, and TLS handshakes; security features were retained. The camera model itself occupies 2,731,136 bytes. The camera map reports 930,178 bytes flash code and 2,911,596 bytes flash rodata; the full loadable image also includes initialized RAM/IRAM sections. Runtime task stacks, heap, and PSRAM allocation are additional budgets, not measured by static flash size.

Compiler frame reports: camera startup `app_main` 160 bytes, journal `begin` 112 bytes, journal `commit` 64 bytes, `observe` 1,376 bytes, link task 1,392 bytes, model initialization 256 bytes. These are individual function frames, not complete call-chain or runtime high-water measurements. Controller disassembly shows the event receiver frame at 5,824 bytes and journal commit at 1,248 bytes within its 10,240-byte task allocation; deeper library frames still require runtime high-water validation.

Final hashes:
- camera: `c5d79bafb478480e2a1f9d2689eec8519b0f3a2562cb8247ccce5f0ada2caba3`
- controller: `123d14a9023d2be8efa8565202b9b6763d549fa84d285a9688f9601e4be1b589`

Checks passed: controller firmware and SPIFFS build; shared camera ESP-IDF build and partition check; portable queue/CRC/episode/clock-wrap/INT8 tests; 161 Worker tests, followed by targeted tests after migration drift/ownership hardening; 15 camera browser checks, 61 shared-dashboard browser checks, and 13 camera/telemetry API unit tests. Generated shared assets were refreshed locally. Existing aggregate zero-initializer warnings remain in the camera configuration; no compiler warnings were suppressed.

The build wrapper uses the isolated SDK Python environment explicitly, even when launched by the laptop's default Python 3.13. CPU dataset evaluation requires the isolated inference modules in `PYTHONPATH`:

```powershell
$env:PYTHONPATH="$PWD\dist\camera-tools\inference-python;$PWD\dist\camera-tools\python"
& 'C:\Program Files\Python313\python.exe' tools/evaluate-camera-dataset.py 'C:\Users\Hello\Downloads\split_dataset_with_labels.zip' --positive-object-class 0
```

Camera clock freshness uses 64-bit monotonic uptime. A persisted 32-bit capture age that cannot be established after restart or counter wrap is reported unknown rather than inferred incorrectly. Retry deadlines are refreshed while disconnected so a first connection after a long outage can drain the queue.

Largest linked camera archives by flash bytes: `libmain.a` 2,755,572, `libnet80211.a` 137,066, `libesp_timer.a` 106,617, `liblwip.a` 103,622, `libespressif__esp-tflite-micro.a` 88,698, `libmbedcrypto.a` 81,106, `libespressif__esp32-camera.a` 75,334. These totals include referenced code/data; the main archive includes the embedded model.

MobileNetV2 is a whole-image presence classifier. Episode deduplication is per camera; it does not count individual chicks or merge upper/lower sightings into physical chick identities.

All six `npm.cmd --prefix cloudflare-worker run test:runtime` harnesses passed after the final code changes: workerd/D1 pairing and ownership, hardening/races/retention, online authenticated reads, independent native-push decryption/signature verification, telemetry REST, and private camera captures. All upstreams were isolated; no production provider or database was contacted. Windows execution policy was retained; npm.cmd and explicit SDK executables were used.

Hardware execution was not attempted. The [HatchAI debugging skill](../.codex/skills/debugging-and-code-review/SKILL.md) states: ?Never energize real outputs, change relay polarity, upload firmware, or alter live setpoints without explicit authorization and a safe test setup.? Target inference, PSRAM/task-stack high-water, power interruption recovery and live Android delivery require that supervised next stage.

## 2026-11-12 preview freshness correction

User screenshots show successful on-device invocation: chick probability 0.727, Invoke durations 2,150?2,833 ms, and approximately 3.1 MB free PSRAM. These are device-reported screenshot observations, not a controlled benchmark or verification of both board identities.

The preview handler discarded classifications once the source frame was 2,000 ms old. Since invocation alone exceeded that limit, a positive completed classification was immediately omitted from X-Detections and the page said ?Waiting for fresh detection.? Both firmware and UI now use the existing 30-second link freshness window. Source-frame age remains visible; event confirmation, persistent episodes, authentication and control logic are unchanged. Embedded JavaScript syntax checks and the ESP-IDF rebuild/partition check passed. No device was flashed by the agent.

Updated camera binary: 3,980,272 bytes; 214,032 bytes headroom; SHA-256 `d744cd9a3db6047e148ab3b9bd75f7397e4a2db934dfb2120611cd409b8c5020`. This supersedes the earlier camera artifact hash above.
