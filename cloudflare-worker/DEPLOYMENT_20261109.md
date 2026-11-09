# Online API deployment — 2026-11-09

Approved scope: existing hatchai Worker deployment. No Firebase deployment,
firmware upload, credential provisioning or database migrations performed.

Final active version: `51a8daee-45ed-437a-8284-2b6072b4cbed`.
Pre-change rollback version: `d8d7211f-4f71-47e9-b439-9d0f9fb73b81`.
An intermediate version activated before the final settings correction:
`d1ba4a44-7802-4138-b760-bd23c990548c`. Do not select it for rollback.

Deployment used `--keep-vars`. Existing publishable-key configuration and secrets
were preserved. Local configuration now explicitly keeps dashboard variables,
disables preview URLs, and preserves enabled observability/logging. Adds the
Supabase project URL and local test origin; manual test notifications remain off.
Existing minute-based pairing retention cron and rate-limit bindings are active.
Retention can clean eligible transient pairing records; no migration was run.

Verification:
- 92 automated Worker tests passed.
- Isolated workerd/D1: 19 smoke requests plus 205 requests across 11 scenarios.
- Production read-only metadata check confirmed all three required tables;
  database reported zero writes for that check.
- Public GET / and GET /health: 200.
- POST /chick-detected: 503, disabled; no valid detection was sent.
- GET /online/incubators without session: 401.
- Allowed local origin OPTIONS: 204, matching Access-Control-Allow-Origin.
- Disallowed origin: 403, no CORS allow header.
- Synthetic invalid user session: 401, confirming authentication configuration
  is available; no real user access token was supplied by the agent.

Live valid-user verification against this deployed version is still pending.
The current website's worker-test=1 option targets the LOCAL test server, not
the deployed Worker. Do not count its earlier success as production verification.

If rollback is necessary, use Cloudflare dashboard Deployments to roll back to
the pre-change version above. Review the configuration diff: rollback may remove
the new allowed-origin and notification-off variables along with the new API.
Database records/migrations are not rolled back by a Worker version rollback.
Do not run rollback merely to test it on production.
