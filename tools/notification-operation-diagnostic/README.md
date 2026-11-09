# Read-only credential-operation stage diagnostic

Local implementation only. Do not execute on hardware without separate supervised
authorization. Production image remains A905F9DBC7DC2638C511DC2663F9087A3E361C545B91C0A0213790575A7BF872.
Original backup b03fd35b8a88-20261109-085011.before.flash.dpapi must be retained.

## Evidence and diagnosis

The reported identical NVS SHA-256 establishes unchanged NVS, not the last
executed instruction. Production's validation failures normally send an explicit
refusal. Digest failure and namespace-open failure also have explicit refusal
paths. A stall/reset inside an SDK call can still cause a timeout.

There is a concrete competing silent-timeout path: production starts one fixed
120-second session deadline before inspection. Host confirmation does not renew
it. If the user waits beyond this deadline, line() returns false and the RAM
application silently enters stop(); the host then waits 30 seconds for a reply.
Actual prompt timing is unknown, so this cannot yet be declared the root cause.
Do not infer that a journal was written solely because the host printed
credential-operation. The supplied unchanged NVS indicates no persistent journal
or namespace change.

## Separate image

Binary: build/hatchai_operation_diagnostic.bin (132,720 bytes).
Manifest: build/hatchai_operation_diagnostic.manifest.json.
SHA-256: 5650668D93916018D3F8850B3B0DB4A45724BB50648AFA413E40C57C937A3B1E.
All load segments are RAM; checksum and appended digest pass.

This image reproduces the actual production codec and unrelatedDigest() code with
public synthetic credential bytes. It never reads the protected credential file,
receives credential packets, opens NVS_READWRITE, invokes provision(), writes a
journal, or enables a write gate. The partition descriptor is read-only. All
partition write/raw-write/erase and flash write/encrypted-write/range-erase/chip-
erase entry points are unconditional refusals with a numeric denial counter.
Flash startup uses the previously tested generic single-bit no-status-write path.
SDK recovery writes are refused even if the SDK later ignores an error.

## Markers

| Stage | Meaning |
|---|---|
| 10 / 11 | Synthetic credential encode/decode begins / completes |
| 20 / 21 | Guarded read-only NVS init begins / returns |
| 30 / 31 | Actual production unrelated-record digest begins / returns |
| 40 / 41 | Existing namespace NVS_READONLY open begins / returns |
| 50 | Transaction intentionally excluded |
| 90 | All checks completed |

Only allowlisted stage numbers, return codes, denial count, heap and stack margin
are output. Namespace absence (ESP_ERR_NVS_NOT_FOUND) is an acceptable read-only
result, not a reason to create it. A higher-priority monitor emits a timeout
marker after 15 seconds if stages have not completed. It is best-effort: it cannot
run if scheduling/interrupts are wedged. Host receive timeout is 30 seconds.
Timeout paths never open writes and do not automatically reboot the controller.

## Future supervised procedure (not authorization)

Isolate loads, use the known stable USB setup, close monitors, and keep BOOT held.
Never use idf.py flash or write_flash; generated SDK suggestions are inapplicable.

```powershell
Set-Location 'C:\Users\LENOVO\Desktop\HATCHAI'
$py='C:\Espressif\tools\python\v5.4.4\venv\Scripts\python.exe'
& $py -B .\tools\notification-operation-diagnostic\diagnose.py `
  --execute --loads-isolated --port COM3 `
  --sha256 5650668D93916018D3F8850B3B0DB4A45724BB50648AFA413E40C57C937A3B1E `
  --backup "$env:LOCALAPPDATA\HATCHAI-Provisioning\backups\operation-diagnostic-before.flash.dpapi"
```

Use a new backup filename; existing backups cannot be overwritten. The host
performs two full matching reads and strict NVS validation, creates a verified
encrypted baseline, loads only this diagnostic, then repeats both full reads and
requires before/after equality including NVS. A transfer exception leaves the
comparison UNVERIFIED and needs a separate read-only recovery comparison. It does
not authorize resume or provisioning. The controller ends in download mode.

If every stage passes, focus investigation on production's human-confirmation
deadline, framing/crypto processing and stack/resource differences. This smaller
diagnostic does not reproduce the production encrypted session's exact stack,
heap or timing. It cannot prove writable NVS or journaled transaction behavior.
If 20 appears without 21, NVS init is implicated; 30 without 31 implicates the
digest; 40 without 41 implicates namespace opening. A nonzero denied count is a
hard failure, never permission to loosen recovery protection.

## Local verification

Separate IDF 5.4.4 build and image validation passed. Three diagnostic tests pass,
including seven compiled unconditional write/erase refusals and a denial-count
assertion. Existing host/preservation tests: 51 passed. Existing native tests:
36 authorization/raw-NVS checks, 267 production codec/transaction checks and
267 RAM-adapter checks passed; cross-codec byte compatibility passed.
No COM3 access, provisioning, secret-file access, flash changes or cloud action.
