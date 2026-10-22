# HatchAI System Details

> See [automatic sync update](AUTOMATIC_SYNC.md) for current SD/clock startup, direct fan/roller controls, Both placement, day-18 cutoff and snapshot/profile migration. Older setup-button instructions below are historical.

> Current manual control, roller selection and LCD behavior: [roller control update](MANUAL_ROLLER_CONTROL.md).

> Control recovery update: see [automatic startup and DHT22 recovery](CONTROL_RECOVERY_FIX.md) for current sensor freshness, SD-independent heating, restart hold and timed-turn behavior.

This description is based on the firmware, browser code, and configuration in this project. It describes software behavior; the connected hardware, live ESP32, and model accuracy were not tested for this report.

Current safety/setup details: [Integrated Control](INTEGRATED_CONTROL.md).

## 1. Purpose and Scope

HatchAI is an ESP32-based chicken egg incubator controller with a local browser dashboard. It measures temperature and relative humidity, switches a heating bulb and a fan, operates separate Batch 1 and Batch 2 egg turners, records measurements on an SD card, shows status on a character LCD, and calculates a predicted hatch date.

The ESP32 runs the control logic and serves the web interface itself. A separate cloud server is not required by the implementation. Users reach it through its Wi-Fi access point or through a Wi-Fi network to which it has connected.

The AI component is an exported Random Forest regressor running locally on the ESP32. The application code contains no LLM integration, autonomous agent runtime, agent coordination, or online model training. AGENTS.md, knowledge.md, and SKILL.md are not loaded by the firmware or dashboard.

## 2. Software Stack

| Layer | Implementation |
| --- | --- |
| Microcontroller target | ESP32 Dev Module, PlatformIO board `esp32dev` |
| Firmware | C++ using the Arduino framework |
| PlatformIO platform | `espressif32` |
| Serial console | 115200 baud |
| HTTP service | Arduino `WebServer`, port 80 |
| Wi-Fi and discovery | ESP32 WiFi and ESPmDNS |
| Peripheral buses | Wire/I2C and SPI |
| Persistent key-value data | ESP32 Preferences |
| Web asset storage | SPIFFS |
| Measurement storage | SD card CSV |
| Frontend | HTML, CSS, plain JavaScript |
| Browser storage | localStorage and sessionStorage |
| Trend plotting | JavaScript drawing on an HTML canvas |
| Prediction | Exported `Eloquent::ML::Port::RandomForestRegressor` |

`platformio.ini` declares Adafruit DHT sensor library 1.4.7, which also depends on Adafruit Unified Sensor. The DHT22 wrapper, DS3231, and LCD communication code is implemented in this repository.

## 3. Hardware Configuration

All values below come from `include/Config.h`; they are configured assignments, not confirmation of physical wiring.

| Device or signal | Configuration |
| --- | --- |
| DHT22 temperature/humidity sensor | DATA on GPIO 4 |
| DS3231 real-time clock | I2C address `0x68` |
| 20-column, 4-row LCD | I2C address `0x27` |
| Shared I2C SDA | GPIO 21 |
| Shared I2C SCL | GPIO 22 |
| Heating bulb relay (IN2) | GPIO 27 |
| Fan relay (IN1) | GPIO 14 |
| Upper egg-turning relay (IN3) | GPIO 26 |
| Lower egg-turning relay (IN4) | GPIO 25 |
| Relay polarity | Active-low: LOW means ON, HIGH means OFF |
| SD card chip select | GPIO 5 |
| SD card SCK | GPIO 18 |
| SD card MISO | GPIO 19 |
| SD card MOSI | GPIO 23 |

The code controls relay signals. Relay contact ratings, bulb wattage, motor specifications, power supplies, enclosure design, and physical egg capacity cannot be established from these files. There is no configured humidifier, water pump, second environmental sensor, motor position sensor, or hatch detection sensor.

## 4. Default Settings and Timing

| Setting | Default |
| --- | --- |
| Mode / targets | Automatic / 37.5°C / 55% RH |
| Sampling / stale timeout / recovery | 2 seconds / 6.5 seconds / three stable valid samples |
| Heater control / minimum OFF | Target +/-0.3 C hysteresis / 5 seconds |
| Fan | Continuously ON, including faults |
| Turner duration / interval | 120 seconds / 120 minutes, independently configurable |
| Motor gap / lockdown | 1 second / selected cutoff, at most 17 complete days after each assigned start |
| LCD / browser polling | 2 seconds / at least 5 seconds |
| Task watchdog | 8 seconds, full-loop servicing |
| Session timeout / heartbeat | 90 seconds / 30 seconds |

Defaults are commissioning settings, not physically validated performance.

## 5. Startup and Runtime

Main setup initializes active-low relays OFF and circulation fan ON through
the controller, then mounts SPIFFS without auto-format and starts networking/HTTP.
I2C transactions have a 25 ms timeout. The controller loads its checked NVS
profile and existing metrics, starts RTC/logger/LCD/DHT22 and the task watchdog.

Each loop advances deferred Wi-Fi, control, timers and HTTP, then feeds the
watchdog and yields briefly. SD/SPI is owned by a separate worker task; DHT,
LCD, NVS and HTTP operations still have latency. Physical timing tests remain
required. See [SD Recovery](SD_RECOVERY.md) for the current recovery state machine.

## 6. Environmental Measurement

The DHT22 remains on GPIO4 with the existing Adafruit checksum validation.
One frame is sampled every five seconds after a two-second startup allowance.
Non-finite values, temperature outside -40..80°C or RH outside 0..100% are invalid.
A brief failed frame retains the previous valid measurement until its 20-second expiry.
Recovery requires three stable valid measurements. Invalid samples are not logged.

The persisted ±2°C temperature offset is applied before safety/history/logging
and prediction input. Thermostat control and protection use unfiltered
calibrated temperature. Humidity offset/notes remain browser-only.

## 7. Automatic and Manual Control

Both modes enforce sensor, storage, watchdog, reset and temperature safety.
The fan runs in automatic mode and during heating/sensor/thermal faults; safe manual OFF is supported. A relay thermostat maintains the user target (30–37.8°C):
ON below target minus 0.3°C, OFF above target plus 0.3°C, hold state in between.
Manual heating requests still obey protected relay timing.
Above 38.0°C heating holds until at/below 37.5°C. High warning starts at 38.5°C
and a critical 39.0°C latch stops heating/turning and persists through restart.
Acknowledgment requires stable valid cool readings. A valid ordinary brownout
recovery may resume heating after RTC/snapshot/sensor validation. Watchdog/panic,
recreated flash journal and persistent critical holds still need acknowledgment.
Uncertain motor positions require separate verification. Low warnings allow boot warm-up.

There are no scheduled heat windows or PID duty pulses. The minimum OFF time
is five seconds; thermostat OFF and safety OFF are immediate. Startup, changed
targets/modes and recovery start from OFF. See [thermostat control](THERMOSTAT_CONTROL.md).

Targets, calibration and motor timing persist. Mode restores from the verified
checkpoint; manual heater ON is never replayed after restart.

## 8. Egg Turning

Each physical roller is explicitly assigned a browser batch record in Control.
The device stores its ID, start date, active state and last reservation.
Schedules default to 120 seconds every two hours; durations 1–600 seconds and
independent interval choices remain configurable after calibration. There is
one active motor at a time with a one-second gap. Legacy continuous switches
become bounded timed requests. Manual starts obey the same safety/RTC/age checks.

NVS intents and verified SD PENDING/IN_PROGRESS checkpoints precede relay ON.
An interrupted transaction holds all automatic motion until the affected position
is checked. Timed completion is recorded after OFF and checkpointed before the
intent clears. Overdue history is not replayed.
Each batch stops turning at its chosen cutoff, no later than the start of day 18 (17 complete days after its stored start).
The form now stores start time and duration; legacy date-only starts mean local midnight. Changed bindings/dates require
re-enabling; paused/completed/deleted bound records disable their turning.
Failed synchronization is shown as unconfirmed. Assigned records persist on SD;
missing active records can import into free browser slots after verified recovery.
Browser-only history and conflicting owned records are retained.

Existing `hatchai-turn` and `hatchai-turn2` counters remain. They count commands,
not measured roller movement. Calibrate travel and add limit protection where
overtravel is possible. No motion/position feedback has been implemented.

## 9. AI Prediction: Actual Model Behavior

The model is embedded in `include/hatchai_random_forest_esp32_final.h`. It contains five decision trees and returns their average. The firmware rounds a positive result to the nearest whole day and interprets it as days remaining.

The firmware supplies these inputs in this order:

```text
x[0] = current temperature in C
x[1] = current relative humidity in percent
x[2] = current turner relay state: 1 or 0
x[3] = incubation day
```

**The exported trees currently branch only on `x[3]`.** No tree references `x[0]`, `x[1]`, or `x[2]`. Therefore, at a fixed incubation day, changing temperature, humidity, or turner state does not change this exported model's numerical output. Valid sensor readings are still required by the firmware before prediction is allowed.

For a batch, the browser calculates incubation day from its start date and the current date, then sends `batchId` and `incubationDay` to `/api/predict`. The firmware rejects days below 1 and clamps model input to days 1-21. If the RTC is available, it adds predicted days remaining to the current RTC date. Otherwise the browser can calculate a fallback date.

The general `/api/data` prediction and LCD use the restored start timestamp of
the first active physical batch. Bound `/api/predict` requests use the same RTC
elapsed-time rule. Invalid RTC/recovery means unknown; unbound browser drafts
retain their explicitly marked advisory date path. A reboot cannot create Day 1.

The repository provides no training dataset, training script, accuracy report, validation split, or error metrics for assessing this model. Prediction is advisory; no code confirms an actual hatch or changes the relay control policy based on the predicted hatch date.

## 10. Clock and LCD

DS3231 reads are validated and cached. Lost-power, malformed, stopped or
discontinuous time disables turning; no compiler-time or uptime fallback is
used for scheduling. Lost/invalid RTC time repairs automatically from a logged-in browser.
The LCD shows temperature/RH on line 1, Upper batch on line 2, Lower batch on
line 3 and an estimate on line 4. Two distinct batches alternate estimates every
six seconds; one batch has one estimate. Alarms/holds take priority on line 4.

## 11. Storage and Logging

| Data | Location and persistence |
| --- | --- |
| Current sensor reading and manual ON requests | ESP32 RAM; never blindly replayed |
| Control targets/calibration, timing, bound batches, reservations and arm/critical state | Preferences `hatchai-ctrl` |
| Recent chart readings | ESP32 RAM ring buffer; reset on restart |
| Turning counters | Preferences `hatchai-turn` and `hatchai-turn2` |
| Saved Wi-Fi SSID/password | Preferences `hatchai-wifi` |
| Device account username/password | Preferences `hatchai` |
| Measurement CSV | SD card `/hatchai.csv` |
| Assigned batch dates/times/configuration/phase and transactions | SD `/HATCHAI/batch_state_a.json` and `batch_state_b.json` |
| Journal serials, uncertainty, phase/duration mirrors and sequence reservation | Preferences `hatchai-rec` |
| HTML, CSS, JS, images, fonts | ESP32 SPIFFS |
| Batch records | Browser localStorage `hatchai_batches` |
| Browser account and password copies | localStorage `hatchaiAccount`, `hatchaiPassword` |
| Calibration form values | localStorage `hatchaiSettings` |
| Browser session record | localStorage `hatchaiActiveSession` |
| Tab client identifier | sessionStorage `hatchaiClientId` |
| Server session token and timeout | ESP32 RAM |

Browser history belongs to its origin. The two assigned physical batch records
now persist on SD; missing active records can import into available browser
slots after verified recovery. Owned/conflicting records and unassigned browser
history are preserved. This is not an unlimited device-wide batch database.

The worker logs valid RTC-stamped samples every ten seconds (configurable):

```text
timestamp,temperature_c,humidity_percent,mode,bulb1,fan,turner,target_temperature_c,target_humidity_percent,turn_interval_minutes,total_turns,turns_today,last_turn_timestamp,actual_turn_interval_minutes,turner2,turn_interval2_minutes,total_turns2,turns_today2,last_turn2_timestamp,actual_turn_interval2_minutes
```

Measurements with unavailable RTC time are not assigned fabricated timestamps.
Events may use `0` for unknown time. Incompatible headers are archived before
starting a new file. CSVs rotate at 256 KiB with three retained archives. New
temperature, humidity, turn, system and recovery logs live under `/HATCHAI`.
CSV history is distinct from validated A/B recovery snapshots; relay states in
a row are diagnostic observations, never commands to replay after restart.

Chart history holds 96 valid samples. At two-second sampling, this represents approximately 3.2 minutes of recent data. The `hour`, `day`, `week`, and `month` JSON groups contain up to 12, 24, 32, and 48 recent points, respectively. These names do not represent actual hour/day/week/month archives; the API does not reconstruct historical charts from the SD CSV.

## 12. Browser Pages and Batch Management

| Page | Implemented purpose |
| --- | --- |
| `index.html` | Login and session start |
| `dashboard.html` | Live readings, output status, component status, active batch, prediction, and chart |
| `control.html` | Automatic/manual mode, relay commands, targets, interval, and timed turn request |
| `batch.html` | Create, inspect, edit, delete, and select browser-local chicken batch records |
| `settings.html` | Account fields, calibration form storage, Wi-Fi management, and logout |
| `log.html` | Static example log page with placeholder filtering |

The log page does not fetch SD records. Its Apply Filters action displays a placeholder alert; there is no CSV download or log retrieval endpoint in the current server.

Batch records include ID, unique label, generated name, chicken type, egg count, laid date, start date, target temperature/humidity text, status, notes, and selection state. Labels are limited to 30 characters and allow letters, digits, spaces, underscores, and hyphens; duplicate comparison is case-insensitive.

Supported statuses are Active, Completed, Paused, and Failed. Only Active records are selectable for dashboard prediction. The Batch page displays two active slot cards and rejects creating or activating a third batch while both slots are in use. Historical/non-active records remain unrestricted; existing records are retained, including older lists with more than two active records. The UI does not provide separate environmental control for each slot.

Batch target values are record metadata. Selecting a batch does not send its targets to `/api/control`. Saving a pause/completion for a bound record requests that its assigned turner stop; device acknowledgment is required. The shared heating/fan loop continues. There is one shared environmental control loop for the incubator.

The store starts empty and does not recreate records after all are deleted. It removes unchanged legacy sample records by comparing their full sample metadata; user-created and edited records remain. Calendar-based 21-day progress and fallback dates are calculated in the browser, separately from model prediction.

Settings saves temperature offset on the ESP32 and applies it to readings and safety decisions. Humidity offset and notes stay browser-only.

## 13. Networking

On boot, the network manager starts the setup AP and queues saved Wi-Fi credentials, or configured credentials when none are saved. Each attempt has a 20-second deadline serviced by the main loop. A failed boot attempt can fall back to distinct configured credentials; saved-network recovery retries wait at least 30 seconds between attempts. The shipped configuration contains `YOUR_WIFI_SSID` and `YOUR_WIFI_PASSWORD`, so those placeholders are not used for a configured connection. The setup AP remains available during station connection and failure states.

```text
Access point SSID: HatchAI-ESP32
Access point password: hatchai123
mDNS hostname: hatchai.local
HTTP port: 80
```

Use the actual IP printed to the serial console; the firmware obtains it from the network interface. mDNS availability depends on the client/network. Connecting to a Wi-Fi router does not itself provide internet-facing remote access.

Settings automatically scans nearby networks and offers Refresh networks. Scan responses are bounded to 20 distinct SSIDs, retaining the strongest duplicates. Named network rows show signal strength, lock icons, and connected/saved labels. There is no manual SSID/password section. Tapping open or saved networks connects directly; saved passwords are read internally from NVS after checking that the saved SSID matches the request. New secured networks open a password dialog with Connect, Cancel, and show/hide. Unnamed networks are omitted. Tapping the connected network opens information. Requests acknowledge immediately, then polling displays Connecting, Connected, Incorrect password or connection failed, or Network unavailable. Previously saved credentials are retained after a failed attempt. Connection details are available through the information button. Refreshes wait at least five seconds after the last operation and pause while hidden.

Forgetting a network clears saved Preferences, acknowledges the request, then disconnects and clears the station-driver configuration after a 750 ms grace period in the main loop. It cancels pending connection/retry work and keeps or starts the setup AP; reconnect to `HatchAI-ESP32` and open `192.168.4.1`. The browser requires a successful `forgotten: true` acknowledgement before clearing its choices. Lost responses are shown as unverified without automatically repeating the command. Browser preferences store only SSID and controller address; legacy browser Wi-Fi passwords are removed on load. The driver uses RAM storage while application credentials use Preferences/NVS. NVS/flash encryption is not configured, and HTTP remains unencrypted.

Dashboard polling retains unchanged values, prediction text, selector options, and canvas content. Data and prediction requests are serialized, with a five-second wait after completion. Failed data requests retain previous readings with an offline label; no sample readings replace them.

## 14. HTTP API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/data` | Current readings, outputs, predictions, component status, history, and settings |
| POST | `/api/control` | Apply mode, relay states, temperature/humidity targets, and turn interval |
| POST | `/api/turn` | Start a timed turning cycle |
| POST | `/api/safety` | Session-token-protected arming, alarm, clock and batch updates |
| POST | `/api/predict` | Calculate prediction for a supplied batch ID/incubation day |
| GET | `/api/account` | Return stored account username |
| POST | `/api/account` | Save account username and optional password |
| POST | `/api/session/start` | Start or refresh a server session |
| POST | `/api/session/keepalive` | Refresh a matching session token |
| POST | `/api/session/end` | End a matching session |
| GET | `/api/session/status` | Report whether a server session is active |
| GET | `/api/wifi/scan` or `/scan-wifi` | Start or retrieve a Wi-Fi scan |
| GET | `/api/wifi/status` | Read live connection, saved SSID, signal, IP, and setup AP details |
| POST | `/api/wifi/connect` or `/connect-wifi` | Connect and save successful Wi-Fi credentials |
| POST | `/api/wifi/forget` | Remove saved Wi-Fi credentials and disconnect |

The browser API client uses URL-encoded POST bodies. Control arguments include `autoMode`, `bulbOn`, `fanOn`, `turnerOn`, `turner2On`, `targetTemperature`, `targetHumidity`, `turnIntervalMinutes`, `turnInterval2Minutes`, `turnDurationSeconds`, `turnDuration2Seconds`, and `temperatureOffset`. Legacy `bulb2On` and `auxiliaryOn` arguments are ignored. Turning accepts `motor=1|2|both`, optional `durationSeconds=1..600`, and `action=start|stop`. Prediction accepts `batchId` and `incubationDay`, with a simple JSON-body fallback parser in addition to form arguments.

The status JSON includes temperature/humidity, heating/motor text, RTC-derived
incubation days/date, component status, turn metrics, history and `control`.
It adds recovery/commit/error status and per-roller restored batch/transaction
fields. Existing field names remain; unavailable RTC days are unknown.
The `control` object reports `heaterControl: "thermostat_hysteresis"`,
`heaterOnBelow` and `heaterOffAbove`. Legacy `heaterDutyPercent` is null and
`heaterCycleSeconds` is zero; no duty schedule runs.
It also reports `relayPins`, per-motor manual requests, pulse state/remaining
seconds, duration limits, independent intervals, and second-motor metrics.
The control page requires compatible pin assignments and safety version 2 before
enabling commands. The model still uses motor 1 as its turner feature, and the
LCD/dashboard motor indicator reports whether either motor is ON.

Static routes serve files from SPIFFS, with `/` mapped to `/index.html`. Responses include cache-control headers; CORS allows any origin, and OPTIONS handlers exist for supported browser requests.

`/api/safety` requires an active matching session token. Login now rejects blank
passwords; account writes require the same token. Legacy control/turn/Wi-Fi
access limitations below remain. Browser API clients share one request queue.

## 15. Login and Access-Control Limitations

The default account is username `admin`, password `1234`. Device credentials are stored as strings in Preferences. The browser also stores a password copy in localStorage. Server sessions expire after 90 seconds without refresh; the browser attempts a heartbeat every 30 seconds.

Login verifies a supplied password. Safety/recovery acknowledgments and account
changes require an active matching token; unauthenticated browser-credential
replacement after a 401 is no longer supported. Main control/turn/Wi-Fi handlers
retain their legacy session limitations. A valid login using the same username
can replace that account's previous token.

Consequently, the login page is not a complete access-control boundary for the device API. HTTP traffic is unencrypted, and CORS is unrestricted. These are concrete properties of the current implementation, relevant when deciding who can reach the ESP32 network.

## 16. Project File Guide

| File or folder | Responsibility |
| --- | --- |
| `src/main.cpp` | Object construction, setup, and main loop |
| `include/Config.h` | Pins, addresses, defaults, and intervals |
| `include/IncubatorTypes.h` | Reading, control settings, and turning metric structures |
| `src/IncubatorController.cpp` | Sensor scheduling, control, turning, predictions, and status JSON |
| `src/Dht22Sensor.cpp` | Environmental sensor communication and validation |
| `src/OutputDevice.cpp` | Relay state and GPIO polarity |
| `src/RealTimeClock.cpp` | DS3231 clock communication |
| `src/DataLogger.cpp` | SD initialization, CSV header, and rows |
| `src/LcdStatusDisplay.cpp` | LCD initialization and four status lines |
| `src/ReadingHistory.cpp` | RAM ring buffer and history JSON |
| `src/NetworkManager.cpp` | Wi-Fi connection, AP, scan, credentials, and mDNS |
| `src/HatchWebServer.cpp` | HTTP APIs, sessions, account access, and static files |
| `include/hatchai_random_forest_esp32_final.h` | Embedded five-tree prediction model |
| `data/js/espApi.js` | Browser requests to the controller APIs |
| `data/js/batchStore.js` | Batch persistence, validation, dates, and selection |
| `data/js/authSession.js` | Browser session storage and heartbeats |
| `data/js/dashboard.js` | Live dashboard updates and canvas chart |
| `data/js/control.js` | Control UI state and API writes |
| `data/js/settings.js`, `data/js/wifi.js` | Account/settings UI and Wi-Fi management |
| `data/css/`, `data/a/` | Styles, images, icons, and fonts |
| `docs/CODE_DOCUMENTATION.md` | Existing module and maintenance documentation |
| `test/README` | PlatformIO test-folder guidance; focused compiler/Node/browser checks are documented there |

## 17. Build and Upload

Run these commands from the project root. The executable path below is the path documented for this machine.

```powershell
# Build firmware
& "C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe" run

# Build the web filesystem image
& "C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe" run --target buildfs

# Upload firmware to the connected board
& "C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe" run --target upload

# Upload web assets to SPIFFS
& "C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe" run --target uploadfs
```

Firmware changes require a firmware upload. Changes under `data/` require a filesystem upload. Updating both requires both uploads. Local compilation/packaging and focused tests are documented in INTEGRATED_CONTROL.md and test/README. Uploads and physical operations require separate authorization.

## 18. Implications for Agent Documentation

For an AI coding assistant working on this repository, AGENTS.md can describe development rules, commands, module boundaries, and verification expectations. A knowledge.md can describe the system facts in this document. A SKILL.md can define a repeatable maintenance or debugging workflow for the agent platform that consumes it.

Those files would guide development tooling. Adding them alone would not add agent AI to the ESP32, change prediction accuracy, synchronize batches, or alter incubator behavior. The supported agent-file format depends on the external agent tool, which is not specified by this project.
