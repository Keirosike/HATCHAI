-- REVIEW ONLY. Never execute automatically. Requires the existing reviewed table.
-- No table recreation, browser grants, RLS changes or existing record deletion.
BEGIN;

CREATE FUNCTION public.hatchai_push_subscribe(p_user uuid,p_incubator uuid,p_endpoint text,p_p256dh text,p_auth text,p_label text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE prior public.web_push_subscriptions%ROWTYPE;
BEGIN
  -- Serialize each incubator's quota and ownership changes; ownership rechecked
  -- under a row lock, independently of the Worker's earlier RLS read.
  PERFORM 1 FROM public.incubators WHERE id=p_incubator AND owner_id=p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Access denied'; END IF;
  IF p_endpoint IS NULL OR length(p_endpoint) NOT BETWEEN 32 AND 2048 OR
     p_p256dh IS NULL OR p_p256dh !~ '^[A-Za-z0-9_-]{87}$' OR
     p_auth IS NULL OR p_auth !~ '^[A-Za-z0-9_-]{22}$' OR p_label IS NULL OR length(p_label)>80
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid subscription'; END IF;
  SELECT * INTO prior FROM public.web_push_subscriptions WHERE endpoint=p_endpoint FOR UPDATE;
  IF FOUND AND (prior.user_id<>p_user OR prior.incubator_id<>p_incubator) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Subscription conflict';
  END IF;
  IF prior.id IS NULL AND
    (SELECT count(*) FROM public.web_push_subscriptions WHERE incubator_id=p_incubator)>=20
  THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='Subscription limit'; END IF;
  INSERT INTO public.web_push_subscriptions(user_id,incubator_id,endpoint,p256dh,auth,device_label)
    VALUES(p_user,p_incubator,p_endpoint,p_p256dh,p_auth,p_label)
  ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,
    device_label=excluded.device_label,enabled=true,updated_at=now()
    WHERE public.web_push_subscriptions.user_id=p_user AND public.web_push_subscriptions.incubator_id=p_incubator;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Subscription conflict'; END IF;
  RETURN jsonb_build_object('confirmed',true);
END $$;

-- Provider-confirmed invalid subscriptions are disabled only if their current
-- encryption keys still match the attempted delivery (refresh race protection).
CREATE FUNCTION public.hatchai_push_expire(p_user uuid,p_incubator uuid,p_endpoint text,p_p256dh text,p_auth text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  UPDATE public.web_push_subscriptions SET enabled=false,updated_at=now()
    WHERE user_id=p_user AND incubator_id=p_incubator AND endpoint=p_endpoint
      AND p256dh=p_p256dh AND auth=p_auth AND enabled;
  RETURN jsonb_build_object('confirmed',true);
END $$;

-- Explicitly invoked maintenance only; maximum 500 rows per call. Active rows
-- never expire just because no push has been sent. No automatic schedule here.
CREATE FUNCTION public.hatchai_push_cleanup()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE removed integer;
BEGIN
  WITH victims AS (SELECT id FROM public.web_push_subscriptions WHERE NOT enabled
    AND updated_at<now()-interval '30 days' ORDER BY updated_at LIMIT 500 FOR UPDATE SKIP LOCKED)
  DELETE FROM public.web_push_subscriptions WHERE id IN (SELECT id FROM victims);
  GET DIAGNOSTICS removed=ROW_COUNT;
  RETURN jsonb_build_object('confirmed',true,'removed',removed);
END $$;

CREATE FUNCTION public.hatchai_push_status(p_user uuid,p_incubator uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM 1 FROM public.incubators WHERE id=p_incubator AND owner_id=p_user FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Access denied'; END IF;
  RETURN jsonb_build_object('confirmed',true,'subscriptions',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'endpointHash',encode(sha256(convert_to(endpoint,'UTF8')),'hex'),'enabled',enabled))
    FROM public.web_push_subscriptions WHERE user_id=p_user AND incubator_id=p_incubator),'[]'::jsonb));
END $$;

CREATE FUNCTION public.hatchai_push_unsubscribe(p_user uuid,p_incubator uuid,p_endpoint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM 1 FROM public.incubators WHERE id=p_incubator AND owner_id=p_user FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Access denied'; END IF;
  UPDATE public.web_push_subscriptions SET enabled=false,updated_at=now()
    WHERE user_id=p_user AND incubator_id=p_incubator AND endpoint=p_endpoint;
  RETURN jsonb_build_object('confirmed',true);
END $$;

-- Worker-only credentials. The supplied p_user is derived from verified Auth,
-- never accepted from browser JSON. A browser cannot execute these functions.
REVOKE ALL ON FUNCTION public.hatchai_push_subscribe(uuid,uuid,text,text,text,text),
  public.hatchai_push_status(uuid,uuid),public.hatchai_push_unsubscribe(uuid,uuid,text),
  public.hatchai_push_expire(uuid,uuid,text,text,text),public.hatchai_push_cleanup()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hatchai_push_subscribe(uuid,uuid,text,text,text,text),
  public.hatchai_push_status(uuid,uuid),public.hatchai_push_unsubscribe(uuid,uuid,text),
  public.hatchai_push_expire(uuid,uuid,text,text,text),public.hatchai_push_cleanup() TO service_role;
COMMIT;
