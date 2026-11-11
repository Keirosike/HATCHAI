-- REVIEW ONLY. Separate approval required after migration 007 verification.
-- Existing firmware thresholds only. No humidity thresholds invented.
-- Rules remain disabled; enabling alerts requires separate approval.
BEGIN;
DO $$ BEGIN
 IF current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM public.incubators WHERE id='87ce3cf3-a455-4bc3-a7bb-049882d985fa' AND device_id='hatchai-inc01-controller') THEN RAISE EXCEPTION 'Verify executor and incubator';END IF;
END $$;
INSERT INTO public.hatchai_alert_rules(incubator_id,kind,enabled,threshold_on,threshold_off,debounce_seconds,warmup_seconds) VALUES
 ('87ce3cf3-a455-4bc3-a7bb-049882d985fa','temperature_high',false,3850,3800,0,0),
 ('87ce3cf3-a455-4bc3-a7bb-049882d985fa','temperature_critical',false,3900,3750,0,0),
 ('87ce3cf3-a455-4bc3-a7bb-049882d985fa','temperature_low',false,3650,3700,600,1800),
 ('87ce3cf3-a455-4bc3-a7bb-049882d985fa','sensor_failure',false,NULL,NULL,0,0),
 ('87ce3cf3-a455-4bc3-a7bb-049882d985fa','sensor_stale',false,NULL,NULL,0,0),
 ('87ce3cf3-a455-4bc3-a7bb-049882d985fa','controller_offline',false,NULL,NULL,0,0);
COMMIT;
