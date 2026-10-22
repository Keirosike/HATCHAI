# HatchAI deployment

This package contains the current thermostat firmware, required headers,
SPIFFS assets, PlatformIO configuration and a SHA-256 source manifest.
It excludes development tools, tests, backups, old exports, PID examples,
preview screenshots and synthetic SD recovery records.

Extract the HatchAI folder and run commands from that folder. The validated
environment is esp32dev, Espressif32 7.0.1 / Arduino-ESP32 2.0.17. Required
libraries are declared in platformio.ini.

Build firmware and web filesystem separately:

```powershell
platformio run -e esp32dev
platformio run -e esp32dev --target buildfs
```

These commands do not upload. When deployment to the connected board is
authorized and its hardware is ready, both uploads are required:

```powershell
platformio run -e esp32dev --target upload
platformio run -e esp32dev --target uploadfs
```

Refresh the browser after updating SPIFFS. Do not copy synthetic batch-state
files onto the SD card. Existing batch dates, NVS settings and SD logs are
not cleared by this packaging/cleanup operation.

The bulb uses thermostat hysteresis: at the 37.5 C default, ON below 37.2 C,
OFF above 37.8 C, otherwise retain state. Cold demand uses a conservative EMA
while raw hot readings act immediately. Automatic restart after switching OFF
waits at least thirty seconds; startup/manual requests use five seconds. The
sensor qualification and thermal cutoffs remain. The fan runs in automatic mode, during heating and during sensor/thermal faults. Safe manual fan OFF is supported. Relay pins
are fan 14, bulb 27, lower roller 25 and upper roller 26, all active LOW.
DHT22 DATA is GPIO4; RTC/LCD use SDA21/SCL22; SD uses CS5/SCK18/MISO19/MOSI23.

Create/edit a batch with Lower, Upper or Both rollers and its turning end. The
cutoff defaults to the start of chicken day 18 (start + 17 days); an earlier
end is supported. Both rollers run sequentially. Saving an active batch enables
its schedule automatically. Control offers direct requests and shows saved labels.

SD checkpoints, card retries, valid state recovery after power return and lost-RTC
browser time synchronization are automatic. Use a correct local clock/timezone on
the logged-in browser if the DS3231 lost time. A valid RTC supplies time offline.
Corrupt recovery files are preserved; critical alarms and interrupted roller
positions still require inspection. Settings > Component status reports actual
communication and commanded relay states, without claiming load feedback.
Manual heat ON is not replayed on restart. The LCD pairs each batch label/estimate.

Local build and mock-test results do not verify relay wiring, sensor accuracy,
motor travel, physical temperature stability or SD reliability. This package
has not been uploaded or physically validated.

The latest package is HatchAI-corrected-rollers-120s-deployment.zip. Raw JavaScript is about
141.9 KiB and total assets 365.1 KiB, above the recommended 80/350 KiB budgets.
The SPIFFS image builds successfully; no new frontend library is required.

This version makes HTTP roller Run/ON an explicit timed manual request in either
climate mode, without SD scheduling prerequisites. Sensor/temperature, position,
internal storage and assigned-batch date/cutoff checks still apply; rejections
report their actual reason. Automatic schedules continue to require verified SD.

Click batch cards to open details with Edit/Delete. Done confirms completion,
stops assigned turning after device acknowledgment and retains history. The LCD
uses line 1 for temperature/RH, line 2 Upper batch, line 3 Lower batch, and line 4
for hatch estimates. Two distinct batches alternate Est U/Est L every six seconds;
one batch, including Both rollers, has one estimate. Alarms take priority on line 4.

Control Save Settings opens a confirmation with mode, targets, roller timing and
power-return behavior. Mode is persisted when switched; confirmed targets/timings
are saved in NVS and queued for SD. A queued SD save is not a verified commit.

SD component diagnostics show the actual recovery.message and sdStatus driver
result below Detected. Detection alone does not confirm a recovery checkpoint.

For invalid recovery files, Component status offers a confirmed Rebuild recovery
from saved settings when safe. It archives invalid originals, keeps NVS original
batch dates, verifies a new checkpoint and keeps turning disabled until roller
positions are inspected/verified. A valid but time-conflicted snapshot cannot be
replaced. Check RTC time before repair. Both firmware and SPIFFS are required.

Corrected roller mapping: Upper GPIO26/IN3, Lower GPIO25/IN4. New/default runs
are 120 seconds every 120 minutes. Existing calibrated durations are retained;
set 120 in both duration fields and confirm Save Settings to update them too.
Existing installations and old-map recovery imports require a one-time inspection
and position verification for both rollers. Older snapshots are kept readable.

Latest heating/sensor/SD fix: source package `release/HatchAI-stable-heating-sd-recovery-deployment.zip`. SD reload/checkpoint completion preserves healthy live climate control. Invalid A/B copies can be archived and rebuilt automatically only from existing healthy NVS and a trusted clock; no valid snapshot is replaced. Assigned rollers remain held for position review after a rebuild. Both firmware and SPIFFS uploads are needed for the new heating details and sensor retry diagnostics. These source packages are not uploaded automatically.

Current mode policy: Automatic owns all outputs; switch to Manual before relay or roller Run/Stop requests. Position verification is no longer required: unfinished turns are skipped automatically, with the next scheduled turn delayed a full interval. No catch-up run occurs. SD recovery/logging still gates automatic schedules, and thermal/sensor/clock/cutoff/timed motor checks remain. Update firmware and SPIFFS together.

Concurrent roller update: existing lower/upper sliders can now request overlapping timed runs in Manual mode; each stops independently. Automatic due turns may overlap after their separate verified SD intents. No combined-control UI was added. Restart gaps are per relay and snapshot validation accepts both ON. Firmware plus SPIFFS (queued-status wording/cache update) must be deployed together. Physical concurrent-load behavior remains untested.
# Network startup diagnostics correction

The access point and station now share a single mDNS HTTP service registration;
station connection no longer attempts to add the existing service again. Static
GET requests use a final registered route after the API routes, preserving the
existing file streaming, MIME types, cache headers and 404 responses. Previously
WebServer logged an error before invoking the successful static-file fallback.
Actual missing paths now print a bounded `[HTTP] 404: /path` diagnostic. These
changes require firmware upload only; no dashboard layout or asset changes.
LCD I2C detection failures remain separate hardware/address diagnostics.
