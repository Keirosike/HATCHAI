# HatchAI Agent Instructions


## Agent Skill Loading Rules

Before implementing any task:

1. Read this AGENTS.md completely.
2. Discover available skills under `.agents/skills/`.
3. Read the SKILL.md files relevant to the task.
4. Follow the selected skills during implementation.
5. Apply esp32-ui-limiter whenever ui-ux-pro-max is used.
6. Apply esp32-embedded-development for firmware changes.
7. Apply debugging-code-review for debugging and reviews.
8. Prioritize hardware safety and ESP32 compatibility.
9. Verify changes before reporting completion.

Do not claim a skill was loaded unless its file
was actually found and read.

## 1. Project Overview

HatchAI is an ESP32 chicken incubator built with PlatformIO and the Arduino framework. It reads an SHT40 temperature/humidity sensor, controls two heating bulbs, a fan, and an egg-turning relay, logs valid measurements to SD, displays status on a 20x4 LCD, serves a local web dashboard from SPIFFS, and runs embedded Random Forest inference.

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
| `src/Sht40Sensor.cpp`, `src/OutputDevice.cpp` | CRC-checked I2C measurements and relay GPIO/polarity abstraction |
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
& "C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe" run -e esp32dev

# Build the SPIFFS image without uploading
& "C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe" run -e esp32dev --target buildfs

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
& "C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe" run -e esp32dev --target upload

# Upload dashboard assets to SPIFFS
& "C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe" run -e esp32dev --target uploadfs
```

Changes under `data/` require `uploadfs` to reach the device. Firmware changes require `upload`. When both change, both uploads are needed. Refresh the browser after deployment if it shows old assets. Do not hand-edit generated `.pio/` outputs.

## 4. Development Rules

- Follow existing C++ and plain JavaScript conventions, helpers, and module boundaries. Keep changes focused on the task and preserve unrelated user work, including untracked files.
- Centralize hardware pins, I2C addresses, and configurable timing/target defaults in `include/Config.h`; avoid duplicating hardware configuration in drivers or frontend code.
- Keep the firmware and browser API contract aligned. Inspect both `src/HatchWebServer.cpp` and `data/js/espApi.js` when changing request methods, arguments, response fields, or error behavior.
- The browser sends URL-encoded POST bodies. Control parsing uses form arguments; prediction additionally supports a simple JSON-body parser. Do not assume all endpoints accept arbitrary JSON bodies.
- Preserve units, field names, relay-state semantics, CSV compatibility, and storage keys unless the task requires a migration. Reuse the JSON helpers and shared browser utilities where appropriate.
- Avoid unrelated refactors, dependencies, generated-model edits, formatting churn, or commits unless required by the task or requested.
- Never invent implemented features, successful checks, hardware observations, training provenance, or model accuracy. Update relevant documentation when a task intentionally changes behavior.


## 5. UI/UX Development and ESP32 Resource Limits

For all frontend development, dashboard redesigns,
and UI improvements:

- Use `ui-ux-pro-max` for design recommendations.
- Apply `esp32-ui-limiter` to enforce ESP32 compatibility.
- Prioritize device reliability over visual complexity.
- Use HTML5, CSS3, and vanilla JavaScript.
- Avoid React, Vue, Angular, and heavy UI frameworks.
- Preserve existing HatchAI API endpoints and behavior.
- Do not introduce unnecessary frontend dependencies.

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

- Prefer system fonts and lightweight SVG icons.
- Avoid excessive blur, shadows, and animations.
- Avoid large images, videos, and 3D visualizations.
- Use CSS Grid and Flexbox for responsive layouts.
- Update only changed dashboard values.
- Avoid overlapping API requests.
- Use existing Canvas-based chart rendering.
- Keep HTTP responses small and bounded.
- Do not increase API polling frequency unnecessarily.
- Do not introduce UI features without backend support.

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


## 6. Hardware and Control Constraints

Configured relays are active-low: LOW is ON, HIGH is OFF. Bulb 1 uses GPIO 26, bulb 2 GPIO 25, fan GPIO 14, and turner GPIO 27. Shared I2C uses SDA 21/SCL 22; SHT40 is `0x44`, DS3231 `0x68`, and LCD `0x27`. SD SPI pins are CS 5, SCK 18, MISO 19, MOSI 23. Verify current values in `Config.h` before hardware-related changes.

- Defaults are automatic mode, 37.8 C temperature, 58% humidity, 120-minute turns, 8-second pulses, 5-second sampling, and 2-second LCD refresh.
- Automatic heating switches both bulbs ON below target minus 0.3 C and OFF above target plus 0.3 C. Inside the band, including boundaries, previous states are retained.
- The fan is ON above temperature target plus 0.5 C OR humidity target plus 5 percentage points; otherwise OFF. There is no configured actuator to raise humidity.
- The SHT40 driver validates both CRCs, retries up to three times, clamps humidity to 0-100%, and rejects temperatures outside -40 to 125 C. Do not record invalid samples as valid history or CSV readings.
- After failed sampling, the controller retains a previous valid reading while its age is at most 20 seconds. On a subsequent failed sample after that limit, it becomes invalid. In automatic mode, invalid readings turn both bulbs and the fan OFF; scheduled turning is evaluated separately.
- Manual mode bypasses automatic temperature/humidity output decisions. A sustained manual turner ON state differs from an eight-second timed turn request. At pulse completion, manual mode restores its configured turner state, which may remain ON.
- Automatic turns are scheduled from boot or the last turn during that boot. Counters persist, but scheduling uptime does not. No motor movement feedback or incubation-day cutoff is implemented. The UI disables manual turning in automatic mode, but `/api/turn` does not enforce that restriction.
- Preserve control behavior unless the task explicitly changes it. Do not silently change pins, relay polarity, timing, thresholds, failure handling, or manual-mode semantics. Explain intentional changes and verify the affected branches.
- Do not upload firmware, upload SPIFFS, or actuate connected hardware without user authorization for that operation. A general request to edit or build code does not authorize deployment or physical relay commands.

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

## 9. Known Implementation Limits

- Calibration offsets/notes are saved in browser settings but are not applied to sensor measurements or sent to firmware control.
- `data/log.html` contains example entries and placeholder filtering; it does not fetch SD logs. No log retrieval or CSV download endpoint exists.
- Control, turn, account, and Wi-Fi handlers do not enforce authenticated sessions. Session start checks credentials only when a password is nonempty; another token using the same username can replace a session. The login page is not a complete API access-control boundary.
- Account passwords are stored as strings in Preferences and browser localStorage; HTTP is unencrypted and CORS permits any origin. Do not imply stronger protections than the implementation provides.
- Wi-Fi connection attempts block the main execution path and can delay control updates. Build success does not establish runtime timing guarantees.
- Three active batch slot cards are a UI presentation, not evidence of physical capacity or independently controlled environments. Training accuracy and physical hatch success remain unverified.

Treat these as confirmed limitations to consider when implementing related tasks. Do not expand an unrelated task into fixing them without a task-specific reason. See [System Details](docs/SYSTEM_DETAILS.md) for further context.

## 10. Testing and Completion

- For documentation-only edits, check source accuracy, referenced paths, and whitespace; firmware builds and hardware access are unnecessary.
- For firmware changes, build the `esp32dev` environment. Exercise affected logic through suitable existing or focused tests where practical; `test/` currently has no project tests. Prioritize hysteresis boundaries, invalid/stale readings, mode transitions, turn timing, and persistence when those behaviors change.
- For web changes, syntax-check affected JavaScript and build SPIFFS. Verify affected browser behavior and layout when relevant. For API changes, check both request encoding and response handling, including failure states. Keep any physical commands within user-authorized scope.
- For model changes, verify feature order, used inputs, representative day boundaries, sensor rejection, rounding, and date paths. Inference checks alone do not establish predictive accuracy.
- Run checks proportional to the change. If a tool, dependency, browser, or board is unavailable, state the exact verification gap; do not report a skipped check as passed.
- Finish with the changed file paths, resulting behavior, checks actually performed and their results, and material remaining limitations. Clearly distinguish source inspection, compilation/packaging, browser checks, and physical hardware testing. Report whether uploads or hardware operations occurred.
