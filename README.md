# HatchAI ESP32 — SHT40 version

> Current sensor: [SHT40 conversion and wiring](docs/SHT40_VERSION.md). Older DHT22 wiring instructions in historical notes do not apply to this version.

> Latest: [Automatic/Manual controls and automatic interrupted-turn recovery](docs/AUTO_MANUAL_ROLLER_UPDATE.md).

> Latest: [heating, sensor qualification and guarded SD recovery fix](docs/HEATING_SENSOR_SD_FIX.md).

> Latest: [direct roller requests, batch-card Done/details, and the four-line LCD](docs/ROLLER_BATCH_LCD_UPDATE.md).

> Latest behavior and verification: [automatic sync, component status and direct controls](docs/AUTOMATIC_SYNC.md).

> Current manual control, roller selection and LCD behavior: [roller control update](docs/MANUAL_ROLLER_CONTROL.md).

> Control recovery update: see [automatic startup and DHT22 recovery](docs/CONTROL_RECOVERY_FIX.md) for current sensor freshness, SD-independent heating, restart hold and timed-turn behavior.

The main firmware now includes [SD persistence and brownout recovery](docs/SD_RECOVERY.md):
CRC-verified A/B snapshots, RTC-based batch days, an internal motor-intent journal,
queued/rotating logs and explicit interrupted-position recovery. An empty card initializes automatically from durable device settings. Invalid existing
snapshots are preserved; no new Day 1 batch is invented. See that guide
for commissioning, the Arduino IDE export and the physical power-loss test matrix.

HatchAI is an ESP32-based smart incubator controller with a local web dashboard.
It monitors temperature and humidity with a SHT40 sensor on I2C (SDA 21 / SCL 22), controls a heating bulb, fan, and two egg
turning relays, logs valid readings to SD card, shows local status on a 20x4
LCD, and runs a hatch timing prediction model.

For the full code walkthrough, see:

- [Code Documentation](docs/CODE_DOCUMENTATION.md)

## SHT40 wiring

| SHT40 breakout | ESP32 |
| --- | --- |
| VCC / VIN | 3.3 V |
| GND | GND |
| SDA | GPIO 21 |
| SCL | GPIO 22 |

The SHT40 shares I2C with DS3231 and LCD. Default address is `0x44`, configurable
as `HatchConfig::Sht40Address` in `include/Config.h`; GPIO 4 is no longer used by
this sensor. Keep I2C pull-ups at 3.3 V. Use the breakout labels for pin order.
The native sensor must not receive 5 V. Do not connect SDA/SCL to 5 V pull-ups
from an LCD/RTC module; use appropriate bus level shifting if required.

The built-in Wire driver sends high-precision measurements with a bounded 10 ms
conversion wait and validates both CRC bytes. No extra sensor library is needed.
Samples remain five seconds apart; failed attempts retry after 2.1 seconds.
Two-second startup allowance, 20-second stale expiry, three stable startup frames
and all existing heater/roller protections remain. See [SHT40 version](docs/SHT40_VERSION.md).

## Deployment package

Use [deployment instructions](docs/DEPLOYMENT.md). Create a clean source ZIP with
`python scripts/package_deployment.py --output release/HatchAI-autosync-deployment.zip`;
use a new output name if the package already exists. It contains only current firmware, required
headers, SPIFFS assets, build configuration and a source hash manifest.
The local `backups/` archive preserves removed references and stale exports;
backups, development tooling, tests and synthetic SD examples are excluded.
Nothing is uploaded by packaging. Keep the tests and documentation in this
working repository for maintenance.

## Quick Build Commands

Defaults are 37.5°C and 55% RH. The main firmware now includes the safety/RTC
integration described in [Integrated Control](docs/INTEGRATED_CONTROL.md).
Automatic heating uses a relay thermostat: ON below target minus 0.3°C,
OFF above target plus 0.3°C, otherwise retain state. A five-second minimum
OFF time prevents rapid re-energizing. See [thermostat control](docs/THERMOSTAT_CONTROL.md).
The circulation fan runs in automatic mode, during heating and during faults; safe manual OFF is supported.
Heating holds above 38.0°C; 39.0°C causes a persistent critical latch.

Both turners default to 120 seconds every two hours. Each has a user-calibrated
duration (1–600 seconds) and an independent interval. Motors have independent timers and may run together,
and RTC/NVS reservations prevent repeated turns after restart. Assigned batch
dates enforce the selected turning end, no later than the start of day 18 (start + 17 days). Manual runs retain the safety
checks; continuous motor ON commands are replaced by bounded timed runs.

After an authorized firmware and SPIFFS upload, log in with a correct browser
local clock. RTC repair and SD recovery run automatically. Choose Lower, Upper or
Both on each Batch form, set its turning end and save calibrated timings. Saving
an active batch enables its schedule; verify motor travel before commissioning.
The dashboard, Wi-Fi, SD logging, LCD and existing prediction routes remain.
No upload or physical validation has been performed. Temperature stability,
power savings and hatch rate remain unmeasured.
The corrected relay layout is IN1 fan GPIO14, IN2 bulb GPIO27, IN3 Upper roller
GPIO26, and IN4 Lower roller GPIO25, all active-low. Upper/Lower were swapped
after the reported physical mismatch; wiring has not been physically tested.
Both batches share temperature and humidity control. See
[turner restoration verification](docs/TURNER_RESTORATION.md) for details.

Build firmware:

```powershell
C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe run
```

Upload firmware:

```powershell
C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe run --target upload
```

Build web filesystem image:

```powershell
C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe run --target buildfs
```

Upload dashboard and web UI files to SPIFFS:

```powershell
C:\Users\LENOVO\.platformio\penv\Scripts\platformio.exe run --target uploadfs
```

Run the commands from this project folder:

```powershell
cd C:\Users\LENOVO\Desktop\HATCHAI
```

## Deployment cleanup verification

Removed stale dist exports/screenshots, the examples PID project, legacy
main-esp32 build/editor leftovers, the empty camera folder, the unused PID
header/tests/guide and unreferenced modal/toast HTML fragments. The required
modal/toast JavaScript, CSS and page markup remain. Non-generated removed files
are preserved in the local backups ZIP; 134,703,555 bytes of regenerable caches
were discarded. The backup manifest contains file hashes and removal paths.

The active source, required headers, web assets, regression tests, development
skills and maintenance documentation are preserved. Legacy PID constants in
Config.h remain necessary for reading older recovery checkpoints.

Post-cleanup firmware and SPIFFS builds, JavaScript syntax, Node control/API
checks, Python syntax, local-header dependencies, HTML/CSS asset references and
release hash verification passed. release/HatchAI-deployment.zip contains 77
files and excludes backups, caches, Git/editor settings, tests and old examples.
No uploads, relay commands or physical hardware tests were performed.

Raw UI sizes remain above recommended budgets: JavaScript 136,738 bytes versus
80 KB, total 365,543 bytes versus 350 KB. Largest HTML is 17,212 bytes, CSS total
46,204 bytes and largest image 39,032 bytes. SPIFFS packaging passed.
