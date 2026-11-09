# Official HATCHAI website — prepared for approval

The user's latest instruction requires showing the target, contents and command
before deployment. No Hosting deployment or live Worker CORS update was performed.
This supersedes the earlier default-site release proposal.

## Verified target

Firebase CLI read-only hosting:sites:list returned BOTH sites in project
hatchai-8d34c:
- projects/hatchai-8d34c/sites/hatchai-8d34c — existing DEFAULT_SITE.
- projects/hatchai-8d34c/sites/myhatchai — existing USER_SITE.

Official origin: https://myhatchai.web.app
firebase.online.json explicitly sets hosting.site = myhatchai and
hosting.public = dist/myhatchai/site. No target alias is needed. The installed
Firebase CLI's hosting filter resolves hosting:myhatchai only to myhatchai.
The original firebase.json and .firebaserc are unchanged. No site was created.

Root /, /online and /dashboard.html redirect to /online-login.html. The deployed
Worker URL remains https://hatchai.kurtzidrickguno-robles.workers.dev. The existing
shared dashboard is generated from data/, not manually duplicated. Local test
mode remains loopback-only. Online commands stay unsupported and local-only
pages/APIs are not packaged.

## Package

Directory: dist/myhatchai/site — 22 public files, 200,793 bytes.
The old dist/hatchai-online package is retained but is NOT the deployment target.
The SHA-256 manifest is outside the upload directory: dist/myhatchai/manifest.json.
Prepared manifest SHA-256:
385BDB822EFBC85591205211888CCB333EF77D9EBB853C8177790C93F3BF91B4

Included online/auth assets (7):
- online-login.html
- online-login.js
- online-dashboard.js
- supabase-auth.js
- incubator-read.js
- online-api-settings.js
- cloud-notification-settings.js

Dormant messaging assets (3):
- firebase-config.js
- push-settings.js
- firebase-messaging-sw.js

Generated shared dashboard assets (12):
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

The allowlist excludes the old LCD notification page/enrollment scripts on this
new origin. It also excludes private keys, backups, firmware, tests, native
binaries, tools, node_modules and development configuration. The public
publishable key, Firebase app configuration and VAPID public key are expected
public values. No privileged service-role key is used.

## Worker CORS — staged only

Live read-only observations:
- myhatchai origin preflight: 403, not yet approved in production.
- hatchai-8d34c origin preflight: 204, approved.
- http://127.0.0.1:8080 preflight: 204, approved.

Read-only version metadata confirmed current ONLINE_ALLOWED_ORIGINS contains
the loopback origin; the original Hosting origin is also allowed by existing
Worker code. The prepared wrangler.jsonc value preserves both and adds myhatchai:

```text
http://127.0.0.1:8080,https://hatchai-8d34c.web.app,https://myhatchai.web.app
```

This local binding change has NOT been applied. It must go live before the new
website can retrieve incubators. No wildcard, auth bypass or device credential
change is introduced. Existing secrets, DB binding, rate limits, logging settings
and disabled notification flag are preserved. New tests verify all three origins
still require authentication. /chick-detected remains disabled.

Pre-change deployed Worker version for rollback:
f32c9dd5-bd54-42fe-b2a9-722efef6a99b

## Supabase and messaging checks

Current code uses email/password POST /auth/v1/token followed by GET /auth/v1/user;
there is no redirect parameter in this flow. Memory-only session/expiry/logout
behavior and Worker/RLS ownership checks are unchanged. Supabase's password-route
preflight accepts the myhatchai Origin (200, Access-Control-Allow-Origin: *).
That is transport evidence, not proof of a valid user's sign-in.

Administrative Supabase Site URL and Redirect URLs are UNVERIFIED: the requested
non-secret values were not provided and no management credential was used. No
Supabase configuration was changed. Password sign-in does not require a redirect
callback in this implementation. Email confirmation/reset/OAuth callback flows
are not implemented or verified here. Before adding those flows, review URL
Configuration in Supabase and add the new origin/callback paths while preserving
existing approved entries; do not assume those settings have been changed.

Both Firebase app and service-worker configuration reference hatchai-8d34c and
SDK 13.2.0. The VAPID public key matches the current old Hosting site. No Firebase
project, app, key or user account was recreated. Firebase Auth is not used by the
online sign-in, so this task does not change its authorized-domain settings.

The messaging files are served for future integration but the dashboard never
registers the service worker or requests push permission. Emulator browser checks
confirmed zero service-worker registrations. New-origin tokens/subscriptions will
need separate authorized enrollment and delivery review; registrations on the old
origin do not transfer automatically. API-key referrer restrictions and live FCM
delivery for the new origin remain unverified. Notifications are not enabled.

## Verification results

- 27 unit/adapter/auth/packaging/session tests passed.
- 93 Worker tests passed, including new-origin CORS/auth isolation.
- 61 shared-dashboard browser checks passed.
- 29 existing sign-in browser checks passed.
- 105 Firebase Hosting emulator checks passed, with log target hosting[myhatchai].
  These cover actual static routes/headers/CSP/MIME and all file hashes, plus
  mocked Supabase/Worker sign-in, account retrieval, sign-out, reload, dormant
  service worker and hidden/absent hardware-control paths.
- Packaging rejects an accidental default-site target and unexpected files.
- Release manifest/source verification and JS syntax/whitespace checks passed.
- Read-only hashes confirm the original Hosting site is unchanged.
- 47 monitored files (data/, firmware/SPIFFS images and original Firebase config)
  match their pre-task hashes. No firmware or physical hardware was accessed.

The new website currently returns 404 because no release has been deployed.
No public real-user test on myhatchai has been performed. Prior real-user success
on localhost/deployed Worker is not claimed as proof of this new site's login.

## Commands — do not run until approval

From C:\Users\LENOVO\Desktop\HATCHAI, offline package preparation:

```powershell
node tools/package-online-release.mjs
node tools/verify-online-release.mjs
```

After approval, first apply the prepared Worker CORS binding update, preserving
its variables and other bindings:

```powershell
node C:/Users/LENOVO/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/bin/wrangler.js deploy --config cloudflare-worker/wrangler.jsonc --keep-vars
```

Check OPTIONS /online/incubators for https://myhatchai.web.app returns 204 and
matching Access-Control-Allow-Origin before proceeding. Missing/invalid tokens
must still fail. No database migration is required.

Then deploy ONLY the verified named Hosting site:

```powershell
node tools/verify-online-release.mjs --check-original-site
if ($LASTEXITCODE -ne 0) { throw 'Release verification failed; do not deploy.' }
firebase deploy --only hosting:myhatchai --project hatchai-8d34c --config firebase.online.json
```

This config contains no Functions/Firestore deployment or dynamic backend rewrite.
Do not run firebase init, deploy using the default config or copy the entire
project/public directory to the site. The existing default site is not targeted.

## Required post-deployment checks

1. Open https://myhatchai.web.app/; confirm same-origin redirect to sign-in.
2. Privately sign in with the existing Supabase account. Do not share passwords,
   access tokens, request headers or exported browser network archives.
3. Confirm the owned incubator, Verified through deployed Worker message and
   shared dashboard. Monitoring values must remain Unavailable.
4. Check refresh, sign-out and reload; no remembered authenticated dashboard.
5. Check mobile/desktop labels, asset hashes/CSP and 404 for unsupported pages.
6. Confirm old Hosting asset hashes and old approved CORS origins are unchanged.
7. Keep chick notifications and telemetry disabled/pending. Do not trigger any
   notification test or physical control as part of verification.

Rollback, if needed, applies only to the myhatchai release and the recorded Worker
version. Never roll back or redeploy the old Firebase Hosting site. On the first
release there may be no prior myhatchai content to roll back to; confirm its
release history immediately before deployment.
