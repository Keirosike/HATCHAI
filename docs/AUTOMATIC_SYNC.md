# Automatic recovery and direct control

> See [roller, batch-card and LCD update](ROLLER_BATCH_LCD_UPDATE.md) for the newer direct-run routing, card actions and fixed LCD layout.

This is the current behavior for the October 22, 2026 update. It supersedes older setup-button, always-on fan, and 432-hour turning instructions in earlier change notes.

## Power and SD recovery

Settings and batch assignments are saved to ESP32 NVS when accepted. Changed state and periodic checkpoints are written to alternating SD snapshots, then read back, parsed and CRC checked before being reported as verified. The latest verified sequence is separate from pending changes. Measurements continue to use valid readings only.

On power return, the controller selects a valid snapshot using the DS3231 time and the NVS motor journal. Newer durable NVS assignments, mode, timing and cutoff take precedence over an older SD snapshot. Manual bulb ON is never replayed on restart. Automatic heating resumes after sensor qualification; automatic turns resume after a 120-second delay, within the saved batch window. Missed turns are skipped rather than replayed. Both motors remain mutually exclusive.

A new empty SD card initializes automatically from durable device settings, preserving original stored start dates. Missing cards, CSV logging faults and failed checkpoints are retried every 30 seconds while motors are idle. Retrying a missing card does not deliberately pulse the heating relay or restart the low-temperature warning warm-up. A successful state restoration requalifies the sensor and recalculates outputs.

Existing corrupt or future-dated recovery files are preserved. They are not silently replaced by an invented batch or current Day 1. A critical overtemperature latch still requires inspection and acknowledgment after cooling. A power interruption or early Stop during motor travel leaves an uncertain position that must be physically checked in the component modal; there is no position sensor. Ordinary restart holds clear automatically after stable sensor readings.

“Checkpoint failed; no verified commit” means no saved snapshot has completed the write/readback/CRC verification. A detected card alone is not proof of a durable save. Settings > Component status distinguishes card availability, CSV logging failure, pending saves and the last verified checkpoint.

## Automatic local time

A working battery-backed DS3231 provides time without a browser. If it reports lost or invalid time, any logged-in dashboard page reading device data automatically supplies browser local time, with at most one attempt per 30 seconds. Valid RTC time is not continually rewritten. Calendar validation and the durable recovery-time floor reject invalid or backward corrections; active motor runs are allowed to finish first.

Keep the phone/computer clock and timezone correct for the incubator. Without a valid RTC, a connected logged-in browser or another implemented time source, firmware cannot know how long power was absent. This update does not implement Internet NTP or use firmware build time as the current time.

## Direct controls

Control contains mode, bulb/fan requests and timed roller Run/Stop controls. The old safety/scheduled-turning setup panel is removed. Slider inputs have a real pointer target and are usable in both modes. A bulb or fan request switches climate control to Manual; explicit timed roller requests also work while automatic heating is on. The normal relay thermostat remains unchanged: default 37.5 C, ON below 37.2 C, OFF above 37.8 C, retain state within the band, and at least five seconds OFF before re-energizing.

Manual fan OFF is honored with heat OFF and stable safe readings. Automatic mode, heating, invalid sensor readings or thermal protection force circulation ON. The checkbox reports the request and nearby text explains an override. Manual timed motors can operate during an SD fault using durable NVS intent, subject to sensor, thermal, clock/batch cutoff, position and internal-storage checks. Rejected requests explain the hold; they are not displayed as running.

## Batches and chicken turning end

Choose Lower, Upper or Both in the Batch form. Both uses one batch ID and one original start timestamp on both rollers, reserves both, and runs them sequentially. Another active batch cannot take an occupied roller. Control and LCD display the saved batch label.

The Batch form detects the current start date/time. Turning end defaults to the **start of chicken day 18**, exactly start + 17 days. Users can choose an earlier end down to the batch start; later ends are rejected by both browser and firmware. Turning is forbidden at the exact cutoff, including after a restart. This intentionally moves the old default of start + 18 complete days one day earlier. The configured hatch period remains separate from turning end.

SD snapshots now use format version 2 with turningEnd and the manual fan policy. Known version 1 snapshots are readable; derived fields are validated using their old policy before the current day-18 policy is applied. NVS profile migration preserves the original 144-byte blob under profile-v2 before writing the new 152-byte format. Older firmware may reject the new formats, so deploy firmware and SPIFFS together.

Browser batch records are restored from verified device state when missing, preserving real count/name/start/cutoff where available. Existing owned records are retained. Metadata that never reached a verified SD snapshot cannot be recreated from NVS alone; missing egg details remain explicitly unknown until restored from the original browser or edited by the user.

## Component modal

Settings > Component status puts simple detection labels first: DHT22 Detected/Not responding, SD card Detected/Not detected or unavailable, RTC (DS3231) Detected/Not detected and LCD Detected/Not detected. Readings and diagnostic details appear underneath. Relay outputs are labeled Output configured because no contact or motor feedback is installed. Wi-Fi connection status is also shown. It polls every five seconds only while open/visible and uses the shared serialized API queue. Escape and Close dismiss it. Connection loss marks retained readings stale.

A relay command confirms software output only; it does not measure relay contacts, bulb light, airflow or rotation. LCD I2C response does not verify displayed text. Exceptional position/alarm acknowledgments require a confirmation; normal SD/clock startup needs no setup button.

## Verification and deployment

Local verification covers the ESP32 firmware build, SPIFFS packaging, JavaScript syntax, production constexpr control/calendar/recovery checks, Node API checks, 131 general browser checks, 41 component/recovery browser checks and the 5,707-case host file/fault simulation. Every browser device endpoint is mocked. These checks do not validate real GPIO wiring, mains loads, temperature stability, motor travel, an SD card or DS3231 battery.

Current raw UI assets: 368,822 bytes total; JavaScript 140,656 bytes; CSS 46,536 bytes; largest HTML 17,212 bytes; no image exceeds 40,000 bytes. JavaScript exceeds the recommended 80 KiB budget and total assets exceed 350 KiB; SPIFFS image compatibility is checked separately. No frontend library was added.

See DEPLOYMENT.md. The current source package is release/HatchAI-component-status-deployment.zip. Both firmware upload and uploadfs are needed to install it. No upload or hardware actuation was performed during this update.

## Main changed paths

- Firmware: include/Config.h, IncubatorTypes.h, IncubatorController.h, DeviceProfile.h, RecoveryState.h, RecoveryCodec.h, TurnSchedule.h and RealTimeClock.h; src/IncubatorController.cpp, ControllerRecovery.cpp, HatchWebServer.cpp, RealTimeClock.cpp and LcdStatusDisplay.cpp.
- Dashboard: data/control.html, batch.html and settings.html; data/js/control.js, batch.js, batchStore.js, espApi.js and componentStatus.js; data/css/components.css, control.css and settings.css.
- Verification: test/ui-regression.cjs, recovery-ui.cjs, control_dual_motor_test.cjs, recovery_compile_test.cpp and automatic_control_compile_test.cpp.
- Documentation: README.md, docs/AUTOMATIC_SYNC.md, DEPLOYMENT.md, SD_RECOVERY.md, THERMOSTAT_CONTROL.md, MANUAL_ROLLER_CONTROL.md, CODE_DOCUMENTATION.md, SYSTEM_DETAILS.md and test/README.

Final firmware image: 66,824 bytes static RAM (20.4%) and 1,046,757 bytes flash (79.9%). SPIFFS build passed. Package manifest verifies 78 packaged files; the ZIP contains current source inputs rather than preflashed hardware.
