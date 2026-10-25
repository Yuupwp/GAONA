WITH lectura(tabla,columnas) AS (VALUES
 ('productos',ARRAY['id','idCategoria','tipo','nombre','descripcion','precioDesde','imagenUrl','activo']),
 ('categorias',ARRAY['id','nombre']),('clientes',ARRAY['id']),
 ('solicitudes',ARRAY['id','idCliente','origen','estado','idUsuarioAsignado','creadoEn']),
 ('solicitud_detalles',ARRAY['id','idSolicitud'])
), alta(tabla,columnas) AS (VALUES
 ('clientes',ARRAY['id','nombre','apellido','direccion','telefono','correo','creadoEn','actualizadoEn']),
 ('solicitudes',ARRAY['id','idCliente','idUsuarioAsignado','origen','estado','descripcion','creadoEn','actualizadoEn']),
 ('solicitud_detalles',ARRAY['id','idSolicitud','idProducto','cantidad','medidasAprox','notas'])
)
SELECT jsonb_build_object(
 'identidad',current_user,'sesion',session_user,
 'version',current_setting('server_version_num')::integer>=170000,
 'solo_lectura',current_setting('transaction_read_only')='on',
 'tls',COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),false),
 'rol_restringido',EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication),
 'grupo_seguro',EXISTS(SELECT 1 FROM pg_roles WHERE rolname='gaona_web_publico' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
   AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='gaona_web_publico')),
 'herencia_exclusiva',(SELECT count(*)=1 AND bool_and(r.rolname='gaona_web_publico' AND m.inherit_option AND NOT m.admin_option AND NOT m.set_option)
    FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname=current_user)),
 'sin_ddl',NOT has_schema_privilege(current_user,'public','CREATE') AND NOT has_schema_privilege(current_user,'gaona_mensajeria','CREATE'),
 'permisos_publicos',NOT EXISTS(SELECT 1 FROM lectura l CROSS JOIN LATERAL unnest(l.columnas) a(col)
    WHERE NOT has_column_privilege(current_user,format('public.%I',l.tabla),a.col,'SELECT'))
    AND NOT EXISTS(SELECT 1 FROM alta l CROSS JOIN LATERAL unnest(l.columnas) a(col)
    WHERE NOT has_column_privilege(current_user,format('public.%I',l.tabla),a.col,'INSERT')),
 'columnas_minimas',NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN lectura l ON l.tabla=c.relname LEFT JOIN alta i ON i.tabla=c.relname
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped AND (
     (has_column_privilege(current_user,c.oid,a.attnum,'SELECT') AND NOT COALESCE(a.attname=ANY(l.columnas),false)) OR
     (has_column_privilege(current_user,c.oid,a.attnum,'INSERT') AND NOT COALESCE(a.attname=ANY(i.columnas),false)) OR
     has_column_privilege(current_user,c.oid,a.attnum,'UPDATE,REFERENCES'))),
 'sin_borrado_negocio',NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER')),
 'cuatro_tablas_privadas',(SELECT count(*)=4 AND bool_and(c.relname IN ('configuracion','registros_web','documentos','correos') AND c.relrowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER'))
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gaona_mensajeria' AND c.relkind IN ('r','p')),
 'permisos_privados',has_table_privilege(current_user,'gaona_mensajeria.configuracion','SELECT') AND NOT has_table_privilege(current_user,'gaona_mensajeria.configuracion','INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES')
    AND (SELECT bool_and(has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND has_table_privilege(current_user,c.oid,'UPDATE')
      AND NOT has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER,REFERENCES')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gaona_mensajeria' AND c.relname IN ('registros_web','documentos','correos')),
 'privadas_no_publicas',NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role') AND has_schema_privilege(r.oid,'gaona_mensajeria','USAGE')),
 'rls_compartido',(SELECT count(*)=5 AND bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('productos','categorias','clientes','solicitudes','solicitud_detalles') AND c.relkind='r'),
 'barreras_restrictivas',(SELECT count(*)=3 FROM pg_policies WHERE schemaname='public' AND policyname IN ('gaona_web6_productos_limite','gaona_web6_solicitudes_limite','gaona_web6_detalles_limite') AND permissive='RESTRICTIVE' AND roles=ARRAY['gaona_web_publico']::name[]),
 'historial_protegido',(SELECT count(*)=3 FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gaona_mensajeria' AND c.relname IN ('registros_web','documentos','correos') AND co.contype='f' AND co.confrelid='public.solicitudes'::regclass AND co.confdeltype='r' AND co.convalidated),
 'indices_validos',(SELECT count(*)=4 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='gaona_mensajeria' AND c.relkind='i' AND c.relname IN ('registros_web_cuota','documentos_retencion','correos_cuota','correos_reservas'))
    AND NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gaona_mensajeria' AND (NOT i.indisvalid OR NOT i.indisready)),
 'sin_definer_accesible',NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND p.prosecdef AND p.prorettype<>'trigger'::regtype
    AND has_schema_privilege(current_user,n.oid,'USAGE') AND has_function_privilege(current_user,p.oid,'EXECUTE')),
 'huellas_vinculadas',EXISTS(SELECT 1 FROM gaona_mensajeria.configuracion WHERE id=1 AND version=2 AND idempotencia_huella IS NOT NULL AND acceso_huella IS NOT NULL)
) AS auditoria;
