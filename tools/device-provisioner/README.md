# HATCHAI device NVS setup — independent RAM-only utility

Serial preflight enumerates available port names without opening them. `serial_port_unavailable` means the selected port is not visible to this process; reconnect and verify the current Windows port before a separately supervised retry. `serial_open_failed` means the enumerated port could not be opened (for example another serial monitor may own it). Neither error authorizes retries, RAM transfer or NVS writes. Raw driver exceptions are suppressed.

Implemented locally for classic ESP32 controller and two separate ESP32-S3 roles. No retired notification provisioner is imported, invoked or modified. Not yet verified on physical hardware. Never run idf.py flash, write_flash, erase_flash, or an NVS partition generator with these RAM images.

## Guarantees and bounds

- ROM chip, security flags and MAC checked before RAM transfer; the loaded agent independently checks chip family and MAC-bound encrypted plan. Controller MAC is fixed to b03fd35b6134; camera MACs are pinned in both host and agent: Upper d885accba598, Lower d885acca0c00. Swapped or unknown MACs are rejected before opening a serial port and independently before agent NVS initialization. Verify physical labels and attach one board at a time.
- Production app, SPIFFS, bootloader, partition metadata and unrelated NVS values are not provisioning targets. Full-flash bytes outside NVS are compared after every submitted operation, including failed operations when the board remains accessible.
- A generic slow single-bit flash driver disables the I/O-mode status-write callback. Physical, usable and ROM sizes must agree: controller 4 MB, cameras 16 MB. MD5-verified physical partition table, non-overlapping bounds, unencrypted flags and NVS offset 0x9000/size 0x5000 or 0x6000 are required.
- No physical sector erase, chip erase, encrypted flash write, automatic format or garbage-collection fallback. SDK recovery writes are denied during initialization. Raw page CRC/state validation occurs first. At least two erased NVS pages and 126 SDK free entries are required; full or damaged NVS fails closed. This conservative limit may reject a usable but crowded NVS partition.
- Only after explicit board/MAC confirmation and AES-GCM request validation can writes within the NVS partition be enabled. Allowed namespace/key writes are independently restricted. No SDK NVS_READWRITE open occurs during startup.
- A single committed hatchai-setup/txn blob binds pending/completed state to the SHA-256 of the complete plan, including board, MAC and router settings. Cloud enabled=false is committed before credential fields or camera router fields. Every value is committed and read back; enabled=true is last, then the journal completes. A fresh NVS deinit/init rechecks all values. Unrelated namespace/key/type/value digests must match before/after.
- Existing credential OR router fields are refused without separately approved --replace. Interrupted transactions require --resume with the exact same bundle/router inputs. Different pending plans fail. A lost response after completion reconciles read-only using --resume. Torn flash entries or a need for SDK recovery are rejected, not repaired. Such cases require separate diagnostics/service; resume is not guaranteed after arbitrary physical power loss.
- ECDH P-256 + HKDF-SHA256 + AES-256-GCM protects USB payloads. Challenge and public keys bind the ephemeral session to the MAC; separate HOST/DEV nonces avoid directional reuse. This is a supervised direct-cable trust model, not authentication against a malicious USB bridge/host. No hardware-held device secret exists before installation. Use a trusted computer/cable and verify image hashes.
- Keys come from the existing Windows DPAPI bundle, never source or CLI arguments. Router passwords are entered using hidden input. Python/managed strings cannot guarantee complete memory erasure. Do not run with shell tracing, serial tracing or terminal capture of process memory.

## Namespace contract

| Board | Namespace | Device | Key ID |
|---|---|---|---|
| controller | hatchai-sync | hatchai-inc01-controller | controller-sync-v1 |
| upper | hatchai-cloud | hatchai-inc01-cam01 | upper-camera-v1 |
| lower | hatchai-cloud | hatchai-inc01-cam02 | lower-camera-v1 |

Credential keys: enabled U8 (Preferences bool), device STR, key-id STR, key BLOB exactly 32 bytes. Camera hatchai-wifi: ssid STR, password STR (8–63 UTF-8 bytes), controller-url STR with canonical http://private-IPv4. Controller router configuration remains untouched. No notification namespace is used. Replacing camera router settings requires replacement approval even if cloud credentials are absent.

## Offline build/test commands — safe, no devices

From the project root:
```powershell
& ./tools/device-provisioner/tests/run.ps1
& ./tools/device-provisioner/build.ps1 -Board controller
& ./tools/device-provisioner/build.ps1 -Board upper
& ./tools/device-provisioner/build.ps1 -Board lower
$py='C:/Espressif/tools/python/v5.4.4/venv/Scripts/python.exe'
& $py -B tools/device-provisioner/provision.py plan --board controller
& $py -B tools/device-provisioner/provision.py plan --board upper
& $py -B tools/device-provisioner/provision.py plan --board lower
```
Each role gets build-ROLE/hatchai_device_setup.bin plus its own manifest. RAM address allowlists reject flash-mapped images; manifests are integrity metadata, not signatures. Review SHA-256 independently before hardware use. SDK 5.4.4 and esptool 4.11/4.12 only; do not silently update toolchains.

## First hardware approval: read-only RAM startup only

This is not authorization to execute. Isolate heater/motor power and stop incubation use during maintenance. Loading RAM resets/halts the working application, so incubation controls are NOT operating during this procedure. Close serial monitors, connect one labeled board, confirm exact COM port and MAC. Protected/encrypted devices are rejected; no eFuse changes.

Use the reviewed board image and literal reviewed SHA, not a freshly substituted hash:
```powershell
& $py -B tools/device-provisioner/provision.py diagnose --board controller --mac b03fd35b6134 --port <CONTROLLER_PORT> --image tools/device-provisioner/build-controller/hatchai_device_setup.bin --sha256 <REVIEWED_CONTROLLER_RAM_SHA>
```
Repeat separately with --board upper / lower, the actual camera MAC/port, and corresponding image/hash. Never guess camera MACs. The host takes two matching snapshots, saves an encrypted baseline, loads RAM using memory commands only, verifies initialization/handshake, then compares two post snapshots with the baseline byte-for-byte. No credentials or authorization packet are sent. Backups go outside the repository under LOCALAPPDATA/HATCHAI-Provisioning/device-backups. A failed snapshot, backup or readback is a HOLD; no automatic retry/reset-to-app.

## Second hardware approval: supervised provisioning

Requires Package A/B review and a separately authorized credential bundle; this utility does not create/rotate production keys. Same Windows account must decrypt LOCALAPPDATA/HATCHAI-Provisioning/sprint4-devices.dpapi. DPAPI backup encryption is different from the PowerShell SecureString bundle serialization; both formats are handled separately.

After diagnostic success and explicit provisioning approval:
```powershell
& $py -B tools/device-provisioner/provision.py provision --board controller --mac b03fd35b6134 --port <CONTROLLER_PORT> --image tools/device-provisioner/build-controller/hatchai_device_setup.bin --sha256 <REVIEWED_CONTROLLER_RAM_SHA>
& $py -B tools/device-provisioner/provision.py provision --board upper --mac d885accba598 --port <UPPER_PORT> --image tools/device-provisioner/build-upper/hatchai_device_setup.bin --sha256 <REVIEWED_UPPER_RAM_SHA>
& $py -B tools/device-provisioner/provision.py provision --board lower --mac d885acca0c00 --port <LOWER_PORT> --image tools/device-provisioner/build-lower/hatchai_device_setup.bin --sha256 <REVIEWED_LOWER_RAM_SHA>
```
Run one command/board at a time. Type exactly PROVISION CONTROLLER/UPPER/LOWER plus the MAC when prompted. Cameras prompt privately for router password and ask for SSID/controller URL. No passwords or keys in arguments. Registry and cloud feature gates remain disabled; provisioning does not activate ingestion.

## Interrupted operation / recovery

1. Keep loads isolated. Retain every encrypted before/after backup and receipt. Do not erase, restore whole NVS or reflash the application to fix provisioning.
2. Do not interpret a timeout as no write. The host attempts post-readback even on failure after submission. If USB/power is gone, preservation is UNVERIFIED until a later separately authorized read-only check.
3. Review last allowlisted STOP code and run the separately approved diagnose command. If raw corruption, recovery writes, full NVS or preservation mismatch is reported, stop for service review. Do not authorize automatic repair.
4. If healthy and the pending plan is unchanged, a separately approved repeat with --resume prompts RESUME ROLE MAC. Re-enter the same router inputs. A different plan cannot resume. Do not use --replace to bypass a pending conflict.
5. --replace requires separate approval and prompts REPLACE ROLE MAC. It is never enabled implicitly. All unrelated records must still pass preservation checks.
6. After success, receipt records MAC, image hash, plan hash, full-flash hashes and unrelated digest only. No secret values. Verify the normal application after an explicitly supervised reset. Keep new cloud gates/registry entries disabled until real-device validation.

## Approval boundary

Local tests/builds do not authorize hardware execution. Required next approvals: Package A registry writes; Package B key generation/private upload/deployment; per-board Package C read-only RAM diagnostic, then credential installation and separate firmware/filesystem upload where needed. Camera MACs are now pinned; COM ports and router-side controller URL remain operator inputs. Never assume a previous COM assignment survives reconnection. No Supabase writes or cloud deployments are performed by this tool.


## Allowlisted error codes

transaction_1 unauthorized; 2 identity; 3 existing managed values; 4 pending transaction requires exact resume; 5 conflicting journal/plan; 6 I/O or write verification failure; 7 final readback failure; 8 invalid plan. Agent 11 identity/security; 12 flash initialization/capacity; 13 layout/raw page/capacity reserve; 14 read-only NVS initialization; 15 unrelated digest/memory bound; 16 MAC; 17 key generation; 18 receive deadline; 19 framing; 20 envelope bounds; 21 peer validation; 22 derivation; 23 authentication; 24 plan identity/validation; 25–26 writable descriptor initialization while gate closed; 27 pre-write preservation; 28–29 raw/fresh NVS readback; 30 unrelated preservation; 31 response encryption. Never print raw exceptions to diagnose these codes.


## Final local verification

67 native transaction/page/gate assertions and 18 Python host tests passed. Three ESP-IDF 5.4.4 RAM-only builds passed, with actual image checksum, appended validation hash, SHA-256, RAM-address and manifest roundtrip verification. The synthetic host peer tests encrypted framing, target rejection, cancellation, tamper rejection and failure-path flash comparisons. These do not constitute actual SDK power-cut testing or USB/hardware verification. No production bundle was decrypted or generated by the test run.

Raw NVS on an unencrypted ESP32 is physically extractable. This utility protects USB transit and host backups, not against physical flash extraction. No flash encryption, secure boot or eFuses are changed. Old managed values can remain physically present after approved replacement; no secure-erasure claim is made.

Final role/MAC-bound image hashes are recorded in RELEASE.json; previous unbound images are superseded.

Serial interface: agents use the UART0 console through a USB-to-UART bridge. On S3 boards with separate UART and native-USB connectors, use the UART connector. Native USB CDC/JTAG-to-application-console handoff is not verified or claimed; if only native USB is available, stop at diagnosis and review that transport separately. Never bypass a missing handshake.


Verified camera mapping is captured in boards.json (no credentials or COM ports). Independent key identifiers remain upper-camera-v1 and lower-camera-v1; signing keys are loaded from their own DPAPI bundle records and are never generated by this utility. Reported camera revision v0.2 and PSRAM 8 MB come from the operator; PSRAM is not required by the RAM agent, and these facts do not establish flash size. Physical flash capacity is independently checked during the approved diagnostic.

## Current MAC-bound RAM images (supersede earlier hashes)

- controller / b03fd35b6134: `7D17EEC3522AEC9E22FCBFF5E010D04DA6BFB6C1B17F037A9DD34CE334BCCC35`
- upper / d885accba598: `50D5CDEB92FF4FEDD3BFBDF88FBDC1CBC94CD0B8C63B3C6A80DB87CD9EBCFE4F`
- lower / d885acca0c00: `44F865F896D7E46188E62D603AD5EF87C02E978470DF502990020D25A02A6D98`


Controller reassignment confirmed by operator: b03fd35b6134. Current controller RAM SHA-256 9496A3754A28D47331241FEE0824F0A6E94F17DD429B09981A48589647EF84B2 supersedes earlier controller hashes. Do not use historical b03fd35b8a88 backups on this board. Latest identity tests: 67 native assertions and 19 host tests passed. Camera images/identities unchanged.
