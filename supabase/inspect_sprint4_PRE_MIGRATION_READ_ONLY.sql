-- SPRINT 4 PRE-MIGRATION INSPECTION. SELECT statements only.
-- Run each labeled section separately in Supabase SQL Editor as postgres.
-- Metadata and aggregate counts only; no endpoints, encryption keys, passwords or tokens.

-- 1. Project executor and schema prerequisites.
SELECT current_database() AS database_name,current_user AS executor,
 r.rolsuper AS executor_superuser,r.rolbypassrls AS executor_bypassrls,
 to_regclass('public.incubators') IS NOT NULL AS incubators_exists,
 to_regclass('public.web_push_subscriptions') IS NOT NULL AS subscriptions_exists
FROM pg_roles r WHERE r.rolname=current_user;

-- 2. Existing/additive tables and RLS. Missing tables intentionally return no row.
SELECT c.relname AS table_name,pg_get_userbyid(c.relowner) AS owner,
 c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN('incubators','web_push_subscriptions','hatchai_sync_devices','hatchai_telemetry','hatchai_sync_nonces','hatchai_camera_events','hatchai_camera_cooldowns','hatchai_camera_outbox','hatchai_camera_captures') ORDER BY c.relname;

-- 3. Actual prerequisite columns, types, defaults and nullability.
SELECT table_name,column_name,data_type,is_nullable,column_default
FROM information_schema.columns WHERE table_schema='public'
AND table_name IN('incubators','web_push_subscriptions','hatchai_sync_devices') ORDER BY table_name,ordinal_position;

-- 4. Existing functions and effective execution privileges.
SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
 pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS browser_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') AS backend_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
AND (p.proname LIKE 'hatchai_sync_%' OR p.proname LIKE 'hatchai_camera_%' OR p.proname LIKE 'hatchai_capture_%' OR p.proname LIKE 'hatchai_push_%') ORDER BY p.proname;

-- 5. Constraints and index definitions, including validity.
SELECT c.relname AS table_name,k.conname,k.convalidated,pg_get_constraintdef(k.oid) AS definition
FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN('incubators','web_push_subscriptions','hatchai_sync_devices','hatchai_camera_captures') ORDER BY c.relname,k.conname;
SELECT t.relname AS table_name,i.relname AS index_name,x.indisvalid,x.indisunique,pg_get_indexdef(i.oid) AS definition
FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname='public' AND t.relname IN('incubators','web_push_subscriptions','hatchai_sync_devices','hatchai_camera_captures') ORDER BY t.relname,i.relname;

-- 6. Registry/ownership aggregate. Do not expose user IDs or invent a new incubator.
SELECT count(*) AS incubator_rows,
 count(*) FILTER(WHERE device_id='hatchai-inc01-controller') AS approved_controller_matches,
 count(*) FILTER(WHERE owner_id IS NULL) AS missing_owner
FROM public.incubators;

-- 7. Dedicated bucket candidates and ALL Storage object policies (broad policies matter).
SELECT id,public,file_size_limit,allowed_mime_types FROM storage.buckets ORDER BY id;
SELECT policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='storage' AND tablename='objects' ORDER BY policyname;

-- 8. Effective table/schema privileges. No subscription rows are returned.
SELECT c.relname AS table_name,roles.role,
 has_table_privilege(roles.role,c.oid,'SELECT') AS can_select,
 has_table_privilege(roles.role,c.oid,'INSERT') AS can_insert,
 has_table_privilege(roles.role,c.oid,'UPDATE') AS can_update,
 has_table_privilege(roles.role,c.oid,'DELETE') AS can_delete
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN(VALUES('anon'),('authenticated'),('service_role')) AS roles(role)
WHERE n.nspname='public' AND c.relname IN('web_push_subscriptions','hatchai_sync_devices','hatchai_telemetry','hatchai_sync_nonces','hatchai_camera_events','hatchai_camera_captures') ORDER BY c.relname,roles.role;
SELECT r.rolname,r.rolsuper,r.rolbypassrls,r.rolinherit,
 pg_has_role('anon',r.oid,'USAGE') AS anon_inherits,
 pg_has_role('authenticated',r.oid,'USAGE') AS browser_inherits
FROM pg_roles r WHERE r.rolsuper OR r.rolbypassrls OR r.rolname='service_role' ORDER BY r.rolname;
-- 9. Exact existing controller/incubator mapping; owner identity remains private.
SELECT i.id AS incubator_id,i.device_id,i.device_name,(u.id IS NOT NULL) AS owner_exists
FROM public.incubators i LEFT JOIN auth.users u ON u.id=i.owner_id
WHERE i.device_id='hatchai-inc01-controller';

-- 10. Schema creation privileges (browser roles must not gain definer access).
SELECT r.rolname,
 has_schema_privilege(r.rolname,'public','USAGE') AS public_usage,
 has_schema_privilege(r.rolname,'public','CREATE') AS public_create,
 has_schema_privilege(r.rolname,'storage','USAGE') AS storage_usage,
 has_schema_privilege(r.rolname,'storage','CREATE') AS storage_create
FROM pg_roles r WHERE r.rolname IN('anon','authenticated','service_role',current_user) ORDER BY r.rolname;

-- OPTIONAL 11: run ONLY if section 2 confirms hatchai_sync_devices already exists.
-- Inspect identity metadata only; no key bytes are stored in this registry.
-- SELECT device_id,incubator_id,key_id,role,position,enabled
-- FROM public.hatchai_sync_devices ORDER BY device_id;
