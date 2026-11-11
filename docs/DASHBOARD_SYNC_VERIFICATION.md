# Shared dashboard and synchronization verification ? 2026-11-11

Scope: recommended development step 1. All browser accounts, device APIs and cloud
responses are synthetic; SQL tests use isolated PostgreSQL/PGlite. No live account,
ESP32, camera, production Worker, Supabase database or notification provider was
contacted. Later camera/hardware/deployment stages are not implied by these results.

## Reproduced and fixed locally

1. **History remained visible after access denial.** In the new Chrome fixture,
   readings cleared after 403 but 6,235 non-white chart pixels still represented
   the old history. Online failure/unavailable paths now clear every chart range,
   hitbox and tooltip. Authorized unchanged history does not acquire an extra
   clear/redraw cycle. Local last-reading/history behavior remains unchanged.
2. **Manual Refresh reused cached ownership/telemetry.** The online adapter accepts
   a forced refresh; the dashboard uses it only for the user action. The account
   list is rechecked before telemetry, and telemetry's short cache is bypassed.
   Normal polling retains its existing bounded five-second telemetry fetch cache.
3. **Selected incubator was not constrained to the current authorized list.** A
   new unit test reproduced a foreign telemetry read attempt. Selection now needs
   membership in the freshly verified list. Backend ownership enforcement was
   already present and remains intact.
4. **Denied forced refresh could resurrect cached data.** A unit test reproduced
   old data returning on the next poll after 403 within the five-second cache TTL.
   Failed authorization now invalidates cached/conditional state. Late responses
   from an older request/session cannot overwrite the current session cache.
5. **Refresh was unreachable in the hidden login container.** The existing action
   is now mounted in the online dashboard toolbar using the shared wrapping layout.
   It performs reads only. Network loss explicitly shows Unavailable with automatic
   retry feedback instead of the misleading Online account connection label.

Legacy browser fixtures were updated for valid UUIDs, the current owner selector,
shared page navigation, notification onboarding preferences and logout confirmation.
Their authentication, XSS, late-completion and no-secret assertions remain in place.
Selected harnesses now accept local test tool paths. Native outputs are redirected
to ignored dist/test-output; generated tracked artifacts modified by the first native
run were preserved there and restored to their pre-task tracked content.

## Executed validation

| Area | Actual result |
| --- | --- |
| Worker/auth/ownership/telemetry/SQL tests | 160 passed, 0 failed |
| Focused frontend Node tests | 33 passed, 0 failed |
| Shared signed-in account browser | 61 checks passed |
| Shared local/online page and responsive browser | 367 checks passed |
| Existing local dashboard/control/batch/prediction browser | 155 checks passed |
| Existing local recovery/component browser | 50 checks passed |
| Live/stale online telemetry browser | 7 checks passed |
| New isolated online recovery browser | PASS: access denial, chart clearing, immediate owner refresh, network/stale/recovery, private local batches, read-only operations |
| Real controller retry and camera record portable helpers | PASS: lost ACK, long Retry-After, bounded backoff, auth pause, rollover, record integrity |
| Native protocol/state suite | 116 passed, 0 failed |
| Cross-language protocol vectors | 30 passed; 10 native signatures accepted by actual Worker verifier; tampering rejected |
| Actual exported Random Forest | 504 inputs passed across days 1?21 |
| JavaScript syntax and git diff whitespace | PASS |
| Existing-partition SPIFFS build | PASS; 1,441,792-byte spiffs.bin |

Initial failing regressions were observed before the relevant patches. The first
separate model compile exceeded a 180-second cold-cache budget; it passed after
using the warmed compiler cache and the same documented Zig 0.13.0 version. No
failed run is counted as a pass.

The browser uses installed Chrome and pinned Playwright Core 1.56.1. Native checks
use pinned Zig 0.13.0. SDK-required mkspiffs 2.230.0 was installed for buildfs; the
Espressif32/Arduino/compiler versions were not upgraded. Reproduction commands are
in test/README. Screenshots are under ignored dist/sprint1-review. The online
mobile screenshot was visually inspected for wrapping/overflow and Refresh visibility.

## What is and is not synchronized

- Owner-scoped incubator lookup and telemetry/history operate through authenticated
  Worker reads. Database tests cover owner rejection, revocation, replay, dedup,
  permissions and conditional-response authorization.
- Online polling hides stale live readings, re-ages cached/304 data monotonically,
  clears inaccessible history, and recovers without manually restarting the page.
- Local batch records, labels, selected-batch predictions and recovery imports retain
  their existing behavior. Browser tests cover batch changes, device acknowledgment,
  preserved start/turning timestamps and exact recovered metadata.
- **Cloud batch-record and prediction synchronization is not implemented.** The
  online adapter deliberately supplies no local batch store and blocks prediction
  commands. Online UI shows Unavailable; seeded private local batches remain local.
  This pass verifies that boundary; it does not implement cloud batch/prediction
  storage or claim that the whole product is feature-complete online.
- Online controls, Wi-Fi changes, turn requests and batch mutations fail closed.
  The strict browser fixture permits no device endpoint or online hardware write.
- Model checks establish bounded finite monotonic outputs and the exported model's
  current incubation-day-only dependence. They do not validate biological hatch
  accuracy, retrain the model or alter its inputs/rounding.

## Preservation and remaining stages

No credentials, gates, migrations, cloud deployment, actuator rules or firmware
security checks were changed in this pass. The prior optimized firmware binary is
unchanged (SHA-256 6e90877617471c603bca02c51649f6d6e6c31f4c3c18874dab65229cf2dc894e).
Only the web filesystem image was rebuilt; nothing was flashed or published.

Real provider integration and physical timing remain unverified by these mocks and
portable-code checks. Continue with the requested ESP32-S3 upper/lower camera
integration stage, then the controlled full-system environment. Production readiness,
supervised electrical/hardware checks and staged deployment remain later stages.
