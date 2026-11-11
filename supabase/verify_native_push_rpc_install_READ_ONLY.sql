-- Run AFTER separately approved migration installation, as postgres.
-- SELECT-only: no subscription endpoints, keys, user IDs or test writes.
-- Export each result separately. Exactly five function rows must be present.
WITH expected(signature) AS (VALUES
 ('public.hatchai_push_subscribe(uuid,uuid,text,text,text,text)'),
 ('public.hatchai_push_status(uuid,uuid)'),
 ('public.hatchai_push_unsubscribe(uuid,uuid,text)'),
 ('public.hatchai_push_expire(uuid,uuid,text,text,text)'),
 ('public.hatchai_push_cleanup()'))
SELECT e.signature,p.oid IS NOT NULL AS installed,
       r.rolname AS function_owner,r.rolbypassrls,r.rolsuper,
       p.prosecdef AS security_definer,p.proconfig,
       pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
       pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
       pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') AS backend_execute,
       p.proacl,
       NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(
         COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
         WHERE a.privilege_type='EXECUTE' AND
         a.grantee NOT IN (p.proowner,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='service_role'))
       ) AS only_owner_and_backend_acl
FROM expected e LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(e.signature)
LEFT JOIN pg_catalog.pg_roles r ON r.oid=p.proowner ORDER BY e.signature;

-- Expected total=5; no unexpected overloads. Underscores are literal here.
SELECT count(*) AS push_function_count
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND left(p.proname,13)='hatchai_push_';

-- Expected both tables exist and remain postgres-owned; subscription RLS true/true.
SELECT t.relname,pg_catalog.pg_get_userbyid(t.relowner) AS owner,
       t.relrowsecurity AS rls_enabled,t.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class t JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname='public' AND t.relname IN ('incubators','web_push_subscriptions');

-- Subscription counts must remain zero from the inspected baseline unless a
-- separately authorized registration happened. Incubator count must be preserved.
SELECT current_user AS inspection_role,
       (SELECT count(*) FROM public.incubators) AS incubator_count,
       (SELECT count(*) FROM public.web_push_subscriptions) AS subscription_count,
       (SELECT count(*) FROM public.web_push_subscriptions WHERE enabled) AS enabled_count;
