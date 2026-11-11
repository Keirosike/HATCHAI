# PID adapted to the current two-roller system

Latest DHT22 transient-fault policy: see DHT22_RELAY_BATCH_FIX.md. An already-ON
heater can hold through read failures only while the last qualified valid sample
is younger than 20 seconds. No new ON is authorized during a read fault; exact
20-second expiry, known hot values and other safety gates force OFF immediately.
Older immediate-failed-frame-OFF descriptions below are superseded by this policy.

## Current warm-up policy (2026-11-10)

Automatic mode now requests continuous heating until qualified measured
temperature first reaches the selected target. PID then maintains temperature;
ordinary dips below target do not restart full-power warm-up. An explicit target
change re-evaluates warm-up against the retained measurement. Restarting the
controller starts a new warm-up; same-target mode changes and fault recovery
preserve target attainment. PID gains and relay timing are unchanged.

Warm-up still requires qualified, fresh DHT22 readings, healthy controller
storage/watchdog, and all temperature protections. Invalid/stale readings and
safety holds force OFF. Automatic retains the 10-second minimum OFF and 30-second start spacing.
Manual buttons bypass those PID intervals but retain all sensor/thermal gates. Reaching the
target ends warm-up and switches the automatic output OFF immediately, then
normal PID relay windows resume as needed. Manual commands retain their existing
safety checks and are not changed by this automatic handoff.

Current wiring is DHT22 GPIO4, heater GPIO14 active-low, passive buzzer GPIO27,
and a directly powered fan. Older hardware descriptions below are historical.
The status reports full-power warm-up when it commands heating during that phase.
Local compile-time checks cover continuous warm-up, exact target handoff,
maintenance dips, failure/recovery, same-target mode changes, retargeting, manual
commands and timer rollover. Physical overshoot and relay operation remain
unverified; a successful build does not prove either. No upload was performed.

This implementation replaces only the current heating policy. It does not apply
the old stashed hardware map or create another Control page. Existing heater
GPIO27, fan GPIO14, Lower GPIO25 and Upper GPIO26 remain active-low. SHT40 shares
SDA21/SCL22 with the RTC/LCD. LCD temperature/RH, Upper/Lower batch labels with
incubation days and estimated hatch dates retain their current layout.

## User target and existing page

Default target is 37.7 C for new device profiles. Existing saved targets, batch
dates, roller intervals/durations and turn counts are preserved. Set a current
device to 37.7 using the existing target field if its saved value is different.
The existing allowed range remains 30..37.8 C. Committing a temperature edit with
Enter or leaving the field validates and applies a target-only API request. Going
directly to Save Settings preserves the existing review/confirmation flow.

The current `hatchai-ctrl` Preferences profile persists/read-verifies the target;
no second competing temperature store is introduced. Rejected saves keep heat
OFF if storage failed and report failure. The live PID demand is recalculated
without restart and without changing the age of the last sensor sample. Pending
heat energy/integral is cleared on target changes. Relay restart dwell still applies.

Existing heater status/demand fields show actual ON/OFF, target, current temperature,
requested PID percent and 20-second window. The dashboard reuses its temperature
note and relay badge. No new controls, pages, frameworks, GPIOs or polling loops.
Manual output requests remain disabled in Auto; the two independent roller
sliders and their Run/Stop/confirmation behavior are preserved.

## Mechanical-relay PID

`RelayPid` computes on actual accepted SHT40 samples, not on every loop's retained
value. Initial gains are Kp=25 %/C, Ki=0.10 %/(C*s), Kd=100 %*s/C, with derivative
on measurement and a 0.25 low-pass blend. Saturation/conditional integration
limit windup; sustained below-target error accumulates integral even more than
2 C below target. A 15-second rising
temperature projection requests early coast-off for PTC/chamber residual heat.
These values are starting gains, not a measured tune for this 50 W chamber.

The integral gain was increased from 0.025 to 0.10 after reported slow recovery
at 36.8 C with a 37.7 C target. At a constant 0.9 C shortfall, unsaturated demand
now grows about 5.4 percentage points/minute instead of 1.35. This describes
controller demand, not a guaranteed chamber heating rate. Faster accumulation
can increase overshoot; verify the physical response during a supervised run.
The 20-second window, minimum ON/OFF times, derivative/coast logic and all
temperature/sensor protections are retained. Old SD snapshot gains remain
diagnostic and do not override this firmware gain or invalidate saved batches.

### Below-target plateau correction

Previously, every sample more than 2 C from target reset the integral. At a
steady 35.5 C with a 37.7 C target, demand therefore stayed around 55%, rather
than growing to compensate for chamber heat loss. That reset is removed;
bounded conditional integration still prevents saturation windup, and existing
target/coast shutdown, fault resets and relay dwell remain in force. A focused
regression holds the measured temperature at 35.5 C for 15 minutes and requires
demand to rise above 99%, verifies normal relay dwell and target shutdown.
This is a synthetic input trace, not a chamber warm-up prediction. If the real
heater is already continuously powered and temperature still stalls, check
power delivery, heater operation, airflow and chamber heat loss; code cannot
provide additional power beyond full ON. Firmware upload applies this correction;
the dashboard layout and assets are unchanged by it.

TPO uses a 20-second base window, minimum normal ON=5 seconds, OFF=10 seconds.
Low duty accumulates across windows instead of creating tiny pulses. High duty
can span windows continuously. Dwell/quantization make delivered duty differ
from requested PID percent in an individual window. No high-frequency PWM,
analogWrite or LEDC is used. Minimum ON is overridden by faults and explicit
OFF/mode/setpoint safety resets. Minimum OFF still prevents immediate restart.

A 20-second window can still produce about 180 relay ON cycles/hour; this is not
a relay-life guarantee. Verify the actual relay's DC contact rating, PTC cold
inrush and desired service life. Nominal 12 V/50 W current is about 4.17 A; a
5 V relay coil rating says nothing about contact load capacity. See
[Omron relay precautions](https://www.ia.omron.com/product/cautions/36/safety_precautions.html).
Physical empty-chamber tuning and an independent series thermal cutoff are
needed before relying on the heater for eggs. Software cannot open welded contacts.

## Existing safety/recovery retained

The independent `ThermalSafety`, current raw temperature limits, persistent
critical flag, watchdog, safe startup and fan override remain. Critical raw
temperature at 39 C inhibits heater/turners and retains the existing alarm
acknowledgment flow. The existing >38 C cooling hold and <=37.5 C resume rule
remain. These are software guards using the same sensor, not a second physical
thermostat. Fan stays continuously ON in Auto and during heating/faults.

A failed SHT40 frame now immediately removes PID heat authorization. The old
valid reading can remain explicitly retained telemetry; recovery requires fresh
qualification. No invalid sample becomes history/CSV data. Calibration changes
retain the existing three-frame qualification. Manual heat still obeys safety
and minimum OFF time. Acknowledging a cooled alarm also clears the PID's latch.

SD recovery imports known thermostat and older PID snapshots without erasing
batch records. New snapshots declare `heaterControl=pid_tpo`, current gains and
ON/OFF limits. Saved demand is diagnostic only; integral/duty/relay ON are never
restored. The existing `pid_percent` CSV column now records requested PID output;
CSV ordering/schema and batch-turn logging remain unchanged. No NVS schema or
roller mapping migration is introduced by this update.

No buzzer or camera integration was present in the inspected `src/`, `include/`
or dashboard scripts; none is added or removed by this heating adaptation.

## Verification and deployment

Compiler-evaluated production PID tests cover startup, faults/staleness, raw trip,
low duty, minimum ON/OFF, anti-windup, retargeting, residual heat coast, timer
rollover and Manual/mode behavior. Existing recovery, concurrency, completed-turn,
LCD/batch-day, sensor, and browser tests check preserved functionality. Browser
tests mock all APIs; they do not contact or operate an ESP32. Physical NVS power
cuts, real SD migration, relay contacts, sensor accuracy and thermal response
remain untested.

Build firmware with `platformio run -e esp32dev` and SPIFFS with
`platformio run -e esp32dev --target buildfs`. Deploy both firmware and filesystem,
then refresh the browser. No upload, serial reset, relay command, stash removal
or commit is performed during implementation. Keep the two original stashes.

Completed verification: firmware and SPIFFS builds passed; final firmware uses
66,952 bytes RAM and 1,057,637 bytes flash. All 11 compiler-evaluated test files,
202 mocked browser checks, the dual-motor API checks and 5,707 host fault-model
cases passed. All frontend JavaScript syntax and whitespace checks passed.
The fault model does not execute the physical SD driver. Downgrading to old
thermostat firmware after writing new PID snapshots has not been validated.
