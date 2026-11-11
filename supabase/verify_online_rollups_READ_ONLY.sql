-- Metadata only. Run SELECTs separately after explicitly approved 006/007 installation.
SELECT c.relname,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity,
 has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS anon_any,
 has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS browser_any,
 has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS backend_direct
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN('hatchai_sync_receipts','hatchai_telemetry_latest','hatchai_telemetry_windows','hatchai_alert_rules','hatchai_alert_state','hatchai_alert_events','hatchai_alert_outbox') ORDER BY c.relname;
SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') AS browser_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') AS backend_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND(p.proname LIKE 'hatchai_alert_%' OR p.proname IN('hatchai_sync_ingest','hatchai_sync_read_v2','hatchai_sync_finalize','hatchai_sync_cleanup_v2')) ORDER BY p.proname;
SELECT t.relname,i.relname AS index_name,x.indisvalid,pg_get_indexdef(i.oid) AS definition FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid WHERE t.relnamespace='public'::regnamespace AND t.relname IN('hatchai_sync_receipts','hatchai_telemetry_latest','hatchai_telemetry_windows','hatchai_alert_rules','hatchai_alert_state','hatchai_alert_events','hatchai_alert_outbox') ORDER BY t.relname,i.relname;
SELECT kind,enabled,threshold_on,threshold_off,debounce_seconds,warmup_seconds FROM public.hatchai_alert_rules ORDER BY kind;
