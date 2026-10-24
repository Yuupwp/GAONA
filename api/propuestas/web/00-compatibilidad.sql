WITH necesarias(tabla,columna,tipo,no_nula) AS (VALUES
 ('categorias','id','text',true),('categorias','nombre','text',true),
 ('productos','id','text',true),('productos','idCategoria','text',true),('productos','nombre','text',true),('productos','descripcion','text',false),
 ('productos','precioDesde','numeric(12,2)',true),('productos','imagenUrl','text',false),('productos','activo','boolean',true),('productos','tipo','"TipoProducto"',true),
 ('clientes','id','text',true),('clientes','nombre','text',true),('clientes','apellido','text',true),('clientes','direccion','text',false),
 ('clientes','telefono','text',true),('clientes','correo','text',false),('clientes','creadoEn','timestamp(3) without time zone',true),('clientes','actualizadoEn','timestamp(3) without time zone',true),
 ('solicitudes','id','text',true),('solicitudes','idCliente','text',true),('solicitudes','idUsuarioAsignado','text',false),('solicitudes','origen','"OrigenSolicitud"',true),
 ('solicitudes','estado','"EstadoSolicitud"',true),('solicitudes','descripcion','text',false),('solicitudes','creadoEn','timestamp(3) without time zone',true),('solicitudes','actualizadoEn','timestamp(3) without time zone',true),
 ('solicitud_detalles','id','text',true),('solicitud_detalles','idSolicitud','text',true),('solicitud_detalles','idProducto','text',true),('solicitud_detalles','cantidad','integer',true),
 ('solicitud_detalles','medidasAprox','text',false),('solicitud_detalles','medidasReales','text',false),('solicitud_detalles','notas','text',false)
), diferencias AS (
 SELECT r.tabla,r.columna,r.tipo AS esperado,format_type(a.atttypid,a.atttypmod) AS actual
 FROM necesarias r LEFT JOIN pg_namespace n ON n.nspname='public'
 LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=r.tabla AND c.relkind='r'
 LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname=r.columna AND a.attnum>0 AND NOT a.attisdropped
 WHERE a.attname IS NULL OR format_type(a.atttypid,a.atttypmod)<>r.tipo OR a.attnotnull<>r.no_nula
), enums(tipo,valor) AS (VALUES ('OrigenSolicitud','WEB'),('EstadoSolicitud','NUEVA'),('TipoProducto','PRODUCTO'))
SELECT jsonb_build_object(
 'version_pg17',current_setting('server_version_num')::integer>=170000,
 'columnas_incompatibles',(SELECT COALESCE(jsonb_agg(to_jsonb(d)),'[]') FROM diferencias d),
 'enums_ausentes',(SELECT COALESCE(jsonb_agg(to_jsonb(e)),'[]') FROM enums e WHERE NOT EXISTS(
   SELECT 1 FROM pg_enum v JOIN pg_type t ON t.oid=v.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname=e.tipo AND v.enumlabel=e.valor)),
 'rls_compartido',(SELECT count(*)=5 AND bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('productos','categorias','clientes','solicitudes','solicitud_detalles') AND c.relkind='r'),
 'instalacion_privada_previa',EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='gaona_mensajeria'),
 'roles_previos',(SELECT COALESCE(jsonb_agg(rolname),'[]') FROM pg_roles WHERE rolname IN ('gaona_web_publico','gaona_web_publico_login'))
) AS compatibilidad;
