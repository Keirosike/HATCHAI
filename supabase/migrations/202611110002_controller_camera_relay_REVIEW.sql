-- REVIEW ONLY. Additive controller-relayed offline camera events. Not deployed.
BEGIN;
DO $$ BEGIN IF current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'postgres BYPASSRLS required';END IF;END $$;
ALTER TABLE public.hatchai_camera_events ALTER COLUMN detected_at DROP NOT NULL;
ALTER TABLE public.hatchai_camera_events ADD COLUMN IF NOT EXISTS relayed_by text REFERENCES public.hatchai_sync_devices(device_id), ADD COLUMN IF NOT EXISTS controller_received_at timestamptz, ADD COLUMN IF NOT EXISTS detection_time_source text NOT NULL DEFAULT 'camera-utc' CHECK(detection_time_source IN('camera-utc','controller-rtc','unknown')), ADD COLUMN IF NOT EXISTS confidence_permille integer CHECK(confidence_permille BETWEEN 500 AND 1000);
-- Small durable receipts deliberately outlive the 30-day event history cleanup.
CREATE TABLE IF NOT EXISTS public.hatchai_camera_relay_receipts(device_id text NOT NULL REFERENCES public.hatchai_sync_devices(device_id),event_id uuid NOT NULL,incubator_id uuid NOT NULL REFERENCES public.incubators(id),relayed_by text NOT NULL REFERENCES public.hatchai_sync_devices(device_id),payload_hash text NOT NULL CHECK(payload_hash ~ '^[A-Za-z0-9_-]{43}$'),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(device_id,event_id));
ALTER TABLE public.hatchai_camera_relay_receipts ENABLE ROW LEVEL SECURITY;ALTER TABLE public.hatchai_camera_relay_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hatchai_camera_relay_receipts FROM PUBLIC,anon,authenticated,service_role;
DO $$ BEGIN
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='hatchai_camera_events' AND ((column_name='detected_at' AND data_type='timestamp with time zone' AND is_nullable='YES') OR (column_name='relayed_by' AND data_type='text' AND is_nullable='YES') OR (column_name='controller_received_at' AND data_type='timestamp with time zone' AND is_nullable='YES') OR (column_name='detection_time_source' AND data_type='text' AND is_nullable='NO') OR (column_name='confidence_permille' AND data_type='integer' AND is_nullable='YES')))<>5
 OR (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='hatchai_camera_relay_receipts')<>6
 OR (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='hatchai_camera_relay_receipts' AND is_nullable='NO' AND ((column_name IN('device_id','relayed_by','payload_hash') AND data_type='text') OR(column_name IN('event_id','incubator_id') AND data_type='uuid') OR(column_name='created_at' AND data_type='timestamp with time zone')))<>6
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.hatchai_camera_relay_receipts'::regclass AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (device_id, event_id)')
 THEN RAISE EXCEPTION 'Existing camera relay schema is incompatible';END IF;
END $$;
CREATE OR REPLACE FUNCTION public.hatchai_camera_relay_accept(p_controller text,p_key text,p_verifier text,p_camera text,p_event uuid,p_nonce text,p_hash text,p_detected timestamptz,p_received timestamptz,p_source text,p_confidence integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.hatchai_sync_devices%ROWTYPE;d public.hatchai_sync_devices%ROWTYPE;r public.hatchai_camera_relay_receipts%ROWTYPE;old public.hatchai_camera_events%ROWTYPE;n integer;
BEGIN
 IF p_event IS NULL OR p_hash IS NULL OR p_hash !~ '^[A-Za-z0-9_-]{43}$' OR p_nonce IS NULL OR p_nonce !~ '^[A-Za-z0-9_-]{43}$' OR p_confidence IS NULL OR p_confidence NOT BETWEEN 500 AND 1000 OR p_source IS NULL OR p_source NOT IN('camera-utc','controller-rtc','unknown') OR ((p_detected IS NULL)<>(p_source='unknown')) OR p_detected>now()+interval '60 seconds' OR p_detected<'2024-01-01'::timestamptz OR p_received>now()+interval '60 seconds' OR p_received<'2024-01-01'::timestamptz OR p_detected>p_received+interval '60 seconds' THEN RAISE EXCEPTION 'Invalid event' USING ERRCODE='22023';END IF;
 SELECT * INTO c FROM public.hatchai_sync_devices WHERE device_id=p_controller AND key_id=p_key AND role='controller' AND enabled AND api_key_verifier=p_verifier AND api_key_revoked_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Controller not authorized' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.incubators WHERE id=c.incubator_id AND device_id=c.device_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Controller ownership mismatch' USING ERRCODE='42501';END IF;
 SELECT * INTO d FROM public.hatchai_sync_devices WHERE device_id=p_camera AND incubator_id=c.incubator_id AND role='camera' AND enabled AND ((device_id='hatchai-inc01-cam01' AND position='upper') OR(device_id='hatchai-inc01-cam02' AND position='lower')) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Camera not authorized' USING ERRCODE='42501';END IF;
 INSERT INTO public.hatchai_sync_nonces(device_id,nonce_hash) VALUES(c.device_id,p_nonce) ON CONFLICT DO NOTHING;GET DIAGNOSTICS n=ROW_COUNT;
 IF n=0 THEN RAISE EXCEPTION 'Replay' USING ERRCODE='23505';END IF;
 SELECT * INTO r FROM public.hatchai_camera_relay_receipts WHERE device_id=p_camera AND event_id=p_event;
 IF FOUND THEN
 IF r.payload_hash<>p_hash OR r.incubator_id<>c.incubator_id OR r.relayed_by<>c.device_id THEN RAISE EXCEPTION 'Conflicting event' USING ERRCODE='23505';END IF;
 RETURN jsonb_build_object('accepted',true,'duplicate',true,'eventId',p_event);END IF;
 INSERT INTO public.hatchai_camera_events(device_id,event_id,incubator_id,position,detected_at,payload_hash,relayed_by,controller_received_at,detection_time_source,confidence_permille) VALUES(d.device_id,p_event,d.incubator_id,d.position,p_detected,p_hash,c.device_id,p_received,p_source,p_confidence) ON CONFLICT DO NOTHING;GET DIAGNOSTICS n=ROW_COUNT;
 SELECT * INTO old FROM public.hatchai_camera_events WHERE device_id=p_camera AND event_id=p_event;
 IF old.payload_hash<>p_hash OR old.incubator_id<>c.incubator_id OR old.relayed_by IS DISTINCT FROM c.device_id THEN RAISE EXCEPTION 'Conflicting event' USING ERRCODE='23505';END IF;
 INSERT INTO public.hatchai_camera_relay_receipts(device_id,event_id,incubator_id,relayed_by,payload_hash) VALUES(d.device_id,p_event,d.incubator_id,c.device_id,p_hash);
 IF n=0 THEN RETURN jsonb_build_object('accepted',true,'duplicate',true,'eventId',p_event);END IF;
 INSERT INTO public.hatchai_camera_outbox(device_id,event_id,subscription_id,user_id) SELECT d.device_id,p_event,s.id,s.user_id FROM public.web_push_subscriptions s JOIN public.incubators i ON i.id=s.incubator_id AND i.owner_id=s.user_id WHERE s.incubator_id=d.incubator_id AND s.enabled ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('accepted',true,'duplicate',false,'eventId',p_event);
END $$;
CREATE OR REPLACE FUNCTION public.hatchai_camera_read(p_user uuid,p_incubator uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE records jsonb;
BEGIN
 PERFORM 1 FROM public.incubators WHERE id=p_incubator AND owner_id=p_user FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('position',q.position,'eventId',q.event_id,'capturedAt',q.detected_at,'timeSource',q.detection_time_source,'confidence',q.confidence_permille,'confirmed',true,'chick',true) ORDER BY coalesce(q.detected_at,q.received_at) DESC),'[]') INTO records FROM(SELECT * FROM public.hatchai_camera_events WHERE incubator_id=p_incubator ORDER BY coalesce(detected_at,received_at) DESC LIMIT 50) q;
 RETURN jsonb_build_object('captures',records);
END $$;
CREATE OR REPLACE FUNCTION public.hatchai_camera_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public.hatchai_camera_outbox%ROWTYPE; lease uuid=gen_random_uuid();result jsonb;
BEGIN
 -- An expired in-flight lease has an unknown provider outcome: never blindly resend.
 UPDATE public.hatchai_camera_outbox SET state='unknown',lease_id=NULL,updated_at=now() WHERE id IN(SELECT id FROM public.hatchai_camera_outbox WHERE state='leased' AND leased_at<now()-interval '60 seconds' LIMIT 50);
 UPDATE public.hatchai_camera_outbox SET state='expired',updated_at=now() WHERE id IN(SELECT id FROM public.hatchai_camera_outbox WHERE state='pending' AND(expires_at<=now() OR attempts>=3) LIMIT 50);
 SELECT * INTO job FROM public.hatchai_camera_outbox WHERE state='pending' AND next_at<=now() AND expires_at>now() AND attempts<3 ORDER BY next_at LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT jsonb_build_object('leaseId',lease,'attempt',job.attempts+1,'expiresAt',job.expires_at,'subscription',jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth)),
 'event',jsonb_build_object('eventId',e.event_id,'position',e.position)) INTO result
 FROM public.web_push_subscriptions s JOIN public.hatchai_camera_events e ON e.device_id=job.device_id AND e.event_id=job.event_id
 JOIN public.incubators i ON i.id=e.incubator_id JOIN public.hatchai_sync_devices d ON d.device_id=e.device_id
 WHERE s.id=job.subscription_id AND s.enabled AND s.user_id=job.user_id AND i.owner_id=job.user_id AND s.incubator_id=i.id AND d.enabled AND d.role='camera' AND d.incubator_id=e.incubator_id AND d.position=e.position AND (e.relayed_by IS NULL OR EXISTS(SELECT 1 FROM public.hatchai_sync_devices c WHERE c.device_id=e.relayed_by AND c.incubator_id=e.incubator_id AND c.role='controller' AND c.enabled AND c.api_key_revoked_at IS NULL AND c.api_key_verifier IS NOT NULL AND i.device_id=c.device_id));
 IF result IS NULL THEN UPDATE public.hatchai_camera_outbox SET state='cancelled',updated_at=now() WHERE id=job.id;RETURN NULL;END IF;
 UPDATE public.hatchai_camera_outbox SET state='leased',lease_id=lease,leased_at=now(),attempts=attempts+1,updated_at=now() WHERE id=job.id;
 RETURN result;
END $$;

ALTER FUNCTION public.hatchai_camera_relay_accept(text,text,text,text,uuid,text,text,timestamptz,timestamptz,text,integer) OWNER TO postgres;
ALTER FUNCTION public.hatchai_camera_read(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.hatchai_camera_claim() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.hatchai_camera_relay_accept(text,text,text,text,uuid,text,text,timestamptz,timestamptz,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hatchai_camera_relay_accept(text,text,text,text,uuid,text,text,timestamptz,timestamptz,text,integer) TO service_role;
COMMIT;
