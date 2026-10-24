SELECT current_user, session_user, current_setting('server_version') AS version,
  rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
FROM pg_roles WHERE rolname = current_user;
SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
FROM pg_roles WHERE rolname IN ('gaona_web_backend', 'gaona_web_login');
SELECT pg_get_userbyid(roleid) AS rol, pg_get_userbyid(member) AS miembro,
  admin_option, inherit_option, set_option
FROM pg_auth_members WHERE member IN
  (SELECT oid FROM pg_roles WHERE rolname IN ('gaona_web_backend','gaona_web_login'));
SELECT n.nspname AS esquema, c.relname AS tabla, c.relrowsecurity AS rls,
  c.relforcerowsecurity AS forzar_rls, pg_get_userbyid(c.relowner) AS propietario,
  pg_has_role(current_user,c.relowner,'MEMBER') AS miembro_propietario
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','gaona_mensajeria') AND c.relkind IN ('r','p') ORDER BY 1,2;
SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname IN ('public','gaona_mensajeria') ORDER BY 1,2,3;
SELECT n.nspname,c.relname,has_table_privilege(current_user,c.oid,'SELECT') AS lectura,
  has_table_privilege(current_user,c.oid,'INSERT') AS alta,
  has_table_privilege(current_user,c.oid,'UPDATE') AS cambio,
  has_table_privilege(current_user,c.oid,'DELETE') AS borrado,
  has_table_privilege(current_user,c.oid,'TRUNCATE') AS truncar
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','gaona_mensajeria') AND c.relkind IN ('r','p') ORDER BY 1,2;
SELECT r.rolname, n.nspname, c.relname,
  has_schema_privilege(r.oid,n.oid,'USAGE') AS acceso_esquema,
  has_table_privilege(r.oid,c.oid,'SELECT') AS lectura
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r
WHERE n.nspname='gaona_mensajeria' AND c.relkind='r'
  AND r.rolname IN ('anon','authenticated','service_role') ORDER BY 1,2,3;
SELECT n.nspname,c.relname,co.conname,co.convalidated,pg_get_constraintdef(co.oid) AS definicion
FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='gaona_mensajeria' ORDER BY 1,2,3;
SELECT c.relname,i.relname AS indice,x.indisvalid,x.indisready,pg_get_indexdef(x.indexrelid)
FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid
JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gaona_mensajeria' ORDER BY 1,2;
SELECT id,version,idempotencia_huella IS NOT NULL AS idempotencia_vinculada,
  acceso_huella IS NOT NULL AS acceso_vinculado,legado_huella IS NOT NULL AS legado_vinculado
FROM gaona_mensajeria.configuracion;
