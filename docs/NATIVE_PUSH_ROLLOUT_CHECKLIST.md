# Native Web Push rollout checklist — security review 2026-11-10

## Production RPC installation verified — 2026-11-10

The user's post-install exports (12)–(15) supersede earlier uninstalled-function
status below. **Database installation verification: PASS.** All five exact RPC
signatures exist; total hatchai_push function count is five. Each owner is
postgres with BYPASSRLS=true, SECURITY DEFINER=true and search_path=pg_catalog.
ACLs contain only postgres and service_role EXECUTE; effective anon/authenticated
EXECUTE=false and service_role EXECUTE=true. Tables remain postgres-owned;
incubator RLS=true/forced=false and subscription RLS=true/forced=true. Counts:
one incubator, zero subscriptions, zero enabled subscriptions. No failed checks
in these exports. SQL installation was performed by the user, not by automation.

Next rollout stage is backend/VAPID configuration and registration-only deployment
under the user's standing approval. This process currently has no Supabase/backend
or VAPID environment variables/local dev secret files, and no local/global Wrangler
executable was found. Existing production secret presence and deployment access
must be established without printing values before staging. Do not substitute a
previously exposed secret or a synthetic test key. No Worker/Hosting deployment
or real-device notification is established by the successful database checks.

## Final exported production metadata review — 2026-11-10

**Current decision: database prerequisites PASS for separate additive-RPC migration
approval; overall production rollout remains HOLD.** This section supersedes the
historical UNVERIFIED database prerequisites and Step 1 execution-status statements
below. No migration, production privilege change, deployment or notification was
executed by this review. Evidence consists of the user's exported CSVs in Downloads.

| Check | Status | Verified exported result |
| --- | --- | --- |
| Column types / nullability | PASS | Earlier unnumbered CSV matches the required subscription columns |
| Required defaults | PASS | CSV (8): id=gen_random_uuid(), enabled=true, created_at=now(), updated_at=now(); all four NOT NULL |
| Migration executor / forced-RLS access | PASS | CSV (1), (5), (9): executor postgres; SUPERUSER=false, BYPASSRLS=true, table access and schema CREATE/USAGE present |
| Unique endpoint index | PASS | CSV (2), (3): full btree endpoint unique index, valid/ready/live/immediate, no predicate; constraint non-deferrable and validated |
| Supporting lookup indexes | PASS | Valid (user_id,incubator_id) subscription index and incubator owner index present |
| FK definitions / delete actions | PASS | Subscription user FK to auth.users(id) and incubator FK to public.incubators(id), validated ON DELETE CASCADE; incubator owner FK ON DELETE RESTRICT retained |
| CHECK constraints | PASS | CSV (3): validated endpoint HTTPS/length/no whitespace, p256dh/auth base64url lengths and label length bounds match local schema |
| RLS and policies | PASS | CSV (4): subscription RLS enabled+forced, no policies; incubator RLS enabled, not forced, authenticated SELECT only via auth.uid()=owner_id; no change to either table proposed |
| Browser table/schema access | PASS | CSV (5): no subscription CRUD for anon/authenticated; public CREATE=false; authenticated has incubator SELECT only; schema USAGE available |
| Browser escalation through memberships | PASS | CSV (9): both browser roles have only self paths, no privileged membership, SUPERUSER/BYPASSRLS/CREATEROLE=false. Self MEMBER/USAGE/SET=true is normal, not escalation |
| Backend schema access | PASS | service_role has public USAGE; lacks direct table CRUD as intended; definer functions provide reviewed access after installation |
| Existing RPC name collisions | PASS (previous inspection) | User reported no hatchai_push_* functions; confirm still absent immediately before separately approved installation |
| Aggregate visibility / counts / quota | PASS | CSV (10): full RLS visibility=true; total=0, enabled=0, disabled=0, over-quota incubators=0, maximum retained=0 |
| Ownership consistency | PASS (previous inspection) | User reported zero mismatches; empty subscription table now independently confirmed |
| Planned RPC SECURITY DEFINER / search_path / grants | PASS (local review/test) | Five functions; fixed pg_catalog path; qualified tables; PUBLIC/anon/authenticated EXECUTE revoked, service_role EXECUTE granted in one transaction |
| Actual installed RPC owner / ACL / execution | UNVERIFIED — post-install gate | No RPC migration has been executed; verify actual postgres ownership, BYPASSRLS, effective browser denial/backend EXECUTE, schema access and runtime behavior after approval |

The three final exports are (8)=01_column_defaults, (9)=07_role_paths,
(10)=08_subscription_counts. Earlier (6) and (7) duplicated section 06; they were
not membership/count evidence. All eight required metadata sections are now covered.

The migration contains no explicit OWNER clause: execute it as the verified
postgres current_user to obtain the reviewed definer ownership. BYPASSRLS is what
permits that definer to access the forced-RLS table; the backend's BYPASSRLS alone
would not replace missing table privileges. The backend remains a trusted boundary:
the Worker must derive p_user from verified Auth, not browser-supplied identity.

**Exact next approval-dependent mutation:** execute only
`supabase/migrations/202611100001_native_push_rpc_REVIEW.sql` as one transaction
using postgres. Reviewed SHA-256:
`3A7F4568A4F2136F288D759B25850900B566F7C4E2FFF5F0E5BE15ACB833EA1F`.
Do not rerun the CREATE TABLE migration or use unrestricted db push. This document
does not authorize execution. Record rollback baselines before later deployment;
after separately approved SQL installation, re-inspect function owners/ACLs and
confirm unchanged RLS and aggregate counts before proceeding to secrets or code.
VAPID configuration, actual backend RPC acceptance and Android registration remain
later gates; live delivery, camera ingestion and chick-detected stay disabled.

**Decision: HOLD.** This is a deployment plan, not deployment authorization.
The first requested approval is a read-only production database metadata check.
Do not apply the migration, change secrets, upload a Worker version, deploy Hosting,
send a notification or operate hardware under that approval.

## Production database verification update — 2026-11-10

**Decision: HOLD; additive RPC migration is not yet ready for execution approval.**
The user reports the read-only inspection was completed. The findings below are
user-supplied production evidence, compared with the local SQL; no production SQL
was executed by this review. Earlier statements below that Step 1 is unexecuted
describe the previous local review, not the user's subsequently completed inspection.

| Database check | Status | Evidence / outstanding condition |
| --- | --- | --- |
| Subscription table exists | PASS | Reported `public.web_push_subscriptions` exists |
| Required column types and nullability | PASS | Reported metadata matches the required contract |
| Subscription RLS enabled and forced | PASS | Both reported true; migration leaves them unchanged |
| Table ownership | PASS | Both tables reported owned by postgres; this alone does not establish forced-RLS bypass |
| Browser effective table SELECT/INSERT/UPDATE/DELETE | PASS | anon/authenticated reported false for all four |
| Browser membership in service_role | PASS | Neither browser role is reported a member |
| service_role self-membership | PASS | Expected reflexive membership; does not give browser roles access |
| Backend lacks direct subscription table privileges | PASS | Compatible with the intended definer-only RPC path; no table grant is required if the definer has access |
| Other role memberships, SET ROLE paths and schema CREATE | UNVERIFIED | Need browser membership/SET ability toward privileged owners, public schema CREATE results, and relevant role attributes; service_role membership check alone is not a complete escalation audit |
| Incubator SELECT policy and subscription policy definitions | UNVERIFIED | Exact current policy expressions not included in the latest supplied findings; retain owner-only incubator read policy and review any unexpected subscription policies |
| Existing hatchai_push_* functions / collision risk | PASS | None reported; expected before additive installation; recheck immediately before installation |
| UNIQUE(endpoint) constraint presence | PASS | Reported present; prevents duplicate endpoints across phones/incubators |
| Unique index usable by ON CONFLICT(endpoint) | UNVERIFIED | Need valid, ready, immediate non-partial endpoint index and non-deferrable constraint definition |
| User and incubator FK presence | PASS | Both reported present |
| FK targets, validation and delete actions | UNVERIFIED | Need exact validated definitions; local contract references auth.users(id) and public.incubators(id), both ON DELETE CASCADE |
| Endpoint/key/label CHECK constraint presence | PASS | All four reported present |
| Exact CHECK definitions and validation | UNVERIFIED | Compare expressions/validated flags with the existing-table draft; presence alone does not prove bounds |
| Insert defaults | UNVERIFIED | RPC omits id, enabled, created_at and updated_at: require UUID generation, true, now() and now() respectively, or verified equivalent defaults |
| User/incubator lookup index | UNVERIFIED | Confirm web_push_subscriptions_user_incubator_idx or equivalent definition; missing index is a scale/performance concern, not authorization bypass |
| Total/enabled subscription counts | UNVERIFIED | Aggregate results not supplied |
| Existing retained-row quota | UNVERIFIED | Need incubators_over_retained_quota; local policy counts disabled and enabled rows toward 20 per incubator |
| Current ownership consistency | PASS | Reported subscriptions_with_changed_incubator_owner=0; empty table also yields zero; validated FKs/nullability provide separate orphan protection |
| Planned function SECURITY DEFINER / search_path / SQL | PASS | All five local definitions use SECURITY DEFINER, fixed pg_catalog search_path, qualified persistent tables and no dynamic SQL |
| Planned ownership checks and endpoint immutability | PASS | Subscribe/status/unsubscribe lock and check incubator ownership; subscribe refuses endpoint reassignment; expire is backend-only with key-match race protection; cleanup is backend-only and bounded |
| Planned EXECUTE grants | PASS | One transaction revokes PUBLIC/anon/authenticated and grants service_role for all five exact signatures |
| Actual future function owner and forced-RLS access | UNVERIFIED | CREATE FUNCTION uses current_user as owner; no explicit OWNER clause. Confirm intended executor, its table access and rolsuper OR rolbypassrls=true; postgres ownership/name alone is insufficient |
| Installed function ownership and effective EXECUTE | UNVERIFIED | Functions do not yet exist. After approved installation verify owners, search_path, effective browser denial/backend EXECUTE, schema USAGE and unexpected ACL grants from default privileges/role inheritance |
| Backend production RPC execution | UNVERIFIED | Local PostgreSQL test exercises SET ROLE service_role; actual Supabase REST execution remains a later controlled acceptance check |

With FORCE ROW LEVEL SECURITY, a normal table owner remains subject to policies.
A superuser or BYPASSRLS definer can access the table despite FORCE; the invoker's
lack of direct table privileges then does not prevent a permitted RPC call.
Do not grant browser writes, disable FORCE/RLS, or infer postgres attributes from
its name. The intended trusted backend can supply arbitrary p_user values to these
RPCs; the Worker must continue deriving that value from verified Supabase Auth.
This is a privileged-backend trust boundary, not a database user-token check.

Endpoint uniqueness deliberately binds one browser endpoint to one incubator.
Same-owner/same-incubator repeats update keys/label without another row; different
owners/incubators conflict. FK existence does not enforce incubator ownership;
the RPC's locked owner comparison provides that authorization. Two cameras in
one incubator share the same registered browser. No camera delivery is enabled.

**Next approval-dependent action:** a narrowly scoped read-only metadata follow-up
for column_default, full constraint/index definitions and validation, postgres and
executor role attributes/memberships, schema privileges, current policy expressions,
and total/enabled/quota counts. Review exported metadata only; do not export rows,
endpoints or keys. The prior inspection did not select column_default, constraint
validation flags or full privileged-role membership paths. Do not apply either
migration to fill these evidence gaps. After those prerequisites pass, request
separate approval for only 202611100001_native_push_rpc_REVIEW.sql, with post-install
owner/ACL/RLS verification. No production settings or firmware changed here.

## Review findings

| Area | Local assessment | Production condition |
| --- | --- | --- |
| SQL authorization | Fixed `pg_catalog` search path; qualified table references; browser/PUBLIC EXECUTE revoked; only service_role granted EXECUTE; verified user supplied by Worker, checked against incubator owner again in SQL | Verify actual function owner, role inheritance/BYPASSRLS, table schema, grants and absence of conflicting function signatures |
| RLS | Migration does not alter or disable existing RLS and adds no browser table grants | RLS enabled AND forced must still be true; authenticated/anon must have no direct subscription write access |
| Ownership and uniqueness | Owner lock and UNIQUE endpoint upsert refuse a different user/incubator; metadata update does not transfer ownership | Confirm NOT NULL ownership columns and existing UNIQUE endpoint constraint; stage true concurrent PostgREST tests |
| Retention | Maximum 20 retained rows/incubator; disabled rows count toward quota; cleanup deletes at most 500 disabled rows older than 30 days; active records preserved | Cleanup is not scheduled. Do not add it to cron in this rollout. Confirm quota/retention policy is acceptable |
| Backend secret | New-style Supabase secret accepted only on server `apikey` header; client continues using user bearer token plus public key for Auth/RLS | Actual secret configuration is unverified. Never reuse a previously exposed secret |
| VAPID | Pinned Web Crypto library; independent decryption/signature tests passed using synthetic keys | Matching stable production pair not verified; private key must never enter Hosting assets or command arguments |
| Runtime | PASS: pinned Miniflare 5.20261109.0-beta / workerd 1.20261109.1; all runtime suites pass at 2026-11-07 with compatibility flags [] | Production deployment metadata still requires verification; no deployed setting changed |
| Service workers | Dedicated `/native-push/` scope, exact-scope conflict rejection, no Firebase unregister/overwrite | Verify actual browser registrations and Android support without printing PushSubscription contents |
| Hosting | Read-only verifier passed again: 27 allowlisted assets; site=myhatchai; project=hatchai-8d34c; no SPA rewrite catches worker URL | Public deployed candidate, authenticated registration and browser delivery are not yet verified |
| Live sending | Gate false; sender not connected to public routes/cron; chick endpoint remains disabled | Keep disabled. Camera authenticator and durable event/outbox repository are not implemented/wired |

Retry-After blocker **resolved locally**: numeric delays are no longer capped at five
minutes; IMF-fixdate, RFC850 and asctime HTTP dates are parsed with UTC validation.
The scheduler persists an absolute deadline without sleeping. It never retries
before the provider deadline; waits beyond event expiry or the three-attempt limit
terminate without another send. Overflow/oversized values fail closed; malformed or
missing values use the existing 30-second fallback. Camera ingestion and sending
remain disabled because production verification and the durable outbox are pending.

Operational limitations: a subscription is bound to one incubator by the existing
UNIQUE endpoint contract; both cameras in that incubator share it. Incubator ownership
transfer requires a separate registration-revocation policy. Cleanup removes the
historical endpoint ownership record after 30 days disabled; do not claim permanent
tombstone protection. The subscription quota limits rows, not cleanup scan cost;
review an index if this grows beyond the current single-incubator scale.

### Follow-up verification results

- Worker suite: **122 passed, 0 failed** (19 added retry/config regression tests).
- Frontend/auth/packaging/service-worker suite: **38 passed, 0 failed**.
- Exact-date runtime: **234 isolated requests passed**: 19 smoke, 205 hardening,
  2 online, 8 native crypto/retry/API; 11 hardening scenarios passed.
- Runtime settings: date **2026-11-07**, flags **[]**, no date override. These are
  the checked-in production settings; deployed metadata is not yet attested.
- Independent crypto interoperability passed inside workerd with synthetic keys.
- Dependency audit: **0 known vulnerabilities**. Hosting-only package verifier PASS.
- Standalone production inspection SQL and version-recording commands: prepared,
  **not executed**. No production data or service configuration changed.

Files changed in this follow-up: `cloudflare-worker/package.json`, `package-lock.json`,
`src/native-push-delivery.js`, new `src/native-push-retry.js`,
`test/native-push.test.js`, new `test/native-push-retry.test.js`,
new `test/runtime-config.mjs`, new `test/runtime-config.test.js`,
`test/runtime-smoke.mjs`, `test/runtime-hardening.mjs`, `test/runtime-online.mjs`,
`test/runtime-native-push.mjs`, new `supabase/inspect_native_push_rollout.sql`,
this checklist and `docs/NATIVE_PUSH_SPRINT2.md`. Worker-relative paths in that
list are relative to `cloudflare-worker/`. Prior unrelated working-tree changes
were retained.

## 0 — Freeze the candidate and establish prerequisites (local/read-only)

From PowerShell:

```powershell
Set-Location 'C:\Users\LENOVO\Desktop\HATCHAI'
git status --short
node tools/verify-online-release.mjs
Get-FileHash .\dist\myhatchai\manifest.json -Algorithm SHA256
Get-FileHash .\supabase\migrations\202611100001_native_push_rpc_REVIEW.sql -Algorithm SHA256
```

Expected: verifier PASS, 27 files, site myhatchai, only reviewed source. Record the
manifest and migration hashes privately with the release record. Existing firmware
cleanup changes are unrelated and must not be included in any firmware upload.

Local runtime verification now uses the exact date and flags directly from
wrangler.jsonc; a divergent date override is rejected. No production date/flags changed:

```powershell
Push-Location .\cloudflare-worker
Remove-Item Env:HATCHAI_RUNTIME_COMPAT_DATE -ErrorAction SilentlyContinue
npm test
npm run test:runtime
Pop-Location
```

Expected: 122 automated tests and all runtime suites pass at date 2026-11-07,
flags []. The runtime pin is a prerelease **test harness only**; the underlying
workerd binary is pinned to 1.20261109.1. Local PostgreSQL/D1 test databases and fake
providers were used. No production SQL or live notification was executed.

Use a reviewed/pinned Wrangler version for later commands and record `npx wrangler
--version` and `firebase --version`. Wrangler is not a pinned dependency in the current
project; do not silently download an unreviewed version during deployment.

## 1 — FIRST APPROVAL GATE: inspect production metadata, read-only

The complete read-only script is [supabase/inspect_native_push_rollout.sql](../supabase/inspect_native_push_rollout.sql).
It is prepared for review and **has not been executed against Supabase**.
Review its hash and contents locally; do not paste/run it in SQL Editor until approved:

```powershell
Get-FileHash .\supabase\inspect_native_push_rollout.sql -Algorithm SHA256
Get-Content .\supabase\inspect_native_push_rollout.sql
```

Required metadata: role BYPASSRLS/inheritance; table owner and enabled/forced RLS;
column types/nullability; PK/FKs/check constraints; valid full UNIQUE endpoint
index; current RLS policy expressions; effective SELECT/INSERT/UPDATE/DELETE and
schema CREATE grants; backend-role membership; function signatures/owners,
SECURITY DEFINER, search_path and effective EXECUTE grants; aggregate record/quota
and changed-owner counts. It never selects endpoints, encryption keys or credentials.
No existing functions is an expected pre-migration result; verify the planned
migration executor can support forced-RLS SECURITY DEFINER operations, and verify
actual function owners/grants again after separately approved installation.

Expected: schema matches the existing table contract; enabled+forced RLS;
authenticated/anon lack direct writes; UNIQUE endpoint and ownership FKs/NOT NULL;
approved migration executor can support the SECURITY DEFINER functions with forced
RLS. Do not grant browser writes or weaken RLS to resolve a mismatch. Unexpected
existing hatchai_push functions must be reviewed, not overwritten. STOP after this
check and request approval for the additive migration separately.

## 2 — Record rollback baselines before any mutation (later approval)

Commands below are prepared, **not executed**. Use the reviewed installed Wrangler
version; --no-install prevents an unexpected package download. If unavailable,
stop and arrange a reviewed local tool installation. These commands do not deploy.

```powershell
Set-Location 'C:\Users\LENOVO\Desktop\HATCHAI'
$RollbackDir = Join-Path (Get-Location) ('backups/rollout-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $RollbackDir -ErrorAction Stop | Out-Null
npx --no-install wrangler --version
firebase --version
npx --no-install wrangler deployments list --config .\cloudflare-worker\wrangler.jsonc |
  Tee-Object -FilePath (Join-Path $RollbackDir 'cloudflare-deployments.txt')
if ($LASTEXITCODE -ne 0) { throw 'Deployment metadata lookup failed; stop.' }
npx --no-install wrangler versions list --config .\cloudflare-worker\wrangler.jsonc |
  Tee-Object -FilePath (Join-Path $RollbackDir 'cloudflare-versions.txt')
if ($LASTEXITCODE -ne 0) { throw 'Version metadata lookup failed; stop.' }
$HostingOutput = firebase hosting:channel:list --site myhatchai --project hatchai-8d34c --config firebase.online.json --json
if ($LASTEXITCODE -ne 0) { throw 'Hosting metadata lookup failed; stop.' }
$HostingMetadata = $HostingOutput | ConvertFrom-Json
if ($HostingMetadata.status -ne 'success') { throw 'Hosting metadata lookup was not successful.' }
$Live = @($HostingMetadata.result.channels | Where-Object { $_.name -match '/channels/live$' })
if ($Live.Count -ne 1 -or -not $Live[0].release.name -or -not $Live[0].release.version.name) {
  throw 'Live release/version metadata missing. Verify in Firebase Console; do not guess.'
}
[pscustomobject]@{
  project='hatchai-8d34c'; site='myhatchai'; channel=$Live[0].name
  release=$Live[0].release.name; version=$Live[0].release.version.name
  releaseTime=$Live[0].release.releaseTime
} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $RollbackDir 'firebase-live-baseline.json')
```

The installed Firebase CLI's channel-list implementation was inspected locally:
it accepts --site and returns channels in JSON. Baseline IDs themselves are still
unverified. Keep captures outside the Hosting package and do not paste auth/debug
logs. Do not use --debug or any command that prints credentials. Record all serving
Worker versions/percentages if traffic is split, not just the newest upload.

Record the currently serving Worker version (not merely latest uploaded), binding
names, existing approved origins, and the current **myhatchai** live release/version
from Firebase Console → Hosting → myhatchai → Release history. Verify a rollback
version is retained. Do not expose secret values, delete prior versions or change
the original hatchai-8d34c Hosting site. Export only approved schema metadata; any
database data backup requires a separate secure process because subscriptions are
sensitive. The new migration creates functions only and should not alter records.

## 3 — Apply only the reviewed RPC migration (SEPARATE APPROVAL)

Display the exact file, compare its recorded hash and paste it into Supabase SQL
Editor only after approval:

```powershell
Get-FileHash .\supabase\migrations\202611100001_native_push_rpc_REVIEW.sql -Algorithm SHA256
Get-Content .\supabase\migrations\202611100001_native_push_rpc_REVIEW.sql
```

Run that entire BEGIN/COMMIT transaction, not the existing CREATE TABLE migration.
Expected: five functions created, EXECUTE revoked from PUBLIC/anon/authenticated and
granted to service_role, no table recreation or subscription data change. Rerun
approved metadata checks to verify owner/search_path/grants and unchanged row counts.
Do not use an unrestricted `supabase db push` that could apply other pending files.

Rollback for migration failure: the transaction must roll back completely. For
application rollback after successful migration, leave these additive functions and
all records intact. Optional later privilege revocation/function removal needs its
own reviewed SQL approval; do not drop the table or restore an entire database.

## 4 — Stage configuration and secrets (SEPARATE APPROVAL)

| Name | Storage | Required for registration rollout |
| --- | --- | --- |
| SUPABASE_BACKEND_KEY | Worker secret, fresh dedicated sb_secret key | Yes |
| SUPABASE_URL | Existing non-secret config | Yes; preserve verified project |
| SUPABASE_PUBLISHABLE_KEY | Existing public config | Yes; never substitute secret key |
| ONLINE_ALLOWED_ORIGINS | Non-secret config | Preserve existing list including https://myhatchai.web.app |
| NATIVE_PUSH_VAPID_PUBLIC_KEY | Non-secret config; 65-byte uncompressed P-256/base64url | Yes |
| NATIVE_PUSH_VAPID_SUBJECT | Non-secret approved mailto/HTTPS contact | Prepare for delivery |
| NATIVE_PUSH_VAPID_PRIVATE_KEY | Worker secret, 32-byte scalar/base64url | Required before any later sending; can remain unconfigured for registration-only |
| NATIVE_PUSH_LIMITER | Rate-limit binding, namespace 834317 | Yes; confirm namespace availability |
| NATIVE_PUSH_DELIVERY_ENABLED | Non-secret config | Must remain false |
| MANUAL_TEST_NOTIFICATIONS_ENABLED | Existing non-secret config | Must remain false |

Approve generating one stable VAPID pair in a secure offline administrative process
if none exists. Verify matching public/private keys privately; store the private key
encrypted and recoverably, never print it. No test fixture key may be used. Do not
overwrite Firebase VAPID settings. Any previously exposed Supabase key needs separately
approved revocation/replacement; never use the exposed value here.

After approved configuration and exact-date tests, stage code/config without serving
traffic, then add secrets with hidden prompts:

```powershell
$VapidPublic = Read-Host 'Approved public VAPID key'
$VapidSubject = Read-Host 'Approved VAPID subject'
npx wrangler versions upload --config .\cloudflare-worker\wrangler.jsonc --var "NATIVE_PUSH_VAPID_PUBLIC_KEY:$VapidPublic" --var "NATIVE_PUSH_VAPID_SUBJECT:$VapidSubject"
npx wrangler versions secret put SUPABASE_BACKEND_KEY --config .\cloudflare-worker\wrangler.jsonc
# Only if separately approved for this stage:
npx wrangler versions secret put NATIVE_PUSH_VAPID_PRIVATE_KEY --config .\cloudflare-worker\wrangler.jsonc
```

Each secret operation creates another undeployed version. Prevent concurrent uploads,
and inspect the final version's code/config/binding names before using its ID. Do not
upload code again afterward without checking retained staged secrets. Ordinary
`wrangler secret put` is unsuitable for staging because it deploys immediately.
See [Cloudflare secrets documentation](https://developers.cloudflare.com/workers/configuration/secrets/).
Existing secret names and DB binding must remain present; secret values must not be
printed. Expected: no production traffic change, no SQL execution, delivery false.

## 5 — Deploy only the reviewed Worker version (SEPARATE APPROVAL)

```powershell
$CandidateWorkerVersion = Read-Host 'Verified final candidate Worker version ID'
npx wrangler versions view $CandidateWorkerVersion --config .\cloudflare-worker\wrangler.jsonc
npx wrangler versions deploy "$CandidateWorkerVersion@100%" --config .\cloudflare-worker\wrangler.jsonc
```

Verify retained DB binding, approved origins, limiter, public key and delivery=false
before confirming deployment. Do not execute D1 or Supabase migrations in this step.

Read-only live checks after deployment:

```powershell
$Worker = 'https://hatchai.kurtzidrickguno-robles.workers.dev'
curl.exe -i -X OPTIONS "$Worker/online/push/subscribe" -H 'Origin: https://myhatchai.web.app' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: authorization,content-type'
curl.exe -i "$Worker/online/push/public-key" -H 'Origin: https://myhatchai.web.app'
curl.exe -i "$Worker/health"
```

Expected: OPTIONS 204, exact allow-origin, POST, Authorization/Content-Type; missing
session returns 401; health remains healthy. No notification is sent. A foreign
origin must return 403 without allow-origin. Verify detection remains disabled by
source/version review; do not submit a real detection event. Authenticated checks
must use the browser session, not tokens pasted into commands or chat.

## 6 — Verify and deploy only myhatchai Hosting (SEPARATE APPROVAL)

```powershell
node tools/package-online-release.mjs
node tools/verify-online-release.mjs
firebase deploy --project hatchai-8d34c --config firebase.online.json --only hosting
```

Expected: exact site myhatchai and 27 public assets from dist/myhatchai/site. The
single-site firebase.online.json, not the default firebase.json, is mandatory.
Do not deploy the entire public/project directory or any Functions/Firestore target.

```powershell
curl.exe -I https://myhatchai.web.app/online-login.html
curl.exe -I https://myhatchai.web.app/native-push/service-worker.js
```

Expected: 200; worker JavaScript MIME, no HTML fallback/redirect; no-store and
nosniff. Verify the deployed worker script matches the approved package hash.
Firebase messaging worker source and registration remain unchanged.

Preview-channel origins differ from myhatchai.web.app and are not automatically
allowed by CORS. Do not add a wildcard to make preview login work. Static preview
checks can be performed without authenticated API access; any new preview origin
requires a separate allowlist approval.

## 7 — Controlled Android registration acceptance (approved database writes)

1. Use Android Chrome with internet, open myhatchai.web.app, reload and sign in.
2. Confirm the authorized incubator; open Notifications. No permission prompt before
   Enable. Click Enable; grant permission; expect Enabled only after subscribe=200.
3. In DevTools/Application, check only script URLs and scopes: native path/scope
   `/native-push/`; preserve all Firebase registrations. Do not copy subscription
   endpoints, encryption keys or request Authorization headers.
4. Refresh/re-sign-in: no repeated permission request; status confirms registration.
5. Register a second phone. Disable the first and verify only its row is disabled;
   the second remains registered. Denied permission must give settings guidance.
6. Keep sending disabled. Enabled means subscription registration, not proof of alert
   display. A live-send trigger, durable outbox and camera transport require review
   and separate approvals. Neither camera ingestion nor /chick-detected is enabled.

## Rollback — separately authorized if required

Stop rollout on failed health, CORS, authentication, ownership, subscription integrity
or deployment-target checks. Restore the frontend first if it calls incompatible new
routes, then restore Worker code/config. With sending disabled there is no delivery
queue to drain in this rollout.

**Cloudflare:**

```powershell
$BaselineWorkerVersion = Read-Host 'Recorded previously serving Worker version ID'
npx wrangler rollback $BaselineWorkerVersion --config .\cloudflare-worker\wrangler.jsonc
```

Verify health, original routes, origins and disabled sending afterward. Rollback does
not reverse external database changes and may depend on prior secret/binding
availability. Do not delete or rotate existing bindings/secrets during rollout.
See [Cloudflare rollback documentation](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

**Firebase Hosting:** Firebase Console → project hatchai-8d34c → Hosting → select
**myhatchai** → Release history → recorded baseline live release → Roll back.
Alternatively, if an approved baseline preview channel was deliberately retained:

```powershell
$BaselineChannel = Read-Host 'Verified retained baseline channel ID for myhatchai'
firebase hosting:clone "myhatchai:$BaselineChannel" 'myhatchai:live' --project hatchai-8d34c
```

Do not invent a channel ID or use hatchai-8d34c:live as the source/destination. Verify
login and existing dashboard after rollback. See
[Firebase release management](https://firebase.google.com/docs/hosting/manage-hosting-resources).

Browser-installed service workers/subscriptions survive a Hosting rollback. Do not
silently unregister them or clear site data. Keep delivery disabled and retain
subscription records and the stable VAPID pair. If individual cleanup is needed,
approve it separately using authenticated unsubscription before retiring the new UI.

**Database:** retain additive functions and registrations during code/Hosting
rollback. No DROP TABLE, bulk row deletion, NVS operation or full-database restore.

## Stop point

Nothing in steps 1–7 or rollback has been executed. This follow-up changed only
local retry code, local runtime/test tooling, tests and review documents; automated
tests used isolated databases and fake providers. The standalone Step 1 SQL remains
unexecuted against Supabase. Firmware, secrets and cloud services were not changed. Request approval for step 1's read-only metadata inspection
only; do not treat that as approval to apply the migration or deploy.
