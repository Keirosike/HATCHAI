-- REVIEW ONLY. Requires migrations 003-005. Never run without separate approval.
-- Keeps existing raw history intact; new ingest writes bounded receipts/latest/windows instead.
BEGIN;
DO $$ BEGIN
 IF current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND(rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'postgres BYPASSRLS required';END IF;
END $$;
CREATE TABLE public.hatchai_sync_receipts(
 device_id text NOT NULL REFERENCES public.hatchai_sync_devices(device_id) ON DELETE RESTRICT,
 event_id uuid NOT NULL,payload_hash text NOT NULL,incubator_id uuid NOT NULL REFERENCES public.incubators(id) ON DELETE RESTRICT,
 captured_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(device_id,event_id)
);
CREATE INDEX hatchai_sync_receipts_expiry ON public.hatchai_sync_receipts(captured_at);
CREATE TABLE public.hatchai_telemetry_latest(
 incubator_id uuid PRIMARY KEY REFERENCES public.incubators(id) ON DELETE RESTRICT,
 device_id text NOT NULL REFERENCES public.hatchai_sync_devices(device_id) ON DELETE RESTRICT,
 event_id uuid NOT NULL,captured_at timestamptz NOT NULL,received_at timestamptz NOT NULL,payload jsonb NOT NULL
);
CREATE TABLE public.hatchai_telemetry_windows(
 incubator_id uuid NOT NULL REFERENCES public.incubators(id) ON DELETE RESTRICT,
 interval_start timestamptz NOT NULL,interval_end timestamptz NOT NULL,
 temperature_sum bigint NOT NULL DEFAULT 0,humidity_sum bigint NOT NULL DEFAULT 0,
 temperature_min integer,temperature_max integer,humidity_min integer,humidity_max integer,
 valid_count integer NOT NULL DEFAULT 0 CHECK(valid_count BETWEEN 0 AND 360),
 slots bit(360) NOT NULL DEFAULT repeat('0',360)::bit(360),
 finalized_at timestamptz,PRIMARY KEY(incubator_id,interval_start),
 CHECK(interval_end=interval_start+interval '30 minutes')
);
CREATE INDEX hatchai_telemetry_windows_due ON public.hatchai_telemetry_windows(interval_end) WHERE finalized_at IS NULL;
ALTER TABLE public.hatchai_sync_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hatchai_sync_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hatchai_telemetry_latest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hatchai_telemetry_latest FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hatchai_telemetry_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hatchai_telemetry_windows FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hatchai_sync_receipts,public.hatchai_telemetry_latest,public.hatchai_telemetry_windows FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.hatchai_sync_ingest(p_device text,p_key text,p_event uuid,p_nonce text,p_hash text,p_captured timestamptz,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE device public.hatchai_sync_devices%ROWTYPE; previous public.hatchai_sync_receipts%ROWTYPE; added integer;
 start_at timestamptz;slot integer;included boolean=false;
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

 IF p_event IS NULL OR p_captured IS NULL OR p_payload IS NULL OR p_nonce IS NULL OR p_nonce !~ '^[A-Za-z0-9_-]{43}$' OR p_hash IS NULL OR p_hash !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023';END IF;
 INSERT INTO public.hatchai_sync_nonces(device_id,nonce_hash) VALUES(p_device,p_nonce) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;IF added=0 THEN RAISE EXCEPTION 'Replay rejected' USING ERRCODE='23505';END IF;
 INSERT INTO public.hatchai_sync_receipts(device_id,event_id,payload_hash,incubator_id,captured_at) VALUES(p_device,p_event,p_hash,device.incubator_id,p_captured) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 SELECT * INTO previous FROM public.hatchai_sync_receipts WHERE device_id=p_device AND event_id=p_event;
 IF previous.payload_hash<>p_hash OR previous.incubator_id<>device.incubator_id THEN RAISE EXCEPTION 'Event conflict' USING ERRCODE='23505';END IF;
 IF added=0 THEN RETURN jsonb_build_object('accepted',true,'duplicate',true,'eventId',p_event);END IF;
 INSERT INTO public.hatchai_telemetry_latest VALUES(device.incubator_id,p_device,p_event,p_captured,now(),p_payload)
 ON CONFLICT(incubator_id) DO UPDATE SET device_id=excluded.device_id,event_id=excluded.event_id,captured_at=excluded.captured_at,received_at=excluded.received_at,payload=excluded.payload
 WHERE excluded.captured_at>hatchai_telemetry_latest.captured_at;
 -- Completed windows allow ten minutes of lateness, based on captured UTC.
 -- At most one valid upload per five-second slot; retries/new IDs cannot inflate count.
 start_at=to_timestamp(floor(extract(epoch FROM p_captured)/1800)*1800);
 slot=floor(extract(epoch FROM p_captured-start_at)/5)::integer;
 IF (p_payload->>'sensorValid')::boolean AND start_at+interval '40 minutes'>now() THEN
  INSERT INTO public.hatchai_telemetry_windows(incubator_id,interval_start,interval_end) VALUES(device.incubator_id,start_at,start_at+interval '30 minutes') ON CONFLICT DO NOTHING;
  UPDATE public.hatchai_telemetry_windows SET
   temperature_sum=temperature_sum+(p_payload->>'temperatureCenti')::integer,
   humidity_sum=humidity_sum+(p_payload->>'humidityCenti')::integer,
   temperature_min=least(temperature_min,(p_payload->>'temperatureCenti')::integer),temperature_max=greatest(temperature_max,(p_payload->>'temperatureCenti')::integer),
   humidity_min=least(humidity_min,(p_payload->>'humidityCenti')::integer),humidity_max=greatest(humidity_max,(p_payload->>'humidityCenti')::integer),
   valid_count=valid_count+1,slots=set_bit(slots,slot,1)
  WHERE incubator_id=device.incubator_id AND interval_start=start_at AND finalized_at IS NULL AND get_bit(slots,slot)=0;
  GET DIAGNOSTICS added=ROW_COUNT;included=added=1;
 END IF;
 RETURN jsonb_build_object('accepted',true,'duplicate',false,'eventId',p_event,'aggregated',included);
END $$;
CREATE FUNCTION public.hatchai_sync_read_v2(p_user uuid,p_incubator uuid,p_history_version text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE latest public.hatchai_telemetry_latest%ROWTYPE;points jsonb;history_version text;unchanged boolean;age_seconds numeric;
BEGIN
 PERFORM 1 FROM public.incubators WHERE id=p_incubator AND owner_id=p_user FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';END IF;
 SELECT l.* INTO latest FROM public.hatchai_telemetry_latest l JOIN public.hatchai_sync_devices d ON d.device_id=l.device_id AND d.enabled AND d.incubator_id=l.incubator_id WHERE l.incubator_id=p_incubator;
 SELECT md5(coalesce(string_agg(extract(epoch FROM q.interval_start)::text||':'||extract(epoch FROM q.finalized_at)::text,',' ORDER BY q.interval_start),'empty')) INTO history_version
 FROM(SELECT interval_start,finalized_at FROM public.hatchai_telemetry_windows WHERE incubator_id=p_incubator AND finalized_at IS NOT NULL ORDER BY interval_start DESC LIMIT 48) q;
 unchanged=coalesce(p_history_version=history_version,false);
 IF unchanged THEN points='[]'::jsonb;ELSE
 -- Existing raw historical records are preserved and accessible via the old read RPC.
 SELECT coalesce(jsonb_agg(jsonb_build_object('intervalStart',q.interval_start,'intervalEnd',q.interval_end,
 'averageTemperatureCenti',q.temperature_sum::numeric/nullif(q.valid_count,0),'averageHumidityCenti',q.humidity_sum::numeric/nullif(q.valid_count,0),
 'minTemperatureCenti',q.temperature_min,'maxTemperatureCenti',q.temperature_max,'minHumidityCenti',q.humidity_min,'maxHumidityCenti',q.humidity_max,
 'validCount',q.valid_count,'completeness',CASE WHEN q.valid_count=360 THEN 'complete' ELSE 'partial' END,'finalizedAt',q.finalized_at) ORDER BY q.interval_start),'[]') INTO points
 FROM(SELECT * FROM public.hatchai_telemetry_windows WHERE incubator_id=p_incubator AND finalized_at IS NOT NULL ORDER BY interval_start DESC LIMIT 48) q;
 END IF;
 age_seconds=greatest(extract(epoch FROM now()-latest.received_at),extract(epoch FROM now()-latest.captured_at));
 RETURN jsonb_build_object('incubatorId',p_incubator,'online',coalesce(age_seconds<90,false),'connection',CASE WHEN latest.event_id IS NULL THEN 'unavailable' WHEN age_seconds>=90 THEN 'offline' WHEN age_seconds>=15 THEN 'stale' ELSE 'online' END,
 'latest',CASE WHEN latest.event_id IS NULL THEN NULL ELSE jsonb_build_object('capturedAt',latest.captured_at,'receivedAt',latest.received_at,'sample',latest.payload) END,
 'history',points,'historyVersion',history_version,'historyUnchanged',unchanged,'historyKind','utc-30-minute','serverTime',now());
END $$;
CREATE FUNCTION public.hatchai_sync_finalize() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer;
BEGIN
 WITH due AS(SELECT incubator_id,interval_start FROM public.hatchai_telemetry_windows WHERE finalized_at IS NULL AND interval_end+interval '10 minutes'<=now() ORDER BY interval_end LIMIT 100 FOR UPDATE SKIP LOCKED)
 UPDATE public.hatchai_telemetry_windows w SET finalized_at=now() FROM due WHERE w.incubator_id=due.incubator_id AND w.interval_start=due.interval_start;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END $$;
CREATE FUNCTION public.hatchai_sync_cleanup_v2() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer;total integer=0;
BEGIN
 -- Dedup receipts remain eight days, longer than the seven-day accepted capture age.
 WITH old AS(SELECT ctid FROM public.hatchai_sync_receipts WHERE captured_at<now()-interval '8 days' LIMIT 1000) DELETE FROM public.hatchai_sync_receipts WHERE ctid IN(SELECT ctid FROM old);GET DIAGNOSTICS n=ROW_COUNT;total=total+n;
 WITH old AS(SELECT ctid FROM public.hatchai_sync_nonces WHERE created_at<now()-interval '24 hours' LIMIT 1000) DELETE FROM public.hatchai_sync_nonces WHERE ctid IN(SELECT ctid FROM old);GET DIAGNOSTICS n=ROW_COUNT;total=total+n;
 -- Preserve all old raw history. New raw samples are never inserted there.
 WITH old AS(SELECT ctid FROM public.hatchai_telemetry_windows WHERE finalized_at IS NOT NULL AND interval_end<now()-interval '30 days' LIMIT 100) DELETE FROM public.hatchai_telemetry_windows WHERE ctid IN(SELECT ctid FROM old);GET DIAGNOSTICS n=ROW_COUNT;
 RETURN total+n;
END $$;
REVOKE ALL ON FUNCTION public.hatchai_sync_read_v2(uuid,uuid,text),public.hatchai_sync_finalize(),public.hatchai_sync_cleanup_v2() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hatchai_sync_read_v2(uuid,uuid,text),public.hatchai_sync_finalize(),public.hatchai_sync_cleanup_v2() TO service_role;
REVOKE ALL ON FUNCTION public.hatchai_sync_ingest(text,text,uuid,text,text,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hatchai_sync_ingest(text,text,uuid,text,text,timestamptz,jsonb) TO service_role;
COMMIT;
