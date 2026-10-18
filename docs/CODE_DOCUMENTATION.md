# HatchAI Code Documentation

This document explains the structure and behavior of the HatchAI ESP32 codebase.
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
    adafruit/DHT sensor library@1.4.7
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
| DHT22 temperature/humidity sensor | DATA on GPIO 4 |
| Bulb 1 relay | GPIO 26 |
| Bulb 2 relay | GPIO 25 |
| Fan relay | GPIO 14 |
| Egg turner relay | GPIO 27 |
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
| Target temperature | 37.8 deg C |
| Target humidity | 58 percent |
| Egg turn interval | 120 minutes |
| DHT22 read interval | 5000 ms |
| Sensor stale timeout | 20000 ms |
| Turner pulse duration | 8000 ms |
| LCD refresh interval | 2000 ms |

## 3. Firmware Startup Flow

The firmware starts in `src/main.cpp`.

Global objects are created for the major hardware and service modules:

- `Dht22Sensor environmentSensor`
- `OutputDevice bulb1Relay`
- `OutputDevice bulb2Relay`
- `OutputDevice fanRelay`
- `OutputDevice turnerRelay`
- `RealTimeClock realTimeClock`
- `DataLogger dataLogger`
- `LcdStatusDisplay lcdDisplay`
- `IncubatorController incubator`
- `NetworkManager network`
- `HatchWebServer webServer`

During `setup()`:

1. Serial starts at `115200`.
2. I2C starts using configured SDA/SCL pins.
3. SPIFFS mounts for serving web files.
4. `incubator.begin()` initializes RTC, logger, LCD, sensor, and relays.
5. `network.begin()` connects to Wi-Fi or starts access point mode.
6. `webServer.begin()` registers HTTP routes and starts the server.

During `loop()`:

1. The controller receives the current network status.
2. The controller updates sensor readings, relay outputs, turner logic, and LCD.
3. The web server handles browser/API requests.
4. The loop yields with a short `delay(2)`.

## 4. Main Controller

Primary files:

- `include/IncubatorController.h`
- `src/IncubatorController.cpp`

`IncubatorController` coordinates the incubator behavior. It owns the current
control settings, latest sensor reading, turn metrics, reading history, and
status text.

Important responsibilities:

- Read the DHT22 at the configured interval.
- Keep the last valid sensor reading briefly when a DHT22 read fails.
- Apply automatic relay control rules.
- Apply manual relay control settings.
- Start scheduled egg turns.
- Stop egg turner pulses after the configured pulse duration.
- Record and persist egg turning metrics.
- Log valid readings to SD card.
- Refresh the LCD display.
- Build JSON responses for the web dashboard.
- Run the Random Forest prediction model.

### Sensor Read Handling

`readSensorIfDue()` reads the DHT22 only when the configured interval has
elapsed. If the read is valid:

- `_currentReading` is updated.
- The reading is added to `ReadingHistory`.
- The reading is written to SD card.
- `_lastAnomaly` is set to `None`.

If the read fails but the previous valid reading is not older than
`SensorStaleAfterMs`, the controller keeps the previous valid reading and stores
the new error in `_lastAnomaly`. This prevents the UI and controls from flicking
to "No reading" because of a single I2C or CRC failure.

If the previous reading is too old, the current reading becomes invalid.

### Automatic Output Rules

Automatic mode is handled by `updateAutomaticOutputs()`.

If the current sensor reading is invalid:

- Bulb 1 turns off.
- Bulb 2 turns off.
- Fan turns off.

If the reading is valid:

- Bulbs turn on when temperature is below target by more than 0.3 deg C.
- Bulbs turn off when temperature is above target by more than 0.3 deg C.
- Fan turns on when temperature is above target by more than 0.5 deg C.
- Fan also turns on when humidity is above target by more than 5 percent.

### Egg Turner Logic

Egg turning can happen in two ways:

- Automatically, based on `turnIntervalMinutes`.
- Manually, through the web API endpoint `/api/turn`.

When a turn starts:

- The turn event is recorded.
- Total turns and turns today are incremented.
- Last turn timestamp is updated.
- Actual interval is calculated if there was a previous turn.
- The turner relay turns on.
- `_turnerStopMs` is set so the pulse stops after `TurnerPulseMs`.

Turn metrics are persisted in ESP32 Preferences under the namespace
`hatchai-turn`.

## 5. DHT22 Sensor Driver

Primary files:

- `include/Dht22Sensor.h`
- `src/Dht22Sensor.cpp`

The driver uses Adafruit's DHT sensor library, pinned to version 1.4.7 in
`platformio.ini`, with DATA on `HatchConfig::Dht22Pin` (GPIO 4). PlatformIO also
resolves the library's Adafruit Unified Sensor dependency.

`begin()` initializes the data pin; it does not claim sensor detection. Reads
during the first two seconds return an invalid warm-up result without blocking.
`Dht22Sensor::read()` performs one measurement per scheduled five-second sample.
There are no immediate retries: DHT22 reads require at least two seconds apart.
Temperature and humidity use the same checksum-validated frame cached by the library.

`Dht22Sensor::read()`:

1. Rejects reads before initialization or while warming up.
2. Reads temperature in Celsius and humidity in percent through the library.
3. Rejects non-finite values from timeout/checksum failures.
4. Rejects temperatures outside -40 to 80 C and humidity outside 0 to 100 percent.
5. Updates `_latest` only for valid readings.

Common error strings include:

- `DHT22 not initialized`
- `DHT22 warming up`
- `DHT22 read failed (timeout or checksum error)`
- `DHT22 reading is outside expected range`

Connect VCC to 3.3 V, GND to GND, and DATA to GPIO 4. Use a 10 kOhm
pull-up from DATA to 3.3 V unless the module already supplies one. A bare four-pin
DHT22 leaves pin 3 unused. The RTC and LCD remain on I2C GPIO 21/22.

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

Primary files:

- `include/RealTimeClock.h`
- `src/RealTimeClock.cpp`

The `RealTimeClock` module talks to a DS3231 over I2C. It provides:

- Hardware detection.
- Lost-power detection.
- Current date/time.
- Full timestamp strings.
- Short time strings.

If the RTC lost power, the code sets the RTC to the firmware build time. This
prevents completely invalid timestamps, but the time should still be checked if
the RTC battery was removed or drained.

## 8. SD Card Logger

Primary files:

- `include/DataLogger.h`
- `src/DataLogger.cpp`

The SD logger writes valid sensor readings to `/hatchai.csv`.

CSV columns:

```text
timestamp,temperature_c,humidity_percent,mode,bulb1,bulb2,fan,turner,
target_temperature_c,target_humidity_percent,turn_interval_minutes,
total_turns,turns_today,last_turn_timestamp,actual_turn_interval_minutes
```

Invalid sensor readings are not logged. This avoids recording fake or misleading
data when the DHT22 fails a read.

If an existing log file has an incompatible header, the code renames it to a
`.legacy-<millis>` backup and starts a new CSV with the current header.

## 9. LCD Display

Primary files:

- `include/LcdStatusDisplay.h`
- `src/LcdStatusDisplay.cpp`

The LCD module directly drives a 20x4 I2C character LCD.

On boot it shows:

```text
HatchAI Incubator
HatchAI booting
Sensor starting
Prediction ready
```

During normal operation it shows:

- Temperature.
- Humidity.
- Egg turner status.
- Hatch prediction/date text.

If there is no valid reading, temperature and humidity display placeholder
values.

## 10. Reading History

Primary files:

- `include/ReadingHistory.h`
- `src/ReadingHistory.cpp`

`ReadingHistory` stores up to 96 recent valid readings in memory. It builds JSON
for the dashboard chart using multiple display windows:

- `hour`: up to 12 points.
- `day`: up to 24 points.
- `week`: up to 32 points.
- `month`: up to 48 points.

The labels are relative to the current uptime, such as `now`, `-30s`, `-5m`, or
`-2h`.

## 11. Network Manager

Primary files:

- `include/NetworkManager.h`
- `src/NetworkManager.cpp`

`NetworkManager` handles Wi-Fi and access point behavior.

Startup behavior:

1. Try saved Wi-Fi credentials from Preferences namespace `hatchai-wifi`.
2. If saved credentials work, connect as a station.
3. If no saved credentials exist and hardcoded Wi-Fi is configured, try it.
4. If station connection fails, start the ESP32 access point.

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
| POST | `/api/predict` | Run batch-specific hatch prediction |
| GET | `/api/account` | Read stored account username |
| POST | `/api/account` | Save account username/password |
| POST | `/api/session/start` | Start a browser session |
| POST | `/api/session/keepalive` | Refresh active session |
| POST | `/api/session/end` | End active session |
| GET | `/api/session/status` | Check whether a session is active |
| GET | `/scan-wifi` | Scan Wi-Fi networks |
| GET | `/api/wifi/scan` | Scan Wi-Fi networks |
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

Primary file:

- `data/js/espApi.js`

`HatchEspApiClient` wraps calls to the ESP32 API:

- `getData()`
- `updateControl(payload)`
- `turnEggsNow()`
- `predictBatch(payload)`

All requests use `cache: "no-store"` to reduce stale API results.

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

The dashboard polls `/api/data` every few seconds. It then:

1. Updates live sensor and relay text.
2. Updates chart data from the history JSON.
3. Loads batches from browser localStorage.
4. Filters dashboard choices to Active batches only.
5. Sends the selected batch incubation day to `/api/predict`.
6. Displays the resulting hatch prediction.

Completed and Failed batches are not shown in the dashboard batch selector.

## 17. Control Page

Primary files:

- `data/control.html`
- `data/js/control.js`
- `data/css/control.css`

The Control page handles:

- Automatic/manual mode switching.
- Bulb control.
- Fan control.
- Turner control.
- Target temperature.
- Target humidity.
- Egg turn interval.
- Manual "Turn Eggs Now" command.

In automatic mode, manual relay controls are locked because the firmware decides
the output states.

In manual mode, the page sends relay state choices to `/api/control`.

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

The current UI supports three active incubator batch slots. Each slot card shows
one Active batch. Clicking an Active slot selects it for the dashboard. The View
button opens the batch in read-only mode.

Batch statuses:

- `Active`: can appear in the dashboard selector and active slot cards.
- `Completed`: kept in records, not selectable on dashboard.
- `Paused`: kept in records, not selectable on dashboard by current filtering.
- `Failed`: kept in records, not selectable on dashboard.

The batch table still lists all records for review, editing, and deletion.

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
| Firmware settings during runtime | ESP32 RAM |
| Turn metrics | ESP32 Preferences namespace `hatchai-turn` |
| Wi-Fi credentials | ESP32 Preferences namespace `hatchai-wifi` |
| Account credentials | ESP32 Preferences namespace `hatchai` |
| Sensor log CSV | SD card `/hatchai.csv` |
| Web UI files | SPIFFS |
| Batch records | Browser localStorage key `hatchai_batches` |
| Browser session | Browser localStorage key `hatchaiActiveSession` |

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
cd C:\Users\LENOVO\Desktop\hatchai-esp32final
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

If DHT22 readings show intermittent failures:

- The firmware retries at the next five-second sample, without rapid retries.
- The controller keeps the last valid reading for up to 20 seconds.
- Check DATA wiring to GPIO 4, sensor power, common ground, and the DATA pull-up.
- Check `lastAnomaly` in the dashboard for the most recent DHT22 error string.

If predictions are unavailable:

- Confirm there is a valid DHT22 reading.
- Confirm the selected batch has a valid start date.
- Confirm the selected batch is Active.
- Confirm `/api/predict` is available from the ESP32.

If SD logging is not working:

- Check the dashboard SD status.
- Confirm the SD card is inserted and wired to the configured SPI pins.
- Confirm `/hatchai.csv` can be created.

## 24. High-Level Flow

```text
DHT22 sensor (GPIO 4)
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
- Do not log invalid DHT22 readings as real sensor history.
- Run `uploadfs` for every `data/` UI change.
- Remember that batch records are browser-local unless a future feature moves
  them into ESP32 storage.
- Completed and Failed batches are intentionally excluded from dashboard batch
  selection.
