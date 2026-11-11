-- REVIEW ONLY. Additive; requires reviewed Sprint 3 migrations 0003 and 0004.
-- Does not create a Storage bucket or grant browser access to Storage objects.
BEGIN;
DO $$ BEGIN
 IF current_user <> 'postgres' OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'postgres BYPASSRLS required';
 END IF;
END $$;
CREATE TABLE public.hatchai_camera_captures(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 device_id text NOT NULL,
 event_id uuid NOT NULL,
 incubator_id uuid NOT NULL REFERENCES public.incubators(id) ON DELETE RESTRICT,
 position text NOT NULL CHECK(position IN('upper','lower')),
 captured_at timestamptz NOT NULL,
 content_hash text NOT NULL CHECK(content_hash ~ '^[A-Za-z0-9_-]{43}$'),
 byte_length integer NOT NULL CHECK(byte_length BETWEEN 4 AND 131072),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','ready','deleting')),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT(now()+interval '15 minutes'),
 cleanup_lease uuid,cleanup_at timestamptz,
 FOREIGN KEY(device_id,event_id) REFERENCES public.hatchai_camera_events(device_id,event_id) ON DELETE RESTRICT,
 UNIQUE(device_id,event_id)
);
CREATE INDEX hatchai_camera_captures_recent ON public.hatchai_camera_captures(incubator_id,captured_at DESC);
CREATE INDEX hatchai_camera_captures_expiry ON public.hatchai_camera_captures(expires_at);
ALTER TABLE public.hatchai_camera_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hatchai_camera_captures FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hatchai_camera_captures FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.hatchai_capture_reserve(p_device text,p_key text,p_event uuid,p_nonce text,p_hash text,p_bytes integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.hatchai_sync_devices%ROWTYPE;e public.hatchai_camera_events%ROWTYPE;r public.hatchai_camera_captures%ROWTYPE;n integer;
BEGIN
 SELECT * INTO d FROM public.hatchai_sync_devices WHERE device_id=p_device AND key_id=p_key AND enabled AND role='camera' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Camera denied' USING ERRCODE='42501';END IF;
 -- Serialize the retained-record quota across both cameras, not just one device.
 PERFORM 1 FROM public.incubators WHERE id=d.incubator_id FOR UPDATE;
 SELECT * INTO e FROM public.hatchai_camera_events WHERE device_id=p_device AND event_id=p_event AND incubator_id=d.incubator_id AND position=d.position FOR SHARE;
 IF NOT FOUND OR e.detected_at<now()-interval '15 minutes' THEN RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501';END IF;
 IF p_hash IS NULL OR p_hash !~ '^[A-Za-z0-9_-]{43}$' OR p_bytes IS NULL OR p_bytes NOT BETWEEN 4 AND 131072 THEN RAISE EXCEPTION 'Invalid capture';END IF;
 INSERT INTO public.hatchai_sync_nonces(device_id,nonce_hash) VALUES(p_device,p_nonce) ON CONFLICT DO NOTHING;GET DIAGNOSTICS n=ROW_COUNT;
 IF n=0 THEN RAISE EXCEPTION 'Replay' USING ERRCODE='23505';END IF;
 SELECT * INTO r FROM public.hatchai_camera_captures WHERE device_id=p_device AND event_id=p_event FOR UPDATE;
 IF FOUND THEN
  IF r.incubator_id<>d.incubator_id OR r.content_hash<>p_hash OR r.byte_length<>p_bytes OR r.state='deleting' OR r.expires_at<=now() THEN RAISE EXCEPTION 'Capture conflict' USING ERRCODE='23505';END IF;
 ELSE
  IF (SELECT count(*) FROM public.hatchai_camera_captures WHERE incubator_id=d.incubator_id)>=512 THEN RAISE EXCEPTION 'Capture quota' USING ERRCODE='54000';END IF;
  INSERT INTO public.hatchai_camera_captures(device_id,event_id,incubator_id,position,captured_at,content_hash,byte_length)
   VALUES(p_device,p_event,d.incubator_id,d.position,e.detected_at,p_hash,p_bytes) RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('id',r.id,'objectKey',r.incubator_id::text||'/'||r.device_id||'/'||r.id::text||'.jpg','ready',r.state='ready');
END $$;

CREATE FUNCTION public.hatchai_capture_complete(p_device text,p_key text,p_id uuid,p_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- Recheck revocation and registry mapping after the Storage operation.
 PERFORM 1 FROM public.hatchai_sync_devices WHERE device_id=p_device AND key_id=p_key AND role='camera' AND enabled FOR SHARE;
 IF NOT FOUND THEN RETURN false;END IF;
 UPDATE public.hatchai_camera_captures c SET state='ready',expires_at=CASE WHEN c.state='pending' THEN now()+interval '7 days' ELSE c.expires_at END
 FROM public.hatchai_sync_devices d WHERE c.id=p_id AND c.device_id=p_device AND c.content_hash=p_hash AND c.state IN('pending','ready') AND c.expires_at>now()
 AND d.device_id=p_device AND d.incubator_id=c.incubator_id AND d.position=c.position;
 RETURN FOUND;
END $$;

CREATE FUNCTION public.hatchai_capture_read(p_user uuid,p_incubator uuid,p_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.hatchai_camera_captures%ROWTYPE;records jsonb;
BEGIN
 PERFORM 1 FROM public.incubators WHERE id=p_incubator AND owner_id=p_user FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Capture denied' USING ERRCODE='42501';END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO r FROM public.hatchai_camera_captures WHERE id=p_id AND incubator_id=p_incubator AND state='ready' AND expires_at>now();
  IF NOT FOUND THEN RETURN NULL;END IF;
  RETURN jsonb_build_object('objectKey',r.incubator_id::text||'/'||r.device_id||'/'||r.id::text||'.jpg','hash',r.content_hash,'bytes',r.byte_length);
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',q.id,'position',q.position,'capturedAt',q.captured_at,'chick',true) ORDER BY q.captured_at DESC),'[]') INTO records
 FROM(SELECT id,position,captured_at FROM public.hatchai_camera_captures WHERE incubator_id=p_incubator AND state='ready' AND expires_at>now() ORDER BY captured_at DESC LIMIT 50) q;
 RETURN jsonb_build_object('captures',records);
END $$;

CREATE FUNCTION public.hatchai_capture_cleanup_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.hatchai_camera_captures%ROWTYPE;l uuid=gen_random_uuid();
BEGIN
 SELECT * INTO r FROM public.hatchai_camera_captures WHERE expires_at<=now() AND (state<>'deleting' OR cleanup_at<now()-interval '60 seconds') ORDER BY expires_at LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL;END IF;
 UPDATE public.hatchai_camera_captures SET state='deleting',cleanup_lease=l,cleanup_at=now() WHERE id=r.id;
 RETURN jsonb_build_object('lease',l,'objectKey',r.incubator_id::text||'/'||r.device_id||'/'||r.id::text||'.jpg');
END $$;
CREATE FUNCTION public.hatchai_capture_cleanup_finish(p_lease uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 DELETE FROM public.hatchai_camera_captures WHERE cleanup_lease=p_lease AND state='deleting';RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.hatchai_capture_reserve(text,text,uuid,text,text,integer),public.hatchai_capture_complete(text,text,uuid,text),public.hatchai_capture_read(uuid,uuid,uuid),public.hatchai_capture_cleanup_claim(),public.hatchai_capture_cleanup_finish(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hatchai_capture_reserve(text,text,uuid,text,text,integer),public.hatchai_capture_complete(text,text,uuid,text),public.hatchai_capture_read(uuid,uuid,uuid),public.hatchai_capture_cleanup_claim(),public.hatchai_capture_cleanup_finish(uuid) TO service_role;
-- Preserve event metadata while its private object still needs cleanup.
CREATE OR REPLACE FUNCTION public.hatchai_camera_cleanup() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE count integer;
BEGIN
 DELETE FROM public.hatchai_sync_nonces WHERE ctid IN(SELECT ctid FROM public.hatchai_sync_nonces WHERE created_at<now()-interval '24 hours' LIMIT 500);
 WITH old AS(SELECT ctid FROM public.hatchai_camera_events e WHERE received_at<now()-interval '30 days'
  AND NOT EXISTS(SELECT 1 FROM public.hatchai_camera_captures c WHERE c.device_id=e.device_id AND c.event_id=e.event_id)
  AND NOT EXISTS(SELECT 1 FROM public.hatchai_camera_outbox o WHERE o.device_id=e.device_id AND o.event_id=e.event_id AND o.state IN('pending','leased')) LIMIT 100)
 DELETE FROM public.hatchai_camera_events WHERE ctid IN(SELECT ctid FROM old);GET DIAGNOSTICS count=ROW_COUNT;RETURN count;
END $$;
COMMIT;
