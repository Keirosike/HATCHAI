-- Run only after separately approved installation of the test-subscription RPC.
SELECT p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
       current_user AS inspection_role,
       r.rolname AS owner,r.rolbypassrls,p.prosecdef,p.proconfig,p.proacl,
       pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
       pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
       pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') AS backend_execute,
       NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(
         COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
         WHERE a.privilege_type='EXECUTE' AND a.grantee NOT IN
           (p.proowner,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='service_role'))
       ) AS only_owner_and_backend_acl
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r ON r.oid=p.proowner
WHERE p.oid=pg_catalog.to_regprocedure('public.hatchai_push_test_subscription(uuid,uuid,text)');
-- Aggregate only: subscription rows and enabled state must be preserved.
SELECT count(*) AS subscriptions,count(*) FILTER(WHERE enabled) AS enabled
FROM public.web_push_subscriptions;

-- Preserve RLS; this addition does not alter either existing table.
SELECT t.relname,pg_catalog.pg_get_userbyid(t.relowner) AS owner,
       t.relrowsecurity AS rls_enabled,t.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class t JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname='public' AND t.relname IN ('incubators','web_push_subscriptions');
