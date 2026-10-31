# Completed timed turns in Batch summary

## Paired completion timing fix

Motor eligibility now samples current uptime after copying the SD worker heartbeat.
Previously a loop timestamp captured before Lower's NVS completion writes could
predate the heartbeat and wrap unsigned subtraction. This falsely reported a
stalled SD worker, interrupting Upper before its full run counted. Each roller's
timer update also refreshes uptime after peer completion work. Real SD stalls,
sensor protections and incomplete-run exclusions remain enforced.

Existing counts are retained: a successful paired run advances 31/17 to 32/18;
historical missing completions are not invented. Firmware upload alone applies
this fix to the current SHT40 version; no UI or schedule settings are changed.

The selected batch summary shows completed timed runs for its assigned roller.
Both placement shows Lower and Upper separately, so two motors completing once
are not misleadingly reported as two turns of every egg. The existing API data
response includes `safety.batches[].completedTurns` (integer, or null if unavailable).
The UI matches both batch ID and incubation start timestamp and refreshes every
five seconds while visible. Requests use the existing serialized API client.

Automatic and manual runs count only when their full configured pulse expires.
User Stop, sensor/safety shutdown, mode change or power loss before completion do
not increment the counter. No count is inferred from scheduled intervals, relay
ON, an issued cycle ID, or missed turns after an outage. This records timed relay
completion; the device has no physical movement feedback.

Counters start at zero with this update, rather than reconstructing unsupported
historical totals. CRC-protected records in Preferences namespace `hatchai-count`
are keyed by batch ID and start time, retaining separate counts and last counted
intent serials for each roller. Writes are read back before being accepted.
Reboot, SD recovery and rebinding the same batch/start do not reset the records;
changing the batch ID or start creates a distinct record. Old records are retained.
Hash collisions, invalid records, NVS capacity/write errors show unavailable or log
`BATCH_TURN_COUNT_FAULT`; they never overwrite a different batch's record.
An abrupt power cut between physical timer completion and durable count storage
may undercount one completed run. Counts are not backed up in SD snapshots; wiping
NVS removes this ledger. Existing SD recovery schema and motor interlocks are unchanged.

Changed sources: `include/BatchTurnCounter.h`, `include/IncubatorController.h`,
`src/IncubatorController.cpp`, `data/batch.html`, `data/js/batch.js`.
Deploy both firmware and SPIFFS; refresh the browser afterwards.

Verification: firmware build, C++14 compiler-evaluated completion/deduplication,
independent roller/overflow/60-second timer checks, JavaScript syntax checks and
mocked browser summary polling/reload/unavailable checks. Physical rotation and
power-loss behavior remain untested. UI asset totals remain over advisory targets:
approximately 367 KiB total versus 350 KiB, and 144 KiB JS versus 80 KiB; no new
libraries, images or CSS were added.
