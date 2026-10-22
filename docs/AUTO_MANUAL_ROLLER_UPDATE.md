# Automatic/Manual mode and interrupted roller recovery

This update supersedes earlier position-verification and direct-manual-in-Auto instructions.

Automatic mode owns bulb, fan and scheduled rollers. All output switches and roller Run/Stop buttons are disabled; the mode switch and settings review remain available. The firmware rejects manual relay arguments in Automatic mode, including a combined switch-to-Manual-plus-relay request. Switch mode first. /api/turn start and stop return 409 in Automatic mode. Controller manual turn requests also reject Automatic mode, so cached pages do not provide an override.

Manual mode enables bulb/fan requests and bounded timed roller runs. Roller default is 120 seconds (existing saved calibrated durations remain). OFF stops the motor immediately. Switching operating mode stops active/queued rollers, starts the manual bulb request OFF and retains circulation ON until a permitted manual OFF request. Thermal/sensor protection can override manual heat/fan requests.

Manual position verification is removed from both Control and Component status. Legacy positionVerified calls return an explicit refresh/no-longer-required message. When outputs are idle and settings/journal/watchdog/sensor checks pass, an unfinished intent is marked Interrupted and skipped automatically. Bound rollers require trusted RTC and get a next turn no earlier than one full configured interval after recovery. The reservation is persisted in NVS before clearing the unfinished intent. Snapshot restore retains the newer NVS reservation, preventing an older SD copy from undoing the skipped interval. No missed run is replayed; completion timestamps and successful-cycle counts are not invented. Empty rollers do not gain fabricated batch/motor records.

NVS intent writes before motor ON, per-roller restart gaps, bounded run timing, batch clock/cutoff checks and sensor/critical heat protection remain. Automatic schedules still need verified SD recovery/logging. Manual timed runs remain SD-independent but require Manual mode and the remaining runtime checks. This change does not repair a physically failed card or create motor-position feedback.

Files: data/js/control.js, data/js/componentStatus.js, data/control.html, data/settings.html; src/HatchWebServer.cpp, src/IncubatorController.cpp, src/ControllerRecovery.cpp; include/IncubatorController.h and include/RecoveryState.h; focused browser and compiler checks.

Verification: successful esp32dev firmware build; compiler-evaluated production recovery/turn-cycle/thermostat/safety checks; mocked browser regression suites covering Auto-disabled controls, Manual requests, no position-confirmation action, default durations and retained settings. SPIFFS packaging is checked separately. No upload, physical relay, power-cut, NVS/SD hardware or motor-travel test was performed. Both firmware and SPIFFS must be updated and the browser refreshed.

Measured UI: total 374,552 bytes; JavaScript 145,777; CSS 46,616; largest HTML 17,212; largest image 39,032. JavaScript and total UI remain over the 80 KB and 350 KB advisory targets. No dependencies or polling timers were added. JavaScript syntax and whitespace checks passed; the two browser suites, independent Node payload/API checks and SPIFFS packaging passed. RAM is 66,920 bytes; firmware flash is approximately 80.4% of its partition.

## Independent concurrent rollers

The existing lower/upper sliders and Run/Stop buttons are unchanged visually; no combined buttons were added. In Manual mode either roller may be started while its peer runs. Each retains its own requested duration, timer and OFF timestamp. Stopping or finishing one does not stop or reset the other. Both still default to 120 seconds; saved custom durations are retained.

Restart dwell now applies per relay, not between different motors. Journal permissions inspect only the selected motor's intent, permitting both live bits while still requiring own unfinished intents to settle. A grouped existing API Both request persists both intents in one NVS write before either relay is energized. Automatic SD intent writes remain serialized, but a running roller no longer blocks a due peer; the start times may differ while both complete their own durations. Snapshot validation accepts both commanded outputs ON. Older valid snapshots remain readable; older firmware may reject a newly written simultaneous-ON snapshot when downgrading.

Interrupted-turn normalization operates per idle roller and skips active/preparing/unfinished completion transactions for that same roller. Stopping an active roller no longer cancels the other roller's pending automatic start. Shared sensor/critical/SD automatic fault handling still stops affected outputs as appropriate. Automatic mode still disables manual requests. API request parameters and visible controls are preserved.

Compiler checks cover per-roller restart dwell, overlapping 120-second deadlines, mask ownership for two live intents, and retained recovery/sensor/thermostat policies. Mocked browser checks cover starting the upper slider while lower is ON, both ON, stopping lower without upper and vice versa, and no added buttons. These are software checks, not physical relay, motor current, NVS/SD power-cut or actual controller-on-device tests.
