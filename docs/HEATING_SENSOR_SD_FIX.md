# Heating, DHT22 and SD recovery

Confirmed source issues were addressed: SD snapshot reload, initialization and checkpoint acknowledgment could unnecessarily switch the bulb OFF or reset sensor qualification. The safety message also prioritized the SD turning fault over actual heater holds. A valid temperature step above 0.5 C could restart qualification even after the sensor had already qualified.

Healthy existing NVS settings and live sensor state now remain active through SD reloads and checkpoint acknowledgments. Live manual requests are preserved during runtime SD recovery; a reboot still starts manual heating OFF. Snapshot-only recovery that changes climate configuration still starts OFF and requalifies. Internal storage/watchdog faults, stale data and raw overheating retain their shutdown behavior.

Three stable valid readings are still needed at startup or after stale/calibration recovery. Once qualified, valid temperature changes drive normal thermostat control rather than re-entering startup qualification. Thermostat cooling demand uses max(raw calibrated temperature, EMA with alpha 0.35): it resists a brief cold dip while responding immediately to a hot frame. The calibrated raw readings remain in API/history/CSV; they are not replaced with invented or smoothed measurements. Checksums, 5-second valid sampling, 2.1-second failed retries and the 20-second freshness limit remain.

The relay retains the 0.3 C hysteresis and 30-second automatic restart guard after an actual ON-to-OFF transition. Startup/manual requests retain the five-second guard. OFF requests and safety shutdown are immediate; no minimum ON time forces continued heating. Actual chamber temperature and electrical interference still need device validation.

When no valid A/B snapshot exists, automatic repair requires previously existing healthy settings and recovery journal, an available card, trusted RTC not older than the durable time floor, valid saved batch dates, qualified sensor and idle motors. The existing repair guard checks these conditions. The SD worker independently refuses to replace any valid snapshot, renames invalid originals to unique backups, then writes, reads back and decodes the new checkpoint. Failure leaves automatic turning OFF and retries at the existing 30-second recovery cadence. A valid but time-conflicted snapshot is preserved for clock correction, not rebuilt.

Rebuild uses original NVS batch IDs/start/turning end and saved durations, not a new Day 1. Assigned rollers require position inspection and verification on their Control cards. Missing names/egg counts are not stored in NVS and may need restoration from the browser; archived invalid files are retained. No missed turn is replayed.

The Control bulb card now shows the actual heater OFF reason, including relay restart seconds. Sensor/cooling messages precede SD-only turning warnings. The Component modal reports consecutive failed DHT22 reads when retained readings are in use. Added status fields are read-only and existing URL-encoded request contracts are unchanged. Polling remains five seconds, with no new frontend dependencies.

Validation: compiler-evaluated production thermostat/safety/sampling/recovery checks; mocked browser checks; firmware and SPIFFS builds. The Python SD fault simulation operates on temporary host files and models transactions, not the ESP32 SD/JSON driver. No upload, serial access, real SD repair, NVS transaction or physical relay/sensor test was performed. Build and mock success cannot establish electrical sensor accuracy or card health.

Deploy firmware and SPIFFS together, then refresh the browser. Latest source package: release/HatchAI-stable-heating-sd-recovery-deployment.zip.

Measured assets: HTML max 17,212 bytes; CSS 46,727; JavaScript 146,582; largest image 39,032; total 375,740. JavaScript and total assets remain above the 80 KB / 350 KB advisory targets; other measured categories stay below their targets. The existing SPIFFS partition build succeeds. RAM: 66,824 / 327,680 bytes; flash: 1,052,369 / 1,310,720 bytes. JavaScript syntax checks passed. Browser suites passed (159 general and 64 recovery/component checks); the independent host file/fault model passed 5,707 checks. These counts do not represent physical hardware tests.

Checkpoint/position follow-up: SD worker failures now carry their request ticket and a separate checkpoint error, so they are reported immediately instead of becoming a generic ten-second timeout. Old acknowledgments/failures cannot complete a newer request. During an SD fault or pending recovery, position verification can persist an explicitly confirmed physical check to healthy internal NVS even with Automatic climate enabled. This does not energize a motor or bypass sensor/watchdog/critical/movement checks, and automatic turning still needs verified SD. Specific Verify rejection messages now identify sensor, alarm, movement, storage or pending-save conditions.

Prediction follow-up: device-bound incubation day now derives from the validated original NVS start epoch and trusted RTC, independently of SD recovery readiness. The firmware overrides browser-supplied day for a matching bound ID. Dashboard accepts the firmware day while logging/recovery is faulted; unknown RTC, invalid internal settings, missing/future start still block it. Model input order, sensor validity, rounding and automatic motor SD guards are unchanged. Both firmware and SPIFFS updates are required.

LCD follow-up: line 4 estimates now use healthy NVS assignments/start dates with the trusted RTC, independently of SD readiness. Active/paused batches remain eligible, and labels are reused only when recovered metadata matches the saved ID/start; otherwise the saved ID is shown. One/shared batch has one estimate; two distinct batches alternate upper/lower every six seconds. Invalid RTC/start/sensor states show the reason. Safety alarms still override line 4. Firmware upload is required; no LCD hardware test was performed.
# Startup checkpoint timeout correction

Startup recovery now returns after queuing its checkpoint and observes the result
on the next controller update. Previously the same update subtracted the newer
request timestamp from its older loop timestamp. Unsigned wraparound could report
an immediate timeout while the SD worker subsequently verified that checkpoint.
This explains repeated successful serial checkpoint messages alongside a timeout
in Component status. Real write failures and unanswered requests still pause
automatic turning; the ten-second timeout and readback validation are unchanged.
This firmware correction requires a firmware upload. LCD I2C detection is separate.

