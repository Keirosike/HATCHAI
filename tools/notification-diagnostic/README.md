# Separate HATCHAI read-only RAM diagnostic

Local build only; hardware execution has not been authorized or performed.
The provisioning project and its image are unchanged. This is pinned to classic
ESP32 and ESP-IDF 5.4.4, expected MAC b03fd35b8a88, 4-MB reviewed flash layout.

## Safety boundary and SDK review

ESP-IDF `nvs::PageManager::load()` can erase recovery pages and duplicate items;
`Storage::init()` calls `eraseMismatchedBlobIndexes()` and `eraseOrphanDataBlobs()`.
Therefore this image excludes the entire `nvs_flash` component. It never calls
NVS initialization, opens a namespace, creates a namespace, repairs pages, writes
a journal, or accepts provisioning commands. The device checks raw page/header
and payload CRCs, bounds and bitmaps. Recovery/freeing and malformed pages fail
closed. The host's existing strict parser additionally validates logical NVS
records, namespaces and blob relationships on both snapshots.

This validates stored NVS integrity, NOT successful writable NVS initialization.
No claim is made that SDK NVS initialization was tested. Testing that while
guaranteeing no physical writes would require a separate NVS Partition backend
whose read methods access flash but whose write and erase methods always refuse.

Flash initialization also has a possible status-register write through the
selected driver's `set_io_mode` callback. The link wraps `esp_flash_init_main`,
uses a copied generic driver, sets single-bit SLOWRD, and replaces that callback
with a no-op. The inspected IDF init path reads ID/capacity, skips driver probing
when this descriptor is supplied, and calls the no-op instead of changing QE.
No vendor-specific init/reset callback runs. The standard data write, encrypted
write, sector/range erase and chip erase API calls are link-wrapped to refuse.
These are defense in depth, not a hardware write-protect guarantee against
arbitrary memory corruption or a modified binary. SDK/target changes need review.

Physical capacity is queried independently, required to be 4 MB, copied to ROM
and usable-capacity RAM metadata, then independently queried again. Only the
expected identity/security state and exact partition layout are accepted.
All table entries are fixed, aligned, within 4 MB and nonoverlapping; flags must
be zero. The MD5 and erased terminator/trailing table area must match.

## Artifacts and local checks

Build: `powershell -File tools/notification-diagnostic/build.ps1`
Test: `python tools/notification-diagnostic/test.py -v`
Binary: `build/hatchai_readonly_diagnostic.bin`
Manifest: `build/hatchai_readonly_diagnostic.manifest.json`
Size: 104,256 bytes.
SHA-256: `C3CA2C68A0CF308271D1419DFDC92D58E0F3D8AB386C6F0CE5F879B5E2620084`.
All segments pass the existing RAM-only image checksum/digest/address checks.
Never execute generated IDF `flash` or `write_flash` suggestions.
Local verification: 3 diagnostic tests passed, including the compiled denial and
damaged-page harness; 50 existing provisioner host/preservation tests passed.
The linker map confirms the custom flash-init wrapper is linked and no NVS
implementation symbols are present. Initial compiler checks hit restricted
temporary-file permissions; the final isolated compiler run passed with the
required local compiler access. No hardware was contacted.

## Future supervised host procedure (not authorized by this document)

Isolate loads, keep BOOT held and close serial monitors. A RAM diagnostic stops
normal incubation operation. Use the stable cable and correct controller. Keep
all previous backups. The new backup filename must not already exist.

```powershell
Set-Location 'C:\Users\LENOVO\Desktop\HATCHAI'
$py='C:\Espressif\tools\python\v5.4.4\venv\Scripts\python.exe'
& $py -B .\tools\notification-diagnostic\diagnose.py `
  --execute --loads-isolated --port COM3 `
  --sha256 C3CA2C68A0CF308271D1419DFDC92D58E0F3D8AB386C6F0CE5F879B5E2620084 `
  --backup "$env:LOCALAPPDATA\HATCHAI-Provisioning\backups\readonly-diagnostic-before.flash.dpapi"
```

The host verifies the diagnostic image, confirms identity/security, reads all
4 MB twice and validates the table/NVS, saves a verified DPAPI-encrypted baseline,
loads this image via ROM RAM commands, and accepts only bounded diagnostic lines.
After a normal diagnostic result (including failure), it resets into download
mode, reads all 4 MB twice again and requires full-image equality including NVS.
No plaintext dump or credential is printed or saved. No existing backup is replaced.
If transfer raises an exception or the port disappears, equality is UNVERIFIED;
retain the baseline, keep loads isolated and arrange a separate read-only recovery
comparison. Never use provisioning `--resume` or erase as diagnostic recovery.
The host ends in download mode; supervised restart is needed to resume controls.

An image PASS is accepted only with full before/after equality. It proves observed
read compatibility and unchanged data, not power-loss write recovery, credential
installation, TLS, cloud enrollment or actuator safety. Generic single-bit flash
compatibility and runtime stack/heap margins remain hardware-unverified.
