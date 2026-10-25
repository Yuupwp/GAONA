SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication
FROM pg_roles WHERE rolname IN ('gaona_web_publico','gaona_web_publico_login',current_user);
SELECT pg_get_userbyid(roleid) AS rol, pg_get_userbyid(member) AS miembro, admin_option, inherit_option, set_option
FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN ('gaona_web_publico','gaona_web_publico_login'));
SELECT n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS propietario
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','gaona_mensajeria') AND c.relkind='r' ORDER BY 1,2;
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check FROM pg_policies
WHERE schemaname IN ('public','gaona_mensajeria') ORDER BY 1,2,3;
SELECT r.rolname, n.nspname, c.relname,
  has_schema_privilege(r.oid,n.oid,'USAGE') AS uso,
  has_table_privilege(r.oid,c.oid,'SELECT') AS lectura_tabla,
  has_any_column_privilege(r.oid,c.oid,'SELECT') AS lectura_columnas,
  has_table_privilege(r.oid,c.oid,'INSERT') AS alta,
  has_table_privilege(r.oid,c.oid,'UPDATE') AS cambio,
  has_table_privilege(r.oid,c.oid,'DELETE') AS borrado,
  has_table_privilege(r.oid,c.oid,'TRUNCATE') AS truncar
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r
WHERE n.nspname IN ('public','gaona_mensajeria') AND c.relkind='r'
AND r.rolname IN ('gaona_web_publico','gaona_web_publico_login','anon','authenticated','service_role') ORDER BY 1,2,3;
SELECT grantee, table_schema, table_name, column_name, privilege_type FROM information_schema.column_privileges
WHERE grantee IN ('gaona_web_publico','gaona_web_publico_login') ORDER BY 1,2,3,4,5;
SELECT n.nspname,c.relname,co.conname,co.convalidated,pg_get_constraintdef(co.oid) AS definicion
FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='gaona_mensajeria' ORDER BY 1,2,3;
SELECT c.relname,i.relname,x.indisvalid,x.indisready,pg_get_indexdef(x.indexrelid) AS definicion
FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid
JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gaona_mensajeria' ORDER BY 1,2;
SELECT id,version,idempotencia_huella IS NOT NULL AS idempotencia_vinculada,acceso_huella IS NOT NULL AS acceso_vinculado,
  legado_huella IS NOT NULL AS legado_vinculado FROM gaona_mensajeria.configuracion;
