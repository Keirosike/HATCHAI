# Automatic startup and control recovery

See [manual roller controls](MANUAL_ROLLER_CONTROL.md) for the subsequent manual motor, roller-selection and LCD update.

Heating now depends on validated internal target settings, a healthy watchdog,
fresh stable DHT22 measurements, and thermal limits. SD snapshots, logging and
RTC availability gate batch recovery and motion, rather than heating or the
mode switch. An abnormal reset hold clears automatically after three stable
valid readings when no critical temperature alarm is latched. Critical heat
alarms still require acknowledgement after cooling. Manual heater ON requests
are never replayed after reboot.

DHT22 reads run every five seconds. Failed checksum/timeout frames retain the
previous valid measurement for at most twenty seconds, without refreshing its
timestamp, adding history or logging a fabricated sample. A finite high raw
temperature still trips protection even if humidity fails. Stale readings stop
heating; three stable valid samples restore sensor readiness automatically.

On an empty first installation, recovery storage initializes automatically once
SD, RTC, internal journals and the sensor are ready. Existing, corrupt or
conflicting recovery data is preserved for review; interrupted motor positions
still require inspection. A verified normal restart restores saved schedules
without a button. SD faults do not disable sensor-protected temperature control.

Timed egg-turn requests are allowed in either temperature-control mode. They
still require enabled turning, an assigned active batch before lockdown, valid
RTC/sensor data, verified recovery storage and a known motor transaction state.
No relay pins or active-low polarity were changed: fan GPIO14, bulb GPIO27,
turner 1 GPIO26, turner 2 GPIO25. A command counter does not confirm movement.

Firmware and SPIFFS both need uploading for these changes to reach the device.
Local builds and mocked tests do not verify physical wiring or relay operation.

## Changed files

- `include/Config.h`, `include/ThermalSafety.h`: sample cadence and bounded transient-failure tolerance.
- `src/IncubatorController.cpp`: mode acceptance, independent heating readiness, reset recovery, timed turn acceptance.
- `src/ControllerRecovery.cpp`: automatic initialization of empty recovery storage.
- `src/HatchWebServer.cpp`, `data/js/control.js`: matching timed-turn and mode-switch behavior.
- `test/automatic_control_compile_test.cpp`, `test/recovery-ui.cjs`: freshness and browser regressions.
- `README.md`, `docs/CODE_DOCUMENTATION.md`, `docs/SYSTEM_DETAILS.md`: current behavior reference.

## Local verification

Firmware and SPIFFS packaging passed. Compiler-evaluated thermal safety, PID,
turn timing and recovery checks passed. JavaScript syntax and the control/API
Node fixture passed. Mocked browser suites passed 153 general UI checks and
33 recovery checks, including mode switching during recovery and availability
of timed turning in automatic mode. No uploads or physical operations occurred.

Assets: HTML 62,590 bytes total (largest page 17,212), CSS 46,166 bytes,
JavaScript 139,865 bytes, SVG 1,376 bytes, WebP 76,900 bytes (largest image
39,032), fonts 42,392 bytes. Total 369,289 bytes. JavaScript exceeds the
80 KB recommendation and the total exceeds 350 KB; HTML, CSS and individual
images meet their recommendations. SPIFFS packaging succeeds with these assets.
No runtime dependencies or polling frequency increases were introduced.
