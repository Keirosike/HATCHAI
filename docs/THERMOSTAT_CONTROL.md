# Relay thermostat control

> See [automatic sync update](AUTOMATIC_SYNC.md) for current SD/clock startup, direct fan/roller controls, Both placement, day-18 cutoff and snapshot/profile migration. Older setup-button instructions below are historical.

The main incubator firmware uses normal hysteresis thermostat control. It no
longer constructs RelayPidHeater or calculates PID, duty percentages or windows.
Obsolete PID reference/example files were archived during deployment cleanup.

## Behavior

HatchConfig::HeaterHysteresisC is 0.3 C. Automatic control turns the heating
relay ON only below target minus 0.3 C, OFF only above target plus 0.3 C, and
retains its actual state at both boundaries and inside the band. At a target
of 37.5 C, these limits are 37.2 C and 37.8 C. There is no scheduled OFF pulse
while the temperature remains below the lower limit or while an ON state is
retained in the band. Actual temperature can overshoot due to retained bulb
heat and sensor placement; no physical stability improvement is claimed.

A five-second guard applies to startup/manual requests; automatic restarting
after a live ON-to-OFF transition waits at least thirty seconds. Thermostat
OFF, manual OFF and safety OFF occur immediately. Startup, mode/target changes
and sensor recovery reset heating to OFF. A fresh start inside the band stays
OFF until the measured temperature falls below the lower threshold.

Thermostat decisions use the greater of raw calibrated temperature and the
existing EMA (alpha 0.35). A downward dip is smoothed; an upward reading acts
immediately. This remains hysteresis control, with no PID duty cycle.
Three stable samples qualify startup/recovery. After qualification, valid
temperature steps do not restart it. The twenty-second freshness limit,
raw overtemperature inhibit above 38 C, 38.5 C warning and latched 39 C critical
protection remain. The independent 38 C inhibit can stop heat before the upper
thermostat threshold when using a higher target. Manual control and the
continuous fan retain their existing safety behavior. Relay pins/polarity,
roller assignment, motor timing, RTC, batch storage and prediction are unchanged.

## API, recovery and logs

Existing request methods/form encoding remain. Status now reports:

- control.heaterControl: thermostat_hysteresis
- control.heaterOnBelow / heaterOffAbove: configured thermostat limits in C
- control.heaterDutyPercent: null (retained legacy key)
- control.heaterCycleSeconds: 0 (no timed cycle)

The control page labels the algorithm Thermostat and shows ON/OFF limits,
rather than a demand percentage or twenty-second cycle.

Recovery JSON now uses format version 2 with per-batch turningEnd and manual fan policy; known format version 1 is still readable.
New checkpoints identify thermostat_hysteresis and hysteresisMilliC=300; their
legacy PID gain/window fields are zero. The reader also accepts the known
PID-era configuration so valid original batch dates and motor journals can be
restored. Old ON observations and old PID output are never replayed as heat
commands. Downgrading to PID-era firmware may reject the new configuration.

The legacy pidOutputMilliPercent snapshot diagnostic and pid_percent CSV column
remain for file compatibility, but are always zero in current firmware. The
heater_on/relay state fields are the actual commanded state. No SD file is
formatted or discarded by this change. Older PID constants stay in Config.h
solely for validating known older snapshots.

## Changed files

- include/RelayThermostat.h, include/Config.h, include/IncubatorController.h
- src/IncubatorController.cpp, src/ControllerRecovery.cpp
- include/RecoveryCodec.h
- data/control.html, data/js/control.js
- test/thermostat_compile_test.cpp, test/ui-regression.cjs, test/recovery-ui.cjs
- README.md, docs/CODE_DOCUMENTATION.md, docs/SYSTEM_DETAILS.md,
  docs/INTEGRATED_CONTROL.md, docs/MANUAL_ROLLER_CONTROL.md,
  test/README and this document

## Verification

The ESP32 firmware and SPIFFS image builds passed. Compiler-evaluated tests
execute the production thermostat's threshold/equality/retention branches,
one hour without periodic heat pulses, minimum OFF timing, manual requests,
safety shutdown, sensor staleness/recovery and millis rollover. Existing
thermal safety, turn and recovery compiler checks also passed.
JavaScript syntax and the Node API fixture passed. Mocked browser suites passed
165 general UI checks and 33 recovery checks, including thermostat text, visible
thresholds, manual controls and rejected unknown heater modes.

These are local compilation/packaging and mocked checks. No uploads, physical
relays, temperature response, real sensor/SD/LCD operation or hardware power-loss
tests occurred. Recovery JSON compatibility was inspected and compiled; it has
not been exercised against a physical card. Firmware and SPIFFS both require
an authorized upload for these changes to reach the ESP32.

Asset sizes: HTML 62,697 bytes total (largest page 17,212), CSS 46,204,
JavaScript 136,738, SVG 1,376, WebP 76,900 (largest 39,032), fonts 42,392.
Total 366,307 bytes. JavaScript exceeds the 80 KB recommendation and the total
exceeds 350 KB; HTML, CSS and individual images meet their recommendations.
No dependencies or faster polling were introduced. SPIFFS packaging passed.

Automatic restart protection: after an energized bulb switches OFF, automatic heating now waits at least 30 seconds before restarting. Startup and manual requests retain the five-second guard. Sensor/temperature faults and manual OFF still act immediately; there is no forced minimum ON time. The 0.3 C hysteresis is unchanged. This limits rapid restarting but does not establish the cause of noisy readings or electrical relay faults. Verify chamber temperature on the actual device after deployment.
