# Sprint 4 gated cloud deployment — 2026-11-10

Operator approved continuing full development after supplying post-install metadata exports 33–35 and confirming the remaining alert-rule check was cleared.

## Completed production changes

- Worker hatchai deployed from cloudflare-worker/wrangler.jsonc.
- New Worker version: 5d6ca7d7-6e74-486d-bcf0-998999133633.
- Previous Worker rollback reference: 27f16ea3-d995-47df-8c6c-89240ca2c294.
- Preserved DB binding to hatchai-devices, configured eleven rate limiters and once-per-minute cron.
- Preserved existing NATIVE_PUSH_TEST_ENABLED=true. No test notification sent.
- TELEMETRY_ENABLED, TELEMETRY_ROLLUPS_ENABLED, TELEMETRY_ALERTS_ENABLED, CAMERA_EVENTS_ENABLED, CAMERA_CAPTURES_ENABLED, CAMERA_CAPTURE_STORAGE_REVIEWED, NATIVE_PUSH_DELIVERY_ENABLED and MANUAL_TEST_NOTIFICATIONS_ENABLED remain false.
- CAMERA_CAPTURE_BUCKET=hatchai-camera-captures configured. Existing secret values were not read or replaced.
- Firebase release deployed only to myhatchai in project hatchai-8d34c using firebase.online.json: 46 manifest-verified public assets. Default Hosting site was not targeted.
- Current Hosting version identifier was not retrieved; CLI confirmed release completion. Previous recorded rollback candidate: 141e7d90f48059fb (review compatibility before restoring).

## Verification actually run

- Worker automated suite: 152 passed, zero failed.
- Targeted Hosting/shared-package/telemetry frontend suite: 12 passed, zero failed.
- Release verifier: 46 files match source and manifest; no extras.
- Production GET /health: 200.
- Production GET /online/incubators without authentication: 401.
- Login OPTIONS with approved origin and Authorization: 204, exact approved origin, GET and Authorization allowed.
- Unapproved-origin OPTIONS: 403.
- A deliberately overbroad incubator-list preflight containing If-None-Match returned 400; the actual list request uses Authorization only. Conditional telemetry has its own endpoint contract and remains gated off.
- Hosting online-login.html: 200 with reviewed CSP including authenticated blob-image previews.

No real-user login, telemetry ingestion, physical sensor readings, camera uploads, Android receipt, credentials provisioning or hardware flashing was performed in this run.

## Outstanding prerequisites

Verify existing disabled device registry rows before any registry insert; never rerun a fail-on-conflict registry script blindly. The expected Sprint 4 DPAPI bundle was absent at the checked user path. Device-key creation/upload and physical provisioning must follow the reviewed board-bound workflow. Controller read-only full-flash diagnostic previously failed; do not start NVS writes or firmware flashing until reliable complete preservation checks succeed. No serial port was accessed this run.

After devices pass provisioning and supervised hardware tests, activation must enable the controller registry and telemetry/rollup gates together. Alerts and cameras remain independently gated. Cloud dashboard availability is not evidence of live measurements.

## Rollback

Disable affected ingestion/delivery gates first. Worker rollback command:

```powershell
node C:/Users/LENOVO/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/bin/wrangler.js rollback 27f16ea3-d995-47df-8c6c-89240ca2c294 --config cloudflare-worker/wrangler.jsonc
```

Do not drop additive tables or reverse migrations by reinstalling old SQL. Migration 006 changed the ingest/read storage path; keep telemetry disabled during an old-code rollback. Hosting rollback must target myhatchai only, using a reviewed existing version. Preserve all NVS and encrypted backups.
