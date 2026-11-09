# Local online API verification

No deployment, database writes, firmware changes or live notifications are needed.
Automated tests use synthetic tokens and mocked Supabase responses. They do not
prove live RLS isolation for a second real user.

The optional live runner executes the Worker handler locally and makes read-only
requests to Supabase Auth and PostgREST. It is not a workerd/network-server test.
It expects exactly the currently approved controller row. Do not use it unchanged
after intentionally adding more incubators.

Use the project URL and a publishable key only. Secret keys and legacy
service-role JWTs are rejected. Never paste session tokens into chat or a command
literal. Supply a short-lived user access token privately with Read-Host, and
close this PowerShell session afterward. Environment variables are not a vault;
other processes running as the same user may inspect them.

From the project root in PowerShell:

```powershell
$env:SUPABASE_URL = 'https://dihufafcztqjuudjeqdm.supabase.co'
$env:ONLINE_ALLOWED_ORIGINS = 'http://127.0.0.1:8080'
$env:HATCHAI_TEST_ORIGIN = 'http://127.0.0.1:8080'
$env:HATCHAI_EXPECTED_USER_ID = '17275f94-f94b-4f89-b1c4-752edf099bc1'
$env:SUPABASE_PUBLISHABLE_KEY = Read-Host 'Supabase publishable key (not secret key)'
$privateSession = Read-Host 'Short-lived Supabase user access token (private)' -AsSecureString
try {
    $env:HATCHAI_SUPABASE_ACCESS_TOKEN = [System.Net.NetworkCredential]::new('', $privateSession).Password
    node cloudflare-worker/test/online-live.mjs
} finally {
    Remove-Item Env:HATCHAI_SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
    $privateSession.Dispose()
}
```

Do not extract tokens into screenshots, shared clipboard history or logs. If a
private access token is not already available, stop: use a future browser-to-local
Worker adapter to test the existing in-memory session instead of exporting it.

Missing configuration produces SKIP. A live expired-token test and a second-user
RLS isolation test require separately available sessions; do not create accounts
or alter policies just to obtain a passing result.

Next: add a dashboard adapter for a configurable local Worker base URL, pass the
existing in-memory access token in Authorization, and retain the current direct
Supabase adapter until the local browser test succeeds. Do not add tokens to URLs
or enable actuator routes. Review deployment and origin configuration separately.
