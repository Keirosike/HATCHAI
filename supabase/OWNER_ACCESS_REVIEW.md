# Stage 1: proposed incubator ownership access

Draft only. Nothing has been applied to Supabase. Do not run a deployment or
`supabase db push` until the user approves this migration.

Verified from supplied dashboard results:
- public.incubators has UUID id, text device_name/device_id/status and timestamptz
  created_at/updated_at. id is the primary key and device_id is unique.
- RLS enabled, no policies, no existing rows returned by the administrator query.
- Existing email-auth user UID: 17275f94-f94b-4f89-b1c4-752edf099bc1 (user supplied).

The draft adds a required owner_id referencing auth.users, an ownership index,
one record for the previously approved controller ID hatchai-inc01-controller,
and authenticated owner-only SELECT. Proposed display name: HATCHAI Incubator.
Status is NULL because no telemetry/heartbeat has established connectivity.
Anonymous access and browser writes remain denied. No signup, user creation,
camera identity, batch, telemetry or notification schema is introduced.

The migration locks the table briefly and checks its inspected starting state.
If rows, policies or owner_id now exist, it aborts instead of modifying them.
It is intentionally not a rerunnable seed: a second execution must fail safely.
All changes and the insert occur in one PostgreSQL transaction.

Before application: revoke the secret key previously exposed in chat. Owner RLS
cannot protect the database against a valid privileged secret key. Do not share
its replacement; no privileged key is required for the browser read path.

After approval and application, verify: owner can read exactly the approved row;
anonymous requests cannot read it; a different authenticated account cannot read
it; owner cannot insert/update/delete or change owner_id. These require actual
Supabase RLS tests and are not claimed as passed by local syntax/static review.
No local PostgreSQL execution was performed for this draft.

Next local implementation after database approval: add a bounded authenticated
read of the existing incubators table to the online page. No working firmware,
provisioning utility, cloud endpoint or notification delivery needs changing for
this read-only step.
