# SD persistence and power-loss recovery

> See [automatic sync update](AUTOMATIC_SYNC.md) for current SD/clock startup, direct fan/roller controls, Both placement, day-18 cutoff and snapshot/profile migration. Older setup-button instructions below are historical.

This implementation extends the existing main firmware. It retains DHT22, a relay thermostat,
automatic/protected circulation, two calibrated turners, Wi-Fi, dashboard, LCD, SD measurement
logging and the existing Random Forest. It has not been uploaded or physically
validated. Build success and host simulations are not a production certification.

## Operating policy

- The original batch start **date and time** are authoritative. Day is
  `floor((RTC - start) / 86400) + 1`; an invalid/future timestamp gives unknown,
  not Day 1. Each physical roller has its own batch timestamp.
- A normal power-on/brownout with verified snapshots, NVS journal, valid RTC and
  three stable DHT22 readings may resume automatic temperature control. Manual
  heater ON, old relay states, integral accumulation and old TPO pulses are never
  restored. A fresh thermostat starts OFF with the minimum OFF-time guard.
- Critical temperature latches persist and require acknowledgment after cooling.
  Ordinary reset holds clear after stable sensor readings. Uncertain motor
  intent still requires physical position checks. Corrupt internal storage is
  held for service; it is not automatically erased.
- Both motors start OFF. Any uncertain transaction holds **all automatic motor
  movement**, until the affected positions are verified. A healthy completed
  transaction resumes its future RTC schedule; missed turns are not replayed.
- Overdue schedules move to at least 120 seconds after recovery. A position
  acknowledgment schedules that roller a full saved interval into the future.
- Turning stops at the chosen cutoff, no later than start + 17 complete days (start of day 18). The configured incubation period
  defaults to 21 days (editable 19–35); its end marks the scheduled period
  Completed, not a sensor-confirmed hatch. Shared temperature control continues.
- Default run/interval is 15 seconds / 120 minutes. Existing independent user
  calibration (1–600 seconds, 30–360 minute intervals) remains available.

## First deployment / commissioning

1. Back up the existing card and flash settings. Disconnect the AC heater and
   motor loads. Upload firmware and SPIFFS **only when separately authorized**.
2. Log in with the correct local clock/timezone on the phone/computer. A valid
   DS3231 works offline; lost/invalid RTC time repairs automatically from the
   logged-in browser. No Set clock button is required.
3. Empty cards initialize from durable NVS settings automatically. Missing cards,
   CSV faults and failed commits are retried every 30 seconds. Existing corrupt
   snapshots are preserved; review/service the card if none can validate.
4. Wait for a verified checkpoint in Settings > Component status. Create a batch
   with its actual start date/time, duration, Lower/Upper/Both placement and
   turning end. Active saves enable schedules without another arming button.
5. Configure measured motor travel before commissioning. If a position hold is
   shown, physically inspect the affected mechanism and confirm its position in
   the component modal. That acknowledgment sends no motor command and is not
   position feedback. Critical alarms also require inspection after cooling.

## Pins, wiring and libraries

All pins remain in `include/Config.h`. LOW energizes each relay.

| Connection | ESP32 GPIO |
| --- | --- |
| CH1 fan relay IN | 14 |
| CH2 bulb relay IN | 27 |
| CH3 lower roller IN | 26 |
| CH4 upper roller IN | 25 |
| DHT22 DATA | 4 |
| DS3231 SDA / SCL | 21 / 22 |
| DS3231 address | `0x68` |
| LCD shared SDA / SCL, address | 21 / 22, `0x27` |
| SD CS / SCK / MISO / MOSI | 5 / 18 / 19 / 23 |

Connect SD/RTC ground to ESP32 ground and use modules with 3.3 V-compatible
signal levels. Supply each module according to its own board specification;
a bare SD card needs 3.3 V, while some adapters contain regulators. Keep I2C
pull-ups at ESP32-compatible levels; do not feed 5 V signals into ESP32 GPIO.
GPIO5 is a strapping pin, so verify the SD adapter does not prevent boot.
The electrical limits are in the [ESP32 datasheet](https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf).

Use an adequate separate regulated supply for the fan/relay coils. A 75 W
incandescent bulb has starting inrush and AC motors are inductive loads; contact
ratings, fusing, suppression, insulation and earth protection require an actual
electrical design. Software cannot open welded contacts or prevent a floating
relay input from energizing while the ESP32 is unpowered. Use a driver that
defaults OFF, independent thermal cutoff and physical motor limit protection.
The CP2102 is a USB interface, not a power-fail supervisor or hold-up supply.

Tested build dependencies: Arduino-ESP32 2.0.17, DHT sensor library 1.4.7,
Adafruit Unified Sensor 1.1.15, ArduinoJson 6.21.5. SD, SPI, Wire, Preferences,
SPIFFS, WiFi, WebServer, ESPmDNS and FreeRTOS come with the ESP32 core. RTC and
LCD drivers are the existing project implementations; no extra RTC library is
needed. IDF5 watchdog compatibility remains present but this revision was built
with the IDF4/Arduino2 core. Serial Monitor is 115200 baud.

Run `python scripts/export_arduino.py` to create a complete Arduino sketch and
ZIP from the current sources, headers and web assets. Open the generated
`HatchAI_Recovery.ino` using ESP32 Dev Module and install the versions above.
The package's README explains the separate web-files upload. The export is the
same implementation, not a second standalone controller with different rules.

## Files and schemas

```text
/HATCHAI/
  config.json
  batch_state_a.json
  batch_state_b.json
  temperature.csv
  humidity.csv
  egg_turning.csv
  system_events.csv
  recovery.csv
/hatchai.csv              # preserved legacy CSV schema
```

Synthetic examples are in [`examples/recovery`](examples/recovery/README.md).
They use fictional IDs/timestamps and paused/disarmed/manual-OFF settings. They
are not device recordings and must not be copied onto a live card.

Recovery JSON contains `formatVersion=1`, sequence, RTC capture/startup times,
reset reason, persistent flags, complete control configuration, two batch/motor
records, diagnostics and `crc32`. Each batch includes ID/label/name/egg count,
start, duration, current day, configured hatch/lockdown timestamps, phase,
completion status, timing, cycle ID, last completed/next turn, transaction and
position hold. These derived day/end fields are checked against the start.
Phases are 0 Empty, 1 Active, 2 Paused, 3 Completed, 4 Failed. Transactions are
0 IDLE, 1 PENDING, 2 IN_PROGRESS, 3 COMPLETED, 4 INTERRUPTED.

`flags`: bit 0 critical alarm, bit 1 turning enabled, bit 2 reset/review hold.
Configuration includes Kp/Ki/Kd, target/offset, fan policy, relay pins, thresholds,
20-second window/dwell/filter/ramp, logging/checkpoint intervals and the explicit
fact that the PID accumulator is not restored. Different policy/pin/format data
is rejected for review rather than silently applied.

CRC32 uses polynomial `0xEDB88320`, initial/final XOR `0xFFFFFFFF`. The input is
compact JSON with `crc32` removed, in stored member order. The 4096-byte file
limit, JSON nesting limit, typed fields, string lengths, enums, numeric bounds,
date relationships and CRC are validated before use. CRC is not authentication.
`config.json` is a readable derived mirror; it is not an independent recovery
authority. Editing it does not bypass configuration validation.

CSV history stores observations/events; it is not replayed to reconstruct
actuator commands. Measurement logs use valid DHT22 readings every 10 seconds
with RTC timestamps. Invalid samples go to events, not fake measurement rows.
RTC-unavailable events use timestamp `0` (unknown), never a fabricated date.
Epoch integers encode the DS3231 **local calendar**; no UTC/network adjustment
is applied. `expectedHatch` is a scheduled period end, not an exact biological
hatching prediction. The existing RF still estimates whole days.

The legacy CSV column order/header is preserved. Incompatible headers are
archived as `.legacy-<millis>`. Each normal CSV rotates at 256 KiB with three
archives (`.1`–`.3`); the oldest archive is removed by that explicit retention
policy. Corrupt snapshot archives are preserved, not automatically deleted.
The web log page remains a placeholder; this change adds no CSV download API.

## Commit and motor transaction ordering

Only the SD worker task owns SPI/SD. Main-loop operations enqueue fixed-size
copies without waiting. There is one commit queue and a bounded 12-record log
queue; overflow is counted/reported. No filesystem work occurs in an ISR.
The worker runs on core 0 at low priority; the controller/HTTP loop stays on its
normal core. Card-driver calls can still take a long time: this is task isolation,
not a guarantee that every physical SD operation finishes within a fixed time.

Checkpoints are requested every 60 seconds and on configuration, phase,
lockdown, safety and transaction changes. Values are compile-time configurable
in Config.h. A periodic write may run during movement; motor OFF never waits for
it. A completion commit is queued after an already-running periodic commit.

1. Validate both existing slots; protect the selected valid copy.
2. Reserve a monotonic sequence from an NVS block (256 values per reservation;
   unused values are skipped after reboot, reducing flash wear).
3. Write only the inactive slot; check byte count, flush/close, reopen, compare
   bytes, reparse, revalidate types/version/CRC and confirm sequence.
4. Only that readback publishes the successful checkpoint acknowledgment.
   A torn write does not cause the protected slot to be truncated.

The separate CRC-checked NVS `hatchai-rec` journal stores motor serials, uncertain
intent bits, timestamp floor, duration/phase mirrors and sequence reservations.
Existing `hatchai-ctrl` and metric/account/Wi-Fi namespaces remain. For a turn:

1. Save NVS intent/serial, with motors OFF.
2. Commit/read back PENDING; then commit/read back IN_PROGRESS.
3. Recheck sensors/clock/lockdown/arming/journal/SD and mutual exclusion. Start
   one relay and its nonblocking millis timer. Retain the one-second motor gap.
4. At expiry turn the relay OFF first. Record timer completion and next RTC turn,
   then commit/read back COMPLETED. Only then clear the NVS uncertain intent.

A stopped/faulted/interrupted pulse is not Completed. A power cut between any
two steps can conservatively require another position check, even if movement
actually finished. No replay of the partial pulse or backlog occurs. There is
no motion feedback: COMPLETED and the last successful cycle ID describe a
finished software-timed command, not proven egg rotation. Existing metrics now
increment at timed completion; pre-upgrade counts remain historical commands.

## Recovery and failure handling

GPIO OFF levels are initialized before serial/bus/storage startup; the fan
retains the continuous-ON policy. The RTC is never reset to build time. Both
snapshots are read, parsed and CRC checked; the newest sequence consistent with
RTC time is selected. A newer future-dated copy may fall back to an older valid
copy. A backwards clock below the durable floor faults. A gap over seven days
requires explicit clock review. Clock setting is blocked while armed and cannot
precede known saved time/startup. Service is required for contradictory history.

The DS3231 validates calendar/BCD/24-hour data, OSF, repeated advancing reads and
live time jumps. OSF reports oscillator disruption; it does **not** measure the
battery or prove its remaining capacity. The backup test below is essential.
See the [DS3231 datasheet, status register](https://www.analog.com/media/en/technical-documentation/data-sheets/DS3231.pdf).

Batch identities/start times must agree with healthy existing NVS copies. A
mismatch enters review, not an automatic Day 1 reset. Internal critical/reset
flags are unioned with SD flags, so an older fallback cannot clear an alarm.
Startup and interrupted recovery are logged. Startup becomes ready only after
a verified new checkpoint; heating still waits for sensor validation and all
existing thresholds. PID history and relay ON states remain diagnostic only.

| Failure | Result |
| --- | --- |
| Missing/unwritable SD or two invalid boot snapshots | Heater/motors OFF, fan ON; explicit intervention; no new batch |
| One corrupt/incomplete snapshot | Use the other valid time-consistent copy |
| Interrupted/uncertain motor or stale SD behind NVS intent | Both motors held; affected position checks required |
| Runtime logging/card/full/write fault after recovery | Motor motion held; validated temperature regulation may continue from RAM/NVS |
| Commit not verified within 10 seconds / worker stalled | No motor start; stop active movement; keep uncertain intents; explicit retry |
| RTC invalid at boot | Day unknown; heater/motors held until recovery can validate time |
| RTC invalid after recovery | Day unknown and motors OFF; sensor-validated temperature control can continue |
| Invalid/stale DHT22 | Existing heater/motor safety OFF; three stable readings to recover |
| Persistent critical alarm / panic/watchdog hold | Existing authorized acknowledgment and cool conditions required |

Immediate saving is **best effort**: power can disappear before an event or
checkpoint finishes. A/B separation protects against a torn inactive file write,
not arbitrary corruption of shared FAT metadata, SD-controller caches, both
copies or the entire card. Industrial/high-endurance media, a sound supply,
power supervisor/hold-up or UPS and an independent thermal cutoff remain
hardware requirements where uninterrupted recovery is required.

## Browser/API synchronization

Existing routes/URL-encoded requests remain. `/api/data` adds `recovery`, plus
per-roller days, exact epochs, phase, metadata and transaction fields under
`safety.batches`. General prediction/LCD use the first active physical batch;
bound `/api/predict` requests derive their day from restored RTC time, overriding
the browser's requested day. No valid RTC means unavailable, not browser Day 1.

Missing active device records import into an otherwise available browser slot,
preserving ID/start timestamp/known metadata. Owned records are not overwritten;
deleted/inactive records are not recreated, and unassigned history remains
browser-local. Unknown legacy egg counts/laid dates are labeled unknown rather
than invented. Matching completed device periods update matching active browser
records. A conflicting full two-slot browser list is preserved for user review.

Authenticated `/api/safety` adds `recoveryRetry`, `recoveryInitialize` and
`positionVerified` with `motor=1|2`. Batch actions add `startTime`, `durationDays`,
`batchStatus`, label/name/count. A response may acknowledge NVS/queue acceptance
while `checkpointPending=true`; only the later verified sequence is an SD save.
Login now requires the actual supplied password and account changes require an
active matching token, closing bypasses that would weaken recovery acknowledgments.
401 login failures no longer overwrite the account using browser credentials.
Legacy control/turn/Wi-Fi access and plain-HTTP/storage limitations remain;
this is not TLS or a complete API authentication overhaul.

## Tests and physical validation procedure

Run these host checks in the original HatchAI repository, without accessing a
board. The Arduino export contains firmware/assets/schemas and this physical
procedure; the repository also contains the host test sources.

```powershell
python test/recovery_fault_simulation.py
node test/control_dual_motor_test.cjs
# With the installed Playwright module configured as in test/README:
node test/ui-regression.cjs
node test/recovery-ui.cjs
```

The C++ compile-time tests exercise production CRC, day/lockdown, candidate
selection, journal/position and next-schedule predicates. The Python test models
file/transaction failures, truncates the inactive host file at every byte and
corrupts bytes while preserving the other copy. It is not execution of the ESP32
SD driver, full C++ JSON codec or a physical FAT power-cut test.

For physical tests, disconnect AC heater/motors first, back up the card, use a
supervised current-limited supply/controlled disconnect and collect 115200-baud
Serial output plus both snapshot copies. Never short supply rails or provoke a
brownout using a mains overload. Inspect relay signals with safe indicators or
instrumentation before reconnecting loads. Record actual timing and outcomes.

| Test | Procedure and required observations |
| --- | --- |
| 1 Normal startup | Boot with valid files/RTC. Observe A/B validation, new verified sequence, outputs OFF first, three stable samples and fresh PID ramp. Day must match elapsed time. |
| 2 New batch | Enter a known date/time/period, assign the roller, review/save and wait for verified sequence. Confirm exact start/end/lockdown fields; enable only after safe travel validation. |
| 3 Save/restore | Note IDs/start times, targets, last completion, next turn and sequence. Restart with loads disconnected. Compare restored values; day must advance using RTC, not reboot uptime. |
| 4 Cut during temperature log | Disconnect low-voltage power during an append. Recover from valid snapshots. A partial/incompatible CSV may be archived; it must not become recovery state. |
| 5 Cut during checkpoint | Repeat cuts while alternating A/B writes. Inspect CRC/sequence after each restart. One valid protected copy must be selected, or a clear fault must replace automatic operation. |
| 6 Cut during turning | With motor AC disconnected, issue a supervised timed run and cut ESP32 power during PENDING, IN_PROGRESS, relay ON, completion write and journal clear. All startup motor signals OFF; uncertain cases require position verification, never partial replay. |
| 7 Restore during lockdown | Save before day 18, restore at/after start+408 hours using a deliberately controlled valid test clock. Confirm no motor start, preserved original start and lockdown checkpoint/event. |
| 8 Corrupt A | On a backed-up test card, alter one A byte or truncate it. Confirm B recovery and a new sequence, no false Day 1. |
| 9 Corrupt B | Repeat with B and confirm A recovery. |
| 10 Both invalid | Corrupt both files. Confirm recovery fault, heater/motors OFF, no automatically created records. Test explicit reviewed repair separately. |
| 11 Remove SD at runtime | Remove only in a supervised low-voltage test. Confirm write error/timeout, motor hold and error counters. Verify the temperature loop remains responsive when its RAM/NVS/sensor state is valid. Reinsert and explicitly retry. |
| 12 RTC backup failure | Note real time, remove main power while retaining the RTC battery, wait and restore. RTC must advance accurately. Separately test missing/depleted backup on a spare/test setup: OSF/invalid RTC must hold recovery until corrected; measure battery health under an appropriate physical test. |
| 13 Sensor failure on restart | Disconnect DHT22 DATA before restart. Confirm zero heater/motor activation. Restore it and check three stable valid samples are required. |
| 14 Critical alarm reboot | With AC disconnected, use a validated sensor simulator or controlled test fixture to cross 39°C. Verify NVS critical latch, reboot persistence and refusal of acknowledgment while hot/unstable. Cool, validate and deliberately acknowledge; no old heater pulse may replay. |

Also test SD full/read-only/SPI failure, a frozen/backwards/jumping RTC, stale
newest snapshots, NVS intent newer than SD, calibrated long motor runs with a
periodic checkpoint in progress, watchdog restart, and relay min-dwell/window
timing. Actual brownout retention, relay electrical OFF behavior, timing jitter,
runtime heap/stack margins and thermal stability remain hardware validation gaps.

Serial examples include `[RECOVERY] SD ready=...; A valid=...; B valid=...`,
`Checkpoint ... verified in A/B`, and `[SD] ...failed`. Numeric reset reasons,
startup/recovery events, dropped-log counts, verified sequence and position holds
are available in the CSVs/API. A POWERON reason alone cannot prove an AC outage;
events record the available evidence rather than invent a precise outage time.

## Implementation map

- `RecoveryState.h`, `RecoveryCodec.h`: versioned records, validation, CRC/JSON.
- `RecoveryGuard.h`, `DeviceProfile.h`: NVS mirrors, lockouts and durable intents.
- `RecoveryStorage.cpp/.h`: exclusive SD worker, A/B commits, verified logs/rotation.
- `ControllerRecovery.cpp`: startup/reconciliation, checkpoint/turn state machine.
- `IncubatorController.cpp`, `main.cpp`: safe outputs, existing control integration.
- `HatchWebServer.cpp`: recovery/batch actions; existing session-token checks.
- `data/js/espApi.js`, `batchStore.js`, `batch.js`, `control.js`, `dashboard.js`:
  exact timestamps, recovered records, status and deliberate operator actions.

## Local verification results

The main `esp32dev` firmware and SPIFFS image built successfully with the pinned
libraries and Arduino-ESP32 2.0.17. Static RAM is 66,800 / 327,680 bytes (20.4%);
application flash is 1,038,037 / 1,310,720 bytes (79.2%). These figures do not
measure runtime heap, SD-task stack headroom or physical response time.

Five C++14 compiler-evaluated test sources passed: thermal/calendar safety, PID
relay behavior, turn timers, recovery/CRC/journal policy and session-token policy.
The Node payload/account-token checks and all 13 deployed JavaScript syntax
checks passed. The original 153 browser checks and 32 new recovery checks passed
(185 total), all with mocked ESP32 APIs. The host fault model passed 5,707 checks
using temporary files. Whitespace checks passed. Screenshots of the compact
Control page/save review were inspected; recovery layouts were checked at
375, 812 and 1280 pixel widths.

| Deployed web resource | Actual bytes | Recommended target |
| --- | ---: | ---: |
| Total | 368,972 | 350,000 |
| JavaScript | 139,548 | 80,000 |
| CSS | 46,166 | 50,000 |
| Largest HTML | 17,212 | 30,000 |
| Largest image | 39,032 | 40,000 |

Total assets exceed the recommended budget by 18,972 bytes and JavaScript by
59,548 bytes. JavaScript was already over its target before this work; the
required persistence status, timestamps and recovered-record handling add code.
Existing required assets/functions remain, no frontend dependency was added and
polling frequency did not increase. SPIFFS packaging succeeds, but this is not
proof of runtime heap or thermal/relay performance on the board.

The exported `.ino` was also preprocessed/compiled successfully through PlatformIO
using the same Arduino framework: 66,792 bytes static RAM and 1,038,025 bytes
application flash. Arduino IDE's graphical interface itself was not launched.
All 37 exported firmware hashes and the ZIP's web assets match the source;
the archive's own CRC check passed. See the package's VERIFICATION.md.

No upload, real brownout, serial connection or physical actuation occurred here.
