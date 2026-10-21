> Historical change record. Current safety, continuous fan and calibrated 15-second defaults supersede the older operating rules below. See [Integrated Control](INTEGRATED_CONTROL.md).

# Temperature and Humidity Target Update

The heating policy now uses a relay thermostat; see [thermostat control](THERMOSTAT_CONTROL.md)
for current validation and tuning limits. The original target-rule validation
below records the earlier work.

The requested defaults are now **37.5°C** and **55% RH**. Automatic control uses
the currently configured temperature target, including edits from the Control
page:

| Valid reading | Bulb | Fan |
| --- | --- | --- |
| At or below temperature target | PID schedules heating pulses | ON |
| Above target but below target +0.5°C | OFF | ON |
| At or above target +0.5°C | OFF | OFF |

At exactly 37.5°C, the fan is ON and PID decides the bulb's ON/OFF time.
Above the current target, the bulb is forced OFF.
At target +0.5°C and above, both are OFF: 38.0°C with the default target. The
cutoff follows edits to the target; for example, a 38.0°C target uses 38.5°C.
The offset is centralized as `HatchConfig::FanCutoffAboveTargetC`.
This replaces the old +/-0.3°C heating hysteresis and target+0.5°C fan threshold.
Cooling to the target or below permits PID heating. The fan stays ON for every
valid temperature below target +0.5°C, including while heating. Humidity does
not override these temperature states. The 55% humidity target remains for
display and batch records; there is no humidity-raising actuator. Cooling below
the cutoff restores ventilation; cooling to target or below permits heating again.

Invalid readings still turn the automatic bulb and fan OFF, following the
existing retained-reading timeout. Manual mode continues to use explicit relay
requests. Both egg-turner schedules, 90-second defaults, custom manual runs,
GPIO assignments, and relay polarity remain unchanged by this target update.

Control form defaults, numeric fallbacks, and new/missing-target batch defaults
now match the firmware. Existing stored batch targets are retained. The old
37.8°C/58% demo fingerprints remain solely for recognizing legacy sample
records; they are not new-batch defaults. Selecting a batch still does not
apply its recorded targets to the controller. Control settings reset at reboot.

## Changed files for this update

- `include/Config.h`: defaults and the relative +0.5°C fan cutoff.
- `include/AutomaticControl.h`, `src/IncubatorController.cpp`: production policy
  and relay application.
- `data/control.html`, `data/js/control.js`: displayed targets and fallbacks.
- `data/batch.html`, `data/js/batch.js`, `data/js/batchStore.js`: new-batch targets.
- `test/automatic_control_compile_test.cpp`: production policy boundary checks.
- `test/control_dual_motor_test.cjs`, `test/ui-regression.cjs`, `test/README`:
  default/form coverage and test instructions.
- `README.md`, `docs/CODE_DOCUMENTATION.md`, `docs/SYSTEM_DETAILS.md`, this report:
  documented defaults and behavior.

## Original target-rule validation (before PID)

- ESP32 compiler assertions passed for just below/exactly at/above 37.5°C,
  both OFF at target +0.5°C and above, fan ON just below the cutoff,
  cutoffs following lower and higher edited targets, return to ventilation
  and heating with both fan and bulb ON at or below target, invalid
  readings, and an edited temperature target. Existing turner timer assertions
  also passed. These evaluate production policy/timer functions; they do not
  execute the full hardware controller.
- All deployed JavaScript syntax checks passed.
- `node test/control_dual_motor_test.cjs` passed, including the new fallback and
  displayed-target assertions.
- Browser regression suite passed **85 checks** using mocked ESP32 APIs,
  including Control targets, new/missing-target batch defaults, preserved
  legacy demo removal, dual turners, Wi-Fi, and stable dashboard refresh.
- Firmware build passed: RAM 49,704 / 327,680 bytes; flash
  981,073 / 1,310,720 bytes.
- SPIFFS image build passed. Assets total 349,242 bytes; CSS 43,478 bytes;
  largest HTML 17,928 bytes; largest image 39,032 bytes. These fit the documented
  targets and existing SPIFFS partition. JavaScript remains 123,344 bytes,
  above its pre-existing 80,000-byte target by 43,344 bytes. No dependencies or
  faster polling were added.
- Whitespace/diff checks passed.

No uploads, live output commands, or physical tests were performed. Both
firmware and SPIFFS uploads are required to deploy these changes. Real sensor
accuracy, relay behavior, temperature stability, and timing remain untested on
the physical incubator.
