# HATCHAI Agent Instructions (Local + Cloud)

## Agent Skill Loading Rules

Before implementing any task:

1. Read this AGENTS.md completely.

2. Discover available skills under `.agents/skills/` (and `.codex/skills/` if present).

3. Read the SKILL.md files relevant to the task.

4. Follow the selected skills during implementation.

5. Apply esp32-ui-limiter whenever ui-ux-pro-max is used.

6. Apply esp32-embedded-development for firmware changes.

7. Apply `debugging-and-code-review` for debugging and reviews when its SKILL.md exists.

8. Prioritize hardware safety and ESP32 compatibility.

9. Verify changes before reporting completion.

Do not claim a skill was loaded unless its file

was actually found and read.

## 0. Current Architecture and Source-of-Truth Rules

- **Read before editing:** `git status --short`, this file, `README.md`, applicable docs, the relevant source files, and relevant skills. Do not overwrite user work.

- **Source precedence:** current source + `platformio.ini` + confirmed physical wiring > old documentation or historical descriptions in this file. If conflicting, stop and ask before modifying GPIO or control logic.

- **Separate deployment targets:** ESP32 firmware (`src/`, `include/`), local SPIFFS web (`data/`), Firebase-hosted web (`public/`), Supabase functions/migrations (`supabase/`, if present), and S3-CAM firmware (inspect actual project location). Never assume editing one automatically updates another.

- **Deployment status:** distinguish planned, implemented, locally tested, deployed, and verified on physical hardware. Do not claim cloud streaming or FCM works until end-to-end tests pass.

- **Cloud ownership:** Supabase is a proposed backend for broader application data, telemetry, commands, and hatch-event records (verify actual implementation). For the notification subsystem, the selected design is Cloudflare Worker + D1 for FCM token registration and event delivery, Firebase Hosting for the HTTPS notification page, and Firebase Cloud Messaging for push alerts. Do not add Supabase or a second identity system to the notification path without an explicit approved migration plan.

- **No production action without authorization:** no firmware flashing, SPIFFS upload, Firebase/Supabase deployment, database migration, credential rotation, GPIO activation, or live actuator command unless explicitly approved.

## Skill Routing for Existing Project Skills

Discover `.agents/skills/*/SKILL.md` and read the relevant ones; skill names are only usable when the file exists and contains instructions. Existing screenshot shows `banner-design`, `brand`, `debugging-and-code-review`, `design`, `design-system`, `esp32-embedded-development`, `esp32-ui-limiter`, `hatchai-architecture`, `slides`, `ui-styling`, and `ui-ux-pro-max`. The screenshot does not establish the content or validity of those files.

- Architecture, integration or migrations: `hatchai-architecture`.

- Firmware, PlatformIO, sensors, relays, Wi-Fi: `esp32-embedded-development`.

- Debugging and reviews: `debugging-and-code-review` (or inspect actual skill filename before invoking).

- UI design: `ui-ux-pro-max` and `esp32-ui-limiter` **together for SPIFFS/local pages**. For `public/`, keep accessibility and performance constraints, but do not incorrectly impose SPIFFS asset-size limits on the cloud-hosted copy.

- Only use design/brand/banner/slides skills when the task actually requires them.

- For notification tasks, discover and read the six skills listed in Section 19 when their files exist. For other Firebase, Supabase, cloud sync, camera streaming, edge AI, testing, and security tasks, use corresponding skills only if installed; never claim an absent skill was loaded.

## 1. Project Overview

HATCHAI is a safety-critical ESP32-based smart incubator. The repository includes legacy/local firmware and is being extended toward a hybrid local/cloud architecture: ESP32 DevKit V1 for control, up to two ESP32-S3-CAM devices for camera and chick detection, Firebase Hosting for an online dashboard, Supabase for application data and authenticated device communication, and Firebase Cloud Messaging for notifications. The notification subsystem is being developed with Cloudflare Workers and D1 rather than assuming Supabase is deployed. The existing local SPIFFS web interface and AP+STA setup must remain functional. **Do not assume any proposed cloud or camera feature is already implemented.** Hardware configurations have evolved (including DHT22/SHT40 and heater/relay revisions); inspect source and actual wiring before making claims or changes.

Read [README.md](README.md), [Code Documentation](docs/CODE_DOCUMENTATION.md), and [System Details](docs/SYSTEM_DETAILS.md) for context. Inspect the relevant source before editing; source code takes precedence when documentation disagrees. These instructions guide development agents. The application contains no autonomous LLM agent runtime and does not load agent Markdown files.

### Starting a Task

These instructions apply throughout this repository. Check for a more specific `AGENTS.md` in the directories being changed and follow it within its scope, subject to higher-priority instructions.

1. Read this file and run `git status --short` before editing. Preserve existing staged, unstaged, and untracked work; do not stage or commit it unless requested.

2. Read the documentation and source relevant to the task. Start firmware work at `src/main.cpp`, `include/Config.h`, and the affected module; start frontend/API work at the relevant page script, `data/js/espApi.js`, and its firmware route.

3. For frontend work, read [UI UX Pro Max](.agents/skills/ui-ux-pro-max/SKILL.md) and [ESP32 UI Limiter](.agents/skills/esp32-ui-limiter/SKILL.md). Apply the resource constraints in Section 5 when selecting design recommendations. Read other local skills only when relevant; a missing or empty skill is not evidence of an implemented workflow.

4. Make the requested change and run the applicable checks in Sections 3 and 10. Distinguish local builds from uploads and physical device operations; initialization alone does not authorize either of the latter.

## 2. Architecture and File Map

| Location | Responsibility |

| --- | --- |

| `platformio.ini` | `esp32dev` environment, `espressif32` platform, Arduino framework, SPIFFS, 115200-baud serial |

| `src/`, `include/` | Firmware implementations and headers |

| `src/main.cpp` | Object construction, peripheral startup, controller updates, and HTTP request handling |

| `include/Config.h`, `include/IncubatorTypes.h` | Hardware assignments, default timing/targets, readings, control settings, and turn metrics |

| `src/IncubatorController.cpp` | Sampling, output decisions, timed turns, persisted turn metrics, predictions, and status JSON |

| `src/Dht22Sensor.cpp`, `src/OutputDevice.cpp` | Checksum-validated DHT22 measurements and relay GPIO/polarity abstraction |

| `src/RealTimeClock.cpp` | DS3231 timestamps and build-time recovery after clock power loss |

| `src/DataLogger.cpp`, `src/LcdStatusDisplay.cpp` | SD CSV logging and four-line LCD updates |

| `src/ReadingHistory.cpp` | Recent valid measurements in a RAM ring buffer and history JSON |

| `src/NetworkManager.cpp` | Wi-Fi credentials, station/AP behavior, scanning, and mDNS |

| `src/HatchWebServer.cpp`, `include/JsonBuilder.h` | HTTP routes, static files, account/session handling, and JSON helpers |

| `include/hatchai_random_forest_esp32_final.h` | Exported five-tree Random Forest regressor |

| `data/` | HTML, CSS, JavaScript, images, icons, and fonts deployed to SPIFFS |

| `data/js/espApi.js` | Browser client for data, control, turn, and prediction endpoints |

| `data/js/batchStore.js`, `data/js/batch.js` | Browser-local batch persistence, validation, dates, selection, and batch UI |

| `data/js/dashboard.js`, `data/js/control.js` | Live monitoring/canvas chart and control UI |

| `data/js/authSession.js`, `data/js/login.js` | Browser sessions, heartbeats, login, and credential fallback |

| `data/js/settings.js`, `data/js/wifi.js` | Account/settings forms and Wi-Fi management |

| `docs/` | System and maintenance documentation |

| `test/`, `lib/` | Currently contain README guidance, not a project test suite or custom library implementation |

Keep coordination in `IncubatorController`, peripheral communication in its driver, routes in `HatchWebServer`, and browser behavior in the corresponding page/shared module.

## 3. Build and Verification Commands

Run from the repository root in PowerShell. The machine-specific PlatformIO executable is available at the path below; if unavailable elsewhere, locate the installed executable or use `platformio` on PATH.

```powershell

# Build firmware without uploading

& "C:\Users\LENOVO\\.platformio\penv\Scripts\platformio.exe" run -e esp32dev

# Build the SPIFFS image without uploading

& "C:\Users\LENOVO\\.platformio\penv\Scripts\platformio.exe" run -e esp32dev --target buildfs

# Check JavaScript syntax; stop on the first failure

Get-ChildItem -LiteralPath .\data\js -Filter *.js | ForEach-Object {

    node --check $_.FullName

    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed: $($_.Name)" }

}

```

Builds verify compilation or asset packaging; they do not update the ESP32. JavaScript syntax checks do not verify browser behavior or inline scripts in HTML.

Only run these upload commands when the user authorizes uploading:

```powershell

# Upload compiled firmware

& "C:\Users\LENOVO\\.platformio\penv\Scripts\platformio.exe" run -e esp32dev --target upload

# Upload dashboard assets to SPIFFS

& "C:\Users\LENOVO\\.platformio\penv\Scripts\platformio.exe" run -e esp32dev --target uploadfs

```

Changes under `data/` require `uploadfs` to reach the device. Firmware changes require `upload`. When both change, both uploads are needed. Refresh the browser after deployment if it shows old assets. Do not hand-edit generated `.pio/` outputs.

## 4. Development Rules

\- Follow existing C++ and plain JavaScript conventions, helpers, and module boundaries. Keep changes focused on the task and preserve unrelated user work, including untracked files.

\- Centralize hardware pins, I2C addresses, and configurable timing/target defaults in `include/Config.h`; avoid duplicating hardware configuration in drivers or frontend code.

\- Keep the firmware and browser API contract aligned. Inspect both `src/HatchWebServer.cpp` and `data/js/espApi.js` when changing request methods, arguments, response fields, or error behavior.

\- The browser sends URL-encoded POST bodies. Control parsing uses form arguments; prediction additionally supports a simple JSON-body parser. Do not assume all endpoints accept arbitrary JSON bodies.

\- Preserve units, field names, relay-state semantics, CSV compatibility, and storage keys unless the task requires a migration. Reuse the JSON helpers and shared browser utilities where appropriate.

\- Avoid unrelated refactors, dependencies, generated-model edits, formatting churn, or commits unless required by the task or requested.

\- Never invent implemented features, successful checks, hardware observations, training provenance, or model accuracy. Update relevant documentation when a task intentionally changes behavior.

## 5. UI/UX Development and ESP32 Resource Limits

For all frontend development, dashboard redesigns,

and UI improvements:

\- Use `ui-ux-pro-max` for design recommendations.

\- Apply `esp32-ui-limiter` to enforce ESP32 compatibility.

\- Prioritize device reliability over visual complexity.

\- Use HTML5, CSS3, and vanilla JavaScript.

\- Avoid React, Vue, Angular, and heavy UI frameworks.

\- Preserve existing HatchAI API endpoints and behavior.

\- Do not introduce unnecessary frontend dependencies.

### Frontend Resource Budgets

| Resource | Recommended Limit |

|---|---|

| HTML | 30 KB per page |

| CSS | 50 KB total |

| JavaScript | 80 KB total |

| Images | 40 KB per image |

| Total UI assets | 350 KB |

| API polling | Minimum 5 seconds |

| Concurrent polling | 1 request preferred |

| Chart data points | 50 per chart |

| CSS transitions | 100–250 ms |

| External JS libraries | 0 preferred |

These are initial optimization targets, not verified

hardware limits.

### UI Design Restrictions

\- Prefer system fonts and lightweight SVG icons.

\- Avoid excessive blur, shadows, and animations.

\- Avoid large images, videos, and 3D visualizations.

\- Use CSS Grid and Flexbox for responsive layouts.

\- Update only changed dashboard values.

\- Avoid overlapping API requests.

\- Use existing Canvas-based chart rendering.

\- Keep HTTP responses small and bounded.

\- Do not increase API polling frequency unnecessarily.

\- Do not introduce UI features without backend support.

### Required Verification

Before completing UI changes:

1. Check HTML, CSS, and JavaScript asset sizes.

2. Verify compatibility with ESP32 SPIFFS.

3. Check JavaScript syntax.

4. Build the SPIFFS filesystem image.

5. Verify existing API compatibility.

6. Report resource-budget violations.

When UI UX Pro Max conflicts with ESP32 resource

constraints, `esp32-ui-limiter` takes priority.

## 6. Hardware and Control Constraints (Legacy Snapshot — Verify Current Code)

The following mappings are from an earlier repository snapshot, **not verified current wiring**. Configured relays were active-low: LOW is ON, HIGH is OFF. Bulb 1 uses GPIO 26, bulb 2 GPIO 25, fan GPIO 14, and turner GPIO 27. DHT22 DATA uses GPIO 4. Shared I2C uses SDA 21/SCL 22 for DS3231 `0x68` and LCD `0x27`. SD SPI pins are CS 5, SCK 18, MISO 19, MOSI 23. Verify current values in `Config.h` before hardware-related changes.

\- Defaults are automatic mode, 37.8 C temperature, 58% humidity, 120-minute turns, 8-second pulses, 5-second sampling, and 2-second LCD refresh.

\- Automatic heating switches both bulbs ON below target minus 0.3 C and OFF above target plus 0.3 C. Inside the band, including boundaries, previous states are retained.

\- The fan is ON above temperature target plus 0.5 C OR humidity target plus 5 percentage points; otherwise OFF. There is no configured actuator to raise humidity.

\- The DHT22 driver uses checksum-validated library reads, rejects non-finite values and measurements outside -40 to 80 C or 0-100% RH, and retries on the next five-second sample. It permits two seconds for startup without blocking. Do not record invalid samples as valid history or CSV readings.

\- After failed sampling, the controller retains a previous valid reading while its age is at most 20 seconds. On a subsequent failed sample after that limit, it becomes invalid. In automatic mode, invalid readings turn both bulbs and the fan OFF; scheduled turning is evaluated separately.

\- Manual mode bypasses automatic temperature/humidity output decisions. A sustained manual turner ON state differs from an eight-second timed turn request. At pulse completion, manual mode restores its configured turner state, which may remain ON.

\- Automatic turns are scheduled from boot or the last turn during that boot. Counters persist, but scheduling uptime does not. No motor movement feedback or incubation-day cutoff is implemented. The UI disables manual turning in automatic mode, but `/api/turn` does not enforce that restriction.

\- Preserve control behavior unless the task explicitly changes it. Do not silently change pins, relay polarity, timing, thresholds, failure handling, or manual-mode semantics. Explain intentional changes and verify the affected branches.

\- Do not upload firmware, upload SPIFFS, or actuate connected hardware without user authorization for that operation. A general request to edit or build code does not authorize deployment or physical relay commands.

## 7. Data and Persistence

| Location | Data |

| --- | --- |

| ESP32 RAM | Current reading, control mode/targets, recent history, server session, and turn scheduling uptime |

| Preferences `hatchai-turn` | Total/daily turns, last timestamp, actual interval, and daily date key |

| Preferences `hatchai-wifi` | Saved Wi-Fi credentials |

| Preferences `hatchai` | Account username/password |

| SPIFFS | Web assets under `data/` |

| SD `/hatchai.csv` | Valid readings, output states, targets, and turn metrics |

| Browser localStorage | `hatchai_batches`, `hatchaiAccount`, `hatchaiPassword`, `hatchaiSettings`, and `hatchaiActiveSession` |

| Browser sessionStorage | Tab client ID `hatchaiClientId` |

Control settings reset to firmware defaults after reboot. Batches belong to a browser origin and are not synchronized across browsers/devices or different access hostnames/IPs. Selecting a batch does not apply its recorded targets to the controller. Pausing/completing a batch does not stop hardware outputs. Only Active batches are selectable for dashboard prediction.

History capacity is 96 valid samples, approximately eight minutes at normal sampling. The `hour`, `day`, `week`, and `month` groups expose recent point subsets, not long-term archives. Do not describe them as SD-backed historical windows.

Preserve the logger's incompatible-header backup behavior when changing the CSV schema. Preserve valid/invalid measurement distinctions and account for missing RTC timestamps.

## 8. Prediction Model Contract

`IncubatorController::predictedDaysRemainingForDay()` supplies exactly four float features in this order:

```text

x[0] = temperature in C

x[1] = relative humidity in percent

x[2] = current turner relay state, 1.0 or 0.0

x[3] = incubation day

```

The exported model averages five trees. Its current branches reference only `x[3]`; temperature, humidity, and turner state do not change the numerical output at a fixed incubation day. The controller still requires a valid sensor reading within its prediction range of -40 to 80 C and 0-100% humidity.

A positive output is rounded to whole days remaining; nonpositive output becomes zero. Batch requests reject incubation days below 1 and clamp model input to 1-21. Preserve feature order, units, range handling, output interpretation, and date behavior when replacing or integrating a model; inspect the new export before claiming which inputs affect it.

The generic `/api/data` prediction and LCD derive incubation day from ESP32 uptime, which resets at reboot. Batch predictions use `/api/predict`, with the day calculated from the stored batch start date and current date. The browser prefers RTC date context and has a browser-date fallback. Keep these paths distinct; selecting a batch does not set a persistent firmware incubation start date.

This is embedded inference, not autonomous LLM agent behavior. Model predictions do not drive the heating policy. No training dataset, training script, or accuracy evidence is included in the repository.

## 9. Known Implementation Limits (Historical — Revalidate)

\- Calibration offsets/notes are saved in browser settings but are not applied to sensor measurements or sent to firmware control.

\- `data/log.html` contains example entries and placeholder filtering; it does not fetch SD logs. No log retrieval or CSV download endpoint exists.

\- Control, turn, account, and Wi-Fi handlers do not enforce authenticated sessions. Session start checks credentials only when a password is nonempty; another token using the same username can replace a session. The login page is not a complete API access-control boundary.

\- Account passwords are stored as strings in Preferences and browser localStorage; HTTP is unencrypted and CORS permits any origin. Do not imply stronger protections than the implementation provides.

\- Wi-Fi connection attempts block the main execution path and can delay control updates. Build success does not establish runtime timing guarantees.

\- Three active batch slot cards are a UI presentation, not evidence of physical capacity or independently controlled environments. Training accuracy and physical hatch success remain unverified.

Treat these as confirmed limitations to consider when implementing related tasks. Do not expand an unrelated task into fixing them without a task-specific reason. See [System Details](docs/SYSTEM_DETAILS.md) for further context.

## 10. Testing and Completion

\- For documentation-only edits, check source accuracy, referenced paths, and whitespace; firmware builds and hardware access are unnecessary.

\- For firmware changes, build the `esp32dev` environment. Exercise affected logic through suitable existing or focused tests where practical; `test/` currently has no project tests. Prioritize hysteresis boundaries, invalid/stale readings, mode transitions, turn timing, and persistence when those behaviors change.

\- For web changes, syntax-check affected JavaScript and build SPIFFS. Verify affected browser behavior and layout when relevant. For API changes, check both request encoding and response handling, including failure states. Keep any physical commands within user-authorized scope.

\- For model changes, verify feature order, used inputs, representative day boundaries, sensor rejection, rounding, and date paths. Inference checks alone do not establish predictive accuracy.

\- Run checks proportional to the change. If a tool, dependency, browser, or board is unavailable, state the exact verification gap; do not report a skipped check as passed.

\- Finish with the changed file paths, resulting behavior, checks actually performed and their results, and material remaining limitations. Clearly distinguish source inspection, compilation/packaging, browser checks, and physical hardware testing. Report whether uploads or hardware operations occurred.

## 11. Hybrid AP+STA and Offline-First Requirements

- Preserve the ESP32 setup AP, captive/local dashboard, and STA router connection. Local incubator operation must not depend on Wi-Fi, internet, Supabase, Firebase, or video services.

- Keep control loops nonblocking. Use bounded HTTPS timeouts, retry with exponential backoff and jitter, and report offline/reconnecting status.

- Sensor and control safety decisions execute locally; cloud commands represent **desired state** and require device-side range checking, authorization, versioning, acknowledgement, and stale-command rejection.

- Never permit a cloud write to directly toggle a heater or motor without validated firmware control. Preserve manual/automatic mode semantics and relay fail-safe behavior.

- Avoid duplicate command execution across reconnects; use command IDs, sequence/revision numbers, expiry times, and acknowledgements.

- Avoid relying on fixed LAN IP addresses; support discovery/configuration and document DHCP reservations when used.

- Keep local and cloud user interfaces consistent but do not assume the hosted site can call private ESP32 HTTP addresses across the internet.

## 12. Supabase Backend and Security

- Use Supabase Auth for user sessions if it is the selected identity provider; avoid combining Firebase Auth and Supabase Auth without an explicit identity-linking design.

- Apply Row Level Security to browser-accessible tables; enforce owner/incubator membership on every read and write. Never trust a browser-supplied `user_id` or `incubator_id` without authorization.

- Expose authenticated Edge Functions for device telemetry, commands, and hatch events. Give each physical device an individual revocable credential and validate ownership/role server-side.

- Never put the Supabase service-role key, Firebase Admin private key, or device secrets in `public/`, frontend JavaScript, firmware committed to Git, or screenshots. Public anon/publishable keys are not authorization controls.

- Keep migrations versioned, reviewed, reversible when possible, and separate from deployment. Do not perform destructive schema changes without approval.

- Store timestamps in UTC, maintain per-device IDs, and distinguish reported state from desired state. Rate-limit telemetry and avoid uncontrolled database growth.

## 13. Firebase Hosting, Web SDK, and Push Notifications

- Treat `public/` as a separate deployment target. Inspect `firebase.json` before changing Hosting paths or copying assets. Never overwrite the local SPIFFS dashboard as a side effect.

- Use the Firebase Web SDK with the configuration belonging to the **selected Firebase project**; do not mix historical `hatchai2` values with `hatchai-8d34c`.

- Register service workers only on secure origins (HTTPS or supported localhost). Request notification permission only from an explicit user interaction.

- Use server-side Firebase Cloud Messaging HTTP v1/Admin authorization to send notifications; never expose private service credentials to browsers or ESP32 boards.

- For the current one-shared-account notification design, associate push registrations with verified, authorized enrollment of each browser; do not require a distinct Firebase account per Android device. Revoke stale registrations and handle delivery errors.

- Hatch alerts are **detection events**, not proof of successful hatching or accurate chick counts. Use temporal confirmation, event IDs, and deduplication across reconnects; a fixed cooldown alone cannot distinguish multiple chicks.

- Do not automatically deploy Hosting, Functions, or messaging changes. Test foreground, background, permission-denied, token/installation registration, and offline scenarios.

## 14. Two ESP32-S3-CAM Devices and Remote Video

- Treat each camera as a separate device with its own credentials, camera ID, stream status, and assigned incubator. Confirm whether one or two physical boards are currently connected.

- Preserve the Freenove ESP32-S3-CAM pinout and camera driver. Verify PSRAM, capture resolution, JPEG quality, frame-buffer count, and heap under simultaneous streaming/inference.

- Local MJPEG HTTP streaming is **not** automatically an internet-accessible WebRTC stream. Firebase Hosting and Supabase Storage are not live-video relays.

- For secure remote CCTV-style video, document the chosen gateway/relay architecture, ingress authentication, transcoding where needed (MJPEG to H.264), HTTPS/WSS, ICE/TURN where needed, and viewer authorization. Do not promise live video without required gateway hardware/server or a tested direct-WebRTC implementation.

- Never expose raw camera endpoints or router ports publicly without an explicit security design. Use short-lived viewer authorization and avoid embedding unprotected stream URLs in public pages.

- If video is unavailable, keep sensor monitoring, controls, chick inference, and alerts functioning. Measure FPS, latency, memory, temperature, bandwidth, and inference timing; do not invent benchmarks.

## 15. Edge AI / FOMO Chick Detection

- Inspect actual deployed model, labels, input dimensions, preprocessing (RGB/grayscale, crop/resize), confidence thresholds, and memory usage before modifying inference.

- Run inference locally on the S3-CAM when feasible, independent of browser viewer activity. Never allow a blocking cloud upload to interrupt inference or the main controller's safety logic.

- Treat training metrics and field performance separately. Evaluate precision, recall, false positives from eggshells/hands, and missed small/blurry chicks using held-out incubator-camera footage.

- Validate hatch events over time and persist an event ID; avoid claiming a detected chick is newly hatched without temporal/batch context. Do not equate confidence score with measured precision.

- Label generated/synthetic images clearly in training provenance; avoid leaking test images into training.

## 16. Hardware Safety, Verification, and Completion

- Confirm real board pin labels and wiring before assigning GPIOs. In particular, do not assume a buzzer pin is free because of a header position; check relay assignments and the active board pinout.

- Confirm heater type, supply rating, fuse placement, wire gauge, power and ground paths, and measured current before electrical recommendations. A fuse does not fix an overloaded or overheating supply.

- Preserve watchdogs, thermal limits, sensor-fault behavior, and safe outputs. Test cloud disconnects, reboot, bad sensor data, stale commands, and recovery without actuating hardware unless authorized.

- For each task report: files inspected, skills actually read, files changed, expected behavior, checks run/results, unverified risks, and whether any device/cloud deployment occurred.

- When requirements conflict, ask a targeted question rather than silently rewriting working firmware.

## 17. Post-Login Notification Modal

- Goal: after a **successful** ESP32 dashboard login, show a lightweight, accessible notification enrollment modal on the local SPIFFS dashboard. Never show it on a failed login or before session validation.
- Use existing `data/js/login.js`, `data/js/authSession.js`, dashboard entry points and the firmware session route; inspect their actual behavior before editing. Preserve local monitoring, controls and UI performance budgets.
- Modal content: purpose of chick-detection alerts, **Enable Notifications** action, dismiss/close action, clear permission/registration states, and a way to retry later. Respect user dismissal and avoid an intrusive modal on every page navigation.
- The local dashboard commonly runs at `http://192.168.4.1`; **do not request Web Push permission there** or inside a cross-origin iframe. From an explicit tap, open the top-level HTTPS page `https://hatchai-8d34c.web.app` for enrollment and notification permission. The local modal is not itself the secure notification origin.
- Do not send the ESP32 username/password, local session token, FCM token, or enrollment secret in a URL. A local HTTP login is **not** automatically cloud authentication.
- Handle Android AP-only connectivity: if the phone cannot reach the internet while connected to the ESP32 AP, explain that cloud enrollment requires internet access; do not claim the modal can bypass that limitation.
- Use HTML/CSS/vanilla JS; preserve keyboard focus, Escape/close behavior, accessible labels, small screens, and reduced motion. Apply `ui-ux-pro-max` and `esp32-ui-limiter` together for local SPIFFS UI.
- Do not claim a notification subscription is active until the HTTPS site has received successful registration confirmation from the Worker.

## 18. Firebase Web Push, Cloudflare Worker and D1

### Selected notification architecture

- Firebase project and Hosting origin: `hatchai-8d34c`, `https://hatchai-8d34c.web.app`.
- Firebase Messaging Web SDK and `/firebase-messaging-sw.js` run on the HTTPS Hosting origin. Preserve the existing VAPID public key and Firebase project configuration.
- Cloudflare Worker handles registration, unregistration and authenticated chick-detection requests. D1 database `hatchai-devices`, binding `env.DB`, stores multiple browser FCM tokens in `push_tokens`.
- Firebase Cloud Messaging HTTP v1 delivers alerts using **server-side** service-account authorization held only in Worker secrets. Keep Firebase Spark compatibility; do not add Blaze-only Cloud Functions as a requirement.
- This is a **target architecture**, not proof of deployed functionality. Inspect current Worker code, database schema and Hosting code before asserting any endpoint works.

### Enrollment and registration

1. The ESP32 dashboard authenticates the shared account locally and offers the post-login modal.
2. The user explicitly opens the HTTPS enrollment page and chooses to enable notifications.
3. Cloudflare must independently verify **authorized enrollment** before accepting a private subscriber. Local ESP32 session state, browser permission, CORS, and Turnstile alone do not prove authorization. Prefer a short-lived pairing/enrollment credential verified server-side; inspect the actual ESP32 auth design and propose the smallest safe bridge before coding.
4. On user action, request notification permission; register the service worker and call `getToken()` with the existing VAPID key.
5. POST the FCM token to `/register` with verified enrollment authorization. The Worker validates request size, token shape, authorization, abuse controls and origin, then upserts into D1 without deleting other subscribers.
6. Only display **registered/enabled** after a successful Worker response. On later visits, refresh and reconcile tokens when permission is already granted and valid enrollment authorization is available.
7. On disable, revoke **only the requesting browser's** registration using a secure registration-specific credential, then delete its local FCM token when appropriate. Handle partial failures explicitly.

### API and security contract

- `GET /health`: database health and active subscription count only; no token enumeration.
- `POST /register`: authorized, validated, idempotent D1 upsert; rate limiting and Turnstile verification as appropriate.
- `POST /unregister`: authenticated per-device revocation; never let one subscriber delete arbitrary tokens.
- `POST /chick-detected`: ESP32-S3 device authentication, bounded payload, event ID, replay/deduplication protection, then FCM fan-out to enabled subscriptions.
- Allow only the configured Hosting origin for browser CORS and handle OPTIONS preflight; **CORS is not authentication**. Validate Turnstile tokens on the server and check hostname/action; rotate any previously exposed secret before production use.
- Use parameterized D1 SQL, secret-managed credentials, bounded retries/batches, and sanitized logs. Never expose Firebase service-account keys or device secrets in `public/`, firmware repositories, screenshots or browser storage.
- FCM API acceptance is not proof the Android notification was displayed. Test foreground, background, closed-browser (where supported), permission denied, offline, token refresh, duplicates and revocation.
- One shared HATCHAI account can authorize **many independent Android browser subscriptions**. Do not require one Firebase Auth account per phone or overwrite tokens with a single shared record.

## 19. Notification Skill Routing and Delivery Order

Discover these exact paths before notification work. Read the actual `SKILL.md` files and follow their instructions only if present:

| Skill | Path | Use when |
| --- | --- | --- |
| `hatchai-notification-modal` | `.agents/skills/hatchai-notification-modal/SKILL.md` | Post-login modal and HTTPS enrollment handoff |
| `firebase-web-push` | `.agents/skills/firebase-web-push/SKILL.md` | Browser permission, service worker, FCM tokens and notifications |
| `cloudflare-worker-d1` | `.agents/skills/cloudflare-worker-d1/SKILL.md` | Worker APIs, D1 registrations and FCM HTTP v1 fan-out |
| `hatchai-device-enrollment-security` | `.agents/skills/hatchai-device-enrollment-security/SKILL.md` | Shared-account authorization, pairing and token revocation |
| `esp32-chick-event-delivery` | `.agents/skills/esp32-chick-event-delivery/SKILL.md` | Authenticated, nonblocking S3 chick-event submission |
| `notification-e2e-testing` | `.agents/skills/notification-e2e-testing/SKILL.md` | Multi-phone enrollment, security and delivery verification |

### Implementation sequence

1. Inspect `git status --short`, `AGENTS.md`, current code and installed skills. Do not overwrite user changes.
2. Confirm the actual ESP32 login/session mechanism and agree on a **secure** cloud enrollment bridge. Do not silently assume a local HTTP session authenticates cloud requests.
3. Implement and locally verify the post-login modal and HTTPS handoff, without changing incubator controls.
4. Implement authorized Worker `/register` and `/unregister` with D1 persistence, then update `public/push.js` to use them; keep the existing service worker behavior compatible.
5. Implement authenticated `/chick-detected` and FCM HTTP v1 broadcasting; deduplicate event IDs and handle invalid tokens.
6. Integrate ESP32-S3 event delivery with bounded, nonblocking networking; keep local detection and heater/motor safety independent of cloud availability.
7. Verify registration and notifications on at least two Android phones, including foreground/background and denied/offline cases. Report observed results, not assumptions.
8. Ask for explicit approval before any Worker/Hosting deployment, D1 migration, SPIFFS upload, firmware flash, secret rotation or physical hardware action.

### Completion report

For each notification task, report the files and skills inspected, exact files changed, tests actually run, what remains unverified, and whether any cloud or device deployment occurred. Do not report planned features as implemented.
