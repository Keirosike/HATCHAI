-- PACKAGE A: REVIEW ONLY. No secrets. Do not run before Package A approval.
-- Proposed key IDs are independent of retired notification-pairing credentials.
BEGIN;
DO $$ BEGIN
 IF current_user <> 'postgres' OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'postgres with BYPASSRLS required';
 END IF;
END $$;
LOCK TABLE public.hatchai_sync_devices IN EXCLUSIVE MODE;
DO $$ BEGIN
 PERFORM 1 FROM public.incubators WHERE id='87ce3cf3-a455-4bc3-a7bb-049882d985fa' AND device_id='hatchai-inc01-controller' AND owner_id IS NOT NULL FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Verified incubator mapping changed';
 END IF;
 IF EXISTS(SELECT 1 FROM public.hatchai_sync_devices WHERE incubator_id='87ce3cf3-a455-4bc3-a7bb-049882d985fa' OR device_id IN('hatchai-inc01-controller','hatchai-inc01-cam01','hatchai-inc01-cam02')) THEN
  RAISE EXCEPTION 'Registry already populated: review existing records; no replacement';
 END IF;
END $$;
INSERT INTO public.hatchai_sync_devices(device_id,incubator_id,key_id,role,position,enabled) VALUES
 ('hatchai-inc01-controller','87ce3cf3-a455-4bc3-a7bb-049882d985fa','controller-sync-v1','controller',NULL,false),
 ('hatchai-inc01-cam01','87ce3cf3-a455-4bc3-a7bb-049882d985fa','upper-camera-v1','camera','upper',false),
 ('hatchai-inc01-cam02','87ce3cf3-a455-4bc3-a7bb-049882d985fa','lower-camera-v1','camera','lower',false);
COMMIT;
-- Fail-closed reruns are intentional. Activation is a separate reviewed operation.
