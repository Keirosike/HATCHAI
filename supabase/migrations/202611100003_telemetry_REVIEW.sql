-- REVIEW ONLY. Additive. Do not execute until separately approved.
BEGIN;
DO $$ BEGIN
 IF current_user <> 'postgres' OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'Run reviewed migration as postgres with BYPASSRLS';
 END IF;
END $$;
CREATE TABLE public.hatchai_sync_devices(
 device_id text PRIMARY KEY CHECK(device_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 incubator_id uuid NOT NULL REFERENCES public.incubators(id) ON DELETE RESTRICT,
 key_id text NOT NULL CHECK(key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 role text NOT NULL CHECK(role IN ('controller','camera')),
 position text CHECK(position IN ('upper','lower')),
 enabled boolean NOT NULL DEFAULT false,
 CHECK((role='controller' AND position IS NULL) OR (role='camera' AND position IS NOT NULL)),
 UNIQUE(incubator_id,role,position)
);
CREATE UNIQUE INDEX hatchai_one_sync_controller ON public.hatchai_sync_devices(incubator_id) WHERE role='controller';
CREATE TABLE public.hatchai_telemetry(
 device_id text NOT NULL REFERENCES public.hatchai_sync_devices(device_id) ON DELETE RESTRICT,
 event_id uuid NOT NULL,
 incubator_id uuid NOT NULL REFERENCES public.incubators(id) ON DELETE RESTRICT,
 captured_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[A-Za-z0-9_-]{43}$'),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=2048),
 PRIMARY KEY(device_id,event_id)
);
CREATE INDEX hatchai_telemetry_recent ON public.hatchai_telemetry(incubator_id,captured_at DESC,received_at DESC);
CREATE TABLE public.hatchai_sync_nonces(
 device_id text NOT NULL REFERENCES public.hatchai_sync_devices(device_id) ON DELETE RESTRICT,
 nonce_hash text NOT NULL CHECK(nonce_hash ~ '^[A-Za-z0-9_-]{43}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(device_id,nonce_hash)
);
CREATE INDEX hatchai_sync_nonces_retention ON public.hatchai_sync_nonces(created_at);
ALTER TABLE public.hatchai_sync_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hatchai_sync_devices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hatchai_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hatchai_telemetry FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hatchai_sync_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hatchai_sync_nonces FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hatchai_sync_devices,public.hatchai_telemetry,public.hatchai_sync_nonces FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.hatchai_sync_ingest(p_device text,p_key text,p_event uuid,p_nonce text,p_hash text,p_captured timestamptz,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE device public.hatchai_sync_devices%ROWTYPE; old public.hatchai_telemetry%ROWTYPE; added integer;
BEGIN
 SELECT d.* INTO device FROM public.hatchai_sync_devices d JOIN public.incubators i ON i.id=d.incubator_id
 WHERE d.device_id=p_device AND d.key_id=p_key AND d.enabled AND d.role='controller' AND i.device_id=d.device_id FOR UPDATE OF d FOR SHARE OF i;
 IF NOT FOUND THEN RAISE EXCEPTION 'Device not authorized' USING ERRCODE='42501'; END IF;
 IF p_captured>now()+interval '60 seconds' OR p_captured<now()-interval '7 days' OR
 jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>2048 OR
 NOT(p_payload ?& ARRAY['eventId','capturedAt','temperatureCenti','humidityCenti','sensorValid','sensorAgeMs','heaterOn','fanOn','lowerOn','upperOn','autoMode','upperCameraOnline','lowerCameraOnline','upperChick','lowerChick']) OR
 (SELECT count(*) FROM jsonb_object_keys(p_payload))<>15 OR (p_payload->>'eventId')::uuid<>p_event OR
 to_timestamp((p_payload->>'capturedAt')::bigint)<>p_captured OR p_payload->'fanOn'<>'null'::jsonb THEN
 RAISE EXCEPTION 'Invalid telemetry' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['sensorValid','heaterOn','lowerOn','upperOn','autoMode']) k WHERE jsonb_typeof(p_payload->k)<>'boolean') THEN RAISE EXCEPTION 'Invalid flags' USING ERRCODE='22023'; END IF;
 IF (p_payload->>'sensorValid')::boolean THEN
  IF jsonb_typeof(p_payload->'temperatureCenti')<>'number' OR jsonb_typeof(p_payload->'humidityCenti')<>'number' OR jsonb_typeof(p_payload->'sensorAgeMs')<>'number' OR
   (p_payload->>'temperatureCenti')::integer NOT BETWEEN -4000 AND 8000 OR (p_payload->>'humidityCenti')::integer NOT BETWEEN 0 AND 10000 OR
   (p_payload->>'sensorAgeMs')::integer NOT BETWEEN 0 AND 19999 THEN RAISE EXCEPTION 'Invalid sensor' USING ERRCODE='22023'; END IF;
 ELSE
  IF p_payload->'temperatureCenti'<>'null'::jsonb OR p_payload->'humidityCenti'<>'null'::jsonb OR p_payload->'sensorAgeMs'<>'null'::jsonb THEN RAISE EXCEPTION 'Invalid unavailable sample' USING ERRCODE='22023'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['upper','lower']) side WHERE (p_payload->(side||'CameraOnline') NOT IN('null'::jsonb,'true'::jsonb,'false'::jsonb)) OR (p_payload->(side||'CameraOnline')='true'::jsonb AND jsonb_typeof(p_payload->(side||'Chick'))<>'boolean') OR (p_payload->(side||'CameraOnline')<>'true'::jsonb AND p_payload->(side||'Chick')<>'null'::jsonb)) THEN RAISE EXCEPTION 'Invalid camera status' USING ERRCODE='22023'; END IF;
 INSERT INTO public.hatchai_sync_nonces(device_id,nonce_hash) VALUES(p_device,p_nonce) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 IF added=0 THEN RAISE EXCEPTION 'Replay rejected' USING ERRCODE='23505'; END IF;
 INSERT INTO public.hatchai_telemetry(device_id,event_id,incubator_id,captured_at,payload_hash,payload)
 VALUES(p_device,p_event,device.incubator_id,p_captured,p_hash,p_payload) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 SELECT * INTO old FROM public.hatchai_telemetry WHERE device_id=p_device AND event_id=p_event;
 IF old.payload_hash<>p_hash OR old.incubator_id<>device.incubator_id THEN RAISE EXCEPTION 'Event conflict' USING ERRCODE='23505'; END IF;
 RETURN jsonb_build_object('accepted',true,'eventId',p_event,'duplicate',added=0);
END $$;
CREATE FUNCTION public.hatchai_sync_read(p_user uuid,p_incubator uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE latest public.hatchai_telemetry%ROWTYPE; points jsonb;
BEGIN
 PERFORM 1 FROM public.incubators WHERE id=p_incubator AND owner_id=p_user FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 SELECT t.* INTO latest FROM public.hatchai_telemetry t JOIN public.hatchai_sync_devices d ON d.device_id=t.device_id
 WHERE t.incubator_id=p_incubator AND d.enabled AND d.role='controller' ORDER BY t.captured_at DESC,t.received_at DESC LIMIT 1;
 SELECT coalesce(jsonb_agg(jsonb_build_object('capturedAt',q.captured_at,'sample',q.payload) ORDER BY q.captured_at),'[]') INTO points
 FROM(SELECT captured_at,payload FROM public.hatchai_telemetry WHERE incubator_id=p_incubator AND captured_at>now()-interval '24 hours' ORDER BY captured_at DESC LIMIT 96) q;
 RETURN jsonb_build_object('incubatorId',p_incubator,'online',coalesce(latest.received_at>now()-interval '90 seconds' AND latest.captured_at>now()-interval '90 seconds',false),
 'latest',CASE WHEN latest.event_id IS NULL THEN NULL ELSE jsonb_build_object('capturedAt',latest.captured_at,'receivedAt',latest.received_at,'sample',latest.payload) END,'history',points,'serverTime',now());
END $$;
CREATE FUNCTION public.hatchai_sync_cleanup() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer; m integer;
BEGIN
 WITH old AS(SELECT ctid FROM public.hatchai_sync_nonces WHERE created_at<now()-interval '24 hours' LIMIT 500)
 DELETE FROM public.hatchai_sync_nonces WHERE ctid IN(SELECT ctid FROM old);GET DIAGNOSTICS n=ROW_COUNT;
 WITH old AS(SELECT ctid FROM public.hatchai_telemetry WHERE captured_at<now()-interval '7 days' LIMIT 500)
 DELETE FROM public.hatchai_telemetry WHERE ctid IN(SELECT ctid FROM old);GET DIAGNOSTICS m=ROW_COUNT;
 RETURN n+m;
END $$;
REVOKE ALL ON FUNCTION public.hatchai_sync_ingest(text,text,uuid,text,text,timestamptz,jsonb),public.hatchai_sync_read(uuid,uuid),public.hatchai_sync_cleanup() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hatchai_sync_ingest(text,text,uuid,text,text,timestamptz,jsonb),public.hatchai_sync_read(uuid,uuid),public.hatchai_sync_cleanup() TO service_role;
COMMIT;
