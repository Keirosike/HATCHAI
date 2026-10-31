# Roller controls, batch cards and LCD

## Direct roller ON / Run

The HTTP /api/turn start action is always a timed manual request. It no longer depends on a browser sending manual=true or on the automatic climate mode. Older requests without that field previously selected the SD-dependent automatic path. The browser still sends the field for compatibility.

Direct runs use the durable ESP32 motor journal rather than requiring an SD recovery checkpoint. Automatic scheduled turns retain their verified-SD requirements. Temperature/sensor qualification, internal flash/watchdog health, position uncertainty and assigned-batch status/clock/turning-end checks still apply.

Rejected manual runs now report the specific reason (for example, three stable DHT22 readings are needed, RTC unavailable, batch completed, turning end reached, or physical roller position needs inspection). The old generic error always mentioning SD recovery is removed. During an SD scheduling hold, Control identifies when a timed manual run remains available. Timed manual runs/queues are also labeled correctly while automatic heating is ON.

This source change cannot determine which physical hold occurred on the user's board without its live status. An actual interrupted movement still requires physical inspection and position verification in Settings > Component status. No movement feedback sensor is installed.

## Incubator batch slots

Click an occupied card (or focus it and press Enter/Space) to open its saved details. Edit and Delete are available near the top of that modal. Edit enables the record fields and keeps the existing Save confirmation. The old card View button is removed.

Each running card has Done. Its confirmation explains that the batch becomes Completed and its assigned turning stops, while history remains. Cancellation sends no update. Completion and deletion require the device's acknowledgment before removing an active local record/slot; rejected requests leave the record intact. A completion acknowledgment confirms the controller accepted the change, not that an SD commit has finished.

Escape dismisses only the top confirmation. The underlying record stays open after cancelling Delete. The batch dialog focuses its controls and keeps Tab inside it while open.

## 20x4 LCD

Normal display:

```text
T:37.5C RH:55%
Upper: FLOCK-A
Lower: FLOCK-B
Est U:2026-10-31
```

Line 1 contains temperature and humidity. Line 2 always identifies the upper roller's batch and line 3 the lower roller's batch. Long labels are clipped to the physical 20-column width; stored labels are unchanged.

With two different active/paused assignments, line 4 alternates every six seconds between Est U and Est L, calculating each estimate using that batch's original start timestamp and the RTC. With only one batch, including one batch shared by Both rollers, it shows just one Est date. Empty rollers say No batch. Completed/Failed assignments are excluded from estimates. Missing valid sensor/RTC/recovery data produces unavailable rather than an invented date.

Existing alarm/hold messages take priority on line 4 until cleared. No model or relay pin/polarity changes are made.

## Main changed paths

- src/HatchWebServer.cpp; include/IncubatorController.h; src/IncubatorController.cpp
- include/BatchDisplay.h; include/LcdStatusDisplay.h; src/LcdStatusDisplay.cpp
- data/batch.html; data/js/batch.js; data/css/batch.css
- data/control.html; data/js/control.js; data/js/modal.js
- test/ui-regression.cjs; test/batch_display_compile_test.cpp

Firmware and SPIFFS must both be uploaded to install this update. No upload or physical relay/LCD/card test was performed during development. The deployment ZIP contains source and dashboard inputs, not a claim of hardware verification.

## Verification results

- ESP32 esp32dev firmware build passed: 66,824 bytes static RAM (20.4%), 1,048,513 bytes flash (80.0%).
- SPIFFS image build and JavaScript syntax checks passed.
- Six C++14 compiler-evaluated sources passed, including single/two/shared LCD estimate selection and the existing control/calendar/turn/recovery/session predicates.
- Node API/payload checks passed. General browser suite: 151 checks; component/recovery browser suite: 41 checks. All ESP32 endpoints were mocked. The suites test behavior and selected viewport bounds; they do not execute the full HTTP/GPIO stack on an ESP32.
- Raw assets: 372,893 bytes total; 144,350 bytes JavaScript; 46,616 bytes CSS; largest HTML 17,212 bytes. No image exceeds 40,000 bytes. JavaScript exceeds the advisory 80 KiB budget and total assets exceed 350 KiB; the SPIFFS image still packages successfully. No frontend dependency was added.

Current clean source package: release/HatchAI-save-settings-deployment.zip. Packaging excludes tests, tooling and old exports, and verifies a SHA-256 source manifest. No upload or real relay actuation was performed.

## Control Save Settings and power return

Control already used the shared confirmation modal. Its review now explicitly shows the saved Automatic/Manual mode, targets, both roller timings and power-return behavior. Cancel sends no settings request. Confirm saves the reviewed target/timing snapshot; a changed roller binding or operating mode requires a new review. The success text distinguishes a verified internal-memory save from an SD checkpoint that is merely queued.

Mode switches are saved immediately by the firmware to the NVS profile. The mode is restored in begin() and reconciled against the mode-known flag during SD restoreSnapshot(). Targets, calibration and roller timing also persist. This behavior was inspected in src/IncubatorController.cpp, src/ControllerRecovery.cpp and include/DeviceProfile.h; no firmware change was needed for this modal update.

After a restart, Automatic heating waits for stable valid sensor readings. Automatic turning also requires valid RTC/batch dates, verified recovery and the resume delay. Manual mode remains Manual, with the bulb OFF; old manual ON commands are not replayed. Critical alarms and interrupted motor positions remain protected. A valid DS3231 supplies time offline; if it loses time, a logged-in browser with a correct local clock supplies automatic repair.

This update changed data/js/control.js, data/control.html and test/ui-regression.cjs. JavaScript syntax, 151 mocked browser checks and the SPIFFS build passed. No firmware upload, SPIFFS upload or physical power-cut test was performed.

## Detected SD card with recovery held

A user reported SD card Detected alongside the automatic-turning recovery/logging hold. That confirms detection only; it does not identify the failed or pending prerequisite. The live card/clock/snapshot failure has not been diagnosed from the generic banner alone.

The component panel previously replaced recovery.message with generic recovery pending whenever ready was false without checkpointFault. It now shows that exact recovery reason, the independent SD driver status (sdStatus), and an RTC-not-ready explanation. A readable card with invalid saved snapshots is distinguishable from a pending initialization or a write/readback fault. Detection labels remain simple; no safety hold is bypassed and no recovery file is changed.

Changes: data/js/componentStatus.js, data/settings.html and test/recovery-ui.cjs. JavaScript syntax, 45 mocked component/recovery checks and SPIFFS build passed. No firmware code, real card, relay output or device upload was used in this diagnostic update. Install the SPIFFS update and inspect the Recovery and SD driver details, or read the existing /api/data fields recovery.message, sdStatus and clockStatus to identify the actual board failure.

Current assets: 373,260 bytes total; 144,711 bytes JavaScript. Both remain above advisory UI budgets; SPIFFS packaging passes. Current source package: release/HatchAI-sd-diagnostics-deployment.zip.

## Guarded repair for unusable recovery snapshots

The confirmed device message reported a successful card read/write probe and queued logging readiness, but no selectable recovery snapshot. This narrows the issue to saved recovery validation or time eligibility; it does not identify which file/clock check failed.

Firmware now exposes snapshotA/snapshotB as Valid, Invalid or Missing. A valid copy that conflicts with RTC time is reported separately and retried periodically so a clock correction can unblock it. Such a copy cannot be overwritten by initialization.

When neither copy validates, Settings > Component status can offer Rebuild recovery from saved settings. The authenticated action uses the existing initialization/archive path after an explicit confirmation. It requires idle motors, healthy internal stores, stable sensors, a valid clock at/after the durable journal floor, and original NVS batch starts/reservations not in the future. Invalid originals are renamed to unique .invalid-* backups before a new checkpoint is written/read back/CRC checked. No current-date Day 1 batch or synthetic egg metadata is created.

The operation disarms turning and requires physical position checks for assigned rollers. Normal automatic recovery remains automatic. A cooled critical alarm may rebuild its recovery checkpoint but its alarm latch is retained and still requires its separate acknowledgment. Accepted repair is pending until the worker verifies the commit; it is not reported as durable immediately. The cached snapshot-file statuses refresh after acknowledgment and archived files are no longer shown as active A/B slots.

Deployment steps:

1. Install BOTH the firmware and SPIFFS from release/HatchAI-recovery-repair-deployment.zip.
2. Check the displayed RTC date/time against actual local time.
3. If the firmware offers Rebuild recovery from saved settings, review and confirm it.
4. Wait for Recovery verified / a checkpoint sequence, then physically inspect and verify each held roller position. Restore missing batch details from the existing browser records if needed.
5. If a snapshot is Valid but time-conflicted, correct/review the clock; the rebuild action is intentionally unavailable. Do not treat that state as a corrupt file.

Main changes: include/IncubatorController.h, src/ControllerRecovery.cpp, src/RecoveryStorage.cpp, src/HatchWebServer.cpp, data/js/componentStatus.js, data/settings.html and test/recovery-ui.cjs. No real card rebuild, firmware/SPIFFS upload or motor command was performed. Firmware and SPIFFS builds, JavaScript syntax and 53 mocked component/recovery checks passed. The browser checks simulate repair visibility, confirmation/cancel, pending versus verified results and position acknowledgment; they do not execute real SD/NVS operations. Raw UI assets total 373,818 bytes (JavaScript 145,270; CSS 46,616; largest HTML 17,212), exceeding the advisory JavaScript/total budgets while SPIFFS packaging succeeds.

## Corrected Upper/Lower mapping and two-minute default

The user reported that the physical rollers were opposite the labels. Config.h
now assigns Lower (motor 1) to GPIO25 / IN4 and Upper (motor 2) to GPIO26 / IN3.
The dashboard compatibility check uses this map; the active-low polarity, bulb
GPIO27 and fan GPIO14 are unchanged. Serial output labels identify the corrected
rollers. Batch/LCD/API slot 1 remains Lower and slot 2 Upper.

The default run is now 120 seconds (120,000 ms), every 120 minutes. Fresh NVS and
recovery defaults, the HTTP fallback, and dashboard initial/missing-value defaults
agree. Explicit saved calibrated durations are retained, including earlier 15-second
values. To apply 120 seconds to already-saved rollers, enter 120 for both durations
and confirm Save Settings. The allowed 1-600 second range remains.

Older SD snapshots with Lower26/Upper25 remain readable, rather than becoming an
SD recovery fault solely because the mapping changed. They are restored with both
positions held. A separate NVS roller-map revision also sets durable position holds
before accepting the new map on existing installations, including with SD missing.
The durable hold is written before the mapping revision so a power cut cannot skip
review. New installations stamp the current revision without inventing previous
motor history. Physically inspect both rollers, then verify their positions in
Settings > Component status once after upgrading. Existing batch IDs, dates,
calibration and counters are retained; old motor ON commands are not replayed.

Changes include include/Config.h, RecoveryState.h, DeviceProfile.h, RecoveryCodec.h,
IncubatorController.h; src/IncubatorController.cpp and main.cpp; data/control.html
and data/js/control.js; the turn/recovery compile checks and browser fixtures.
Firmware and SPIFFS builds, JavaScript syntax, six compiler-evaluated check sources,
155 general browser checks and 53 recovery browser checks passed. Timing checks
exercise just-before/exactly-at 120 seconds, independent timers and millis rollover.
The browser tests use the corrected relay map and verify new defaults alongside
preserved calibrated durations. These checks do not exercise real NVS migration,
relay wiring or motor travel. Firmware: 66,824 bytes RAM; 1,050,217 bytes flash.

Current source ZIP: release/HatchAI-corrected-rollers-120s-deployment.zip. Both
firmware and SPIFFS need updating. No upload or motor actuation was performed.
UI assets: 373,823 bytes total, 145,272 bytes JavaScript. The advisory JavaScript/total
budgets remain exceeded; the SPIFFS image builds successfully.

## Roller verification location

Position checks are now in the matching Lower/Upper roller card on Control, shown only while that roller has a position hold. Each requires confirmation after physical inspection and acknowledges only that roller; it does not move the motor. Component status remains diagnostic. The existing firmware position checks and authenticated API are unchanged.

## DHT22 retry timing

Normal successful sampling remains every five seconds. Startup/read/calibration failures now retry after 2.1 seconds from completion, allowing a fresh sensor frame without a blocking retry loop. Failed attempts do not renew the last valid timestamp or enter valid history/CSV. Three stable valid readings are still required after a stale fault; the 20-second freshness cutoff and unfiltered heat alarms remain unchanged. This addresses delayed recovery from intermittent reads, not electrical interference or physical sensor accuracy. Firmware upload is required; no upload or hardware validation was performed.

## Dashboard sensor interruptions

The dashboard retains its last valid temperature/humidity pair during invalid sensor responses and labels both as last valid/sensor unavailable. Network failures label both readings as connection lost. New valid samples restore the live labels automatically; no sample is invented, and firmware stale-data protection and logging rules are unchanged. Values are cached only in the current page, not persisted across reloads. Roller Verify buttons are displayed only for that roller’s firmware position hold.

Roller Verify is now a compact button beside the batch heading (accessible name identifies the roller). Its hidden state occupies no layout space; the existing conditional position-hold behavior and confirmation are unchanged.

Latest UI preference: Control roller cards no longer contain Verify buttons or their heading wrappers/styles. Interrupted-position confirmation is available only as a conditional maintenance action in Settings > Component status. Firmware and missing-value duration defaults remain 120 seconds; explicit saved calibrations are retained. Removing the Control button does not bypass the SD recovery, clock, cutoff or sensor checks.
# Incubation day beside each LCD batch

Rows 2 and 3 now append the RTC-based incubation day: `Upper: BATCH-001 D2`
and `Lower: BATCH-002 D21`. Long labels are shortened to reserve space for the
day within 20 columns. Unknown RTC/future or invalid start shows `D--`, never a
guessed day. Unassigned rows remain `Upper: No batch` / `Lower: No batch`.
Temperature/RH on row 1 and estimates/warnings on row 4 retain their behavior.
Firmware upload alone applies this display change; no SPIFFS changes are needed.
