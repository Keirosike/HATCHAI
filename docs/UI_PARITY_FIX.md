# Local / online UI parity correction

## Confirmed bugs corrected

- Removed online-only dashboard grid and font overrides and the large account/verification card that shifted the local layout.
- Replaced simultaneous hidden pages with one active canonical page. This removes duplicate element IDs, cross-page stylesheet collisions and stale chart/navbar handlers.
- Page packaging now includes full body markup, page-specific CSS and local dialogs for Dashboard, Control, Camera, Batch, Settings and Logs. Camera stylesheet links without a trailing slash are now parsed correctly.
- Online Control is the real local layout with all hardware operations disabled. Batch form preview is available but Save/Edit/Delete are disabled without cloud batch storage. Settings retains the local layout and native Notifications entry.
- Logs layout is copied, but its local example records are not presented as real cloud records.
- Fixed local Logs grid minimum sizing so its table scrolls inside its card instead of widening the mobile page. This shared CSS-only fix is prepared locally, not uploaded to ESP32.
- Unavailable temperature/humidity use the existing smaller status-value typography, preventing wrapping at intermediate desktop widths. This branch applies only to online unavailable states.
- Login authentication remains separate; page-specific login styling is disabled after login and restored on logout. Fast navigation is serialized; old view handlers are disposed.

## Verification

43 frontend Node tests passed. Native notification browser suite: 20 checks passed. Online authentication browser suite: 29 checks passed.

Expanded local-vs-online browser suite: 342 checks passed at 375, 812, 950, 1024 and 1280 pixels, including local/online navbar, page and card x/width comparison, one active page, unique IDs, repeated navigation, mobile menus, readonly batch dialog, disabled hardware controls, no ESP32 API requests and logout/style restoration. Supabase/Worker responses were mocked; no physical-device verification is claimed. Screenshots were also visually inspected for dashboard desktop and Settings mobile.

SPIFFS build passed without uploading. No firmware/control, Worker, database, credential, subscription or notification service-worker implementation changes were made in this correction.

The public-only Hosting package contains 42 allowlisted files. No firmware, private credentials, backups or development/test files are included.

## Source changes

- public/online-dashboard.js: isolated page renderer and online readonly adapters.
- tools/package-online-dashboard.mjs: complete canonical page/style/dialog packaging.
- tools/verify-online-release.mjs: 42-file release integrity contract.
- data/js/dashboard.js: bounded unavailable-text presentation using existing typography.
- data/log.html: mobile table/grid width fix.
- test/shared-online-sprint.cjs: cross-page browser parity/regression tests.
- test/shared-dashboard-package.test.mjs and test/online-release.test.mjs: expanded package contracts.
- Generated public/online-login.html, public/shared and dist/myhatchai outputs; Hosting cache.

Online readings, predictions, batches, camera streams and logs remain unavailable until synchronized; layouts do not establish live functionality. Native Android push delivery remains a separate unverified device issue.

Rollback reference: dist/myhatchai/ui-parity-before.json, previous Hosting version b41bf34c678497c8. Only Firebase Hosting site myhatchai is targeted.

Deployed Hosting version: 467ef05f770c13ab; release 1794284132415000. All 42 public asset hashes matched the tested release after deployment. Production Worker unauthenticated access still returned 401.

## Login and navigation follow-up
Replaced the separate password action with an accessible eye button inside the shared password input. Online sign-in and navigation now show a circular loading overlay. Active page markup remains hidden until its stylesheets load, with an eight-second stylesheet timeout and safe failure message. This prevents the oversized unstyled-logo flash. Tests: 350 shared browser checks including delayed lookup and delayed stylesheet tests, 43 frontend tests, 29 authentication browser checks and 20 notification browser checks passed. SPIFFS built but was not uploaded. Deployed to myhatchai only; served login, scripts and password CSS hashes verified. Source changes: data/index.html, data/css/login.css, data/js/login.js, public/online-login.js, public/online-dashboard.js, tools/package-online-dashboard.mjs, test/shared-online-sprint.cjs and generated public/online-login.html/shared/release files. No firmware or backend changes.

## Combined account card, modal close and skeleton follow-up
Notifications now lives beside the profile inside the single User Account card, wrapping within that same card on phones. Native notification close is upper-right; only Enable and Disable remain in the bottom actions. Local HTTP notification UI uses the same presentation without cloud authorization. Online logout now requires confirmation; Cancel preserves the session. Skeleton screens replace the spinner for sign-in, navigation, refresh and confirmed logout; style loading still gates page visibility. Tests: 363 shared browser checks, 23 native notification browser checks, 29 auth browser checks and 43 frontend Node tests passed. SPIFFS built locally, not uploaded. Mobile screenshots were visually reviewed. Deployed only to myhatchai; changed public asset hashes matched the release. No firmware, backend, secrets or database changes. Files: data/settings.html, data/css/settings.css, data/css/modal.css, data/js/offlineNotifications.js, public/native-push/modal.js, public/online-login.js, tools/package-online-dashboard.mjs, test/native-push-browser.cjs, test/online-auth-browser.cjs, test/shared-online-sprint.cjs and generated Hosting assets.

## Invalid-login follow-up
Loading captions are visually hidden, with an accessible status retained. Authentication checks keep the form visible; skeleton loading begins only after successful authentication. Invalid credentials display Invalid email or password beneath Sign In using the shared local status error styling. Local UI maps 401 to the same generic message without changing authentication rules. Verified 35 auth browser checks (including a delayed wrong-password response and no-skeleton observer), 367 shared browser checks, 43 frontend tests, local SPIFFS build and deployed login asset hashes. No flashing or backend changes.
