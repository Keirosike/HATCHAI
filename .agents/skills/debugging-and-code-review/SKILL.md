---
name: hatchai-debugging-code-review
description: >-
  Diagnose defects and review code in HatchAI, an ESP32/Arduino/PlatformIO
  chicken-egg incubator with SHT40 and DS3231 over I2C, active-low relays,
  SD logging, SPIFFS-hosted vanilla JavaScript dashboard, Wi-Fi HTTP APIs,
  and an embedded Random Forest hatch-date predictor. Use for build failures,
  hardware-interface symptoms, control and turning bugs, browser/API issues,
  reliability regressions, and safety/security-focused reviews.
---

# HatchAI — Debugging and Code Review

## Objective

Find the root cause of a HatchAI issue, assess the impact of proposed or existing code, and recommend the smallest verifiable correction. Prioritize **safe actuator behavior**, correct data flow, reproducible evidence, and clear communication of what has and has not been tested.

This skill instructs a **development assistant**; it is not loaded by ESP32 firmware or the dashboard and does not introduce runtime AI agents.

## When to use

- A PlatformIO build, firmware boot, sensor read, relay, SD, RTC, LCD, Wi-Fi, or HTTP API fails.
- The browser reports incorrect readings, control states, hatch predictions, charts, batch records, login behavior, or settings.
- A change to `src/`, `include/`, `data/`, or `platformio.ini` needs review before merging.
- A developer requests a reliability, security, hardware-safety, or regression audit.

## 1. Ground rules and source of truth

1. **Read the relevant repository files before making a claim.** The system details provided for HatchAI describe a snapshot; the checked-out code is authoritative for the current task. Start with `platformio.ini`, `include/Config.h`, and the files for the affected behavior.
2. **Distinguish observations from hypotheses.** Label findings as *confirmed in source*, *reproduced in a test*, *likely*, or *requires hardware validation*. Do not claim the ESP32, connected relays, sensor accuracy, hatch success, or trained-model quality was tested without evidence.
3. **Prioritize physical safety.** Bulbs are heat sources and the turner moves a motor. Never energize real outputs, change relay polarity, upload firmware, or alter live setpoints without explicit authorization and a safe test setup. Prefer disconnected loads, simulators, or mocks for early verification.
4. **Never assume `HIGH` means ON.** Relay outputs are configured **active-low**: `LOW = ON`, `HIGH = OFF`. Trace through `OutputDevice` instead of writing GPIO directly.
5. **Avoid destructive actions.** Do not wipe Preferences, format SD/SPIFFS, reset counters, remove batch data, delete credentials, or overwrite the device unless authorized. `SPIFFS.begin(true)` can format on mount failure; note this risk when investigating mount failures.
6. **Protect secrets.** Do not print, hard-code, commit, or include actual Wi-Fi passwords, device passwords, session tokens, or personal batch data in bug reports. Replace them with redacted placeholders.
7. **Preserve scope.** A debugging patch should not silently convert the controller to PID, add a cloud server, redesign batch storage, retrain the model, or change user-visible control behavior.

## 2. Architecture quick reference

| Concern | Start here | Important boundary |
| --- | --- | --- |
| Boot, initialization, loop | `src/main.cpp` | Arduino loop and blocking handlers |
| Pins, I2C addresses, thresholds | `include/Config.h` | Configured values do not prove wiring |
| Shared state types | `include/IncubatorTypes.h` | Sensor/control/turn structures |
| Sampling, temperature/fan rules, turns, status | `src/IncubatorController.cpp` | Firmware governs the physical incubator |
| SHT40 reads and CRC | `src/Sht40Sensor.cpp` | I2C `0x44`; CRC and invalid-read handling |
| Relays | `src/OutputDevice.cpp` | Active-low outputs |
| RTC | `src/RealTimeClock.cpp` | DS3231, I2C `0x68` |
| SD CSV | `src/DataLogger.cpp` | `/hatchai.csv`; timestamp and append behavior |
| LCD | `src/LcdStatusDisplay.cpp` | 20x4 LCD, I2C `0x27` |
| Recent readings | `src/ReadingHistory.cpp` | 96 valid samples in RAM |
| Wi-Fi, AP, mDNS | `src/NetworkManager.cpp` | Credentials and AP/station transitions |
| HTTP API, sessions, static files | `src/HatchWebServer.cpp` | Browser requests and missing authorization guards |
| Model | `include/hatchai_random_forest_esp32_final.h` | Exported five-tree regressor |
| Frontend API | `data/js/espApi.js` | URL-encoded POST and response handling |
| Dashboard and graph | `data/js/dashboard.js` | Polls, chart rendering, batch prediction |
| Control page | `data/js/control.js` | UI intent versus firmware state |
| Batches | `data/js/batchStore.js` | Browser-local records only |
| Browser sessions | `data/js/authSession.js` | Browser heartbeat and client state |
| Settings and Wi-Fi UI | `data/js/settings.js`, `data/js/wifi.js` | UI storage versus actual controller changes |

Other relevant locations: `data/*.html`, `data/css/`, `docs/CODE_DOCUMENTATION.md`, and `test/`. Do not assume a test suite exists merely because `test/` exists.

## 3. Debugging procedure

Follow this sequence. Skip only steps that demonstrably do not apply.

### Step A — Define and classify the failure

Record:

- **Expected behavior** versus **actual behavior**, including the trigger and whether it is intermittent.
- Affected layer: **build/boot**, **I2C sensor/RTC/LCD**, **GPIO/actuator**, **timing/turner**, **SD/SPIFFS/Preferences**, **Wi-Fi/HTTP/session**, **browser/batch**, or **prediction**.
- Firmware revision, relevant configuration, page and API route, and whether firmware or filesystem assets were uploaded.
- Evidence: compiler errors, redacted 115200-baud serial output, HTTP status/JSON, browser console/network traces, timestamps, and UI screenshots when available.
- Hardware conditions where applicable: device powered, loads disconnected/connected, AP versus station mode, RTC present, SD present, and I2C devices detected. Never infer wiring solely from configuration.

### Step B — Trace one end-to-end data path

Identify the initiating source, intermediate transformations, and final effect. Examples:

- **Temperature:** `Sht40Sensor` → validated reading → `IncubatorController` → active-low `OutputDevice` → `/api/data` → `dashboard.js`/`control.js`.
- **Manual control:** browser input → `espApi.js` → `POST /api/control` → parsed arguments → controller mode/state → GPIO outputs → returned status.
- **Turn request:** timer or `POST /api/turn` → controller pulse → relay state → counter persistence → API/LCD.
- **Batch prediction:** `batchStore.js` start date → browser-computed incubation day → `POST /api/predict` → embedded model → response date/UI.
- **Logging:** accepted SHT40 sample → timestamp source (DS3231 or uptime) → CSV row on SD.

Check types, units, state lifetimes, API parameter names, invalid data handling, and exact event order at each boundary.

### Step C — Check project-specific invariants

These are **observed baseline behaviors from the supplied system description**, not evidence that hardware performs as expected. Re-verify them in the current checkout.

**Sensor and control**

- Defaults: automatic mode, target `37.8 °C`, target `58% RH`.
- Sample about every **5 seconds**. A failed sample may leave the last valid reading usable only while its age is at most **20 seconds**; after expiry it becomes invalid on a subsequent failed sample.
- Sensor command `0xFD`, six-byte read, separate temperature/humidity CRC with initial `0xFF` and polynomial `0x31`. Drivers can retry up to three times.
- **Automatic heating:** both bulbs ON below `target − 0.3 °C`; OFF above `target + 0.3 °C`; hold their previous state inside and at the boundaries.
- **Automatic fan:** ON if `temperature > target + 0.5 °C` **or** `humidity > target + 5 percentage points`; otherwise OFF.
- **Invalid sensor reading in automatic mode:** bulbs and fan OFF. **Manual mode does not inherit this fail-safe**; report safety implications instead of assuming otherwise.
- There is **no humidity-raising actuator**. Do not describe the system as closed-loop humidity control or PID control.

**Turning and time**

- Default timed turn interval is **120 minutes**; pulse duration is **8 seconds**. A manual sustained ON is not an 8-second pulse.
- At pulse completion, automatic mode turns the relay OFF, while manual mode may restore its configured turner state.
- Turning counters are persisted to Preferences (`hatchai-turn`); the scheduler's uptime-based timer does **not** survive reboot. Counters represent commands, **not confirmed motor movement**.
- RTC time may be initialized from firmware build time following a lost-power indication; the described implementation has no NTP or clock-set API.

**Prediction and browser state**

- Prediction input order: temperature, humidity, turner relay state, incubation day. The documented exported trees **split only on incubation day (`x[3]`)**. Do not claim live environmental readings alter the numerical prediction unless the model is actually changed and verified.
- `POST /api/predict` uses the selected batch's supplied incubation day (accepted 1–21); general `/api/data` and LCD prediction use an **uptime-derived** day. They are not guaranteed to match after reboot.
- Batches, calibration form values, and some credentials exist in **browser localStorage**, not an ESP32 batch database. Selecting a batch does not automatically change physical control targets; displayed calibration offsets are not applied to sensor readings.
- Recent chart history has **96 valid samples** (about eight minutes at five-second intervals). Labels `hour`, `day`, `week`, and `month` do not indicate complete historical archives.

**Storage and HTTP**

- Sensor rows are normally appended to SD `/hatchai.csv` every valid sample. Existing incompatible headers can cause legacy-file renaming. Logged relay states may precede that loop's following actuator update.
- SPIFFS serves HTML/CSS/JS assets; uploading firmware does **not** automatically update the browser files.
- API routes to trace include `GET /api/data`, `POST /api/control`, `POST /api/turn`, `POST /api/predict`, account/session routes, and Wi-Fi scan/connect/forget routes.
- Browser control POSTs are usually **URL-encoded**. Verify exact argument names (`autoMode`, `bulbOn`, `bulb2On`, `fanOn`, `turnerOn`, `targetTemperature`, `targetHumidity`, `turnIntervalMinutes`) and alternate names before debugging parse failures.

### Step D — Form a minimal hypothesis and test it

1. Rank plausible causes by evidence and safety impact.
2. Inspect the narrowest relevant function and its callers; check the state before and after the suspected branch.
3. Reproduce with a **small, reversible** test. Prefer source-level reasoning and mocked sensor/API data over energizing actual heaters or motors.
4. Add targeted logs only when necessary. Avoid logging credentials and avoid excessive synchronous serial logging that changes timing.
5. If the hypothesis fails, explicitly discard it and select the next cause; do not patch unrelated code.
6. Before changing code, note expected effects on automatic/manual modes, boot state, failed sensor reads, Wi-Fi state, and persisted data.

### Step E — Implement and verify narrowly

- Fix the root cause with the fewest changes needed. Preserve consistent `millis()` elapsed-time handling, overflow-safe arithmetic, hysteresis boundary semantics, and active-low relay initialization.
- Make failure modes explicit: disconnected I2C sensor, invalid CRC, missing RTC/SD/LCD, SD full, SPIFFS mount problem, HTTP timeout, stale browser cache, Wi-Fi reconnect, unexpected POST bodies, and reset during timed turning.
- Compare behavior against the baseline and document intentional deviations. If a safety or security defect requires a behavioral change, explain the migration/compatibility impact.
- Add a regression test wherever the code can be isolated. If no test harness exists, provide reproducible manual or hardware-in-loop test steps; do not claim automated coverage.
- Rebuild the appropriate artifacts. Report exact commands and outcomes; do not equate compilation with runtime correctness.

## 4. Build and verification commands

Run from the repository root after inspecting `platformio.ini`:

```powershell
# Compile ESP32 firmware
pio run

# Build SPIFFS filesystem image from data/
pio run --target buildfs

# On an explicitly authorized, safely prepared physical device ONLY:
pio run --target upload
pio run --target uploadfs
pio device monitor --baud 115200
```

If `pio` is not on `PATH`, locate the actual PlatformIO executable. The documented Windows setup used `C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe`; do not assume that path exists in another environment.

**Upload decision:** `src/` or `include/` change → firmware upload; `data/` change → filesystem upload; both changed → both uploads. A local build does not confirm uploads or live device behavior. Running `pio test` only makes sense if suitable tests and environment are actually configured.

## 5. Code-review procedure

### Step A — Establish review scope

Review the supplied diff first. Read impacted call sites and nearby state transitions, then check relevant project settings. Identify whether the request is for a **change review**, a **targeted bug/security audit**, or a **full repository audit**. Never imply a full audit if only a few files were inspected.

### Step B — Inspect in this order

1. **Actuator safety and controller correctness**: safe startup relay states; active-low mapping; stale/invalid sensor behavior; mode transitions; heater/fan threshold boundaries; motor pulse completion; stuck-on or unbounded outputs; nonblocking timing and wraparound.
2. **Unauthorized control/security**: access checks on mutating HTTP endpoints, session-token validation, account changes, Wi-Fi credentials, password storage, HTTP/CORS exposure, and untrusted input validation. Check backend enforcement, not just disabled frontend controls.
3. **Concurrency and latency**: blocking Wi-Fi operations inside HTTP handlers, synchronous SD/I2C operations, missed sample or turn schedules, and interactions between user commands and automatic control.
4. **Data integrity and persistence**: SD header compatibility, partial writes, RTC fallback timestamps, Preferences write frequency, reboot behavior, RAM-versus-browser state, and browser origin changes.
5. **API and UI compatibility**: parameter parsing, endpoint methods, JSON fields, caching, race conditions between polling and form edits, misleading statuses, and SPIFFS asset version mismatch.
6. **Model correctness/claims**: exact feature order, incubation-day clamping, input validity gate, date calculations, uptime-vs-batch disagreement, and unsupported accuracy claims.
7. **Maintainability/testability**: code duplication, naming, boundary abstractions, deterministic tests, warnings, dead code, and documentation updates.

### Step C — Review known high-risk areas explicitly

The supplied system description reports these **existing behavior/risks**. Confirm them against current code, and do not mislabel them as newly introduced regressions:

- Main control, account, and Wi-Fi handlers reportedly lack authenticated-session checks; a frontend login alone is not authorization.
- Session start reportedly checks a password only if a nonempty password is supplied; HTTP is unencrypted and CORS permits all origins.
- The default credentials and access-point password are weak examples for deployment; browser localStorage reportedly holds a password copy.
- `/api/turn` reportedly permits calls even when the browser disables its button in automatic mode.
- Sensor failure reportedly does not force manually commanded heaters OFF.
- Wi-Fi connection handling can block the controller for up to **20 seconds**.
- `SPIFFS.begin(true)` can format flash storage on mount failure.
- Browser batch statuses and batch-specific targets do not command physical incubation controls.
- Turning commands do not prove actual egg rotation; model outputs do not prove a real hatch date.

Report these with evidence, realistic exploit/failure prerequisites, and a proposed mitigation. Do **not** perform intrusive live endpoint tests or write new credentials without permission.

### Step D — Assign severity based on impact

| Priority | Meaning | HatchAI-style examples |
| --- | --- | --- |
| **P0 — Critical** | Immediate danger or catastrophic, reliably reachable failure | Heaters stuck ON without a safe shutdown path under realistic operation |
| **P1 — High** | Serious security, safety, or core function failure | Unauthenticated actuator-control write reachable by an untrusted network user; a turning pulse never stops |
| **P2 — Medium** | Incorrect but bounded behavior, data loss, or substantial reliability issue | Unintended missed samples from blocking requests; incorrect CSV timestamp around RTC fallback |
| **P3 — Low** | Minor usability, maintainability, or documentation problem | Unclear dashboard labels or a harmless display formatting issue |

Priority depends on **actual reachability and consequences**, not just an alarming code pattern. If severity cannot be established, say what evidence is missing.

### Step E — Provide actionable review findings

For each genuine finding include:

```text
[P1/P2/P3] Concise issue title
Location: path/to/file.cpp:<line or narrow range>
Evidence: What the code demonstrably does.
Trigger: Exact inputs/state needed to reproduce.
Impact: Specific consequence for HatchAI.
Recommendation: Smallest safe change, noting compatibility issues.
Verification: Targeted test or observation proving the fix.
Confidence: Confirmed in code / reproduced / needs hardware test.
```

Put findings **first, ordered by severity**. When a diff has no confirmed findings, state that plainly, then list **testing gaps and residual risks** separately. Avoid generic advice that is not anchored to code or a specified requirement.

## 6. Focused regression test matrix

Select tests relevant to the change; do not report unexecuted cases as passes.

| Area | Minimum cases to check |
| --- | --- |
| Relay output | Boot OFF; `LOW=ON`; automatic and manual transitions; reset during ON |
| Temperature | Below lower limit; exactly lower boundary; inside band; exactly upper boundary; above upper limit |
| Fan | Temperature and humidity triggers independently; OR condition; exact boundaries |
| Sensor faults | Disconnected sensor; CRC failure; transient failure; stale reading beyond 20 seconds |
| Turner | Interval not reached/reached; overlapping request; eight-second completion; manual sustained ON; restart during cycle |
| Timing | `millis()` rollover; blocking HTTP request; sampling cadence after delay |
| RTC and logs | Correct RTC; absent/lost-power RTC; timestamp fallback; legacy CSV header; missing/full SD |
| Browser/API | GET success/error; correct POST encoding; partial/invalid arguments; page reload; stale assets; network loss |
| Sessions/security | Unauthorized mutating request (in isolated test); blank password; token expiry/replacement; origin/CORS behavior |
| Batches | New/edited/deleted/selected record; duplicate label; another browser/origin; pause/complete not affecting hardware |
| Predictions | Days 0, 1, 21, 22; invalid sensor; uptime reset; same day with varied environmental inputs |
| Persistence | Mode/setpoints after restart; turn counters across restart; Preferences and localStorage boundaries |

For actual heaters, motors, and relays, obtain approval and use a supervised safe hardware test. Static analysis and unit tests cannot confirm GPIO electrical states or correct relay wiring.

## 7. Response format for a debugging task

Use this concise structure:

```markdown
## Diagnosis
- Symptom and affected subsystem
- Root cause: confirmed or most likely, with file/line evidence
- Why the behavior occurs, including any hardware uncertainty

## Fix
- Files to change and minimal modification
- Safety, compatibility, and data-persistence implications

## Verification
- Tests performed and actual results
- Tests not performed (especially physical-device checks)
- Remaining risks
```

For a review, use **Findings (highest priority first)**, **Validation performed**, **Open questions**, and **Residual risks**. If the user requests a patch, show the patch separately from the review findings.

## 8. Completion criteria

A debugging or review task is complete only when the assistant has:

- Identified the applicable firmware/frontend/storage boundary and inspected the relevant current source.
- Distinguished proven facts from assumptions and unverified hardware behavior.
- Checked safety and access-control effects for every changed endpoint or actuator path.
- Explained the root cause or provided prioritized, reproducible hypotheses when proof is unavailable.
- Run feasible, authorized verification and reported the exact result without inventing tests.
- Documented any remaining risks or changes requiring a device, specialized instrumentation, or user approval.

**Avoid false conclusions:** HatchAI's embedded Random Forest is not a live-trained agent; its model does not currently drive heating; its chart labels are not historical time windows; its browser-local batches are not device-wide records; and successful relay commands are not proof of physical egg turning.
