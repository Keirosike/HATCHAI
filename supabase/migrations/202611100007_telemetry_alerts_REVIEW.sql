-- REVIEW ONLY. Requires 006 and existing subscription contract. No rule seeded or activation performed.
BEGIN;
DO $$ BEGIN IF current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND(rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'postgres BYPASSRLS required';END IF;END $$;
CREATE TABLE public.hatchai_alert_rules(
 incubator_id uuid NOT NULL REFERENCES public.incubators(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN('temperature_high','temperature_critical','temperature_low','humidity_high','humidity_low','sensor_failure','sensor_stale','controller_offline')),
 enabled boolean NOT NULL DEFAULT false,threshold_on integer,threshold_off integer,
 debounce_seconds integer NOT NULL CHECK(debounce_seconds BETWEEN 0 AND 86400),warmup_seconds integer NOT NULL DEFAULT 0 CHECK(warmup_seconds BETWEEN 0 AND 86400),
 PRIMARY KEY(incubator_id,kind),
 CHECK(kind NOT IN('temperature_high','temperature_critical','temperature_low','humidity_high','humidity_low') OR(threshold_on IS NOT NULL AND threshold_off IS NOT NULL)),
 CHECK(kind NOT IN('temperature_high','temperature_critical','humidity_high') OR threshold_off<=threshold_on),
 CHECK(kind NOT IN('temperature_low','humidity_low') OR threshold_off>=threshold_on)
);
CREATE TABLE public.hatchai_alert_state(
 device_id text NOT NULL REFERENCES public.hatchai_sync_devices(device_id) ON DELETE RESTRICT,kind text NOT NULL,
 active boolean NOT NULL DEFAULT false,since_at timestamptz,started_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(device_id,kind)
);
CREATE TABLE public.hatchai_alert_events(
 device_id text NOT NULL REFERENCES public.hatchai_sync_devices(device_id) ON DELETE RESTRICT,event_id uuid NOT NULL DEFAULT gen_random_uuid(),
 incubator_id uuid NOT NULL REFERENCES public.incubators(id) ON DELETE RESTRICT,kind text NOT NULL,
 status text NOT NULL CHECK(status IN('active','resolved')),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(device_id,event_id)
);
CREATE INDEX hatchai_alert_events_recent ON public.hatchai_alert_events(incubator_id,created_at DESC);
CREATE TABLE public.hatchai_alert_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),device_id text NOT NULL,event_id uuid NOT NULL,
 subscription_id uuid NOT NULL REFERENCES public.web_push_subscriptions(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','leased','accepted','expired','failed','unknown','cancelled')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 next_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT(now()+interval '24 hours'),
 lease_id uuid,leased_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(device_id,event_id) REFERENCES public.hatchai_alert_events(device_id,event_id) ON DELETE CASCADE,
 UNIQUE(device_id,event_id,subscription_id)
);
CREATE INDEX hatchai_alert_outbox_due ON public.hatchai_alert_outbox(next_at) WHERE state='pending';
ALTER TABLE public.hatchai_alert_rules ENABLE ROW LEVEL SECURITY;ALTER TABLE public.hatchai_alert_rules FORCE ROW LEVEL SECURITY;REVOKE ALL ON public.hatchai_alert_rules FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.hatchai_alert_state ENABLE ROW LEVEL SECURITY;ALTER TABLE public.hatchai_alert_state FORCE ROW LEVEL SECURITY;REVOKE ALL ON public.hatchai_alert_state FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.hatchai_alert_events ENABLE ROW LEVEL SECURITY;ALTER TABLE public.hatchai_alert_events FORCE ROW LEVEL SECURITY;REVOKE ALL ON public.hatchai_alert_events FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.hatchai_alert_outbox ENABLE ROW LEVEL SECURITY;ALTER TABLE public.hatchai_alert_outbox FORCE ROW LEVEL SECURITY;REVOKE ALL ON public.hatchai_alert_outbox FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.hatchai_alert_observe(p_device text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.hatchai_sync_devices%ROWTYPE;l public.hatchai_telemetry_latest%ROWTYPE;r public.hatchai_alert_rules%ROWTYPE;s public.hatchai_alert_state%ROWTYPE;
 condition boolean;fresh boolean;value integer;change_to boolean;ev uuid;n integer=0;
BEGIN
 SELECT * INTO d FROM public.hatchai_sync_devices WHERE device_id=p_device AND enabled AND role='controller' FOR UPDATE;
 IF NOT FOUND THEN RETURN 0;END IF;
 SELECT * INTO l FROM public.hatchai_telemetry_latest WHERE device_id=p_device AND incubator_id=d.incubator_id;
 IF NOT FOUND THEN RETURN 0;END IF;
 PERFORM 1 FROM public.incubators WHERE id=d.incubator_id AND device_id=p_device FOR SHARE;
 IF NOT FOUND THEN RETURN 0;END IF;
 fresh=l.captured_at>now()-interval '15 seconds' AND l.received_at>now()-interval '15 seconds';
 FOR r IN SELECT * FROM public.hatchai_alert_rules WHERE incubator_id=d.incubator_id AND enabled ORDER BY kind LOOP
  INSERT INTO public.hatchai_alert_state(device_id,kind) VALUES(p_device,r.kind) ON CONFLICT DO NOTHING;
  SELECT * INTO s FROM public.hatchai_alert_state WHERE device_id=p_device AND kind=r.kind FOR UPDATE;
  condition=NULL;
  IF r.kind='controller_offline' THEN condition=least(l.captured_at,l.received_at)<=now()-interval '90 seconds';
  ELSIF r.kind='sensor_failure' AND fresh THEN condition=NOT(l.payload->>'sensorValid')::boolean;
  ELSIF r.kind='sensor_stale' THEN condition=(l.payload->>'sensorValid')::boolean AND coalesce((l.payload->>'sensorAgeMs')::integer,0)+extract(epoch FROM now()-l.captured_at)*1000>=20000;
  ELSIF fresh AND(l.payload->>'sensorValid')::boolean THEN
   value=(l.payload->>CASE WHEN r.kind LIKE 'humidity_%' THEN 'humidityCenti' ELSE 'temperatureCenti' END)::integer;
   IF r.kind IN('temperature_low','humidity_low') THEN condition=CASE WHEN s.active THEN value<r.threshold_off ELSE value<r.threshold_on END;
   ELSE condition=CASE WHEN s.active THEN value>r.threshold_off ELSE value>=r.threshold_on END;END IF;
  END IF;
  IF condition IS NULL THEN
   UPDATE public.hatchai_alert_state SET since_at=NULL WHERE device_id=p_device AND kind=r.kind AND NOT active;
   CONTINUE;
  END IF;
  change_to=NULL;
  IF condition THEN
   IF NOT s.active AND now()>=s.started_at+make_interval(secs=>r.warmup_seconds) THEN
    IF s.since_at IS NULL THEN s.since_at=now();UPDATE public.hatchai_alert_state SET since_at=s.since_at WHERE device_id=p_device AND kind=r.kind;END IF;
    IF now()>=s.since_at+make_interval(secs=>r.debounce_seconds) THEN change_to=true;END IF;
   END IF;
  ELSE
   UPDATE public.hatchai_alert_state SET since_at=NULL WHERE device_id=p_device AND kind=r.kind;
   IF s.active THEN change_to=false;END IF;
  END IF;
  IF change_to IS NOT NULL THEN
   UPDATE public.hatchai_alert_state SET active=change_to,since_at=NULL WHERE device_id=p_device AND kind=r.kind;
   INSERT INTO public.hatchai_alert_events(device_id,incubator_id,kind,status) VALUES(p_device,d.incubator_id,r.kind,CASE WHEN change_to THEN 'active' ELSE 'resolved' END) RETURNING event_id INTO ev;
   INSERT INTO public.hatchai_alert_outbox(device_id,event_id,subscription_id,user_id)
   SELECT p_device,ev,sub.id,sub.user_id FROM public.web_push_subscriptions sub JOIN public.incubators i ON i.id=sub.incubator_id AND i.owner_id=sub.user_id WHERE sub.incubator_id=d.incubator_id AND sub.enabled;
   n=n+1;
  END IF;
 END LOOP;
 RETURN n;
END $$;
CREATE FUNCTION public.hatchai_alert_tick() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d record;n integer=0;
BEGIN
 FOR d IN SELECT device_id FROM public.hatchai_sync_devices WHERE enabled AND role='controller' ORDER BY device_id LIMIT 20 LOOP n=n+public.hatchai_alert_observe(d.device_id);END LOOP;
 RETURN n;
END $$;
CREATE FUNCTION public.hatchai_alert_read(p_user uuid,p_incubator uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE records jsonb;
BEGIN
 PERFORM 1 FROM public.incubators WHERE id=p_incubator AND owner_id=p_user FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('eventId',q.event_id,'kind',q.kind,'status',q.status,'createdAt',q.created_at) ORDER BY q.created_at DESC),'[]') INTO records
 FROM(SELECT * FROM public.hatchai_alert_events WHERE incubator_id=p_incubator ORDER BY created_at DESC LIMIT 50) q;
 RETURN jsonb_build_object('alerts',records);
END $$;
CREATE FUNCTION public.hatchai_alert_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public.hatchai_alert_outbox%ROWTYPE;lease uuid=gen_random_uuid();result jsonb;
BEGIN
 UPDATE public.hatchai_alert_outbox SET state='unknown',lease_id=NULL,updated_at=now() WHERE id IN(SELECT id FROM public.hatchai_alert_outbox WHERE state='leased' AND leased_at<now()-interval '60 seconds' LIMIT 50);
 UPDATE public.hatchai_alert_outbox SET state='expired',updated_at=now() WHERE id IN(SELECT id FROM public.hatchai_alert_outbox WHERE state='pending' AND(expires_at<=now() OR attempts>=3) LIMIT 50);
 SELECT * INTO job FROM public.hatchai_alert_outbox WHERE state='pending' AND next_at<=now() AND expires_at>now() AND attempts<3 ORDER BY next_at LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT jsonb_build_object('leaseId',lease,'attempt',job.attempts+1,'subscription',jsonb_build_object('endpoint',sub.endpoint,'keys',jsonb_build_object('p256dh',sub.p256dh,'auth',sub.auth)),
 'event',jsonb_build_object('eventId',e.event_id,'kind',e.kind,'status',e.status)) INTO result
 FROM public.web_push_subscriptions sub JOIN public.hatchai_alert_events e ON e.device_id=job.device_id AND e.event_id=job.event_id
 JOIN public.incubators i ON i.id=e.incubator_id JOIN public.hatchai_sync_devices d ON d.device_id=e.device_id
 JOIN public.hatchai_alert_rules rules ON rules.incubator_id=e.incubator_id AND rules.kind=e.kind AND rules.enabled
 WHERE sub.id=job.subscription_id AND sub.enabled AND sub.user_id=job.user_id AND i.owner_id=job.user_id AND sub.incubator_id=i.id AND d.enabled;
 IF result IS NULL THEN UPDATE public.hatchai_alert_outbox SET state='cancelled',updated_at=now() WHERE id=job.id;RETURN NULL;END IF;
 UPDATE public.hatchai_alert_outbox SET state='leased',lease_id=lease,leased_at=now(),attempts=attempts+1,updated_at=now() WHERE id=job.id;
 RETURN result;
END $$;
CREATE FUNCTION public.hatchai_alert_finish(p_lease uuid,p_outcome text,p_retry timestamptz DEFAULT NULL,p_endpoint text DEFAULT NULL,p_p256dh text DEFAULT NULL,p_auth text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public.hatchai_alert_outbox%ROWTYPE;
BEGIN
 IF p_outcome NOT IN('accepted','expired','failed','unknown','retryable','disabled','unconfigured') THEN RAISE EXCEPTION 'Invalid outcome';END IF;
 SELECT * INTO job FROM public.hatchai_alert_outbox WHERE lease_id=p_lease AND state='leased' FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 IF p_outcome='expired' THEN UPDATE public.web_push_subscriptions SET enabled=false,updated_at=now() WHERE id=job.subscription_id AND endpoint=p_endpoint AND p256dh=p_p256dh AND auth=p_auth;END IF;
 UPDATE public.hatchai_alert_outbox SET state=CASE WHEN p_outcome='retryable' AND job.attempts<3 AND p_retry>now() AND p_retry<job.expires_at THEN 'pending' WHEN p_outcome IN('accepted','expired','unknown') THEN p_outcome ELSE 'failed' END,
 next_at=coalesce(p_retry,next_at),lease_id=NULL,updated_at=now() WHERE id=job.id;
 RETURN true;
END $$;
CREATE FUNCTION public.hatchai_alert_cleanup() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer;
BEGIN
 WITH old AS(SELECT device_id,event_id FROM public.hatchai_alert_events WHERE created_at<now()-interval '30 days' LIMIT 100)
 DELETE FROM public.hatchai_alert_events e USING old WHERE e.device_id=old.device_id AND e.event_id=old.event_id;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.hatchai_alert_observe(text) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.hatchai_alert_observe(text) TO service_role;
REVOKE ALL ON FUNCTION public.hatchai_alert_tick() FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.hatchai_alert_tick() TO service_role;
REVOKE ALL ON FUNCTION public.hatchai_alert_read(uuid,uuid) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.hatchai_alert_read(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.hatchai_alert_claim() FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.hatchai_alert_claim() TO service_role;
REVOKE ALL ON FUNCTION public.hatchai_alert_finish(uuid,text,timestamptz,text,text,text) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.hatchai_alert_finish(uuid,text,timestamptz,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.hatchai_alert_cleanup() FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.hatchai_alert_cleanup() TO service_role;
COMMIT;
