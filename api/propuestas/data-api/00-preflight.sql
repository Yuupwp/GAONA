BEGIN READ ONLY;
SELECT current_database() AS base,current_setting('server_version') AS version,current_setting('transaction_read_only') AS solo_lectura;
SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname IN ('anon','authenticated','authenticator');
SELECT n.nspname,c.relname,c.relrowsecurity,pg_get_userbyid(c.relowner) AS propietario FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('productos','categorias','clientes','solicitudes','solicitud_detalles');
SELECT policyname,tablename,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ('productos','categorias','clientes','solicitudes','solicitud_detalles');
SELECT c.relname,r.rolname,a.privilege_type,a.is_grantable FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('productos','categorias','clientes','solicitudes','solicitud_detalles');
SELECT d.defaclrole::regrole AS propietario,n.nspname,d.defaclobjtype,d.defaclacl FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE d.defaclobjtype='r';
SELECT p.proname,p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='gaona_web_operacion';
COMMIT;
