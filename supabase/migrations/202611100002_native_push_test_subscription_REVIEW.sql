-- REVIEW ONLY: requires separate approval; not part of the installed RPC file.
-- Backend-only read of ONE enabled subscription owned by the verified user.
BEGIN;
CREATE FUNCTION public.hatchai_push_test_subscription(p_user uuid,p_incubator uuid,p_endpoint_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
  IF p_endpoint_hash IS NULL OR p_endpoint_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid subscription reference';
  END IF;
  PERFORM 1 FROM public.incubators WHERE id=p_incubator AND owner_id=p_user FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Access denied'; END IF;
  SELECT jsonb_build_object('endpoint',endpoint,'p256dh',p256dh,'auth',auth)
  INTO result FROM public.web_push_subscriptions
  WHERE user_id=p_user AND incubator_id=p_incubator AND enabled
    AND encode(sha256(convert_to(endpoint,'UTF8')),'hex')=p_endpoint_hash
  LIMIT 1;
  IF result IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Subscription unavailable'; END IF;
  RETURN jsonb_build_object('confirmed',true,'subscription',result);
END $$;
REVOKE ALL ON FUNCTION public.hatchai_push_test_subscription(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hatchai_push_test_subscription(uuid,uuid,text) TO service_role;
COMMIT;
