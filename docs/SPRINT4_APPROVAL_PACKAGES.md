# Sprint 4 grouped approval packages

Prepared locally. Nothing in this file authorizes execution. Do not paste terminal output as commands.

## Verified prerequisites

Supplied production CSVs 30–32: seven postgres-owned forced-RLS tables; 13 backend-only definer RPCs with pg_catalog search_path; 17 valid indexes. Incubator UUID 87ce3cf3-a455-4bc3-a7bb-049882d985fa was verified in supplied production inspection. Bucket hatchai-camera-captures is private, restricted to image/jpeg and 131072 bytes; subsequent storage.objects policy query returned no policies. This verifies supplied metadata, not actual device ingestion.

## Package A — registry operations only

Review supabase/sprint4_registry_REVIEW.sql. Execute its complete transaction as postgres only after Package A approval. It locks registry writes, takes a shared lock on the verified incubator, refuses any existing matching identity/incubator registrations, and inserts exactly three DISABLED records. It never overwrites existing records or stores secrets.

| Device | Key ID proposed | Role | Position |
|---|---|---|---|
| hatchai-inc01-controller | controller-sync-v1 | controller | NULL |
| hatchai-inc01-cam01 | upper-camera-v1 | camera | upper |
| hatchai-inc01-cam02 | lower-camera-v1 | camera | lower |

Before and after approved execution, inspect metadata only:
```sql
SELECT device_id,incubator_id,key_id,role,position,enabled
FROM public.hatchai_sync_devices ORDER BY device_id;
```
Expected before: no conflicting rows. Expected after: exactly the above three rows for this incubator, all enabled=false. Stop on discrepancies. Current row contents have not been supplied. Do not turn enabled=true under this package. Rollback: keep records disabled; do not delete referenced identities.

## Package B — cloud configuration and code/site deployment

Requires its own approval after A. Preserve all existing six secrets and D1 DB binding. Re-read live secret names, deployment version and native test setting first. Do not overwrite an existing device-key binding.

New secret names: TELEMETRY_DEVICE_KEYS and CAMERA_EVENT_KEYS. Each maps device ID -> key ID -> unpadded base64url 32-byte key. Controller binding contains only the controller; camera binding contains Upper and Lower with different keys. Never share a key or use the retired NOTIFICATION_DEVICE_KEYS binding.

Local credential generator (NOT executed; requires explicit production-key generation approval):
```powershell
powershell -NoProfile -File tools/sprint4-credentials.ps1 -Action Create
powershell -NoProfile -File tools/sprint4-credentials.ps1 -Action Inspect
# Only after Package B secret provisioning approval:
$env:CLOUDFLARE_ACCOUNT_ID="ecf0870e81b2fb48e1f05cdc9b34eab8"
powershell -NoProfile -File tools/sprint4-credentials.ps1 -Action Upload
```
Stores a DPAPI-encrypted bundle under the current Windows user's LOCALAPPDATA/HATCHAI-Provisioning. Refuses replacement. No plaintext file or key output. Inspect decrypts only in memory and prints identifiers. Managed strings cannot guarantee complete memory erasure. Upload checks the live secret-name inventory and refuses replacement; it passes each binding through stdin and suppresses raw CLI output. A failed second upload may leave the first binding installed: stop and reconcile instead of rerunning. The inventory check is not a distributed lock; coordinate a single administrator during upload. Do not paste decrypted keys into chat, command arguments or logs.

Variables: CAMERA_CAPTURE_BUCKET=hatchai-camera-captures. Keep CAMERA_CAPTURE_STORAGE_REVIEWED=false, CAMERA_CAPTURES_ENABLED=false, CAMERA_EVENTS_ENABLED=false, TELEMETRY_ENABLED=false, NATIVE_PUSH_DELIVERY_ENABLED=false and MANUAL_TEST_NOTIFICATIONS_ENABLED=false for initial deployment. Preserve live NATIVE_PUSH_TEST_ENABLED (previous verified value true). CORS retains myhatchai, existing Firebase origin and approved localhost. Preserve eleven configured rate limiters, existing DB binding, minute cleanup cron; recheck actual production cron before approval.

Local package/preflight:
```powershell
node tools/package-online-release.mjs
node tools/verify-online-release.mjs
python tools/sprint4-preflight.py
```
Approved deployment commands, ONLY after B approval and configuration review:
```powershell
node C:/Users/LENOVO/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/bin/wrangler.js deploy --config cloudflare-worker/wrangler.jsonc --var NATIVE_PUSH_TEST_ENABLED:true --var CAMERA_CAPTURE_BUCKET:hatchai-camera-captures
firebase deploy --project hatchai-8d34c --config firebase.online.json --only hosting
```
Only myhatchai is targeted. Existing Firebase messaging worker remains preserved. New Hosting CSP allows authenticated blob JPEG previews, not private LAN streams. No online actuator routes are introduced.

Record live Worker version with wrangler deployments list and versions view (use same --config); record Firebase live release/version from authenticated Hosting release metadata or dashboard before deployment. Previous baseline Worker 27f16ea3-d995-47df-8c6c-89240ca2c294, Hosting 141e7d90f48059fb must be refreshed; not assumed current.
Rollback commands after separately authorized recovery:
```powershell
node C:/Users/LENOVO/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/bin/wrangler.js rollback <RECORDED_WORKER_VERSION> --config cloudflare-worker/wrangler.jsonc
firebase hosting:clone hatchai-8d34c:myhatchai@<RECORDED_HOSTING_VERSION> hatchai-8d34c:myhatchai:live --project hatchai-8d34c
```
Additive tables and bucket remain; preserve objects/records. Rollback does not undo leaked credentials or make destructive SQL necessary.

Post-deploy: GET /health 200; GET /online/incubators without token 401; OPTIONS from https://myhatchai.web.app exact ACAO, GET and Authorization; unrelated origin rejected; all new ingestion requests fail closed while disabled. Sign in privately and verify only owned incubator, no hardware controls. Do not send test detections/notifications under B.

## Package C — physical devices (local utility implemented; physical diagnostic approval pending)

Candidate controller firmware .pio/build/esp32dev/firmware.bin and filesystem .pio/build/esp32dev/spiffs.bin; run artifact preflight immediately before approval. Heater GPIO14, buzzer GPIO27, DHT22 GPIO4, fan directly powered. Firmware includes the recent PID qualification fix; filesystem includes email-only login. Change a legacy username to an email before installing email-only login assets.

Upper: test/.build/camera-images/upper.bin. Lower: test/.build/camera-images/lower.bin. Separate role builds; never interchange. Camera partition table is test/.build/camera-sprint3/partition_table/partition-table.bin. Expected camera flash is 16 MB; controller 4 MB. Verify actual chip, flash and port per board before any write. Firmware builds do not verify physical capacities.

Credential namespaces: controller hatchai-sync, cameras hatchai-cloud; enabled boolean/u8, device string, key-id string, key raw blob exactly 32 bytes. Camera router configuration uses hatchai-wifi (ssid/password/controller-url). Credentials must match Package A/B. Each camera requires Internet-capable router STA and the controller's router-side private IPv4 URL. Controller AP alone supplies no NAT Internet.

The independent tools/device-provisioner utility now implements three RAM-only agents, DPAPI bundle loading, encrypted USB transport, explicit role/MAC confirmation, journaled enable-last writes, fresh readback and preservation checks. See tools/device-provisioner/README.md for exact commands, image manifests and limits. It has not been run on hardware. Start with a separately approved read-only RAM diagnostic per board; do not proceed to actual writes until full-flash preservation and startup succeed. No retired provisioner is used. No physical erases or automatic SDK recovery are allowed; at least two erased NVS pages are required, so crowded/damaged storage fails closed. No production provisioning is claimed.

After C approval and provisioning readiness, isolate heater/motor power; close serial monitors; take verified configuration-preserving backups with explicit authorization. App-only commands below preserve NVS/partition metadata but require installed compatible bootloader/table. No erase_flash or partition changes:
```powershell
$py='C:/Users/LENOVO/.platformio/penv/Scripts/python.exe'
$esp='C:/Users/LENOVO/.platformio/packages/tool-esptoolpy/esptool.py'
& $py $esp --chip esp32 --port <CONTROLLER_PORT> write_flash 0x10000 .pio/build/esp32dev/firmware.bin
& $py $esp --chip esp32 --port <CONTROLLER_PORT> write_flash 0x290000 .pio/build/esp32dev/spiffs.bin
& $py $esp --chip esp32s3 --port <UPPER_PORT> write_flash 0x10000 test/.build/camera-images/upper.bin
& $py $esp --chip esp32s3 --port <LOWER_PORT> write_flash 0x10000 test/.build/camera-images/lower.bin
```
SPIFFS upload replaces its full contents, including any on-filesystem recovery data: backup/review first. App-only writes are not first-install camera commands. Incompatible bootloader/table requires a separately reviewed full layout; do not guess offsets. No command here touches security fuses.

Physical validation: qualified DHT22, stale sensor heater cutoff, immediate manual OFF, warm-up then PID with dwell protection, LCD warnings, relay polarity with heater isolated, roller isolation, SD logging, reboot/offline operation; TLS/UTC/router reconnection and actual accepted telemetry; cameras separately then together, private images decode, dedup and outages. Hardware relay state cannot be proved from API output alone. Rollback restores reviewed app/site candidates and preserves NVS; never blindly restore an entire old flash snapshot.

## Shortest safe activation path

Verify registry metadata -> approve A -> prepare and privately upload independent keys under B -> deploy code/site with all new gates false -> approve per-board read-only RAM diagnostics -> approve C credential installation and validate controller first -> separately approve controller registry enable + telemetry gate -> verify real online readings -> separately provision/enable Upper, then Lower -> verify private snapshots -> separately review notification outbox dispatch/receipt. No batch association is claimed without verified batch schema. Queue and JPEG retention limitations from Sprint 3 remain.


Camera MAC assignments are now operator-verified and pinned in the independent provisioning host and RAM agents: Upper d885accba598; Lower d885acca0c00. Credentials remain independent and unprovisioned. COM ports are selected afresh for each connection. Current hashes are in tools/device-provisioner/RELEASE.json; old RAM images are superseded. Latest local verification: 67 native assertions, 18 host tests and all three role builds passed. No hardware execution.
