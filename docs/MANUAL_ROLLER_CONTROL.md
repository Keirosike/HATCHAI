# Manual controls, roller placement and LCD batch identity

> See [automatic sync update](AUTOMATIC_SYNC.md) for current SD/clock startup, direct fan/roller controls, Both placement, day-18 cutoff and snapshot/profile migration. Older setup-button instructions below are historical.

Current automatic heating uses [relay thermostat control](THERMOSTAT_CONTROL.md).

This update intentionally separates explicit timed manual operation from
SD-backed automatic scheduling. It does not change GPIO assignments or relay
polarity, and it has not been uploaded or tested on connected loads.

## Controls

With Auto OFF, manual heater ON no longer waits for a 20-second PID window.
It respects the minimum five-second OFF time. OFF and thermal/sensor protection
override it immediately. The fan retains its continuous cooling policy.

Both rollers accept bounded 1-600-second manual requests without SD logging,
a verified SD checkpoint or automatic-turning arming. They still require a
healthy watchdog, validated internal settings/journal, stable fresh sensor data,
no critical thermal alarm and no unresolved interrupted motor. An assigned
batch must be active with valid RTC time and be before its 18-day lockdown.
An unassigned roller can be operated explicitly in manual mode without RTC.
Only one motor runs at a time, with the existing one-second gap.

NVS stores an uncertain intent before relay ON. Timer completion turns the
relay OFF before clearing the intent. Early Stop or reset preserves an
uncertain position, which needs a deliberate physical inspection and Position
checked confirmation. Manual inspection can be acknowledged without SD while
in manual mode. There is no movement/position feedback sensor. Automatic mode
continues to require enabled schedules and verified recovery/logging storage.

The active roller switch remains enabled for OFF. Failed operations reload
confirmed device state. Manual targets/timing can be edited during SD recovery.
The controls still reject mismatched relay firmware. Firmware pin assignments
remain fan 14, bulb 27, lower roller 26, upper roller 25; LOW means ON.

## Batch and settings flow

The Batch form has a Lower roller / Upper roller choice. An active batch
requires a selection, and another active batch cannot occupy the same roller.
The device independently rejects taking another active batch's roller. Changing
placement stops motion and disables automatic turning until deliberately enabled.
Pausing/deleting a bound batch still requests a device update. A device rejection
is shown as unconfirmed while preserving the browser record for retry.

Legacy browser records without roller metadata are retained; confirmed device
placement backfills missing values. Existing recovery snapshots keep their
schema, with the array index identifying the physical roller. Control shows
actual saved batch labels, uses physical roller names rather than default batch
numbers, and removes the Assigned batch record dropdowns. Batch placement now
belongs to the Batch page. Save Settings opens a confirmation modal for targets
and each roller's calibrated timing, saves only that reviewed snapshot, and
sends no batch reassignment requests. Cancel/Escape sends no settings writes.

## LCD

The 20x4 display shows combined temperature/humidity on row 1, the roller and
saved batch label on row 2, that same batch's estimated hatch date on row 3,
and alarm or turning status on row 4. It alternates assigned batches every six
seconds. Labels are clipped to the LCD's 20 columns. Invalid sensor/RTC/recovery
context produces an unavailable estimate rather than a fabricated date.

## SD compatibility and diagnostics

The known earlier sensor timing pair (2000 ms sampling / 6500 ms freshness)
is accepted when reading version 1 snapshots; current timing remains 5000 /
20000 ms. Other configuration guards, CRC, dates and motor validation remain.
Checkpoint errors now distinguish unavailable SD, invalid base snapshots,
sequence conflicts, state/JSON encoding, write/readback mismatch and saved JSON
validation. These diagnostics do not prove physical SD reliability.

## Changed paths

- data/control.html, data/css/control.css, data/js/control.js
- data/batch.html, data/js/batch.js, data/js/batchStore.js, data/js/espApi.js
- include/IncubatorController.h, include/RelayThermostat.h
- src/IncubatorController.cpp, src/ControllerRecovery.cpp, src/LcdStatusDisplay.cpp
- include/RecoveryState.h, include/RecoveryCodec.h, src/RecoveryStorage.cpp
- test/ui-regression.cjs, test/recovery-ui.cjs, test/thermostat_compile_test.cpp,
  test/recovery_compile_test.cpp
- README.md, docs/CODE_DOCUMENTATION.md, docs/SYSTEM_DETAILS.md,
  docs/CONTROL_RECOVERY_FIX.md, test/README, this document

## Verification scope

Firmware compilation, SPIFFS packaging, JavaScript syntax, the Node control/API
fixture, compiler-evaluated thermal safety/PID/turn/recovery checks, and mocked
browser checks were run locally. The browser suites verify UI behavior and
request encoding using intercepted APIs; they do not execute ESP32 drivers.
No firmware or SPIFFS uploads, real relay commands, physical motor movement,
LCD hardware, SD-card readback, sensor wiring or fault-injection hardware tests
were performed. Both firmware and SPIFFS must be uploaded for device use.

Final local results: firmware and SPIFFS builds passed; JavaScript syntax,
control/API Node fixture and compiler-evaluated checks passed. Browser suites
passed 163 general UI checks and 33 recovery checks. Desktop/phone screenshots
were inspected, including settings confirmation and long batch labels.

Measured assets: HTML 62,647 bytes total (largest page 17,212),
CSS 46,204, JavaScript 136,591, SVG 1,376, WebP 76,900
(largest 39,032), fonts 42,392. Total 366,110 bytes.
JavaScript exceeds the 80 KB recommendation; total assets exceed 350 KB.
HTML, CSS and individual images meet their budgets; SPIFFS packaging succeeds.
No dependencies or faster polling were introduced.
