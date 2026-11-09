-- REVIEW DRAFT: do not apply until separately approved.
-- Based on inspected public.incubators: empty table, RLS enabled, no policies,
-- UUID primary key id and unique text device_id. No other table is created.
-- This deliberately refuses reruns or changes to the inspected starting state.
BEGIN;

LOCK TABLE public.incubators IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = '17275f94-f94b-4f89-b1c4-752edf099bc1'::uuid
  ) THEN
    RAISE EXCEPTION 'Approved owner account was not found; no changes applied';
  END IF;
  IF EXISTS (SELECT 1 FROM public.incubators) THEN
    RAISE EXCEPTION 'Incubators is no longer empty; review existing records first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = 'public.incubators'::regclass
    AND relkind = 'r' AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Expected RLS-enabled incubators table was not found';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'incubators'
  ) THEN
    RAISE EXCEPTION 'Existing policies require review; no policies replaced';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'incubators'
    AND column_name = 'owner_id'
  ) THEN
    RAISE EXCEPTION 'Ownership column already exists; inspect before retrying';
  END IF;
END $$;

ALTER TABLE public.incubators
  ADD COLUMN owner_id uuid NOT NULL
  REFERENCES auth.users(id) ON DELETE RESTRICT;

CREATE INDEX incubators_owner_id_idx ON public.incubators(owner_id);

-- No claim of live hardware connectivity: status is intentionally NULL.
INSERT INTO public.incubators
  (id, device_name, device_id, status, created_at, updated_at, owner_id)
VALUES
  (gen_random_uuid(), 'HATCHAI Incubator', 'hatchai-inc01-controller',
   NULL, now(), now(), '17275f94-f94b-4f89-b1c4-752edf099bc1'::uuid);

-- Ordinary browsers receive SELECT only. Existing privileged backend grants
-- are not replaced. Database owners/service roles can still bypass RLS.
REVOKE ALL PRIVILEGES ON TABLE public.incubators FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.incubators TO authenticated;

CREATE POLICY incubators_owner_select
  ON public.incubators FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id);

COMMIT;
