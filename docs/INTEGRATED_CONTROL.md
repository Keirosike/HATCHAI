# Integrated temperature safety and RTC turning

Current SD/brownout recovery, schemas and hardware test procedure:
[SD Recovery](SD_RECOVERY.md). That guide supersedes the earlier NVS-only
reservation and uptime-prediction behavior described by the original integration.

This profile runs inside the main HatchAI firmware in `src/`, alongside Wi-Fi,
the dashboard, SD logging, LCD and the existing prediction model. The separate
Arduino example remains available for reference; uploading it is unnecessary
for this integration. This is locally checked commissioning firmware, not a
physically validated production system.

## First use after an authorized deployment

1. Upload **both** firmware and SPIFFS assets when deployment is authorized.
   These changes have only been built locally; no upload or relay actuation
   was performed during development.
2. Log in and open Control. Check the four relay assignments: fan GPIO14,
   heater GPIO27, lower/Batch 1 motor GPIO26, upper/Batch 2 motor GPIO25, all
   active LOW. The DHT22 stays on GPIO4; RTC/LCD use SDA21/SCL22.
3. With turning disabled, use **Set clock from this device** if RTC time is
   unavailable/wrong. Check the phone/computer time and local timezone first.
   The RTC must produce three good reads before turning can be enabled.
   Complete the SD initialization/recovery steps in SD_RECOVERY.md before
   saving new assignments when a recovery hold is shown.
4. Create or retain your browser batch records. In Control, assign the correct
   record to each physical roller and select Save Settings. Review the targets,
   both timings and batch records, then select Confirm & save. Keep editing
   cancels without sending settings. The two rollers can have
   different start dates, but share one temperature/humidity environment.
5. Calibrate motor travel under supervision and fit limit/position protection
   wherever overtravel is possible. Set each roller's run duration and interval.
   Defaults are **15 seconds every 120 minutes**. Both durations are editable
   from 1–600 whole seconds; interval choices are 30/60/120/180/240/360 minutes.
   The backend accepts whole intervals from 30–360 minutes. Durations apply to
   automatic turning and serve as the initial manual Run values.
6. Only after physical movement/protection is checked, select **Enable egg
   turning**. New installs start disabled. The enabled state survives ordinary
   restarts. A changed batch assignment/start date disables turning and needs
   deliberate re-enabling. Stop is available for an active/queued motor in
   either automatic or manual mode.

## Heating and sensor safety

| Item | Integrated behavior |
| --- | --- |
| Defaults | 37.5°C and 55% RH |
| Temperature target | User configurable, 30–37.8°C; absolute safety thresholds stay fixed |
| DHT22 schedule | One checksum-validated frame every 5 seconds, after 2-second startup |
| Invalid temperature or humidity | Retain last valid sample up to 20 seconds; no invalid history/CSV sample |
| Stale sample | Heater/motors disabled after 20 seconds without valid data |
| Recovery | Three valid readings with successive temperature steps ≤0.5°C |
| Noise filtering | Hysteresis reduces relay chatter; control/protection use unfiltered calibrated temperature |
| Above 38.0°C | Heater OFF immediately; resumes only at/below 37.5°C |
| At/above 38.5°C | High-temperature alarm; clears at/below 38.0°C |
| At/above 39.0°C | Critical latch; heater/motors OFF; persists through restart |
| Low temperature | Below 36.5°C for 10 minutes after 30-minute boot warm-up; clears at 37.0°C |
| Fan | Continuously ON, including sensor faults, cooling holds and critical alarms |
| Manual mode | Heating requests still obey relay timing and all safety interlocks |
| Brownout restart | Valid recovered state/RTC/sensors may resume heating; uncertain motor positions require verification |
| Restart hold | Clears automatically after stable sensor qualification unless a critical heat alarm remains |
| Internal control storage/watchdog fault | Heater/motors disabled; fan ON; SD-only faults hold automatic turning |

Critical/reset holds clear with **Acknowledge alarm**, only after three stable
valid readings at/below 37.5°C and with working storage/watchdog. Correct the
cause first. The LCD substitutes a short safety message for its normal turner
line during a hold; the dashboard and Control page show the reason. No buzzer
driver, airflow feedback, or redundant thermometer input was added.

Settings now applies the **temperature** calibration offset to firmware readings,
safety decisions, history, logging and prediction input. Offset range is ±2°C;
changing it pauses heating until readings are validated again. Humidity offset
and calibration notes remain browser-only and are labeled accordingly. Compare
against a calibrated reference before changing offsets: calibration cannot fix
upper/lower temperature gradients or turn a DHT22 into a precision reference.

## Mechanical heater relay thermostat

Main firmware uses normal ON/OFF control with +/-0.3 C hysteresis, not PID.
At the default 37.5 C target it turns ON below 37.2 C, OFF above 37.8 C and
retains state at either boundary and between them. There are no timed duty
windows. Minimum OFF time is five seconds; thermostat/safety OFF is immediate.
Raw calibrated measurements drive both thresholds and protection. See
[thermostat control](THERMOSTAT_CONTROL.md) for recovery/API compatibility and tests.
Obsolete PID examples are archived in the local pre-deployment cleanup backup.


## RTC, storage and two batches

`RealTimeClock` validates DS3231 transactions, BCD/calendar fields and oscillator
stop status, detects frozen/backward/jumped time and supplies a cached timestamp.
It never silently sets the RTC to compilation time. Turning has no uptime
fallback. After RTC communication failure, three good reads are required;
clock discontinuities or lost backup time require an explicit clock setting.

New Preferences namespace `hatchai-ctrl` stores a versioned checked profile:
targets, temperature offset, independent durations/intervals, two bound batch
IDs/start timestamps/active states, last turn reservations, turning-enabled state
and critical/abnormal-reset holds. These holds survive an ordinary power cycle
until acknowledged. Existing `hatchai-turn`/`hatchai-turn2` metrics, Wi-Fi and
account namespaces are retained. Malformed profiles disable control and are not
silently erased. SPIFFS is mounted without auto-format on failure.

A CRC-protected NVS intent and verified SD PENDING/IN_PROGRESS checkpoints
precede motor ON. Timer completion is recorded after OFF and checkpointed before
the intent clears. Any interrupted/uncertain position blocks automatic turning
until explicitly checked. Overdue history is not replayed. Motors run one at a
time with a one-second gap. Future intervals use the last completed timestamp;
recovery and position acknowledgment apply the policies in SD_RECOVERY.md.
Lockdown begins **18 complete 24-hour periods (432 hours)** after the assigned
start timestamp. The Batch form now stores an explicit time and configured
duration; legacy date-only records retain local midnight.

Browser history/unassigned records remain in localStorage. Assigning a record in Control
saves its ID/date/time/phase/duration/known metadata for SD recovery. Later Save/Delete actions on a bound
record send its updated state to the device; paused/completed/deleted records
stop their assigned turning. Unassigned records have no hardware effect. An
offline/failed update is labeled unconfirmed; do not rely on that browser edit
to stop hardware. Missing active assigned records can import from verified device
state into available browser slots. Owned/conflicting records are preserved and
physical roller assignments are never silently remapped.

The Random Forest export and feature order are unchanged. Dashboard batch
predictions use `/api/predict`; bound records now derive their day from the
restored RTC timestamp. Generic LCD/API prediction uses the first active physical
batch; no valid RTC/recovery means unknown. It is not a physical hatch sensor
or the RTC turning deadline. Recent RAM history is 96 valid readings (about
3.2 minutes at two-second sampling); named chart ranges remain recent subsets.

## API and UI compatibility

Existing `/api/data`, `/api/control`, `/api/turn`, `/api/predict`, account/session
and Wi-Fi routes remain. POSTs are URL encoded. The client serializes device
requests across its instances, keeps the five-second polling cadence, preserves
edited fields and updates dashboard values without replacing the page/chart.

`/api/control` adds `turnDurationSeconds`, `turnDuration2Seconds` and
`temperatureOffset`. Targets/durations/intervals/calibration persist; runtime
mode restores from the verified checkpoint and manual ON requests are not restored.
`fanOn=false` cannot stop circulation. Legacy turner ON switches now request
bounded timed runs rather than sustained ON. `/api/turn` enforces manual mode,
arming, assigned active batch, RTC, sensor safety and lockdown on every start;
`motor=both` queues sequential runs. Stop cancels the selected timer/queue.

`/api/data` adds `safety.version=2`, messages, readiness/acknowledgment flags,
turning state and two device batch profiles. Existing control/turn/prediction
fields remain, alongside duration/calibration/manual-request telemetry.

New POST `/api/safety` uses `action=ack|arm|disarm|clock|batch|batchUpdate` and
requires the existing active session token in its form body. Existing session
and legacy endpoint security limitations remain: this does not add TLS or
establish complete API authorization. The new Control page requires matching
relay pins and safety version before enabling commands. Update both images.

## Physical validation and verification limits

Commission the current [thermostat controller](THERMOSTAT_CONTROL.md) with
relay-board interface checks, thermal mapping at upper/lower positions, and
supervised motor tests. Obsolete PID commissioning examples are archived in
the local pre-deployment cleanup backup.
Fit an independent hardware thermal cutoff that disconnects bulb power even
if relay contacts weld. Continuous fan command does not prove actual airflow.
Software cannot make an unsafe 5 V supply safe or confirm roller displacement.

The task watchdog is eight seconds and is fed only after the entire control/HTTP
loop completes. Blocking peripheral work still has latency; a stalled motor can
overrun its requested time until reset, and welded contacts cannot be opened by
software. Limit/position protection is required wherever overtravel is possible.
Local compilation and browser mocks do not validate GPIO wiring, electrical
ratings, RTC/NVS hardware operation, physical cutoff, sensor accuracy or hatch rate.

Core files: `include/Config.h`, `RelayThermostat.h`, `ThermalSafety.h`, `Calendar.h`,
`TurnSchedule.h`, `DeviceProfile.h`, `RuntimeWatchdog.h`, `src/IncubatorController.cpp`,
`src/RealTimeClock.cpp`, `src/HatchWebServer.cpp`, `src/main.cpp` and the Control,
Settings, Batch and Dashboard scripts. Focused tests and run instructions are in
[`test/README`](../test/README). Resource budgets/build results are recorded there
when verified. Firmware and SPIFFS must be uploaded separately, only when authorized.

## Compact Control page and save review

The Control Summary sidebar is removed. Temperature/airflow, safety/clock and
the two rollers use the full page width in a two-column desktop layout. The
tested default 1280 by 900 layout fits without vertical scrolling. Phones keep
the readable single-column layout; the Save bar stays visible while scrolling.
Feedback appears near the top so it does not cover Save.

Save Settings opens a review of temperature, humidity, both run durations and
intervals, and both assigned batch records. Confirm & save sends the exact
reviewed snapshot. Keep editing, Escape and backdrop dismissal send no writes.
The dialog warns when a changed assignment/date will disable turning and checks
for changed/deleted records before saving. Auto and bulb switches apply only
their own setting, so they cannot save unrelated unfinished form edits.

Files changed for this UI revision: `data/control.html`, `data/css/control.css`,
`data/js/control.js`, `data/js/modal.js`, `test/ui-regression.cjs` and the Control
section of `docs/CODE_DOCUMENTATION.md`. The existing API routes, hardware
interlocks, five-second polling and browser batch storage format are preserved.

## Earlier integration verification (before the SD extension)

The figures below describe the earlier PID/UI integration. Current persistence
builds, tests and resource budgets are reported in [SD Recovery](SD_RECOVERY.md).

The integrated firmware compiled for `esp32dev` with Arduino-ESP32 2.0.17:
49,984 bytes static RAM (15.3%) and 997,153 bytes flash (76.1%). The actual
production safety/PID/calendar/turn timer functions passed compiler-evaluated
checks, including 10,000 scheduling steps and one-shot warm-up across timer
rollover. Node payload/queue checks, all 13 deployed JavaScript syntax checks,
and whitespace checks passed. All 153 isolated browser checks passed, including
Wi-Fi/dashboard regression, calibrated durations, queued motors, alarm recovery,
batch pause/delete synchronization, calibration save/reset/failure feedback,
review/cancel/exact-snapshot saving, keyboard focus, phone/landscape dialogs and
Save visibility without toast overlap. Desktop and phone screenshots were
visually inspected. All 13 scripts and the Node payload checks passed again for
this UI revision; firmware source was unchanged by this revision.
SPIFFS image packaging passed. Browser checks use mocked APIs; no board was
contacted and no firmware/filesystem upload or physical actuation occurred.

| Web resource | Actual bytes | Recommended target |
| --- | ---: | ---: |
| All deployed assets | 359,334 | 350,000 |
| JavaScript | 129,972 | 80,000 |
| CSS | 46,005 | 50,000 |
| Largest HTML page | 17,928 | 30,000 |
| Largest image | 39,032 | 40,000 |

The total is 9,334 bytes over the recommended budget; JavaScript is 49,972 bytes
over. JavaScript already exceeded its budget before integration. The added
safety/batch/calibration/save-review behavior increases the total; existing fonts/images and
required features were retained. No runtime dependency or faster browser polling
was added. These are budget overruns, not proof of a device memory failure;
physical runtime/heap behavior remains untested.
