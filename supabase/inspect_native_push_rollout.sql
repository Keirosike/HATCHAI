-- REVIEW ONLY: requires separate approval before production execution.
-- Metadata and aggregate counts only. No subscription endpoints/keys/user data.
BEGIN READ ONLY;
SELECT current_user AS inspection_role;
SELECT rolname, rolsuper, rolbypassrls, rolinherit
FROM pg_roles WHERE rolname IN (current_user,'postgres','service_role','authenticated','anon');

SELECT c.relname, pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('incubators','web_push_subscriptions');

SELECT table_name,column_name,data_type,is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('incubators','web_push_subscriptions')
ORDER BY table_name,ordinal_position;

SELECT conname,pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid='public.web_push_subscriptions'::regclass;

SELECT indexrelid::regclass::text AS index_name,indisunique,indisvalid,
       pg_get_indexdef(indexrelid) AS definition
FROM pg_index WHERE indrelid='public.web_push_subscriptions'::regclass;

SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename IN ('incubators','web_push_subscriptions');

SELECT r.rolname,
 has_table_privilege(r.rolname,'public.web_push_subscriptions','SELECT') AS can_select,
 has_table_privilege(r.rolname,'public.web_push_subscriptions','INSERT') AS can_insert,
 has_table_privilege(r.rolname,'public.web_push_subscriptions','UPDATE') AS can_update,
 has_table_privilege(r.rolname,'public.web_push_subscriptions','DELETE') AS can_delete,
 has_schema_privilege(r.rolname,'public','CREATE') AS can_create_in_public,
 pg_has_role(r.oid,'service_role','MEMBER') AS member_of_backend_role
FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role');

SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
 owner.rolname AS owner,p.prosecdef AS security_definer,
 owner.rolsuper OR owner.rolbypassrls AS owner_can_bypass_forced_rls,
 (SELECT setting FROM unnest(p.proconfig) setting WHERE setting LIKE 'search_path=%') AS search_path,
 p.proacl,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') AS backend_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
JOIN pg_roles owner ON owner.oid=p.proowner
WHERE n.nspname='public' AND p.proname LIKE 'hatchai_push_%';

SELECT count(*) AS total,count(*) FILTER(WHERE enabled) AS enabled
FROM public.web_push_subscriptions;
SELECT count(*) AS incubators_over_retained_quota FROM (
 SELECT incubator_id FROM public.web_push_subscriptions
 GROUP BY incubator_id HAVING count(*)>20
) totals;
SELECT count(*) AS subscriptions_with_changed_incubator_owner
FROM public.web_push_subscriptions s JOIN public.incubators i ON i.id=s.incubator_id
WHERE s.user_id<>i.owner_id;
COMMIT;
