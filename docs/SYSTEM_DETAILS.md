# HatchAI System Details

This description is based on the firmware, browser code, and configuration in this project. It describes software behavior; the connected hardware, live ESP32, and model accuracy were not tested for this report.

## 1. Purpose and Scope

HatchAI is an ESP32-based chicken egg incubator controller with a local browser dashboard. It measures temperature and relative humidity, switches two heating bulbs and a fan, operates an egg-turning motor through a relay, records measurements on an SD card, shows status on a character LCD, and calculates a predicted hatch date.

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

`platformio.ini` does not declare extra `lib_deps`. The SHT40, DS3231, and LCD communication code is implemented in this repository.

## 3. Hardware Configuration

All values below come from `include/Config.h`; they are configured assignments, not confirmation of physical wiring.

| Device or signal | Configuration |
| --- | --- |
| SHT40 temperature/humidity sensor | I2C address `0x44` |
| DS3231 real-time clock | I2C address `0x68` |
| 20-column, 4-row LCD | I2C address `0x27` |
| Shared I2C SDA | GPIO 21 |
| Shared I2C SCL | GPIO 22 |
| Heating bulb 1 relay | GPIO 26 |
| Heating bulb 2 relay | GPIO 25 |
| Fan relay | GPIO 14 |
| Egg-turning relay | GPIO 27 |
| Relay polarity | Active-low: LOW means ON, HIGH means OFF |
| SD card chip select | GPIO 5 |
| SD card SCK | GPIO 18 |
| SD card MISO | GPIO 19 |
| SD card MOSI | GPIO 23 |

The code controls relay signals. Relay contact ratings, bulb wattage, motor specifications, power supplies, enclosure design, and physical egg capacity cannot be established from these files. There is no configured humidifier, water pump, second environmental sensor, motor position sensor, or hatch detection sensor.

## 4. Default Settings and Timing

| Setting | Default |
| --- | --- |
| Control mode | Automatic |
| Temperature target | 37.8 C |
| Humidity target | 58% relative humidity |
| Egg-turn interval | 120 minutes |
| Timed egg-turn pulse | 8 seconds |
| Sensor sampling interval | 5 seconds |
| Maximum retained reading age after failed samples | 20 seconds |
| LCD refresh interval | 2 seconds |
| Dashboard polling interval | 5 seconds |
| Control-page polling interval | 5 seconds |
| Session timeout | 90 seconds |
| Browser session heartbeat | 30 seconds |
| Main loop delay | 2 milliseconds |

These are project defaults, not experimentally verified incubation recommendations.

## 5. Startup and Runtime

`src/main.cpp` constructs the sensor, four relay objects, clock, logger, LCD, controller, network manager, and HTTP server.

Startup proceeds as follows:

1. Start the serial console and shared I2C bus.
2. Mount SPIFFS using `SPIFFS.begin(true)`, which enables formatting on a mount failure.
3. Initialize the clock, load turning counters, initialize SD logging and LCD, probe the sensor, and initialize the relay outputs to OFF.
4. Attempt Wi-Fi connection or start the access point.
5. Register API routes and start the HTTP server.

Each main-loop iteration updates the controller's network status, checks the sensor schedule, updates outputs and turn timing, refreshes the LCD when due, handles HTTP requests, and delays briefly.

Most recurring work uses elapsed `millis()` checks. Some operations block: sensor measurement/retries, SD access, and Wi-Fi connection attempts. A connection request can wait up to 20 seconds in the HTTP handler; controller updates pause while that handler is running.

## 6. Environmental Measurement

`src/Sht40Sensor.cpp` sends the SHT40 high-precision command `0xFD`, waits 10 milliseconds, and requests six bytes. It checks a CRC for both temperature and humidity, using initial CRC `0xFF` and polynomial `0x31`.

Conversion formulas are:

```text
temperature_c = -45 + 175 * raw_temperature / 65535
humidity_percent = -6 + 125 * raw_humidity / 65535
```

Humidity is clamped to 0-100%. The sensor driver rejects temperatures outside -40 to 125 C. Prediction applies a narrower temperature acceptance range of -40 to 80 C.

Each scheduled sample can attempt up to three reads, with 20 milliseconds between retries. A valid sample updates the current reading, RAM history, and SD log. A failed sample sets `lastAnomaly`; the controller retains the previous valid sample while its age is at most 20 seconds. Once it is too old, the reading becomes invalid at a subsequent failed sampling attempt.

Errors distinguish a missing sensor, incomplete response, temperature CRC failure, humidity CRC failure, and an out-of-range reading. Invalid measurements are not added to history or the CSV.

## 7. Automatic and Manual Control

### Automatic temperature control

Both bulbs switch together using hysteresis:

| Condition | Action |
| --- | --- |
| Temperature below target minus 0.3 C | Both bulbs ON |
| Temperature above target plus 0.3 C | Both bulbs OFF |
| Temperature inside that band, including its boundaries | Keep the previous bulb states |

With the default target, the thresholds are below 37.5 C and above 38.1 C. This is threshold control, not PID control and not AI-controlled heating.

The fan is ON when temperature is above target plus 0.5 C OR humidity is above target plus 5 percentage points. At the defaults, these thresholds are above 38.3 C or above 63% humidity. Otherwise the fan is OFF; it is not continuously enabled for circulation by this logic.

The humidity target is used for fan decisions and displayed status. There is no actuator that actively raises humidity.

If the current environmental reading is invalid in automatic mode, both bulbs and the fan turn OFF. Scheduled egg turning is evaluated separately and can continue without a valid environmental reading.

### Manual control

The browser can switch to manual mode and request bulb, fan, and turner states. The Control page presents one shared bulb switch; the firmware API also supports a separate second-bulb argument.

Manual mode skips the automatic temperature/humidity output rules. Its relay states do not automatically turn off because a sensor reading becomes invalid. Switching the turner ON manually is a sustained relay command; it is different from requesting a timed turn pulse.

Control targets and mode are held in ESP32 RAM. Applying settings does not save them to Preferences, so a restart restores the firmware defaults.

## 8. Egg Turning

Automatic mode starts a turn when the configured interval has elapsed since boot or the last turn during the current boot. A new timed cycle is ignored while a timed cycle is already active.

Starting a cycle records the event, increments total turns and turns today, records a timestamp, calculates the actual interval when there was a previous cycle during this boot, turns the relay ON, and schedules the pulse to finish after eight seconds.

When the pulse finishes, automatic mode turns the relay OFF. Manual mode restores the configured manual turner state, which can leave it ON.

Turning counters are saved in Preferences namespace `hatchai-turn`, with keys `total`, `today`, `interval`, `last`, and `date`. The daily count resets when the RTC date changes, or according to an uptime-day fallback if the clock is unavailable.

Counters survive a restart, but the scheduling timer and previous-turn uptime do not. Counts record issued commands; there is no feedback confirming physical motor rotation or egg movement. There is no incubation-day cutoff for automatic turning in the controller. The browser disables its manual turn button while automatic mode is active, but the `/api/turn` handler itself does not enforce that restriction.

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

The general `/api/data` prediction and LCD use an incubation day derived from ESP32 uptime. They do not use the selected browser batch's persisted start date, and uptime resets at reboot. The selected batch's dashboard prediction uses the separate batch prediction request.

The repository provides no training dataset, training script, accuracy report, validation split, or error metrics for assessing this model. Prediction is advisory; no code confirms an actual hatch or changes the relay control policy based on the predicted hatch date.

## 10. Clock and LCD

The DS3231 module supplies dates and times for CSV timestamps, daily turn counts, and predicted hatch dates. If its lost-power flag is set during initialization, the firmware sets it to the firmware build date/time. No NTP synchronization or clock-setting API is implemented.

The LCD displays temperature, humidity, egg-turner ON/OFF state, and hatch prediction/date text. Each line is padded or truncated to 20 characters. Missing readings use placeholders. Missing LCD hardware does not prevent the controller from running.

## 11. Storage and Logging

| Data | Location and persistence |
| --- | --- |
| Current sensor reading and control settings | ESP32 RAM; reset on restart |
| Recent chart readings | ESP32 RAM ring buffer; reset on restart |
| Turning counters | Preferences `hatchai-turn` |
| Saved Wi-Fi SSID/password | Preferences `hatchai-wifi` |
| Device account username/password | Preferences `hatchai` |
| Measurement CSV | SD card `/hatchai.csv` |
| HTML, CSS, JS, images, fonts | ESP32 SPIFFS |
| Batch records | Browser localStorage `hatchai_batches` |
| Browser account and password copies | localStorage `hatchaiAccount`, `hatchaiPassword` |
| Calibration form values | localStorage `hatchaiSettings` |
| Browser session record | localStorage `hatchaiActiveSession` |
| Tab client identifier | sessionStorage `hatchaiClientId` |
| Server session token and timeout | ESP32 RAM |

Batch records belong to a browser origin. Clearing browser data, changing browser/device, or accessing the ESP32 through a different hostname/IP can expose a different batch list. There is no batch database or cross-device batch synchronization on the ESP32.

The logger appends one CSV row for each valid scheduled sample, normally every five seconds:

```text
timestamp,temperature_c,humidity_percent,mode,bulb1,bulb2,fan,turner,target_temperature_c,target_humidity_percent,turn_interval_minutes,total_turns,turns_today,last_turn_timestamp,actual_turn_interval_minutes
```

Without an available RTC, timestamps use uptime. An incompatible existing CSV header causes the file to be renamed with a `.legacy-<millis>` suffix before a new file is created. There is no automatic size-based rotation. Relay states in a row are read before that loop's subsequent automatic output update.

Chart history holds 96 valid samples. At five-second sampling, this represents approximately eight minutes of recent data. The `hour`, `day`, `week`, and `month` JSON groups contain up to 12, 24, 32, and 48 recent points, respectively. These names do not represent actual hour/day/week/month archives; the API does not reconstruct historical charts from the SD CSV.

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

Supported statuses are Active, Completed, Paused, and Failed. Only Active records are selectable for dashboard prediction. The Batch page displays three active slot cards; this is a UI presentation and does not prove a three-batch hardware capacity or a hard limit on stored records.

Batch target values are record metadata. Selecting a batch does not send its targets to `/api/control`. Pausing or completing a browser record does not stop physical outputs. There is one shared environmental control loop for the incubator.

The store supplies example batches when no usable saved records exist. Calendar-based 21-day progress and fallback dates are also calculated in the browser; these are separate from the model prediction.

Calibration offsets and notes are saved and restored by the Settings page. They are not sent to the controller or applied to measured readings by the current implementation.

## 13. Networking

On boot, the network manager tries saved Wi-Fi credentials for up to 15 seconds. If unsuccessful, it can try configured credentials. The shipped configuration contains `YOUR_WIFI_SSID` and `YOUR_WIFI_PASSWORD`, so those placeholders are not used for an actual configured connection. The firmware starts an access point when startup connection attempts fail or are not configured.

```text
Access point SSID: HatchAI-ESP32
Access point password: hatchai123
mDNS hostname: hatchai.local
HTTP port: 80
```

Use the actual IP printed to the serial console; the firmware obtains it from the network interface. mDNS availability depends on the client/network. Connecting to a Wi-Fi router does not itself provide internet-facing remote access.

The dashboard supports nearby-network scanning, connecting, saving credentials after success, and forgetting credentials. Scans return SSID, signal strength, and whether encryption is present. A user-initiated connection can wait up to 20 seconds. Forgetting credentials disconnects the station; that handler does not explicitly start the access point again.

## 14. HTTP API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/data` | Current readings, outputs, predictions, component status, history, and settings |
| POST | `/api/control` | Apply mode, relay states, temperature/humidity targets, and turn interval |
| POST | `/api/turn` | Start a timed turning cycle |
| POST | `/api/predict` | Calculate prediction for a supplied batch ID/incubation day |
| GET | `/api/account` | Return stored account username |
| POST | `/api/account` | Save account username and optional password |
| POST | `/api/session/start` | Start or refresh a server session |
| POST | `/api/session/keepalive` | Refresh a matching session token |
| POST | `/api/session/end` | End a matching session |
| GET | `/api/session/status` | Report whether a server session is active |
| GET | `/api/wifi/scan` or `/scan-wifi` | Start or retrieve a Wi-Fi scan |
| POST | `/api/wifi/connect` or `/connect-wifi` | Connect and save successful Wi-Fi credentials |
| POST | `/api/wifi/forget` | Remove saved Wi-Fi credentials and disconnect |

The browser API client uses URL-encoded POST bodies. Control arguments include `autoMode`, `bulbOn`, `bulb2On` (with `auxiliaryOn` as an alias), `fanOn`, `turnerOn`, `targetTemperature`, `targetHumidity`, and `turnIntervalMinutes`. Prediction accepts `batchId` and `incubationDay`, with a simple JSON-body fallback parser in addition to form arguments.

The status JSON includes temperature/humidity, heating and motor text, predicted days/date, uptime incubation day, RTC/SD/LCD/sensor/network status, IP address, turn metrics, last anomaly, history groups, and a nested `control` object.

Static routes serve files from SPIFFS, with `/` mapped to `/index.html`. Responses include cache-control headers; CORS allows any origin, and OPTIONS handlers exist for supported browser requests.

## 15. Login and Access-Control Limitations

The default account is username `admin`, password `1234`. Device credentials are stored as strings in Preferences. The browser also stores a password copy in localStorage. Server sessions expire after 90 seconds without refresh; the browser attempts a heartbeat every 30 seconds.

The session system provides browser coordination, but the main control, account, and Wi-Fi handlers do not check an authenticated session before acting. The session-start handler only verifies credentials when a nonempty password is supplied. Its conflict rule also permits a different token using the same username to replace the session. Login fallback can synchronize browser credentials to the account endpoint before retrying.

Consequently, the login page is not a complete access-control boundary for the device API. HTTP traffic is unencrypted, and CORS is unrestricted. These are concrete properties of the current implementation, relevant when deciding who can reach the ESP32 network.

## 16. Project File Guide

| File or folder | Responsibility |
| --- | --- |
| `src/main.cpp` | Object construction, setup, and main loop |
| `include/Config.h` | Pins, addresses, defaults, and intervals |
| `include/IncubatorTypes.h` | Reading, control settings, and turning metric structures |
| `src/IncubatorController.cpp` | Sensor scheduling, control, turning, predictions, and status JSON |
| `src/Sht40Sensor.cpp` | Environmental sensor communication and validation |
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
| `test/README` | PlatformIO test-folder guidance; no project test suite is present there |

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

Firmware changes require a firmware upload. Changes under `data/` require a filesystem upload. Updating both requires both uploads. These commands were not executed for this documentation task, and no board state was changed.

## 18. Implications for Agent Documentation

For an AI coding assistant working on this repository, AGENTS.md can describe development rules, commands, module boundaries, and verification expectations. A knowledge.md can describe the system facts in this document. A SKILL.md can define a repeatable maintenance or debugging workflow for the agent platform that consumes it.

Those files would guide development tooling. Adding them alone would not add agent AI to the ESP32, change prediction accuracy, synchronize batches, or alter incubator behavior. The supported agent-file format depends on the external agent tool, which is not specified by this project.
