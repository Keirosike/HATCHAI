# HATCHAI supervised USB/RAM NVS credential provisioner

The separately built [OPTRACE-V1 candidate](OPERATION_TRACE_V1.md) adds encrypted
operation-stage diagnostics for the unresolved credential-operation timeout.
The previously reviewed A905 image in `build/` has not been replaced. Select a
versioned image explicitly; do not interpret instrumentation as a proven fix.

This is a separate **classic ESP32 RAM-only** utility. It does not replace, rebuild or flash the installed HATCHAI application. It uses the existing production credential codec and writes only six named entries in the existing `hatchai-pair` NVS namespace. No Wi-Fi, HTTP, cloud deployment, eFuse change, sensor operation or actuator command is included. `/chick-detected` is not changed or enabled.

**Implementation and local tests are complete; physical execution is unverified. No production credential file was opened and no serial device was accessed during development.** Use the first physical run only on a supervised, isolated bench after explicit approval.

## Connection review and diagnostics

Connection review: the original host already used `default_reset`; it did not use
the failing diagnostic's `--before no_reset` sequence. The host now explicitly
disables serial tracing, uses `default_reset` with seven esptool connection
attempts on every connection, and refuses a stale already-running stub. It never
falls back to no-reset mode. After the standard stub starts, the redundant
`flash_spi_attach(0)` override is no longer sent, matching esptool's normal default
stub flow. MAC/security/4-MB checks remain mandatory. These changes do not prove
the earlier failure had the same cause as the separate no-reset diagnostic.

Safe diagnostics print fixed `[stage]` labels to stderr. Unexpected errors report
only a whitelisted stage and exception type, such as
`STOP: stage=flash-read-1; error=FatalError; offset=0x010000; length=65536;
details suppressed...`. Flash reads report only completed byte counts and the
bounded failing window; they never report flash bytes. Ctrl+C is
identified as `KeyboardInterrupt`. Raw exception messages, tracebacks, serial
buffers, secret values and flash contents are never echoed. No diagnostic log
file is written automatically; the displayed labels can be captured with normal
terminal redirection without enabling `--trace`. Close failures do not hide the
original error, and cleanup never resets/reconnects or retries a write.
The RAM utility's fixed startup categories are allowlisted for display, including
separate chip/flash, table-read, table-MD5, entry/bounds/overlap, NVS-layout,
partition-flag, NVS-init/open, preservation-heap and preservation-scan failures.
Legacy image categories remain recognized. All other startup text is reduced to
`unknown_startup_error`.

Before any later provisioning retry, confirm the known-working default-reset
`flash_id` and small partition-table read. Use `--after no_reset` only to stay in
download mode; omit `--before no_reset` so the default reset sequence is used.
These operations do not write persistent flash, but still require isolated loads
because reset interrupts incubation. A successful small read does not establish
that two full reads are stable. Use the read-only diagnostic below for that next
step; do not run `--execute` merely to test COM3.

## Read-only full-read diagnostic after successful flash ID / small read

Run only in an approved supervised session with loads isolated, the correct board
on COM3 and BOOT held. This snippet calls only the host's read-only snapshot path.
It does not read the credential file, save/decrypt a backup, load the custom RAM
provisioner, initialize NVS or write flash. The standard esptool RAM reader is
temporary. Expect at least about 12 minutes plus overhead at 115200 baud for two
4-MB reads. Each read uses independently checksum-verified 64-KiB windows and
prints a completed-byte count after each window. There is no automatic retry:
both complete snapshots must still match byte-for-byte before any provisioning.

```powershell
Set-Location 'C:\Users\LENOVO\Desktop\HATCHAI'
$py = 'C:\Espressif\tools\python\v5.4.4\venv\Scripts\python.exe'
@'
import sys
from types import SimpleNamespace
sys.path.insert(0, 'tools/notification-provisioner')
import provision as p
try:
    # 57600 is intentionally slower than the failed 115200 full read.
    args = SimpleNamespace(port='COM3', expected_mac='b03fd35b8a88', baud=57600)
    data = p.snapshot(args, twice=True)
    print('PASS: two matching 4-MB reads and partition validation; no flash write performed.')
    del data
except p.Failure as error:
    print('STOP: ' + str(error), file=sys.stderr)
    sys.exit(1)
except (Exception, KeyboardInterrupt) as error:
    print('STOP: ' + str(p.DiagnosticFailure('internal', error)), file=sys.stderr)
    sys.exit(1)
'@ | & $py -B -
```

Report only stage labels and the sanitized STOP/PASS line. Do not enable serial
tracing or print `data`, exception representations, buffers or local variables.
No diagnostic file is created automatically. Failure of this read-only path must
be resolved before approving another provisioning attempt.

## Safety and trust boundary

- USB download mode and the RAM utility stop normal incubation control. This is not a hot provisioning operation. Heater and motor loads must be physically isolated; do not run on an unattended active incubator.
- Close serial monitors. Confirm COM3 is still the main controller before using the example commands. Expected MAC `b03fd35b8a88` comes from the reported ESP32-D0WD-V3 identification; a different MAC is refused.
- Keep BOOT held through the operation, or use a reviewed download-mode fixture. This prevents an unexpected reset/panic from booting the normal application while the session is in progress. Never release/reset into the application until the supervisor is ready. Volatile CPU/RAM state is not preserved by entering download mode; persistent application data is protected by the checks below.
- The host refuses secure-boot or flash-encrypted devices. It does not disable security, burn fuses or attempt to bypass protected download mode. The RAM application refuses an encrypted NVS partition or an unexpected partition layout.
- A RAM-loaded application does not inherit the normal second-stage bootloader's ESP-IDF partition registry. The utility therefore reads the bounded physical table at `0x8000`, requires its MD5 record and terminator, and validates the exact reviewed entries, sector alignment, flash bounds, ordering/nonoverlap and zero encryption/read-only/unknown flags. It constructs only the reviewed `nvs` descriptor (`0x9000`, `0x5000`) and passes that descriptor to `nvs_flash_init_partition_ptr()`. Reopen/readback verification uses the same pointer path; it never assumes direct parsing alone initialized NVS.
- The RAM loader also bypasses the normal startup call that prepares `esp_flash_default_chip`. The utility now explicitly calls ESP-IDF 5.4.4's `esp_flash_init_default_chip()` before reading size or table data, fails closed if initialization is unavailable, and still independently requires the detected size to be exactly 4 MB.
- ECDH P-256, HKDF-SHA256 and AES-256-GCM protect the credential from passive serial capture. Direction-separated nonces and bounded sequence numbers reject tampering/replays. This is not remote hardware attestation: trust the Windows account, physical USB connection, adapter, reviewed RAM image and connected board. A compromised host or malicious USB intermediary is outside this threat model.
- Neither the key nor credential blob is printed, placed in command arguments, stored in a plaintext temporary file, returned through HTTP, or transmitted in plaintext serial output. The source key is never embedded in the RAM image. Python/.NET process memory cannot be guaranteed immune to swapping, debugging or memory extraction.
- NVS encryption is not added. The existing NVS key remains physically extractable on an unprotected board; CRC32 is corruption detection, not encryption or authentication. Protect the board and encrypted backups. DPAPI recovery requires access to the original Windows account/machine and its keys.

## What is written and how it is verified

### Authorization boundary (current image)

Startup uses the same copied generic single-bit SLOWRD driver and no-op
I/O-mode callback as the successfully tested separate diagnostic. It reads and
validates raw NVS and hashes all 20 KiB; it does not initialize the NVS SDK or open
any namespace. The authenticated inspection response binds this raw hash to the
host's independently parsed, encrypted pre-write snapshot. Existing/pending
credential metadata is derived from that snapshot; full credential validity is
checked again by the device core after authorization.

The host's typed PROVISION/REPLACE/RESUME/VERIFY confirmation precedes the
authenticated operation request. The device requires inspection first, correct
sequence, authenticated ciphertext, a valid credential record, and unchanged
raw NVS. Only then does it initialize NVS using a read-only descriptor while the
physical write gate remains closed. Partition and flash write/erase entry points
are wrapped: any initialization recovery attempt is refused and latches failure,
even if the SDK ignores a recovery error. Raw bytes must remain unchanged and
the unrelated-record digest must succeed. There is no erase-and-retry fallback.

Only operation 2 opens the gate and switches the descriptor writable. Namespace
creation can then occur, followed by the existing journaled transaction. VERIFY
keeps the descriptor/gate read-only and opens only an existing namespace. Writes
are confined to 0x9000..0xDFFF; encrypted writes and chip erasure are always denied.
The gate closes when the bounded session ends, including error/cancellation paths.
No incoming request is accepted after the transaction response. A host timeout
after authorization is ambiguous: retain the original backup and follow recovery.

After authorization, SDK compaction/recovery during reopens can rewrite shared
NVS pages. The gate limits physical writes to NVS but does not make every SDK
write key-specific. Logical unrelated-record checks, exact credential readback,
and host before/after preservation checks remain mandatory; they detect damage
but cannot undo power-loss effects. Unexpected startup recovery is always refused;
unexpected later changes result in failure, never automatic restore or erase.
Writable initialization and power-loss behavior remain hardware-unverified.

The existing application reads these Preferences keys once at startup:

| Namespace/key | Type | First provisioning value |
|---|---|---|
| `hatchai-pair/slot0` | Blob | Exact production `HNPC` v1 record, 87 bytes for the selected IDs |
| `hatchai-pair/active` | U8 | 0 |
| `hatchai-pair/enabled` | U8 | 1, committed last |
| `hatchai-pair/generation` | U32 | 1 |
| `hatchai-pair/slot1` | Blob | Not created for first provisioning |
| `hatchai-pair/usb-pending` | Blob | Temporary 46-byte recovery journal; removed after success |

The credential record is produced/validated by `src/NotificationCredentialStore.cpp`: `HNPC`, version 1, reserved zero, explicit lengths, little-endian generation, controller ID `hatchai-inc01-controller`, key ID `controller-v1`, exactly 32 raw key bytes and the existing CRC32. The Python encoder is cross-checked byte for byte against the production C++ codec and RAM adapter.

Transaction order: inspect -> journal -> disable -> write inactive slot -> close/deinitialize/reinitialize NVS -> verify exact bytes -> generation/selector -> fresh re-read -> enable -> fresh re-read -> remove journal. Every write is committed before continuing. A readback failure never advances to activation. The journal binds resume to the exact record hash, generation and target slot and has its own corruption checksum. There is no inactive-key fallback.

The host first validates the DPAPI file locally, then after explicit execution/physical confirmation it:

1. Checks classic ESP32 identity, expected MAC, security state, actual 4 MB flash and the reviewed partition table with checksum/nonoverlap checks.
2. Reads full flash twice, compares the reads and saves a **DPAPI-encrypted** full backup with decrypt/readback verification before loading the RAM image. Serial reads also undergo esptool's checksum verification. USB corruption stops the process before provisioning.
3. Loads only validated RAM image segments using ROM `mem_begin`, `mem_block` and `mem_finish`. No host `write_flash`, erase or eFuse operation is used.
4. Exchanges bounded, encrypted USB packets. The first encrypted request inspects metadata; the second requires a typed physical write confirmation.
5. Verifies active slot, enabled flag, generation, exact persisted record digest and an HMAC proof using the **persisted key** and a fresh session challenge. No raw key is exported. After resetting back to ROM/download mode, the host independently parses the flash snapshot and rechecks the exact selected record and typed activation metadata.
6. Re-enters USB/download mode, reads flash again and compares every byte outside NVS. Bootloader, partition table, OTA metadata, both application slots, SPIFFS and core-dump partition must be unchanged.
7. Compares unrelated NVS logical namespaces/keys/types/values before and after, excluding only the six provisioner-owned fields. An independent on-device logical digest provides an additional check. NVS garbage collection may move entries physically inside NVS; byte-for-byte NVS equality is not promised.
8. Saves an encrypted after-snapshot and a non-secret success receipt. There is no automatic boot into the installed application.

Existing credentials, corrupt selectors, unexplained partial state and unsupported/corrupt NVS pages are refused by default. The tool never erases NVS or formats it when initialization fails.

## Offline build and tests

The installed environment used here is ESP-IDF 5.4.4 at `C:\esp\v5.4.4\esp-idf`, tools at `C:\Espressif`, and Python at `C:\Espressif\tools\python\v5.4.4\venv\Scripts\python.exe`. `requirements.txt` records the already installed host dependencies; no global install or upgrade is performed automatically.

```powershell
Set-Location 'C:\Users\LENOVO\Desktop\HATCHAI'
$py = 'C:\Espressif\tools\python\v5.4.4\venv\Scripts\python.exe'

# Separate project only. Never use PlatformIO upload or idf.py flash for this utility.
& .\tools\notification-provisioner\build.ps1
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }

node .\tools\notification-provisioner\tests\run.mjs
& $py .\tools\notification-provisioner\tests\test_host.py
& $py .\tools\notification-provisioner\image_info.py
```

The RAM application uses ESP-IDF's experimental RAM-build mode, no flash-mapped code/data, the supported 40-KiB SRAM1 instruction-RAM extension, only the P-256 curve and required crypto, and no TLS/network stack. It reserves a 12-KiB main task stack and enforces heap headroom before NVS fingerprinting. None of these settings affect the main application or flash partition table. Physical heap/stack/ROM-UART behavior remains to be tested.

ESP-IDF may generate generic `idf.py flash` suggestions and `flash_args` files. **Never use them.** The wrapper suppresses the generic suggestion and validates the RAM image. The only approved execution path is the guarded host script below.

## 1. Validate the real credential without touching USB

Run this yourself when ready; development tests did not read the production file:

```powershell
& $py .\tools\notification-provisioner\provision.py
```

Default mode is `offline_plan`. It reads `%LOCALAPPDATA%\HATCHAI-Provisioning\controller-v1.dpapi`, validates its Windows SecureString/DPAPI format and exact JSON controller/key-ID map, and prints only public metadata. It does not open a serial port, generate a key or write a file.

Expected metadata: controller `hatchai-inc01-controller`, key ID `controller-v1`, generation 1, record size 87. If validation fails, stop. Do not print the decrypted JSON and do not generate a new key to mask the error.

## 2. Supervised first provisioning — DO NOT execute without approval

First arrange an idle, safe bench, isolate heater/motor loads, keep BOOT held, close serial monitors and verify the port/board. These commands reset the controller and later write NVS; they are provided for a separately approved supervised run, not executed by development.

```powershell
$ram = Join-Path (Get-Location) 'tools\notification-provisioner\build\hatchai_usb_provisioner.bin'
$ramHash = (Get-FileHash -LiteralPath $ram -Algorithm SHA256).Hash.ToLowerInvariant()

& $py .\tools\notification-provisioner\image_info.py --image $ram

& $py .\tools\notification-provisioner\provision.py `
  --execute --loads-isolated `
  --port COM3 --expected-mac b03fd35b8a88 `
  --ram-image $ram --ram-sha256 $ramHash
```

The script asks for `STOPPED b03fd35b8a88` before USB access and then `PROVISION b03fd35b8a88` before the credential operation. A correct RAM-image hash is checked again before loading. The hash should agree with the reviewed `build/hatchai_usb_provisioner.manifest.json`; do not use an unexplained replacement image. Full reads at 115200 baud can take many minutes. Do not disconnect or release BOOT during the session. A lower read speed can be selected with `--baud 57600` if needed; RAM RPC remains 115200.

Success backups/receipt are stored outside the repository under `%LOCALAPPDATA%\HATCHAI-Provisioning\backups`. No existing backup is overwritten. A full backup includes other device secrets and is encrypted; do not post it publicly.

Only after an explicit PASS and a supervisor's approval, restart the normal application with loads still isolated. It should read the newly selected NVS record and report `credentialsReady: true`. Confirm existing Wi-Fi/account settings, batch/recovery metadata, dashboard and normal sensor monitoring remain intact before considering restoration of loads. UTC/network readiness and matching Worker credentials are separate requirements. This tool does not configure/deploy Cloudflare or send notifications.

## Interrupted provisioning and lost response

Never use `erase_flash`, `nvs_flash_erase`, a freshly generated full NVS partition image, or a normal application upload as recovery.

- If no durable write started and no journal/credentials exist, retry the first-provisioning command with the same file.
- If the encrypted metadata reports `pending: true`, rerun the same command with **`--resume`**, the same file, key ID and generation, and **`--baseline-backup` pointing to the original interrupted attempt's encrypted before-snapshot**. The baseline is encrypted and bound to the board MAC. Original unrelated data must still match before another write is admitted. Do not generate another credential.
- If success/activation occurred but the final host response was lost and no pending journal remains, use **`--verify-existing`**. This proves the installed key/record without replacing or reactivating it.
- If storage is corrupt, a selector is invalid, the record does not match, a preservation check fails or resume is refused, stop and retain the encrypted before/after backups. Do not auto-restore full flash; recovery needs a separate reviewed operation.

```powershell
# Choose ONE recovery mode based on the reported state; retain all safety setup.
$baseline = Read-Host 'Paste the ORIGINAL pre-write .before.flash.dpapi path printed by the interrupted attempt'

& $py .\tools\notification-provisioner\provision.py `
  --execute --loads-isolated --resume --baseline-backup $baseline `
  --port COM3 --expected-mac b03fd35b8a88 `
  --ram-image $ram --ram-sha256 $ramHash

# Or, for completed activation with a lost acknowledgement:
& $py .\tools\notification-provisioner\provision.py `
  --execute --loads-isolated --verify-existing --baseline-backup $baseline `
  --port COM3 --expected-mac b03fd35b8a88 `
  --ram-image $ram --ram-sha256 $ramHash
```

For a deliberately approved replacement, use a separately prepared file with a **new key ID**, `--replace-existing`, the exact `--expected-generation`, and `--generation` equal to old generation + 1. The script also requires a typed `REPLACE <MAC>` confirmation. A replacement interrupted before disabling the old credential requires both `--resume` and the replacement flags. No example that replaces current production credentials is automatically executed or enabled. Existing disabled/revoked keys are never silently reactivated.

`--verify-existing` can also be used without a baseline solely to verify a known installed credential; that does not prove preservation across a previous interrupted attempt. The receipt explicitly records whether the original baseline was compared. Do not select a newer retry's backup to bypass a mismatch against the original one.

## Files

- `build.ps1`, `CMakeLists.txt`, `sdkconfig.defaults`, `main/CMakeLists.txt`: isolated RAM build.
- `provision.py`: offline DPAPI validation, guarded USB host, encryption, backups and preservation checks.
- `image_info.py`: offline image checksum/hash/segment validation and build manifest.
- `main/provision_core.h/.cpp`: portable journal/slot/activation state machine.
- `main/codec_support.cpp`: minimal identity adapter; links the actual production record codec.
- `main/idf_store.h/.cpp`: typed, namespace-restricted NVS adapter and unrelated-entry fingerprinting.
- `main/main.cpp`: bounded encrypted ROM-UART RAM service.
- `tests/native.cpp`, `tests/run.mjs`, `tests/test_host.py`: in-memory faults, cross-codec checks and host/DPAPI/transport tests.
- `requirements.txt`, `.gitignore`, this README. Generated images, manifests, configs and test binaries are ignored under this directory.

## Local verification results

- Native provisioning checks: 267 passed against the full production codec, and the same 267 passed against the RAM adapter. Coverage includes faults before/after all seven commit boundaries for initial install and replacement, exact-record resume, failed readback, journal corruption, existing/revoked credentials and invalid records.
- Python host tests: 51 passed, zero failed. Authorization/raw-NVS native checks: 36 passed. These cover closed startup gates, invalid/interrupted approval, damaged/recovery NVS pages, absent namespaces without creation, range enforcement, and one-shot authorization. Existing codec, encrypted backup, preservation and transport tests remain enabled.
- Python / production C++ / RAM adapter encoded credential bytes matched exactly.
- Existing notification native tests: 113 passed; cross-language signing vectors: 25 passed.
- Isolated ESP-IDF build passed. The image checksum and validation hash passed; all four load segments are RAM addresses.
- Reviewed RAM image: `build/hatchai_usb_provisioner.bin`, 172,864 bytes, SHA-256 `A905F9DBC7DC2638C511DC2663F9087A3E361C545B91C0A0213790575A7BF872`.
- Flash startup initializes exactly once, independently detects physical capacity, and requires the reviewed 4-MB capacity. It updates ROM RAM metadata with `bootloader_flash_update_size(physical)` and the public driver's cached `size` with the same detected value, then independently detects capacity again and requires usable/physical/ROM capacities to agree. No flash data is written and no replacement capacity is hardcoded. This is a pinned ESP-IDF 5.4.4 adaptation, not a generic cross-version initialization API. The previous repeated-init implementation retained the old nonzero driver size; IDF's `default_chip.size < legacy_chip->chip_size` comparison returned `ESP_ERR_FLASH_SIZE_NOT_MATCH` (alias `ESP_ERR_INVALID_SIZE`, 260). Physical compatibility remains unverified. Only bounded numeric return codes and sizes are displayed; the host also displays the verified RAM image hash before transfer.
- The installed-application artifact was not rebuilt or changed: SHA-256 `FE836BEBF3799713FD8F2194DA83327BF97B883C5F0922161FA6163B5CA28C84`.
- No actual serial/ESP32 operation, production DPAPI read, credential write, cloud change, deployment or notification send occurred.

## Required physical validation still outstanding

First verify ROM load/handshake, heap/stack margins, default replacement refusal and successful readback on an isolated spare/supervised board. Then exercise staged power loss with synthetic credentials and confirm unrelated NVS/application/SPIFFS preservation and resume behavior. Native fault injection does not prove real flash power-loss behavior. No production write or cloud delivery success is claimed.

References: [ESP-IDF build modes](https://docs.espressif.com/projects/esp-idf/en/v5.4.4/esp32/api-reference/kconfig.html), [NVS API](https://docs.espressif.com/projects/esp-idf/en/v5.4.4/esp32/api-reference/storage/nvs_flash.html).
