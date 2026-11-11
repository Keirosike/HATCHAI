-- REVIEW ONLY. Requires reviewed 0003 telemetry registry and existing push RPC migration.
BEGIN;
DO $$ BEGIN IF current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'postgres BYPASSRLS required';END IF;END $$;
CREATE TABLE public.hatchai_camera_events(
 device_id text NOT NULL REFERENCES public.hatchai_sync_devices(device_id) ON DELETE RESTRICT,
 event_id uuid NOT NULL,
 incubator_id uuid NOT NULL REFERENCES public.incubators(id) ON DELETE RESTRICT,
 position text NOT NULL CHECK(position IN('upper','lower')),
 detected_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[A-Za-z0-9_-]{43}$'),
 PRIMARY KEY(device_id,event_id)
);
CREATE INDEX hatchai_camera_events_recent ON public.hatchai_camera_events(incubator_id,detected_at DESC);
CREATE TABLE public.hatchai_camera_cooldowns(device_id text PRIMARY KEY REFERENCES public.hatchai_sync_devices(device_id) ON DELETE RESTRICT,last_queued_at timestamptz NOT NULL);
CREATE TABLE public.hatchai_camera_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),device_id text NOT NULL,event_id uuid NOT NULL,
 subscription_id uuid NOT NULL REFERENCES public.web_push_subscriptions(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','leased','accepted','expired','failed','unknown','cancelled')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 next_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT(now()+interval '24 hours'),
 lease_id uuid,leased_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(device_id,event_id) REFERENCES public.hatchai_camera_events(device_id,event_id) ON DELETE CASCADE,
 UNIQUE(device_id,event_id,subscription_id)
);
CREATE INDEX hatchai_camera_outbox_due ON public.hatchai_camera_outbox(next_at) WHERE state='pending';
ALTER TABLE public.hatchai_camera_events ENABLE ROW LEVEL SECURITY;ALTER TABLE public.hatchai_camera_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hatchai_camera_cooldowns ENABLE ROW LEVEL SECURITY;ALTER TABLE public.hatchai_camera_cooldowns FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hatchai_camera_outbox ENABLE ROW LEVEL SECURITY;ALTER TABLE public.hatchai_camera_outbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hatchai_camera_events,public.hatchai_camera_cooldowns,public.hatchai_camera_outbox FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.hatchai_camera_accept(p_device text,p_key text,p_event uuid,p_nonce text,p_hash text,p_detected timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.hatchai_sync_devices%ROWTYPE;old public.hatchai_camera_events%ROWTYPE;n integer;last_at timestamptz;
BEGIN
 SELECT * INTO d FROM public.hatchai_sync_devices WHERE device_id=p_device AND key_id=p_key AND role='camera' AND enabled FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Camera not authorized' USING ERRCODE='42501';END IF;
 IF p_detected>now()+interval '60 seconds' OR p_detected<now()-interval '7 days' THEN RAISE EXCEPTION 'Invalid event time' USING ERRCODE='22023';END IF;
 INSERT INTO public.hatchai_sync_nonces(device_id,nonce_hash) VALUES(p_device,p_nonce) ON CONFLICT DO NOTHING;GET DIAGNOSTICS n=ROW_COUNT;
 IF n=0 THEN RAISE EXCEPTION 'Replay' USING ERRCODE='23505';END IF;
 INSERT INTO public.hatchai_camera_events(device_id,event_id,incubator_id,position,detected_at,payload_hash) VALUES(p_device,p_event,d.incubator_id,d.position,p_detected,p_hash) ON CONFLICT DO NOTHING;GET DIAGNOSTICS n=ROW_COUNT;
 SELECT * INTO old FROM public.hatchai_camera_events WHERE device_id=p_device AND event_id=p_event;
 IF old.payload_hash<>p_hash OR old.incubator_id<>d.incubator_id THEN RAISE EXCEPTION 'Conflicting event' USING ERRCODE='23505';END IF;
 IF n=0 THEN RETURN jsonb_build_object('accepted',true,'duplicate',true,'eventId',p_event);END IF;
 SELECT last_queued_at INTO last_at FROM public.hatchai_camera_cooldowns WHERE device_id=p_device;
 -- Old queued detections remain in history but do not become fresh delayed alerts.
 IF p_detected>=now()-interval '15 minutes' AND (last_at IS NULL OR last_at<=now()-interval '60 seconds') THEN
  INSERT INTO public.hatchai_camera_outbox(device_id,event_id,subscription_id,user_id)
  SELECT p_device,p_event,s.id,s.user_id FROM public.web_push_subscriptions s JOIN public.incubators i ON i.id=s.incubator_id AND i.owner_id=s.user_id
  WHERE s.incubator_id=d.incubator_id AND s.enabled;
  INSERT INTO public.hatchai_camera_cooldowns VALUES(p_device,now()) ON CONFLICT(device_id) DO UPDATE SET last_queued_at=excluded.last_queued_at;
 END IF;
 RETURN jsonb_build_object('accepted',true,'duplicate',false,'eventId',p_event);
END $$;
CREATE FUNCTION public.hatchai_camera_read(p_user uuid,p_incubator uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE records jsonb;
BEGIN
 PERFORM 1 FROM public.incubators WHERE id=p_incubator AND owner_id=p_user FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('position',q.position,'capturedAt',q.detected_at,'chick',true) ORDER BY q.detected_at DESC),'[]') INTO records
 FROM(SELECT position,detected_at FROM public.hatchai_camera_events WHERE incubator_id=p_incubator ORDER BY detected_at DESC LIMIT 50) q;
 RETURN jsonb_build_object('captures',records);
END $$;
CREATE FUNCTION public.hatchai_camera_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
 WHERE s.id=job.subscription_id AND s.enabled AND s.user_id=job.user_id AND i.owner_id=job.user_id AND s.incubator_id=i.id AND d.enabled;
 IF result IS NULL THEN UPDATE public.hatchai_camera_outbox SET state='cancelled',updated_at=now() WHERE id=job.id;RETURN NULL;END IF;
 UPDATE public.hatchai_camera_outbox SET state='leased',lease_id=lease,leased_at=now(),attempts=attempts+1,updated_at=now() WHERE id=job.id;
 RETURN result;
END $$;
CREATE FUNCTION public.hatchai_camera_finish(p_lease uuid,p_outcome text,p_retry timestamptz DEFAULT NULL,p_endpoint text DEFAULT NULL,p_p256dh text DEFAULT NULL,p_auth text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public.hatchai_camera_outbox%ROWTYPE;
BEGIN
 IF p_outcome NOT IN('accepted','expired','failed','unknown','retryable','disabled','unconfigured') THEN RAISE EXCEPTION 'Invalid outcome';END IF;
 SELECT * INTO job FROM public.hatchai_camera_outbox WHERE lease_id=p_lease AND state='leased' FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 IF p_outcome='expired' THEN UPDATE public.web_push_subscriptions SET enabled=false,updated_at=now() WHERE id=job.subscription_id AND endpoint=p_endpoint AND p256dh=p_p256dh AND auth=p_auth;END IF;
 UPDATE public.hatchai_camera_outbox SET state=CASE WHEN p_outcome='retryable' AND job.attempts<3 AND p_retry>now() AND p_retry<job.expires_at THEN 'pending' WHEN p_outcome IN('accepted','expired','unknown') THEN p_outcome ELSE 'failed' END,
 next_at=coalesce(p_retry,next_at),lease_id=NULL,updated_at=now() WHERE id=job.id;
 RETURN true;
END $$;
CREATE FUNCTION public.hatchai_camera_cleanup() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE count integer;
BEGIN
 DELETE FROM public.hatchai_sync_nonces WHERE ctid IN(SELECT ctid FROM public.hatchai_sync_nonces WHERE created_at<now()-interval '24 hours' LIMIT 500);
 WITH old AS(SELECT ctid FROM public.hatchai_camera_events WHERE received_at<now()-interval '30 days' AND NOT EXISTS(SELECT 1 FROM public.hatchai_camera_outbox o WHERE o.device_id=hatchai_camera_events.device_id AND o.event_id=hatchai_camera_events.event_id AND o.state IN('pending','leased')) LIMIT 100)
 DELETE FROM public.hatchai_camera_events WHERE ctid IN(SELECT ctid FROM old);GET DIAGNOSTICS count=ROW_COUNT;RETURN count;
END $$;
REVOKE ALL ON FUNCTION public.hatchai_camera_accept(text,text,uuid,text,text,timestamptz),public.hatchai_camera_read(uuid,uuid),public.hatchai_camera_claim(),public.hatchai_camera_finish(uuid,text,timestamptz,text,text,text),public.hatchai_camera_cleanup() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hatchai_camera_accept(text,text,uuid,text,text,timestamptz),public.hatchai_camera_read(uuid,uuid),public.hatchai_camera_claim(),public.hatchai_camera_finish(uuid,text,timestamptz,text,text,text),public.hatchai_camera_cleanup() TO service_role;
COMMIT;
