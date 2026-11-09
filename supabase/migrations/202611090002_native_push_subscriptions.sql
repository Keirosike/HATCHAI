-- REVIEW DRAFT ONLY. Do not execute until separately approved.
-- Verified prerequisite: public.incubators(id uuid PK, owner_id uuid NOT NULL).
-- No existing table/policy is altered. Deliberately fail if this table exists.
BEGIN;

CREATE TABLE public.web_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  incubator_id uuid NOT NULL REFERENCES public.incubators(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  device_label text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  CONSTRAINT web_push_endpoint_shape CHECK (
    length(endpoint) BETWEEN 32 AND 2048 AND endpoint LIKE 'https://%'
    AND endpoint !~ '[[:space:][:cntrl:]]'
  ),
  CONSTRAINT web_push_p256dh_shape CHECK (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  CONSTRAINT web_push_auth_shape CHECK (auth ~ '^[A-Za-z0-9_-]{22}$'),
  CONSTRAINT web_push_label_length CHECK (device_label IS NULL OR length(device_label) <= 80)
);

CREATE INDEX web_push_subscriptions_user_incubator_idx
  ON public.web_push_subscriptions(user_id, incubator_id);

ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_push_subscriptions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.web_push_subscriptions FROM PUBLIC, anon, authenticated;

-- No browser or worker-user write grants yet. The reviewed registration RPCs
-- must enforce auth.uid(), current incubator ownership, bounded fields, endpoint
-- ownership immutability, quota and atomic duplicate handling before grants.
-- Endpoint HTTPS syntax alone is NOT SSRF protection: ingestion and delivery
-- must independently enforce the reviewed push-provider policy and no redirects.
-- No service-role key or privileged sender is provisioned by this migration.

COMMIT;
