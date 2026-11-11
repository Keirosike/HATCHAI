-- HATCHAI Sprint 2: FINAL READ-ONLY inspection. Rollout remains HOLD.
-- No migrations, SET ROLE, function calls to application RPCs, or row exports.
-- Use the SAME SQL Editor role intended to execute the later RPC migration.
-- Select ONE complete numbered section (through its semicolon), Run, then
-- Results > Export > CSV. Save as hatchai-db-01.csv ... hatchai-db-08.csv.
-- A WITH clause belongs to its SELECT: include the entire section when running.
-- Return all eight exports for review. Do not run either migration at this stage.
-- Roles below are database-role metadata, not application user identifiers.

-- 01 — Defaults required by the RPC's omitted INSERT columns.
SELECT '01_column_defaults' AS section, table_name, column_name,
       data_type, is_nullable, column_default, is_identity, is_generated
FROM information_schema.columns
WHERE table_schema='public' AND table_name='web_push_subscriptions'
  AND column_name IN ('id','enabled','created_at','updated_at')
ORDER BY ordinal_position;

-- 02 — Actual executor, server version and privileged-role attributes.
-- Function ownership follows current_user, not a presumed SQL Editor role name.
SELECT '02_executor_roles' AS section, current_user AS migration_executor,
       session_user AS session_role, current_setting('server_version_num') AS server_version_num,
       r.rolname, r.rolsuper, r.rolbypassrls, r.rolinherit, r.rolcreaterole,
       r.rolcanlogin, (r.rolsuper OR r.rolbypassrls) AS bypasses_forced_rls
FROM pg_catalog.pg_roles r
WHERE r.rolname IN (current_user,session_user,'postgres','service_role','anon','authenticated')
ORDER BY r.rolname;

-- 03 — Full index definitions: endpoint uniqueness must be immediate and valid.
SELECT '03_indexes' AS section, t.relname AS table_name,
       i.indexrelid::regclass::text AS index_name,
       i.indisprimary, i.indisunique, i.indisvalid, i.indisready, i.indislive,
       i.indimmediate, pg_catalog.pg_get_expr(i.indpred,i.indrelid) AS predicate,
       pg_catalog.pg_get_indexdef(i.indexrelid) AS definition
FROM pg_catalog.pg_index i
JOIN pg_catalog.pg_class t ON t.oid=i.indrelid
JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname='public' AND t.relname IN ('incubators','web_push_subscriptions')
ORDER BY t.relname,index_name;

-- 04 — Exact constraints, validation, deferral and foreign-key delete behavior.
SELECT '04_constraints' AS section, t.relname AS table_name, c.conname,
       c.contype, c.convalidated, c.condeferrable, c.condeferred,
       CASE WHEN c.contype='f' THEN c.confrelid::regclass::text END AS referenced_table,
       CASE WHEN c.contype='f' THEN CASE c.confdeltype
         WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
         WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END END AS on_delete,
       pg_catalog.pg_get_constraintdef(c.oid,true) AS definition
FROM pg_catalog.pg_constraint c
JOIN pg_catalog.pg_class t ON t.oid=c.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname='public' AND t.relname IN ('incubators','web_push_subscriptions')
ORDER BY t.relname,c.conname;

-- 05 — RLS state and exact policies; no policy still yields a table-state row.
SELECT '05_rls_policies' AS section, t.relname AS table_name,
       pg_catalog.pg_get_userbyid(t.relowner) AS table_owner,
       t.relrowsecurity AS rls_enabled,t.relforcerowsecurity AS rls_forced,
       p.policyname,p.permissive,p.roles,p.cmd,p.qual,p.with_check
FROM pg_catalog.pg_class t
JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
LEFT JOIN pg_catalog.pg_policies p ON p.schemaname=n.nspname AND p.tablename=t.relname
WHERE n.nspname='public' AND t.relname IN ('incubators','web_push_subscriptions')
ORDER BY t.relname,p.policyname;

-- 06 — Schema access and effective table grants; do not grant anything here.
SELECT '06_schema_and_table_access' AS section, r.rolname,
       pg_catalog.has_schema_privilege(r.oid,'public','USAGE') AS public_usage,
       pg_catalog.has_schema_privilege(r.oid,'public','CREATE') AS public_create,
       pg_catalog.has_schema_privilege(r.oid,'auth','USAGE') AS auth_usage,
       pg_catalog.has_table_privilege(r.oid,t.oid,'SELECT') AS can_select,
       pg_catalog.has_table_privilege(r.oid,t.oid,'INSERT') AS can_insert,
       pg_catalog.has_table_privilege(r.oid,t.oid,'UPDATE') AS can_update,
       pg_catalog.has_table_privilege(r.oid,t.oid,'DELETE') AS can_delete,
       t.relname AS table_name
FROM pg_catalog.pg_roles r
CROSS JOIN pg_catalog.pg_class t
JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
WHERE r.rolname IN ('anon','authenticated','service_role',current_user)
  AND n.nspname='public' AND t.relname IN ('incubators','web_push_subscriptions')
ORDER BY r.rolname,t.relname;

-- 07 — All reachable membership paths from relevant roles, plus an explicit
-- self row when no memberships exist. USAGE means currently inherited access.
-- SET is available on PostgreSQL 16+; older versions use MEMBER semantics.
-- SUPERUSER/BYPASSRLS attributes are NOT inherited as ordinary table privileges:
-- inspect SET ability separately. CREATEROLE paths require manual review too.
WITH RECURSIVE roots AS (
  SELECT oid,rolname FROM pg_catalog.pg_roles
  WHERE rolname IN ('anon','authenticated','service_role',current_user)
), paths AS (
  SELECT oid AS root_oid,oid AS target_oid,ARRAY[oid] AS visited,
         ARRAY[rolname::text] AS role_path,0 AS depth FROM roots
  UNION ALL
  SELECT p.root_oid,m.roleid,p.visited||m.roleid,
         p.role_path||r.rolname::text,p.depth+1
  FROM paths p JOIN pg_catalog.pg_auth_members m ON m.member=p.target_oid
  JOIN pg_catalog.pg_roles r ON r.oid=m.roleid
  WHERE NOT m.roleid=ANY(p.visited)
)
SELECT '07_role_paths' AS section,root.rolname AS source_role,
       target.rolname AS reachable_role,p.depth,p.role_path,
       target.rolsuper,target.rolbypassrls,target.rolcreaterole,
       target.rolinherit,
       pg_catalog.pg_has_role(p.root_oid,p.target_oid,'MEMBER') AS is_member,
       pg_catalog.pg_has_role(p.root_oid,p.target_oid,'USAGE') AS inherited_privileges,
       CASE WHEN current_setting('server_version_num')::integer>=160000
         THEN pg_catalog.pg_has_role(p.root_oid,p.target_oid,'SET')
         ELSE pg_catalog.pg_has_role(p.root_oid,p.target_oid,'MEMBER') END AS can_set_role,
       (target.rolsuper OR target.rolbypassrls OR target.rolcreaterole
         OR target.rolname IN ('postgres','service_role')
         OR EXISTS (SELECT 1 FROM pg_catalog.pg_class t
           JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
           WHERE n.nspname='public' AND t.relname IN ('incubators','web_push_subscriptions')
             AND t.relowner=target.oid)) AS privileged_target
FROM paths p JOIN pg_catalog.pg_roles root ON root.oid=p.root_oid
JOIN pg_catalog.pg_roles target ON target.oid=p.target_oid
ORDER BY root.rolname,p.depth,p.role_path;

-- 08 — Aggregate counts only. Disabled subscriptions count toward the quota.
-- Treat counts as complete only when visibility is confirmed; RLS-filtered
-- results must not be mistaken for an empty table. No incubator IDs returned.
SELECT '08_subscription_counts' AS section,
       (SELECT rolsuper OR rolbypassrls FROM pg_catalog.pg_roles
         WHERE rolname=current_user) AS executor_has_full_rls_visibility,
       (SELECT count(*) FROM public.web_push_subscriptions) AS total_subscriptions,
       (SELECT count(*) FROM public.web_push_subscriptions WHERE enabled) AS enabled_subscriptions,
       (SELECT count(*) FROM public.web_push_subscriptions WHERE NOT enabled) AS disabled_subscriptions,
       (SELECT count(*) FROM (
          SELECT count(*) AS retained FROM public.web_push_subscriptions
          GROUP BY incubator_id HAVING count(*)>20
        ) q) AS incubators_over_retained_quota,
       (SELECT COALESCE(max(retained),0) FROM (
          SELECT count(*) AS retained FROM public.web_push_subscriptions GROUP BY incubator_id
        ) q) AS maximum_retained_per_incubator;
