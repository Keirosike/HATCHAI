# HatchAI ESP32

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
It monitors temperature and humidity with a DHT22 sensor on GPIO 4, controls a heating bulb, fan, and two egg
turning relays, logs valid readings to SD card, shows local status on a 20x4
LCD, and runs a hatch timing prediction model.

For the full code walkthrough, see:

- [Code Documentation](docs/CODE_DOCUMENTATION.md)

## DHT22 Wiring

- VCC to ESP32 3.3 V, GND to GND, and DATA to GPIO 4 (`HatchConfig::Dht22Pin`).
- Use a 10 kOhm pull-up from DATA to 3.3 V if the sensor module has no pull-up.
- On a bare four-pin DHT22, pin 3 is unused; follow the module labels for a breakout.
- The DS3231 and LCD still use I2C on GPIO 21/22. The DHT22 does not use I2C.

See [Adafruit's wiring guide](https://learn.adafruit.com/dht/connecting-to-a-dhtxx-sensor).
PlatformIO installs the configured Adafruit DHT library during the build. The firmware
allows two seconds for sensor startup and samples every five seconds. Brief
read failures retain the last valid measurement for at most 20 seconds without
refreshing its age. Three stable valid samples restore sensor readiness.


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
