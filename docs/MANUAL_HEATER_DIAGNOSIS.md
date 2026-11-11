# Manual heater/PID diagnosis — 2026-11-10

## Confirmed and unresolved

The user reports Manual mode accepts a heater request but the mechanical relay
does not click. A read-only GET of the known controller `/api/data` was attempted
from this session and could not be reached. No control or actuator command was
sent. Running firmware version, live temperature/target, actual heater hold and
physical relay wiring/power remain unverified.

Confirmed reporting defect: the control page always displayed `Control updated`
after a successful HTTP response, including when the heater command remained OFF
under sensor or temperature protection. It now reports the controller's actual
output command and includes the returned hold reason. Output is explicitly a
software command, not measured relay contact/coil feedback.

The firmware previously called a Manual-mode target-temperature cutoff a generic
PID window/coasting state. Status now identifies the existing target+0.2 C cutoff
and independent PID critical-temperature latch. The cutoff predicate is shared
with the PID implementation without changing its behavior.

## PID behavior preserved

Manual ON bypasses PID duty calculations but still requires qualified/fresh DHT22
readings, healthy controller/watchdog/storage and cleared temperature alarms.
Manual ON now bypasses PID restart intervals; the target+0.2 C cutoff remains.
Automatic mode retains minimum OFF and 30-second start-spacing protection.
Explicit Manual OFF is immediate. Existing PID gains, relay window, thresholds,
watchdog, motor logic, GPIO assignments and offline operation were not retuned.

Production PID tests reproduce Manual ON after qualification, immediate OFF,
direct immediate restart, exact target cutoff, cutoff recovery, stale/invalid samples,
critical trip, automatic duty, sustained heat loss, retargeting and timer rollover.
They do not establish the correct gains for the physical chamber or confirm that
the relay is powered and responding.

## Verification

- Three compiler-evaluated files passed: PID, automatic controls and sensor sampling.
- Existing control payload/serialization host test passed.
- Isolated Chrome dashboard/control suite: 155 checks passed, including accepted
  Manual ON held OFF by sensor protection and correct output/hold reporting.
- Firmware and SPIFFS builds passed; RAM 67,208 bytes (20.5%), linked flash
  1,075,341 bytes (82.0%).
- No hardware flashing, relay activation, cloud deployment or production SQL.

Changed: `include/RelayPid.h`, `src/IncubatorController.cpp`, `data/js/control.js`,
`data/control.html`, `test/pid_compile_test.cpp`, `test/ui-regression.cjs`, this document.

## Evidence needed next

Read the current local Control page: temperature, target, heater status and output
state. If it reports OFF, diagnose the specific hold rather than overriding it.
If it reports ON but the relay has no physical response, inspect the relay model,
input assignment (configured heater GPIO14 active-low), supply and wiring under a
separately authorized safe hardware procedure. A missing click alone cannot prove
a PID fault. Do not force GPIOs, disable protections or assume the existing flashed
firmware/filesystem already contains these local changes.

Firmware and filesystem uploads would both be needed to apply the local reporting
changes; neither is authorized or performed by this diagnosis.
