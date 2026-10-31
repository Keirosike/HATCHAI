> Historical change record. Current safety, continuous fan and calibrated 15-second defaults supersede the older operating rules below. See [Integrated Control](INTEGRATED_CONTROL.md).

# Batch Turner Restoration

## Cause and source

The checked-out `DHT22_Code` branch used the older root project: two heating
relay objects, one turner, and a fixed eight-second turn pulse. The newer dual
turner implementation exists in commit `78e5bcc` on `origin/master`, under
`main-esp32/`. That version has a heating relay and two motor relays, independent
intervals, 90-second automatic pulses, and custom manual durations.

The Wi-Fi/two-slot update in `d1d991a` did not modify the Control page or
controller. This restoration brings the earlier dual-motor implementation into
the active root project while retaining the new Wi-Fi implementation, two batch
slots, batch-record migration, and stable dashboard refresh behavior.

## Result

- Separate **Batch 1 Turner** and **Batch 2 Turner** cards and summaries.
- Each interval offers 30, 60, 120, 180, 240, or 360 minutes; default 120.
- Each automatic run lasts 90 seconds. Manual mode offers independent
  1–600 whole-second Run inputs, initially 90, plus Stop and continuous switches.
  Changing manual seconds does not change automatic pulse duration.
- Each motor has its own timer, interval, counters, and last-turn timestamp.
  Repeated starts cannot extend a running pulse. Stopping one leaves the other
  unchanged. Settings updates do not turn timed runs into continuous requests.
- Active pulses survive settings/mode changes. On completion, manual mode
  restores that motor's continuous request; automatic mode switches it OFF.
- `hatchai-turn` retains the first motor's existing metric keys; the second
  uses `hatchai-turn2`. Schedules and settings reset on reboot.
- Browser batch records remain browser-local. A batch's status/selection does
  not start or stop a motor. Temperature and humidity control remain shared.
- Legacy `bulb2On`/`auxiliaryOn` arguments are ignored, so they cannot operate
  the second motor. Status retains `bulb2On: false` for older readers.
- CSV logs now include motor 2's state/metrics; incompatible old logs retain
  the existing `.legacy-<millis>` backup behavior.

The recovered four-relay assignments are:

| Relay input | Device | GPIO |
| --- | --- | --- |
| IN1 | Fan | 14 |
| IN2 | Heating bulb | 27 |
| IN3 | Batch 1 turner | 26 |
| IN4 | Batch 2 turner | 25 |

These match the earlier version's recorded assignments. Physical wiring was
not tested; that version's report specifically left GPIO25-to-IN4 unconfirmed.
Polarity remains active-low. The control page requires matching firmware pin
diagnostics and duration limits before enabling commands.

## Changed files

| Purpose | Paths |
| --- | --- |
| Defaults, settings, timers | `include/Config.h`, `include/IncubatorTypes.h`, `include/TurnCycle.h` |
| Controller and relay objects | `include/IncubatorController.h`, `src/IncubatorController.cpp`, `src/main.cpp` |
| Output initialization and pin diagnostics | `include/OutputDevice.h`, `src/OutputDevice.cpp` |
| API and CSV integration | `src/HatchWebServer.cpp`, `include/DataLogger.h`, `src/DataLogger.cpp` |
| Two turner controls | `data/control.html`, `data/css/control.css`, `data/js/control.js`, `data/js/espApi.js` |
| Single heating-relay wording | `data/dashboard.html`, `data/js/dashboard.js` |
| Documentation | `README.md`, `docs/CODE_DOCUMENTATION.md`, `docs/SYSTEM_DETAILS.md`, this report |
| Verification | `test/README`, `test/control_dual_motor_test.cjs`, `test/turn_cycle_compile_test.cpp`, `test/ui-regression.cjs` |

## Verification

- All deployed JavaScript syntax checks passed.
- `node test/control_dual_motor_test.cjs` passed: independent field routing,
  duration validation, manual/pulse separation, polling locks, firmware
  compatibility, offline handling, and URL-encoded requests.
- ESP32 C++ compiler assertions in `test/turn_cycle_compile_test.cpp` passed:
  90-second defaults, relay assignments, independent schedules/durations,
  boundary conditions, duplicate-pulse suppression, and uptime rollover.
  These assertions evaluate timer predicates, not the full controller.
- Browser regression suite passed **82 checks**, including the previous Wi-Fi,
  two-slot batch, and dashboard stability checks plus real Control page tests.
  All API requests were mocked. Separate 7/17-second requests, independent Stop,
  separate interval values, defaults, input preservation, no pulse latching,
  and incompatible-firmware locking were checked. Phone/tablet/desktop widths
  of 375, 812, and 1280 pixels fit without horizontal overflow. The phone
  screenshot was inspected.
- Firmware compilation and SPIFFS image build passed. Builds are local only.
- Whitespace/diff checks passed.

## Frontend sizes

Uncompressed bytes under `data/`; budgets below use decimal KB.

| Resource | Measured | Target | Result |
| --- | --- | --- | --- |
| Control HTML | 10,548 | 30,000/page | Within |
| Largest HTML | 17,928 | 30,000/page | Within |
| CSS total | 43,478 | 50,000 | Within |
| JavaScript total | 123,329 | 80,000 | Over by 43,329 |
| Largest image | 39,032 | 40,000 | Within |
| All UI assets including fonts | 349,130 | 350,000 | Within |

JavaScript already exceeded its target before this restoration (117,326 bytes).
The restoration adds 6,003 JavaScript bytes. No runtime dependencies, images,
or fonts were added. Polling remains every five seconds, and control reads and
writes do not overlap. Assets package into the existing SPIFFS partition.

## Deployment and remaining limits

No firmware upload, SPIFFS upload, live relay commands, or physical device tests
were performed. Deployment requires both firmware `upload` and web `uploadfs`,
then a browser reload. Actual wiring, motor travel, pulse timing under load,
and NVS/SD persistence remain unverified on hardware. Main-loop work can delay
pulse servicing; compiler/browser checks do not establish real-time guarantees.
