-- REVIEW ONLY: additive device API-key enrollment and verifier storage.
-- Run as postgres only after separate production approval.
BEGIN;

DO $$ BEGIN
  IF current_user <> 'postgres' OR NOT EXISTS(
    SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Run reviewed migration as postgres with BYPASSRLS';
  END IF;
  IF to_regclass('public.hatchai_sync_devices') IS NULL OR
     to_regclass('public.incubators') IS NULL OR
     to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'Required HATCHAI schema is not installed';
  END IF;
END $$;

ALTER TABLE public.hatchai_sync_devices
  ADD COLUMN IF NOT EXISTS api_key_verifier text,
  ADD COLUMN IF NOT EXISTS api_key_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS api_key_revoked_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.hatchai_sync_devices'::regclass
      AND conname='hatchai_device_api_key_verifier_format'
  ) THEN
    ALTER TABLE public.hatchai_sync_devices
      ADD CONSTRAINT hatchai_device_api_key_verifier_format
      CHECK (api_key_verifier IS NULL OR api_key_verifier ~ '^[A-Za-z0-9_-]{43}$');
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='hatchai_sync_devices'
        AND ((column_name='api_key_verifier' AND data_type='text' AND is_nullable='YES') OR
             (column_name IN('api_key_created_at','api_key_revoked_at') AND data_type='timestamp with time zone' AND is_nullable='YES'))) <> 3 OR
     NOT EXISTS(
       SELECT 1 FROM pg_constraint
       WHERE conrelid='public.hatchai_sync_devices'::regclass
         AND conname='hatchai_device_api_key_verifier_format'
         AND pg_get_constraintdef(oid) LIKE 'CHECK ((%api_key_verifier%43%'
     ) THEN
    RAISE EXCEPTION 'Existing API-key registry columns or constraint are incompatible';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.hatchai_device_enrollment_tokens (
  id uuid CONSTRAINT hatchai_device_enrollment_tokens_pkey PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL CONSTRAINT hatchai_device_enrollment_token_hash_key UNIQUE,
  user_id uuid NOT NULL,
  device_id text NOT NULL,
  key_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hatchai_device_enrollment_token_hash_format CHECK (token_hash ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT hatchai_device_enrollment_key_id_format CHECK (key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT hatchai_device_enrollment_expiry_order CHECK (expires_at > created_at),
  CONSTRAINT hatchai_device_enrollment_used_order CHECK (used_at IS NULL OR used_at >= created_at),
  CONSTRAINT hatchai_device_enrollment_user_fkey FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT hatchai_device_enrollment_device_fkey FOREIGN KEY(device_id) REFERENCES public.hatchai_sync_devices(device_id) ON DELETE CASCADE
);

DO $$ BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='hatchai_device_enrollment_tokens') <> 8 OR
     (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='hatchai_device_enrollment_tokens'
        AND ((column_name='id' AND data_type='uuid' AND is_nullable='NO') OR
             (column_name IN('token_hash','device_id','key_id') AND data_type='text' AND is_nullable='NO') OR
             (column_name='user_id' AND data_type='uuid' AND is_nullable='NO') OR
             (column_name IN('expires_at','created_at') AND data_type='timestamp with time zone' AND is_nullable='NO') OR
             (column_name='used_at' AND data_type='timestamp with time zone' AND is_nullable='YES'))) <> 8 OR
     (SELECT count(*) FROM pg_constraint
      WHERE conrelid='public.hatchai_device_enrollment_tokens'::regclass
        AND conname IN('hatchai_device_enrollment_tokens_pkey','hatchai_device_enrollment_token_hash_key',
          'hatchai_device_enrollment_token_hash_format','hatchai_device_enrollment_key_id_format',
          'hatchai_device_enrollment_expiry_order','hatchai_device_enrollment_used_order',
          'hatchai_device_enrollment_user_fkey','hatchai_device_enrollment_device_fkey')) <> 8 THEN
    RAISE EXCEPTION 'Existing enrollment-token table is incompatible';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS hatchai_device_enrollment_expiry
  ON public.hatchai_device_enrollment_tokens(expires_at) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS hatchai_device_enrollment_retention
  ON public.hatchai_device_enrollment_tokens(used_at,expires_at);

ALTER TABLE public.hatchai_device_enrollment_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hatchai_device_enrollment_tokens FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hatchai_device_enrollment_tokens FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.hatchai_device_enrollment_start(
  p_user uuid, p_device text, p_key text, p_token_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE device_record public.hatchai_sync_devices%ROWTYPE; token_id uuid; expiry timestamptz;
BEGIN
  IF p_token_hash !~ '^[A-Za-z0-9_-]{43}$' OR p_key !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'Invalid enrollment' USING ERRCODE='22023';
  END IF;
  SELECT registry.* INTO device_record FROM public.hatchai_sync_devices registry
    JOIN public.incubators incubator ON incubator.id=registry.incubator_id
    WHERE registry.device_id=p_device AND registry.key_id=p_key
      AND registry.role='controller' AND incubator.owner_id=p_user
    FOR UPDATE OF registry FOR SHARE OF incubator;
  IF NOT FOUND OR device_record.api_key_verifier IS NOT NULL THEN
    RAISE EXCEPTION 'Device is not enrollable' USING ERRCODE='42501';
  END IF;
  UPDATE public.hatchai_device_enrollment_tokens SET used_at=now()
    WHERE device_id=p_device AND used_at IS NULL;
  expiry=now()+interval '5 minutes';
  INSERT INTO public.hatchai_device_enrollment_tokens(token_hash,user_id,device_id,key_id,expires_at)
    VALUES(p_token_hash,p_user,p_device,p_key,expiry) RETURNING id INTO token_id;
  RETURN jsonb_build_object('id',token_id,'keyId',device_record.key_id,'expiresAt',expiry);
END $$;

CREATE OR REPLACE FUNCTION public.hatchai_device_api_key_enroll(
  p_token_hash text, p_device text, p_key text, p_verifier text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE claimed uuid;
BEGIN
  IF p_token_hash !~ '^[A-Za-z0-9_-]{43}$' OR p_verifier !~ '^[A-Za-z0-9_-]{43}$' OR
     p_key !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'Invalid enrollment' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM public.hatchai_sync_devices
    WHERE device_id=p_device AND key_id=p_key AND role='controller'
      AND api_key_verifier=p_verifier AND api_key_revoked_at IS NULL) THEN
    RETURN true;
  END IF;
  -- Serialize redemption with registry changes and ownership transfers.
  PERFORM 1 FROM public.hatchai_sync_devices registry
    JOIN public.incubators incubator ON incubator.id=registry.incubator_id
    WHERE registry.device_id=p_device AND registry.key_id=p_key
      AND registry.role='controller' AND registry.api_key_verifier IS NULL
      AND EXISTS(
        SELECT 1 FROM public.hatchai_device_enrollment_tokens token
        WHERE token.token_hash=p_token_hash AND token.device_id=registry.device_id
          AND token.key_id=registry.key_id AND token.user_id=incubator.owner_id
          AND token.used_at IS NULL AND token.expires_at>now()
      )
    FOR UPDATE OF registry FOR SHARE OF incubator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enrollment denied' USING ERRCODE='42501'; END IF;
  UPDATE public.hatchai_device_enrollment_tokens token SET used_at=now()
    FROM public.hatchai_sync_devices registry, public.incubators incubator
    WHERE token.token_hash=p_token_hash AND token.device_id=p_device AND token.key_id=p_key
      AND token.used_at IS NULL AND token.expires_at>now()
      AND registry.device_id=token.device_id AND registry.key_id=token.key_id
      AND registry.role='controller' AND registry.api_key_verifier IS NULL
      AND incubator.id=registry.incubator_id AND incubator.owner_id=token.user_id
    RETURNING token.id INTO claimed;
  IF claimed IS NULL THEN RAISE EXCEPTION 'Enrollment denied' USING ERRCODE='42501'; END IF;
  UPDATE public.hatchai_sync_devices
    SET api_key_verifier=p_verifier,api_key_created_at=now(),api_key_revoked_at=NULL
    WHERE device_id=p_device AND key_id=p_key AND role='controller'
      AND api_key_verifier IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enrollment denied' USING ERRCODE='42501'; END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.hatchai_device_api_key_auth(
  p_device text, p_key text, p_verifier text
) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog STABLE AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.hatchai_sync_devices
    WHERE device_id=p_device AND key_id=p_key AND role='controller' AND enabled
      AND api_key_revoked_at IS NULL AND api_key_verifier=p_verifier
  )
$$;

CREATE OR REPLACE FUNCTION public.hatchai_device_api_key_revoke(
  p_device text, p_key text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE changed integer;
BEGIN
  UPDATE public.hatchai_sync_devices
    SET api_key_revoked_at=now()
    WHERE device_id=p_device AND key_id=p_key AND role='controller'
      AND api_key_verifier IS NOT NULL AND api_key_revoked_at IS NULL;
  GET DIAGNOSTICS changed=ROW_COUNT;
  UPDATE public.hatchai_device_enrollment_tokens SET used_at=now()
    WHERE device_id=p_device AND key_id=p_key AND used_at IS NULL;
  RETURN changed=1;
END $$;

CREATE OR REPLACE FUNCTION public.hatchai_device_api_key_cleanup()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE removed integer;
BEGIN
  WITH expired AS(
    SELECT ctid FROM public.hatchai_device_enrollment_tokens
    WHERE (used_at IS NOT NULL AND used_at<now()-interval '1 day')
       OR (used_at IS NULL AND expires_at<now()-interval '1 day')
    ORDER BY coalesce(used_at,expires_at) LIMIT 500
  )
  DELETE FROM public.hatchai_device_enrollment_tokens
    WHERE ctid IN(SELECT ctid FROM expired);
  GET DIAGNOSTICS removed=ROW_COUNT;
  RETURN removed;
END $$;

ALTER FUNCTION public.hatchai_device_enrollment_start(uuid,text,text,text) OWNER TO postgres;
ALTER FUNCTION public.hatchai_device_api_key_enroll(text,text,text,text) OWNER TO postgres;
ALTER FUNCTION public.hatchai_device_api_key_auth(text,text,text) OWNER TO postgres;
ALTER FUNCTION public.hatchai_device_api_key_revoke(text,text) OWNER TO postgres;
ALTER FUNCTION public.hatchai_device_api_key_cleanup() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.hatchai_device_enrollment_start(uuid,text,text,text),
  public.hatchai_device_api_key_enroll(text,text,text,text),
  public.hatchai_device_api_key_auth(text,text,text),
  public.hatchai_device_api_key_revoke(text,text),
  public.hatchai_device_api_key_cleanup()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hatchai_device_enrollment_start(uuid,text,text,text),
  public.hatchai_device_api_key_enroll(text,text,text,text),
  public.hatchai_device_api_key_auth(text,text,text),
  public.hatchai_device_api_key_revoke(text,text),
  public.hatchai_device_api_key_cleanup() TO service_role;
COMMIT;
