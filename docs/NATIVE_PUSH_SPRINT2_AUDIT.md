# Sprint 2 — native Web Push audit (implementation pending)

## Schema evidence received

User-provided Supabase screenshots confirm the public column inspection returned
seven rows for incubators: id uuid NOT NULL, device_name/device_id text NOT NULL,
status text nullable, created_at/updated_at timestamptz nullable, and owner_id uuid
NOT NULL (consistent with the earlier approved ownership migration). The policy
inspection returned one policy, incubators_owner_select, authenticated SELECT,
using auth.uid() = owner_id, with no write check. Earlier constraint results show
id primary key, unique device_id and owner_id referencing auth.users with RESTRICT.
No existing public push-subscription table was shown by this inspection.

The schema input blocker is resolved. The proposed additive subscription table is
in supabase/migrations/202611090002_native_push_subscriptions.sql. It is only a
storage draft: browser privileges are revoked and no registration RPC has been
granted yet. Do not apply it as a complete subscription backend. RPC authorization,
atomic ownership/idempotency handling and per-user quotas remain to implement and
test locally before requesting migration approval. No SQL execution or PostgreSQL
runtime verification is claimed for this draft.

The user selected standards-based browser Push/Notifications APIs and server-side
VAPID/encryption. Firebase Hosting remains the static host; the new notification
flow must not import Firebase Messaging or Admin SDKs. Existing notification
files and registrations must not be deleted or silently replaced.

Verified source findings:
- Online Supabase session verification and owner-filtered incubator retrieval
  already exist. Reuse their authorization and configured CORS boundaries.
- data/js/modal.js and existing modal/component CSS can supply the dialog design.
- public/firebase-messaging-sw.js imports Firebase SDKs; do not register it for
  native push or silently overwrite a registration using that script.
- The online dashboard currently registers no service worker.
- Only the ownership migration is checked in under supabase/migrations. It does
  not establish the complete current production schema. Metadata is required
  before adding a subscription table.
- /chick-detected remains disabled. Camera source sends local authenticated
  events and references the older Firebase /api/chick URL, not a verified native
  Web Push ingestion pipeline. No end-to-end detection delivery is established.

Design boundaries for the next implementation:
- Subscribe/status/unsubscribe use independently verified Supabase sessions and
  server-checked incubator ownership. No localStorage/LCD code authorization.
- Store multiple independent subscriptions with database-enforced uniqueness and
  ownership. Do not allow subscription reassignment between users.
- Treat endpoint and encryption keys as sensitive metadata. Protect endpoints
  against SSRF: HTTPS is necessary but not sufficient; require a reviewed push
  provider policy, reject redirects/private destinations and cap response sizes.
- Use a reviewed Workers-compatible Web Push implementation. Verify RFC 8291
  encryption and RFC 8292 VAPID interoperability independently in workerd before
  enabling a sender. Do not substitute a hand-written, unverified crypto scheme.
- Private VAPID material belongs in Worker secrets, never generated during a
  browser request or embedded in frontend files. Do not rotate/install keys here.
- Permission requests require user interaction. Existing permission does not
  prove backend registration. Reconcile granted subscriptions without prompting.
- Handle existing service-worker script/scope explicitly; fail closed on an
  unknown registration until a separate transition is reviewed.
- Bounded retries, dead subscription handling and durable idempotency require
  database contracts. Unknown delivery outcomes must not imply exactly-once
  delivery. No live sends, event ingestion activation or firmware changes.

Schema results have now been received as described above. Next implementation:
review subscription RPCs and endpoint/provider validation, then integrate the
matching modal and backend locally. Migrations and deployments remain separately
approved actions. No further schema screenshot is required for this draft.

This audit is not an implemented notification system. No database query was
executed, no notification was sent, and no deployment/hardware change occurred.
