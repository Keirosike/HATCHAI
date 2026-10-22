# HatchAI Code Documentation

> Current sensor hardware: [SHT40 version](SHT40_VERSION.md). Older sensor-specific wiring instructions are historical.

> See [automatic sync update](AUTOMATIC_SYNC.md) for current SD/clock startup, direct fan/roller controls, Both placement, day-18 cutoff and snapshot/profile migration. Older setup-button instructions below are historical.

> Current manual control, roller selection and LCD behavior: [roller control update](MANUAL_ROLLER_CONTROL.md).

> Control recovery update: see [automatic startup and SHT40 recovery](CONTROL_RECOVERY_FIX.md) for current sensor freshness, SD-independent heating, restart hold and timed-turn behavior.

This document explains the structure and behavior of the HatchAI ESP32 codebase.
For the current safety profile and commissioning steps, see [Integrated Control](INTEGRATED_CONTROL.md).
It is written for maintaining, presenting, debugging, and extending the project.

## 1. Project Overview

HatchAI is a smart incubator system built on an ESP32 Dev Module. The firmware
reads incubator temperature and humidity, controls relays for heating, fan, and
egg turning, logs valid readings to an SD card, updates a local LCD, serves a
web dashboard from SPIFFS, and runs a Random Forest model for hatch timing
prediction.

The project is a PlatformIO Arduino project:

```ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
monitor_speed = 115200
board_build.filesystem = spiffs
lib_deps =
```

The source code is split into:

- `src/`: firmware implementations.
- `include/`: firmware headers and configuration.
- `data/`: web UI files uploaded to ESP32 SPIFFS.
- `platformio.ini`: PlatformIO board, framework, and filesystem settings.

## 2. Hardware Configuration

Hardware pins and default settings are defined in `include/Config.h`.

| Device | Setting |
| --- | --- |
| SHT40 temperature/humidity sensor | I2C 0x44, SDA GPIO 21 / SCL GPIO 22 |
| Heating bulb relay (IN2) | GPIO 27 |
| Fan relay (IN1) | GPIO 14 |
| Upper roller relay (IN3) | GPIO 26 |
| Lower roller relay (IN4) | GPIO 25 |
| Relay polarity | Active-low |
| I2C SDA | GPIO 21 |
| I2C SCL | GPIO 22 |
| DS3231 RTC address | `0x68` |
| LCD I2C address | `0x27` |
| LCD size | 20 columns x 4 rows |
| SD card CS | GPIO 5 |
| SD card SCK | GPIO 18 |
| SD card MISO | GPIO 19 |
| SD card MOSI | GPIO 23 |
| SD log path | `/hatchai.csv` |

Default incubation settings:

| Setting | Value |
| --- | --- |
| Target temperature | 37.5 deg C |
| Target humidity | 55 percent |
| Egg turn interval | 120 minutes |
| SHT40 read interval | 5000 ms |
| Sensor stale timeout | 6500 ms |
| Automatic turner run, each motor | 15000 ms initially; calibrated 1–600 seconds |
| Manual timed run, each motor | 1–600 seconds, initially 15 |
| LCD refresh interval | 2000 ms |

## 3. Firmware Startup Flow

The objects in `src/main.cpp` are retained: SHT40, four OutputDevices, DS3231,
logger, LCD, controller, network manager and web server. Setup configures I2C
with a 25 ms transaction timeout, then initializes the controller's relays OFF
and fan ON before peripheral/file-system/network startup. SPIFFS mounts with
`begin(false)` so a mount failure does not silently format assets.

The controller loads the checked `hatchai-ctrl` profile and existing turn
metrics, starts sensor/LCD/logger/RTC support and configures an eight-second
task watchdog. Network setup remains deferred/non-blocking.

Each loop updates network/controller state and services HTTP. The watchdog is
fed through `completeLoop()` only after the entire loop completes. The existing
short 2 ms scheduler yield remains; motor and thermostat control have no blocking waits.

## 4. Main Controller

`IncubatorController` coordinates existing peripherals plus these small modules:

- `ThermalSafety.h`: sensor qualification, unfiltered thresholds and alarm hysteresis.
- `RelayThermostat.h`: target +/-0.3 C hysteresis, retained in-band state, minimum OFF time and safety override.
- `DeviceProfile.h`: versioned NVS profile, verified writes and fail-closed loading.
- `TurnSchedule.h` / `TurnCycle.h`: RTC age/due predicates and independent millis pulse deadlines.
- `RuntimeWatchdog.h`: ESP-IDF 4/5 task watchdog API adapters.

Brief failed samples retain the last valid measurement for at most 20 seconds,
without refreshing its timestamp or logging an invalid frame. Sensor readiness
requires three stable valid samples. Calibration is applied before control,
safety/history/logging/model input. Thermostat and safety use the unfiltered
calibrated temperature. Protection runs in both modes; see [thermostat control](THERMOSTAT_CONTROL.md).

The fan runs automatically or under a heating/sensor/thermal override; safe manual OFF is supported. Heating holds above 38.0°C until at/below 37.5°C, warns
at 38.5°C and critically latches at 39.0°C. Critical flags persist; recovery
requires deliberate acknowledgment with valid cool readings. Low warnings and
abnormal-reset holds are described in [Integrated Control](INTEGRATED_CONTROL.md).

Motor starts require an enabled schedule, valid sensor/RTC, active assigned
batch outside lockdown, working storage/watchdog and no critical/reset hold.
One motor runs at a time with a one-second gap. Its reservation is durably
saved before relay ON; counters remain in their existing namespaces.
Interrupted turns are skipped after reset, and missed history is not replayed.

Targets, calibration, intervals and durations persist. Mode defaults to auto
on reboot; manual ON requests do not persist. Legacy manual motor switches
request bounded runs. Stop cancels a selected active/queued run in either mode.

## 5. SHT40 Sensor Driver

`src/Sht40Sensor.cpp` uses the shared Wire bus at address 0x44. High-precision
command 0xFD is followed by a bounded 10 ms conversion wait and six-byte read.
Both two-byte data words must pass CRC-8 (polynomial 0x31, initial 0xFF).
The protocol helpers convert temperature and clamp RH to 0..100% as specified by
Sensirion. Temperatures outside the application's -40..80 C range are rejected.
A two-second startup allowance, five-second sample interval, 2.1-second failed-read
retry, 20-second stale expiry and three stable startup/recovery frames are retained.
Invalid samples do not enter history or CSV. The persisted temperature offset is
still applied by the controller; review it when replacing the sensor.

## 6. Output Devices

Primary files:

- `include/OutputDevice.h`
- `src/OutputDevice.cpp`

`OutputDevice` is a small relay abstraction. Each output has:

- A GPIO pin.
- An active-high or active-low setting.
- A human-readable name.
- An internal on/off state.

Because HatchAI is configured as active-low, turning a relay "on" writes the
appropriate low output level.

## 7. Real-Time Clock

`RealTimeClock` now polls DS3231 once per second with bounded I2C transactions.
It validates response lengths, BCD, calendar fields, 24-hour encoding and OSF.
Three good reads establish readiness. Frozen/backward/jumped clocks lose trust.
It caches dates for logging/API/LCD instead of reading I2C on every accessor.
No build-time fallback is written to hardware. Set actual local date/time
through Control with turning disabled. RTC failure stops turning; valid
temperature regulation may continue. `Calendar.h` supplies checked epoch math.

## 8. SD Card Logger

Primary files:

- `include/DataLogger.h`
- `src/DataLogger.cpp`

`DataLogger` queues valid RTC-stamped readings to `/hatchai.csv` every 10 seconds.
`RecoveryStorage.cpp` exclusively owns SD/SPI in a separate low-priority task.
It verifies writes/readbacks, rotates logs, and validates alternating CRC recovery
files. `ControllerRecovery.cpp`, `RecoveryState.h`, `RecoveryCodec.h` and
`RecoveryGuard.h` integrate startup, durable motor transactions, NVS intents,
RTC day/lockdown and persistent safety. See [SD Recovery](SD_RECOVERY.md) for
schemas, failure policy, Arduino export and the required physical test matrix.

CSV columns:

```text
timestamp,temperature_c,humidity_percent,mode,bulb1,fan,turner,
target_temperature_c,target_humidity_percent,turn_interval_minutes,
total_turns,turns_today,last_turn_timestamp,actual_turn_interval_minutes,
turner2,turn_interval2_minutes,total_turns2,turns_today2,last_turn2_timestamp,
actual_turn_interval2_minutes
```

Invalid sensor readings are not logged. This avoids recording fake or misleading
data when the SHT40 fails a read.

If an existing log file has an incompatible header, the code renames it to a
`.legacy-<millis>` backup and starts a new CSV with the current header.

## 9. LCD Display

The 20x4 LCD refreshes every two seconds: line 1 temperature/RH, line 2 Upper
batch label, line 3 Lower batch label, line 4 estimated hatch date. For two distinct
batches, the final line alternates Est U/Est L every six seconds using each batch's
RTC-based incubation day. A single batch, including Both rollers, has one estimate.
Alarms/holds retain priority on line 4. See [roller/LCD update](ROLLER_BATCH_LCD_UPDATE.md).
Bound `/api/predict` requests also use the device's restored start timestamp.
An invalid RTC makes the day unavailable. LCD messages are not evidence of
actual hatching or motor motion.

## 10. Reading History

`ReadingHistory` retains its 96-valid-sample RAM ring buffer. At the new
two-second sampling interval this is about 3.2 minutes. Invalid samples are
never inserted. The hour/day/week/month fields contain bounded recent subsets,
not long-term archives reconstructed from SD. The existing Canvas charts remain.

## 11. Network Manager

Primary files:

- `include/NetworkManager.h`
- `src/NetworkManager.cpp`

`NetworkManager` handles Wi-Fi and access point behavior.

Startup behavior:

1. Start the setup AP and keep it available during station connection attempts.
2. Queue saved credentials from Preferences namespace `hatchai-wifi`, if present.
3. Otherwise queue configured credentials, if they are not placeholders.
4. Advance the attempt in `network.update()` without a connection wait loop.
   A failed boot attempt can fall back to distinct configured credentials.
   Saved-network recovery retries wait at least 30 seconds between attempts.

Default access point:

```text
SSID: HatchAI-ESP32
Password: hatchai123
```

The module also starts mDNS as:

```text
http://hatchai.local
```

Wi-Fi API support includes:

- Scan nearby networks.
- Connect to a selected SSID.
- Save credentials.
- Forget saved credentials.
- Report current Wi-Fi status and IP address.

`POST /api/wifi/connect` and its alias return immediately with `accepted: true`
and `connecting: true` after validating and queuing the request. The main loop
starts the station attempt after 250 ms and checks it until connected or a
20-second deadline. It does not wait for association in the HTTP handler.
Only a successful connection writes credentials to Preferences. A failed user
attempt leaves previously saved credentials in place and awaits another user
attempt. Startup and subsequent loss of a saved connection support retries.

`GET /api/wifi/status` reports connected/saved/requested SSIDs, `connecting`,
`connectionState` (`idle`, `connecting`, `connected`, `failed`), `error`
(`network_unavailable`, `connection_failed`, or empty), `credentialsSaved`,
signal in dBm (or `null`), current IP, and setup AP name/IP. It never returns
a password. The UI polls this response at least five seconds after its previous
operation finishes and pauses while hidden. The connection-failed message
includes incorrect password as a possible cause; the status does not establish
that every failure is an authentication error.

Settings automatically scans on opening, or after an ongoing connection
finishes. Refresh networks scans again. Scan responses are capped at 20 distinct
SSIDs, retaining the strongest duplicate; the browser also deduplicates.
Secured networks have lock icons. Settings has no manual SSID/password form:
tapping an open network connects immediately, and tapping the saved network
uses its NVS password on the ESP32 (`useSaved=true`) without returning it to
the browser. A new secured network opens a password dialog with Connect,
Cancel, and show/hide. Unnamed networks are omitted. Tapping the connected
network opens its details. The information icon also expands connection
details and Forget network; browser-saved flags never establish live status.

The Wi-Fi driver uses RAM credential storage; application credentials are
persisted only in Preferences/NVS. Browser preferences contain only SSID and
controller address, and legacy browser Wi-Fi passwords are removed on load.
Preferences storage alone does not enable NVS/flash encryption; encryption at
rest is not configured by this project. HTTP and existing endpoint access-control
limitations still apply.

Forgetting clears the `hatchai-wifi` namespace, acknowledges the request, then
disconnects and erases the station driver's credentials after a 750 ms grace
period serviced by `network.update()`. It keeps or starts the setup AP. The user
must rejoin `HatchAI-ESP32` and open `192.168.4.1`. A failed or missing response
is shown as unverified; the browser does not retry a state-changing request at
another address. New browser Wi-Fi preferences contain only the chosen SSID
and controller address; passwords are sent to the ESP32 when connecting.

## 12. Web Server and API

Primary files:

- `include/HatchWebServer.h`
- `src/HatchWebServer.cpp`

`HatchWebServer` uses the Arduino `WebServer` library. It serves JSON API
responses and static web files from SPIFFS.

### API Routes

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/data` | Current sensor, relay, prediction, history, and status JSON |
| POST | `/api/control` | Update auto/manual mode, relay states, targets, and turn interval |
| POST | `/api/turn` | Trigger an egg turning pulse |
| POST | `/api/safety` | Authenticated alarm/arming/clock/batch actions |
| POST | `/api/predict` | Run batch-specific hatch prediction |
| GET | `/api/account` | Read stored account username |
| POST | `/api/account` | Save account username/password |
| POST | `/api/session/start` | Start a browser session |
| POST | `/api/session/keepalive` | Refresh active session |
| POST | `/api/session/end` | End active session |
| GET | `/api/session/status` | Check whether a session is active |
| GET | `/scan-wifi` | Scan Wi-Fi networks |
| GET | `/api/wifi/scan` | Scan Wi-Fi networks |
| GET | `/api/wifi/status` | Read connected/saved SSID, signal, IP, and setup AP details |
| POST | `/api/wifi/connect` | Connect ESP32 to Wi-Fi |
| POST | `/api/wifi/forget` | Remove saved Wi-Fi credentials |
| POST | `/connect-wifi` | Alternate Wi-Fi connect route |

The server also handles CORS headers and `OPTIONS` requests for browser
compatibility.

### Static File Serving

Unknown routes are treated as SPIFFS file requests. Examples:

- `/` maps to `/index.html`.
- `/dashboard.html` serves the dashboard.
- `/css/dashboard.css` serves dashboard CSS.
- `/js/dashboard.js` serves dashboard JavaScript.

The static handler strips query strings such as `?v=20260728b`, so cache-busted
asset URLs still map to real SPIFFS files.

The server sends no-cache headers for static files and JSON responses to reduce
stale dashboard behavior after updates.

## 13. Prediction Model

Primary file:

- `include/hatchai_random_forest_esp32_final.h`

The prediction model is an exported Random Forest regressor.

The controller creates:

```cpp
Eloquent::ML::Port::RandomForestRegressor hatchModel;
```

The model feature order is:

```text
temperature_c
humidity_percent
turner_state
incubation_day
```

`turner_state` is:

- `1.0` when the egg turner relay is on.
- `0.0` when it is off.

The model output is interpreted as predicted days remaining. The firmware rounds
the prediction to the nearest integer.

For a specific batch, the web UI sends the batch incubation day to
`/api/predict`. The ESP32 uses the current sensor reading and that incubation
day to build the feature array and calculate prediction output.

If RTC is available, the firmware also returns an ISO hatch date. If RTC is not
available, the browser can produce a fallback predicted hatch date using its
current date.

## 14. Web UI Structure

Primary folder:

- `data/`

The `data/` folder is uploaded to ESP32 SPIFFS with:

```powershell
platformio run --target uploadfs
```

Main pages:

| File | Purpose |
| --- | --- |
| `data/index.html` | Login page |
| `data/dashboard.html` | Main monitoring dashboard |
| `data/control.html` | Auto/manual control page |
| `data/batch.html` | Batch management and batch predictions |
| `data/settings.html` | Account, Wi-Fi, and configuration page |
| `data/log.html` | Log-related page |

Shared CSS:

- `data/css/base.css`
- `data/css/layout.css`
- `data/css/components.css`
- `data/css/modal.css`
- `data/css/toastNotification.css`

Page CSS:

- `data/css/dashboard.css`
- `data/css/control.css`
- `data/css/batch.css`
- `data/css/settings.css`
- `data/css/login.css`

Shared JavaScript:

- `data/js/storage.js`
- `data/js/authSession.js`
- `data/js/app.js`
- `data/js/espApi.js`
- `data/js/modal.js`
- `data/js/toastNotification.js`

Page JavaScript:

- `data/js/login.js`
- `data/js/dashboard.js`
- `data/js/control.js`
- `data/js/batch.js`
- `data/js/settings.js`
- `data/js/wifi.js`

## 15. Browser API Client

`data/js/espApi.js` retains URL-encoded request bodies and existing endpoints.
All client instances share one request queue, including Settings/Wi-Fi clients.
Timeouts begin when a queued request actually starts. Backend error messages
reach the UI. New safety actions carry the active session token in the form body.
No credentials/passwords are added to diagnostic responses.

## 16. Dashboard Page

Primary files:

- `data/dashboard.html`
- `data/js/dashboard.js`
- `data/css/dashboard.css`

The dashboard displays:

- Current temperature.
- Current humidity.
- Relay/bulb status.
- Motor/turner status.
- Hatch timing model result.
- Active batch selector.
- Batch laid date.
- Batch start date.
- Predicted hatch date.
- Batch progress.
- Temperature/humidity trend chart.
- Quick summary.
- Recent status.

The dashboard waits five seconds after completing its data/prediction requests
before polling `/api/data` again. Requests are serialized, bounded by timeouts,
and paused while hidden. It then:

1. Updates live sensor and relay text.
2. Updates chart data from the history JSON.
3. Loads batches from browser localStorage.
4. Filters dashboard choices to Active batches only.
5. Sends the selected batch incubation day to `/api/predict`.
6. Displays the resulting hatch prediction.

Unchanged text, batch options, and chart data are retained. Refreshing the same
batch does not insert generic uptime predictions or calculating placeholders;
canvas dimensions change only on actual resize. A failed data request retains
the previous readings and marks them offline instead of inserting sample data.

Completed and Failed batches are not shown in the dashboard batch selector.

## 17. Control Page

The Control page requires matching relay pins and `safety.version=2`.
It shows separate Lower and Upper controls with their saved batch labels and interval
choices. Default durations are 120 seconds and are editable for calibrated
automatic/manual travel. It shows actual outputs separately from heating requests.
The fan switch sends a manual request; automatic/heating/sensor/thermal overrides keep circulation ON when required.

The Control Summary sidebar is removed. Targets and airflow share one card,
each roller groups its duration/interval and batch label. Assignments are saved on
Batch; component status and exceptional acknowledgments are in Settings. A sticky Save bar remains reachable on
smaller screens. Heating demand and actual bulb state appear beside the bulb.

Save Settings first opens a review dialog with targets, both roller timings and
assigned records. Confirm sends the reviewed snapshot; Keep editing, Escape and
backdrop dismissal send no writes. A changed batch record/date warning explains
that turning will be disabled. Changed/deleted records are checked again before
saving. Mode/bulb switches apply only their own immediate setting and cannot
save unreviewed target/timing edits. The shared modal supports keyboard focus
containment and returns focus on cancellation.

The Batch form binds records to Lower, Upper or Both physical rollers. Control
Save applies targets and timings after review; active batch saves enable schedules.
Active batch saves enable their schedules automatically. Lost RTC time syncs from the logged-in browser; exceptional alarm/position acknowledgments are in the Settings component modal.
Start requests can queue behind another motor; Stop remains available in auto.
Polling stays at least five seconds apart, pauses while hidden and preserves
edited fields. Runtime errors/holds are explained instead of reported as success.

## 18. Batch Page

Primary files:

- `data/batch.html`
- `data/js/batch.js`
- `data/js/batchStore.js`
- `data/css/batch.css`

The Batch page manages chicken incubation batches. Batch records include:

- Batch label.
- Batch name.
- Egg type.
- Egg count.
- Egg laid date.
- Incubation start date.
- Target temperature.
- Target humidity.
- Status.
- Notes.

Batch records are stored in browser localStorage using the key:

```text
hatchai_batches
```

Important: batch records currently live in the browser, not permanently on the
ESP32. The ESP32 provides sensor data and prediction calculation, while the
browser stores the batch list and sends each batch's incubation day to the ESP32
for prediction.

The current UI supports two active incubator batch slots. Each slot card shows
one Active batch. Clicking an Active slot selects it for the dashboard. The View
button opens the batch in read-only mode.

The shared store exposes `ACTIVE_SLOT_COUNT = 2`. Creating or activating an
additional batch is rejected when both slots are occupied. Non-active records
can still be kept, and existing records are not discarded to enforce capacity.
The initial batch list is empty; deleting all records keeps it empty. Loading
removes only records matching all unchanged legacy sample metadata, preserving
user-created records and sample records the user has edited.

Batch statuses:

- `Active`: can appear in the dashboard selector and active slot cards.
- `Completed`: kept in records, not selectable on dashboard.
- `Paused`: kept in records, not selectable on dashboard by current filtering.
- `Failed`: kept in records, not selectable on dashboard.

The batch table still lists all records for review, editing, and deletion.

Bound records also send their start date/active state to the device when saved or deleted. Control explicitly maps each ID to a physical roller. Full record lists remain browser-local; failed synchronization is labeled unconfirmed.

## 19. Settings and Login

Primary files:

- `data/index.html`
- `data/js/login.js`
- `data/settings.html`
- `data/js/settings.js`
- `data/js/authSession.js`
- `data/js/wifi.js`

Default login:

```text
Username: admin
Password: 1234
```

The session system uses:

- A browser client ID.
- An active session token.
- A 90 second timeout.
- A 30 second heartbeat.

The ESP32 session endpoints can prevent another user from taking over while a
session is active.

The Settings page supports:

- User account display and credentials.
- Sensor calibration input fields.
- ESP32 Wi-Fi scanning.
- Wi-Fi connection.
- Forget saved Wi-Fi.
- Logout.

## 20. Data Storage Locations

| Data | Location |
| --- | --- |
| Current reading, mode and manual requests | ESP32 RAM |
| Targets, temperature offset, durations/intervals, bound dates/IDs, reservations, arm/critical state | Preferences `hatchai-ctrl` |
| Turn metrics | Preferences `hatchai-turn` and `hatchai-turn2` |
| Wi-Fi credentials / account | Existing `hatchai-wifi` / `hatchai` namespaces |
| Valid sensor CSV | SD `/hatchai.csv` |
| Web UI | SPIFFS |
| Full batch records | Browser `hatchai_batches` |
| Account/calibration notes/session | Existing browser storage keys |

Bound batch Save/Delete actions synchronize its date/active state; unassigned
records have no hardware effect. Failed/offline updates are marked unconfirmed.
Unassigned/history browser records remain local. Missing active assigned records
can import from verified SD/device state into free browser slots. Temperature
offsets now affect firmware; humidity offsets/notes remain browser-only.

## 21. Upload and Deployment Notes

Firmware code changes require:

```powershell
platformio run --target upload
```

Web UI changes under `data/` require:

```powershell
platformio run --target uploadfs
```

Most user interface changes will not appear on the ESP32 unless `uploadfs` is
run. If both firmware and web files changed, run both commands.

Recommended full update:

```powershell
cd C:\Users\LENOVO\Desktop\HATCHAI
C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe run --target upload
C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe run --target uploadfs
```

After uploading web files, hard refresh the browser with `Ctrl + F5`.

## 22. Build and Verification

Build firmware:

```powershell
C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe run
```

Build SPIFFS image:

```powershell
C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe run --target buildfs
```

Check JavaScript syntax:

```powershell
node --check data\js\dashboard.js
node --check data\js\batch.js
node --check data\js\batchStore.js
node --check data\js\control.js
node --check data\js\settings.js
node --check data\js\wifi.js
```

## 23. Common Debugging Notes

If the UI did not change after upload:

- Confirm you are in `C:\Users\LENOVO\Desktop\hatchai-esp32final`.
- Run `platformio run --target uploadfs`.
- Hard refresh the browser with `Ctrl + F5`.

If firmware behavior did not change:

- Confirm you uploaded firmware with `platformio run --target upload`.
- Confirm the correct project folder was used.

If SHT40 readings show intermittent failures:

- The firmware retries at the next five-second sample, without rapid retries.
- Heating stops on a detected invalid sample; recovery requires three stable valid readings.
- Check SDA21/SCL22, 3.3 V sensor power, common ground, I2C address and 3.3 V bus pull-ups.
- Check `lastAnomaly` in the dashboard for the most recent SHT40 error string.

If predictions are unavailable:

- Confirm there is a valid SHT40 reading.
- Confirm the selected batch has a valid start date.
- Confirm the selected batch is Active.
- Confirm `/api/predict` is available from the ESP32.

If SD logging is not working:

- Check the dashboard SD status.
- Confirm the SD card is inserted and wired to the configured SPI pins.
- Confirm `/hatchai.csv` can be created.

## 24. High-Level Flow

```text
SHT40 sensor (I2C 0x44, GPIO 21/22)
  -> IncubatorController
  -> ReadingHistory
  -> SD logger
  -> Automatic relay decisions
  -> Random Forest prediction
  -> LCD status display
  -> HTTP JSON API
  -> Web dashboard
```

For batch prediction:

```text
Browser batch record
  -> Calculate current incubation day
  -> POST /api/predict
  -> ESP32 Random Forest model
  -> Predicted days remaining
  -> Predicted hatch day/date
  -> Dashboard and batch UI
```

## 25. Important Maintenance Notes

- Keep hardware pin changes centralized in `include/Config.h`.
- If the model is replaced, keep the feature order aligned with
  `predictedDaysRemainingForDay()`.
- Do not log invalid SHT40 readings as real sensor history.
- Run `uploadfs` for every `data/` UI change.
- Remember that batch records are browser-local unless a future feature moves
  them into ESP32 storage.
- Completed and Failed batches are intentionally excluded from dashboard batch
  selection.
