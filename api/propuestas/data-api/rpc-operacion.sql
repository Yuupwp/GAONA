CREATE OR REPLACE FUNCTION gaona_web_interno.operacion(p_accion text,p_args jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
 cfg public.gaona_web_configuracion%ROWTYPE;
 r public.gaona_web_registros%ROWTYPE;
 d public.gaona_web_documentos%ROWTYPE;
 c public.gaona_web_correos%ROWTYPE;
 sid text:=p_args->>'id'; cid text; lease uuid; bytes bytea; n integer; qty integer; subtotal numeric:=0; iva numeric;
 pos integer:=0; item jsonb; price numeric; expected numeric; email text; result jsonb;
BEGIN
 SELECT * INTO cfg FROM public.gaona_web_configuracion WHERE id=1 AND backend_uid=auth.uid();
 IF current_setting('role',true) IS DISTINCT FROM 'authenticated' OR cfg.id IS NULL THEN RAISE EXCEPTION 'Identidad no autorizada' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR octet_length(p_args::text)>3000000 THEN RAISE EXCEPTION 'Argumentos inválidos' USING ERRCODE='22023'; END IF;
 IF p_args ? 'correo_modo' AND COALESCE(p_args->>'correo_modo','') NOT IN ('simulado','smtp') THEN RAISE EXCEPTION 'Modo de correo inválido' USING ERRCODE='22023'; END IF;
 IF p_accion='verificar' THEN
  RETURN jsonb_build_object('version',cfg.version,'uid',cfg.backend_uid,'idempotencia_huella',cfg.idempotencia_huella,'acceso_huella',cfg.acceso_huella,'modo','simulado','correo_version',2,'modos_correo',jsonb_build_array('simulado','smtp'),'seguridad',
   (SELECT count(*)=4 AND bool_and(relrowsecurity AND relforcerowsecurity AND NOT pg_has_role('authenticated',relowner,'MEMBER')
      AND NOT has_any_column_privilege('authenticated',oid,'INSERT,UPDATE,REFERENCES')
      AND NOT has_table_privilege('authenticated',oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      AND NOT has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      AND NOT has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
    FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname IN ('gaona_web_configuracion','gaona_web_registros','gaona_web_documentos','gaona_web_correos'))
   AND NOT has_any_column_privilege('authenticated','public.gaona_web_registros','SELECT')
   AND NOT has_any_column_privilege('authenticated','public.gaona_web_documentos','SELECT')
   AND NOT has_any_column_privilege('authenticated','public.gaona_web_correos','SELECT')
   AND(SELECT count(*)=1 FROM pg_policies WHERE schemaname='public' AND tablename IN ('gaona_web_configuracion','gaona_web_registros','gaona_web_documentos','gaona_web_correos'))
   AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
   AND(SELECT count(*)=5 AND bool_and(relrowsecurity) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('productos','categorias','clientes','solicitudes','solicitud_detalles'))
   AND(SELECT count(*)=2 AND bool_and(policyname IN ('gaona_web_catalogo_productos','gaona_web_catalogo_categorias') AND cmd='SELECT' AND roles=ARRAY['authenticated']::name[]) FROM pg_policies WHERE schemaname='public' AND tablename IN ('productos','categorias','clientes','solicitudes','solicitud_detalles'))
   AND NOT has_schema_privilege('authenticated','public','CREATE')
   AND NOT has_schema_privilege('authenticated','gaona_web_interno','CREATE')
   AND NOT EXISTS(SELECT 1 FROM pg_roles elevated WHERE pg_has_role('authenticated',elevated.oid,'MEMBER') AND(elevated.rolsuper OR elevated.rolbypassrls OR elevated.rolcreatedb OR elevated.rolcreaterole OR elevated.rolreplication))
   AND(SELECT count(*)=2 AND bool_and(
      NOT pg_has_role('authenticated',p.proowner,'MEMBER')
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
      AND p.prosecdef=(p.pronamespace='gaona_web_interno'::regnamespace))
    FROM pg_proc p WHERE (p.pronamespace='gaona_web_interno'::regnamespace AND p.proname='operacion') OR(p.pronamespace='public'::regnamespace AND p.proname='gaona_web_operacion')));


 ELSIF p_accion IN ('buscar','registrar') THEN
  IF COALESCE(p_args->>'clave','') !~ '^[a-f0-9]{64}$' OR COALESCE(p_args->>'huella','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Clave inválida'; END IF;
  IF p_accion='registrar' THEN PERFORM pg_advisory_xact_lock(713428994); END IF;
  SELECT * INTO r FROM public.gaona_web_registros WHERE clave=p_args->>'clave';
  IF FOUND THEN
   IF r.huella<>p_args->>'huella' THEN RETURN jsonb_build_object('error','CLAVE_CONFLICTO','status',409); END IF;
   IF r.retener_hasta<=now() THEN RETURN jsonb_build_object('error','COMPROBANTE_EXPIRADO','status',410); END IF;
   RETURN jsonb_build_object('comprobante',r.comprobante,'repetido',true);
  END IF;
  IF p_accion='buscar' THEN RETURN 'null'::jsonb; END IF;
  IF COALESCE(p_args->>'origen','') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_args->'datos')<>'object' OR jsonb_typeof(p_args->'comprobante')<>'object' THEN RAISE EXCEPTION 'Registro inválido'; END IF;
  IF (SELECT count(*) FROM public.gaona_web_registros WHERE creado_en>now()-interval '15 minutes')>=100
   OR(SELECT count(*) FROM public.gaona_web_registros WHERE creado_en>now()-interval '15 minutes' AND origen_huella=p_args->>'origen')>=10
   THEN RETURN jsonb_build_object('error','LIMITE_REGISTROS','status',429); END IF;
  IF jsonb_typeof(p_args->'comprobante'->'cliente') IS DISTINCT FROM 'object' OR jsonb_typeof(p_args->'comprobante'->'estimado') IS DISTINCT FROM 'object'
   OR jsonb_typeof(p_args->'comprobante'->'estimado'->'productos') IS DISTINCT FROM 'array' OR jsonb_typeof(p_args->'datos'->'productos') IS DISTINCT FROM 'array'
   OR p_args->'comprobante'->'estimado'->>'subtotal' IS NULL OR p_args->'comprobante'->'estimado'->>'iva' IS NULL OR p_args->'comprobante'->'estimado'->>'total' IS NULL
   THEN RAISE EXCEPTION 'Comprobante inválido'; END IF;
  n:=jsonb_array_length(p_args->'comprobante'->'estimado'->'productos');
  IF n NOT BETWEEN 1 AND 30 OR n<>jsonb_array_length(p_args->'datos'->'productos') THEN RAISE EXCEPTION 'Productos inválidos'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_args->'comprobante'->'estimado'->'productos') LOOP
   IF item->>'idProducto' IS NULL OR item->>'cantidad' IS NULL OR item->>'precioUnitario' IS NULL OR item->>'importe' IS NULL THEN RAISE EXCEPTION 'Detalle incompleto'; END IF;
   IF item->>'idProducto' IS DISTINCT FROM (p_args->'datos'->'productos'->pos->>'idProducto') OR item->>'cantidad' IS DISTINCT FROM (p_args->'datos'->'productos'->pos->>'cantidad') THEN RAISE EXCEPTION 'Detalles no coinciden'; END IF;
   pos:=pos+1;
   qty:=(item->>'cantidad')::integer;
   IF qty NOT BETWEEN 1 AND 999 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
   SELECT "precioDesde" INTO price FROM public.productos WHERE id=item->>'idProducto' AND activo=true AND tipo='PRODUCTO';
   IF NOT FOUND OR price<0 OR price<>(item->>'precioUnitario')::numeric OR price*qty<>(item->>'importe')::numeric THEN RETURN jsonb_build_object('error','PRODUCTO_NO_DISPONIBLE','status',400); END IF;
   subtotal:=subtotal+price*qty;
  END LOOP;
  iva:=round(subtotal*0.16,2);
  IF subtotal<>(p_args->'comprobante'->'estimado'->>'subtotal')::numeric OR iva<>(p_args->'comprobante'->'estimado'->>'iva')::numeric OR subtotal+iva<>(p_args->'comprobante'->'estimado'->>'total')::numeric THEN RAISE EXCEPTION 'Importes inválidos'; END IF;
  sid:=p_args->'comprobante'->>'id';email:=p_args->'comprobante'->'cliente'->>'correo';
  IF p_args->'comprobante'->'cliente' IS DISTINCT FROM (p_args->'datos'->'cliente')-'direccion' THEN RAISE EXCEPTION 'Cliente no coincide'; END IF;
  cid:=gen_random_uuid()::text;
  INSERT INTO public.gaona_web_registros(clave,huella,cliente_id,solicitud_id,origen_huella,datos,comprobante)
   VALUES(p_args->>'clave',p_args->>'huella',cid,sid,p_args->>'origen',p_args->'datos',p_args->'comprobante');
  INSERT INTO public.clientes(id,nombre,apellido,direccion,telefono,correo)
   VALUES(cid,p_args->'datos'->'cliente'->>'nombre',p_args->'datos'->'cliente'->>'apellido',p_args->'datos'->'cliente'->>'direccion',p_args->'datos'->'cliente'->>'telefono',email);
  INSERT INTO public.solicitudes(id,"idCliente",origen,descripcion,"creadoEn","actualizadoEn")
   VALUES(sid,cid,'WEB',p_args->'datos'->>'descripcion',(p_args->'comprobante'->>'fecha')::timestamptz AT TIME ZONE 'UTC',(p_args->'comprobante'->>'fecha')::timestamptz AT TIME ZONE 'UTC');
  INSERT INTO public.solicitud_detalles(id,"idSolicitud","idProducto",cantidad,"medidasAprox",notas)
   SELECT gen_random_uuid()::text,sid,value->>'idProducto',(value->>'cantidad')::integer,value->>'medidasAprox',value->>'notas' FROM jsonb_array_elements(p_args->'datos'->'productos');
  INSERT INTO public.gaona_web_documentos(solicitud_id) VALUES(sid);
  IF email IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(713428993);
   SELECT to_jsonb(CASE WHEN count(*)>=30 OR count(*) FILTER(WHERE lower(destinatario)=lower(email))>=3 THEN 'limitado'::text ELSE 'pendiente'::text END) INTO result
    FROM public.gaona_web_correos WHERE creado_en>now()-interval '1 hour' AND estado NOT IN ('limitado','no_disponible');
   INSERT INTO public.gaona_web_correos(solicitud_id,destinatario,estado,mensaje_id,modo)
    VALUES(sid,email,result#>>'{}','<solicitud-'||sid||'@example.test>',COALESCE(p_args->>'correo_modo','simulado'));
  END IF;
  RETURN jsonb_build_object('comprobante',p_args->'comprobante','repetido',false);
 ELSIF p_accion='documento_leer' THEN
  SELECT * INTO r FROM public.gaona_web_registros WHERE solicitud_id=sid;
  SELECT * INTO d FROM public.gaona_web_documentos WHERE solicitud_id=sid;
  IF r.solicitud_id IS NULL OR d.solicitud_id IS NULL THEN RETURN 'null'::jsonb; END IF;
  IF LEAST(r.retener_hasta,d.retener_hasta)<=now() OR d.estado='expirado' THEN RETURN jsonb_build_object('error','PDF_EXPIRADO','status',410); END IF;
  RETURN jsonb_build_object('comprobante',r.comprobante,'estado',d.estado,'pdf',encode(d.pdf,'base64'),'sha',d.pdf_sha256,'intentos',d.intentos);
 ELSIF p_accion='documento_reclamar' THEN
  lease:=(p_args->>'reserva')::uuid;
  UPDATE public.gaona_web_documentos SET estado='generando',reserva=lease,vence_reserva=now()+interval '2 minutes',intentos=intentos+1
   WHERE solicitud_id=sid AND intentos<3 AND retener_hasta>now() AND(estado IN ('pendiente','error') OR(estado='generando' AND vence_reserva<=now()));
  GET DIAGNOSTICS n=ROW_COUNT;RETURN to_jsonb(n=1);
 ELSIF p_accion='documento_guardar' THEN
  bytes:=decode(p_args->>'pdf','base64');
  UPDATE public.gaona_web_documentos SET estado='disponible',pdf=bytes,pdf_sha256=p_args->>'sha'
   WHERE solicitud_id=sid AND estado='generando' AND reserva=(p_args->>'reserva')::uuid AND vence_reserva>now();
  GET DIAGNOSTICS n=ROW_COUNT;RETURN to_jsonb(n=1);
 ELSIF p_accion='documento_error' THEN
  UPDATE public.gaona_web_documentos SET estado='error' WHERE solicitud_id=sid AND estado='generando' AND reserva=(p_args->>'reserva')::uuid;RETURN 'null'::jsonb;
 ELSIF p_accion='correo_origen' THEN
  SELECT * INTO c FROM public.gaona_web_correos WHERE solicitud_id=sid;
  IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
  RETURN jsonb_build_object('modo',c.modo,'destinatario',c.destinatario);
 ELSIF p_accion IN ('correo_estado','correo_reclamar') THEN
  UPDATE public.gaona_web_correos SET estado='no_confirmado',codigo_error='PROCESO_INTERRUMPIDO' WHERE solicitud_id=sid AND estado IN ('preparando','enviando') AND vence_reserva<=now();
  IF p_accion='correo_estado' THEN
   SELECT * INTO c FROM public.gaona_web_correos WHERE solicitud_id=sid;
   RETURN to_jsonb(CASE WHEN c.estado IN ('preparando','enviando') THEN 'pendiente' ELSE COALESCE(c.estado,'no_confirmado') END);
  END IF;
  UPDATE public.gaona_web_correos SET estado='preparando',reserva=(p_args->>'reserva')::uuid,vence_reserva=now()+interval '2 minutes'
   WHERE solicitud_id=sid AND modo=COALESCE(p_args->>'correo_modo','simulado') AND estado='pendiente' AND intentos=0 RETURNING * INTO c;
  IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
  RETURN jsonb_build_object('solicitud_id',c.solicitud_id,'destinatario',c.destinatario,'mensaje_id',c.mensaje_id,'reserva',c.reserva);
 ELSIF p_accion='correo_iniciar' THEN
  UPDATE public.gaona_web_correos SET estado='enviando',intentos=1,adjunto_sha256=p_args->>'sha',vence_reserva=now()+interval '2 minutes'
   WHERE solicitud_id=sid AND modo=COALESCE(p_args->>'correo_modo','simulado') AND reserva=(p_args->>'reserva')::uuid AND estado='preparando' AND intentos=0 AND vence_reserva>now()
    AND EXISTS(SELECT 1 FROM public.gaona_web_documentos doc WHERE doc.solicitud_id=sid AND doc.estado='disponible' AND doc.pdf_sha256=p_args->>'sha' AND doc.retener_hasta>now());
  GET DIAGNOSTICS n=ROW_COUNT;RETURN to_jsonb(n=1);
 ELSIF p_accion='correo_finalizar' THEN
  IF p_args->>'estado' NOT IN ('aceptado','error','error_pdf','no_confirmado','limitado','no_disponible') THEN RAISE EXCEPTION 'Estado de correo inválido'; END IF;
  UPDATE public.gaona_web_correos SET estado=p_args->>'estado',codigo_error=p_args->>'codigo',proveedor_id=COALESCE(proveedor_id,p_args->>'proveedor'),respuesta_smtp=(p_args->>'respuesta')::integer
   WHERE solicitud_id=sid AND modo=COALESCE(p_args->>'correo_modo','simulado') AND reserva=(p_args->>'reserva')::uuid AND estado IN ('preparando','enviando','no_confirmado');RETURN 'null'::jsonb;
 END IF;
 RAISE EXCEPTION 'Operación no autorizada' USING ERRCODE='42501';
EXCEPTION WHEN data_exception OR integrity_constraint_violation THEN
 RAISE EXCEPTION 'Datos de operación inválidos' USING ERRCODE='22023';
END $$;
