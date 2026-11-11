-- READ ONLY. Run each SELECT separately after approved migration installation.
-- Metadata and aggregate counts only; no credential material or subscriber data.
SELECT c.relname AS table_name,c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS rls_forced,pg_get_userbyid(c.relowner) AS owner,
 has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS anon_any_access,
 has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS browser_any_access,
 has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS backend_any_direct_access
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN('hatchai_sync_devices','hatchai_telemetry','hatchai_sync_nonces','hatchai_camera_events','hatchai_camera_cooldowns','hatchai_camera_outbox','hatchai_camera_captures') ORDER BY c.relname;

SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_userbyid(p.proowner) AS owner,
 p.prosecdef AS security_definer,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS browser_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') AS backend_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND (p.proname LIKE 'hatchai_sync_%' OR p.proname LIKE 'hatchai_camera_%' OR p.proname LIKE 'hatchai_capture_%') ORDER BY p.proname;

SELECT c.relname AS table_name,i.relname AS index_name,x.indisunique,x.indisvalid,pg_get_indexdef(i.oid) AS definition
FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN('hatchai_sync_devices','hatchai_telemetry','hatchai_sync_nonces','hatchai_camera_events','hatchai_camera_cooldowns','hatchai_camera_outbox','hatchai_camera_captures') ORDER BY c.relname,i.relname;

-- Run only when Storage exists; metadata, never object names or signed URLs.
SELECT id,public,file_size_limit,allowed_mime_types FROM storage.buckets ORDER BY id;
SELECT policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='storage' AND tablename='objects' ORDER BY policyname;
