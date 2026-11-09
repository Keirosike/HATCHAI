# Online frontend release — prepared, not deployed

> Superseded by docs/MYHATCHAI_DEPLOYMENT.md. The official site is now myhatchai.
> This document records the earlier default-site proposal; do not use its package
> paths, file counts or deployment instructions for the new site.

Target project: hatchai-8d34c. Canonical production origin:
https://hatchai-8d34c.web.app

Dashboard entry after approval: /online-login.html, or /online (302 redirect).
The root / retains the EXISTING deployed notification page. It is not changed
into a second dashboard. /dashboard.html redirects to the online sign-in entry.
No SPA fallback exists; unpublished control/settings/camera/API paths return 404.

## Responsive fix

Only public/online-login.html was styled. Online monitoring cards use a responsive
minimum width and single-line, clamped status typography. The wide prediction
card still spans the grid, and the existing small-screen single-column layout is
preserved. Checked 320, 390, 640, 768, 900, 901, 942, 1000, 1100 and 1280 CSS pixels,
plus 125% CSS zoom. This simulates a scaling case, not every native browser zoom.
No data/ HTML, CSS or JavaScript changed in this task.

## Inspected configuration and preservation finding

The original firebase.json serves all of public/ and has Functions/Firestore
configuration. It and .firebaserc remain unchanged. A separate Hosting-only
firebase.online.json points to the clean dist/hatchai-online/site output.

The local notification index, push.js, VAPID settings and messaging service worker
differed from production; pairing-client.js was not deployed (404). Rather than
publish unrelated candidates, the release preserves the five actual deployed
public files, captured read-only in dist/hatchai-hosting-baseline with a SHA-256
manifest. These contain public frontend configuration only. Local public/
notification files were not modified, and notification delivery was not enabled.
Do not replace this preservation baseline with local candidates during deployment.

The baseline is a required local release input, not a private firmware/NVS backup.
If it is missing, stop and recapture/review the public production files; do not
fall back to a recursive copy of public/ or regenerate the old provisioner.

## Exact package contents

Upload directory: dist/hatchai-online/site — 24 files, 210,608 bytes.

Online entry/configuration/authentication (7):
- online-login.html
- online-login.js
- online-dashboard.js
- supabase-auth.js
- incubator-read.js
- online-api-settings.js
- cloud-notification-settings.js

Preserved existing production notification assets (5):
- index.html
- push.js
- firebase-config.js
- push-settings.js
- firebase-messaging-sw.js

Generated from the canonical data/ dashboard (12):
- shared/dashboard-fragment.html
- shared/js/app.js
- shared/js/dashboardAdapters.js
- shared/js/dashboard.js
- shared/css/base.css
- shared/css/layout.css
- shared/css/components.css
- shared/css/dashboard.css
- shared/a/fonts/inter-regular.woff2
- shared/a/fonts/inter-semibold.woff2
- shared/a/images/hatchai-logo.webp
- shared/a/images/fortitle.webp

The release manifest is dist/hatchai-online/manifest.json, OUTSIDE the upload
directory. It includes every uploaded file's size/hash and the Hosting config
hash. The preservation baseline, tests, tools, development settings, private keys,
backups, firmware, native binaries and source tree are outside the upload root.
The allowlisted builder rejects private credential markers, linked output and
unexpected output files. The pre-upload verifier rejects missing, changed or
extra files. These hashes detect changes; they are not cryptographic signatures.

Prepared manifest SHA-256:
30AFD59A0BE47FB9771E52766E1168AD9636C7290B595596F4072484F5997550

## Configuration and authentication

The online API remains https://hatchai.kurtzidrickguno-robles.workers.dev.
Supabase remains https://dihufafcztqjuudjeqdm.supabase.co and uses its public
publishable key. No secret/service-role key is used. Existing in-memory login,
independent user verification, owner-authorized Worker retrieval and sign-out are
preserved. Reload requires another sign-in. Static assets are public; ownership
is enforced on data requests, not by hiding HTML.

The Hosting config sets no-store, nosniff, no-referrer, frame denial and restricted
permissions. Online CSP permits scripts only from self and connections only to
self, the existing Supabase project and the deployed Worker. Inline CSS remains
allowed for the existing styles; inline JavaScript/eval is not allowed. The CSP
is specific to the online page so it does not break the retained legacy Firebase
SDK imports. No Supabase redirect or Firebase Auth-provider changes are required
for the existing email/password REST login. This does not validate password-reset
or OAuth flows, which are outside this release.

Windows Firebase emulator 15.35.0 had a reproduced glob-matching issue for custom
headers. Supported regex rules matching slash/backslash paths fixed local testing;
the production slash paths are explicitly tested. No tool installation was patched.

Live read-only verification: the deployed Worker returned OPTIONS 204 with the
matching Access-Control-Allow-Origin for https://hatchai-8d34c.web.app. No Worker
configuration change is required for that canonical origin. Other hostnames,
including future custom domains or firebaseapp.com aliases, are not claimed to
work until explicitly checked/allowed. POST /chick-detected still returns 503.

## Tests performed

- Responsive/shared dashboard browser: 61 mocked checks passed.
- Unit/adapter/auth/packaging/session tests: 26 passed (including 3 release tests).
- Existing online login browser: 29 mocked checks passed.
- Existing local dashboard regression: 152 mocked checks passed.
- Existing recovery UI: 50 mocked checks passed.
- Existing dual-motor browser-client regression passed.
- Existing Worker automated suite: 92 passed, zero failed.
- Final Firebase Hosting emulator: 109 checks passed against the exact 24-file
  release, including all file hashes, real Hosting routes/headers/MIME/CSP,
  excluded paths, mocked Supabase login, mocked HTTPS Worker retrieval, sign-out
  and reload. Provider requests were intercepted, not live sign-ins.
- Live preserved-asset drift check: five files match production byte-for-byte.
- Preservation check: 47 files (all data/ files, firmware/SPIFFS artifacts,
  original firebase.json and .firebaserc) match pre-task hashes.
- Syntax, deterministic generation and changed-file whitespace checks passed.
- A concurrent packaging-test collision was corrected by giving release tests
  their own generated scratch workspace; the final combined 26-test run passed.

The emulator is HTTP localhost; real Hosting HTTPS and real-user behavior must
be verified after approval/deployment. No deployment, migration, flashing or
credential provisioning has been performed. Existing real-user Sprint 1 success
is user-verified evidence, not a new production deployment claim.

## Rebuild and verify locally

From C:\Users\LENOVO\Desktop\HATCHAI:

```powershell
node tools/package-online-release.mjs
node tools/verify-online-release.mjs
node --test test/online-release.test.mjs
firebase emulators:exec --only hosting --project hatchai-8d34c --config firebase.online.json "node test/online-hosting.cjs"
```

The builder never deploys. Do not manually add files to the upload directory.

## Exact deployment sequence — APPROVAL REQUIRED

Record the current Firebase Hosting release in the console first for rollback.
Then, only after approval, from the project root:

```powershell
node tools/verify-online-release.mjs --check-hosting-baseline
if ($LASTEXITCODE -ne 0) { throw 'Release verification failed; do not deploy.' }
firebase deploy --only hosting --project hatchai-8d34c --config firebase.online.json
```

The live baseline check makes only public GET requests. It stops if notification
assets changed since review; refresh the preservation review rather than overwrite
them. The Hosting-only config contains no Functions, Firestore or dynamic rewrites,
so this command is not a Worker/Functions/database deployment. Do not use the
default firebase.json or deploy the whole public/ directory for this release.

After deployment, privately sign in at:
https://hatchai-8d34c.web.app/online-login.html
Confirm the owned incubator and Verified through deployed Worker message, check
Refresh, Sign out and reload, and inspect mobile widths. Measurements must remain
unavailable. Confirm /online redirects, unsupported pages return 404, and legacy
notification asset hashes are unchanged. Do not click notification enable/test
or operate actuators as part of this release verification.

If required, roll back Hosting to the recorded previous release through Firebase
Hosting release history. No database rollback or firmware operation is needed.

## Sprint 2 plan — only after frontend deployment verification

1. Inspect the current /api/data fields and sensor validity/time semantics. Define
   the smallest read-only telemetry payload, acquisition and receipt timestamps,
   source boot/sequence identity, and stale-data rules. Do not invent existing
   telemetry tables or infer valid data from connection status.
2. Review additive Supabase storage/index/retention SQL and a proposed authenticated
   Worker ingestion/read API. Enforce device-to-incubator ownership, bounded
   payloads, replay rejection, idempotent acknowledgements and rate limits. Approve
   schema changes separately before any execution.
3. Resolve the main controller's 48-byte application headroom BEFORE implementing
   firmware synchronization. Review safe code-size reductions without changing
   partitions, control behavior, recovery or eFuses. No firmware changes or flash
   operations are authorized by this frontend release.
4. Design a dedicated, revocable device credential and separately approved secure
   provisioning/rotation method. Never reuse the Supabase user password, expose
   service credentials, or use the old notification credential provisioner.
5. Implement, after approval, a bounded single-owner background HTTPS sender that
   snapshots already-acquired readings. Start with a proposed 30–60 second upload
   interval, a small bounded queue, capped backoff, certificate/time validation,
   and fixed timeouts. No cloud requests/locks in the PID or sensor/control loop;
   failure must never reboot the incubator or block SD logging/offline recovery.
6. Test loss of internet, stale/invalid measurements, queue saturation, duplicate
   submissions, restart and revoked credentials locally. Only then prepare a
   supervised load-isolated hardware test and measure control timing/heap/stack.
7. Connect online cards/history to verified synchronized data and expose its real
   last-sync timestamp. Keep remote actuators, chick delivery and camera firmware
   out of this telemetry increment.

## Task file changes

Modified: public/online-login.html (online-only responsive rules),
public/online-login.js (safe production-facing asset-load error),
test/shared-dashboard-browser.cjs (responsive cases).

Created: firebase.online.json, tools/package-online-release.mjs,
tools/verify-online-release.mjs, test/online-release.test.mjs,
test/online-hosting.cjs, docs/ONLINE_FRONTEND_RELEASE.md.

Generated: dist/hatchai-online/site, its outside-site manifest, the ignored
public Hosting preservation baseline and refreshed generated public/shared assets.
