BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM gaona_mensajeria.configuracion WHERE id=1 AND version=2) THEN
    RAISE EXCEPTION 'Se requiere la instalación web versión 2';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('gaona_web_publico','gaona_web_publico_login')) THEN
    RAISE EXCEPTION 'La identidad web ya existe; revisar privilegios antes de continuar';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('productos','categorias','clientes','solicitudes','solicitud_detalles') AND c.relrowsecurity) <> 5 THEN
    RAISE EXCEPTION 'Las tablas compartidas requieren RLS previamente revisado';
  END IF;
END $$;
CREATE ROLE gaona_web_publico NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT USAGE ON SCHEMA public, gaona_mensajeria TO gaona_web_publico;
GRANT SELECT ON gaona_mensajeria.configuracion TO gaona_web_publico;
GRANT SELECT, INSERT, UPDATE ON gaona_mensajeria.registros_web, gaona_mensajeria.documentos, gaona_mensajeria.correos TO gaona_web_publico;
GRANT SELECT (id, "idCategoria", tipo, nombre, descripcion, "precioDesde", "imagenUrl", activo) ON public.productos TO gaona_web_publico;
GRANT SELECT (id, nombre) ON public.categorias TO gaona_web_publico;
GRANT INSERT (id,nombre,apellido,direccion,telefono,correo,"creadoEn","actualizadoEn") ON public.clientes TO gaona_web_publico;
GRANT INSERT (id,"idCliente","idUsuarioAsignado",origen,estado,descripcion,"creadoEn","actualizadoEn") ON public.solicitudes TO gaona_web_publico;
GRANT INSERT (id,"idSolicitud","idProducto",cantidad,"medidasAprox",notas) ON public.solicitud_detalles TO gaona_web_publico;
GRANT SELECT (id) ON public.clientes TO gaona_web_publico;
GRANT SELECT (id, "idCliente", origen, estado, "idUsuarioAsignado", "creadoEn") ON public.solicitudes TO gaona_web_publico;
GRANT SELECT (id, "idSolicitud") ON public.solicitud_detalles TO gaona_web_publico;
GRANT USAGE ON TYPE public."OrigenSolicitud", public."EstadoSolicitud", public."TipoProducto" TO gaona_web_publico;
CREATE POLICY gaona_web3_config ON gaona_mensajeria.configuracion FOR SELECT TO gaona_web_publico USING (true);
CREATE POLICY gaona_web3_registros ON gaona_mensajeria.registros_web TO gaona_web_publico USING (true) WITH CHECK (true);
CREATE POLICY gaona_web3_documentos ON gaona_mensajeria.documentos TO gaona_web_publico USING (true) WITH CHECK (true);
CREATE POLICY gaona_web3_correos ON gaona_mensajeria.correos TO gaona_web_publico USING (true) WITH CHECK (true);
CREATE POLICY gaona_web3_productos ON public.productos FOR SELECT TO gaona_web_publico USING (activo=true AND tipo='PRODUCTO');
CREATE POLICY gaona_web3_categorias ON public.categorias FOR SELECT TO gaona_web_publico USING (true);
CREATE POLICY gaona_web3_clientes_lectura ON public.clientes FOR SELECT TO gaona_web_publico USING (true);
CREATE POLICY gaona_web3_clientes_alta ON public.clientes FOR INSERT TO gaona_web_publico WITH CHECK (true);
CREATE POLICY gaona_web3_solicitudes_lectura ON public.solicitudes FOR SELECT TO gaona_web_publico USING (origen='WEB');
CREATE POLICY gaona_web3_solicitudes_alta ON public.solicitudes FOR INSERT TO gaona_web_publico WITH CHECK (origen='WEB' AND estado='NUEVA' AND "idUsuarioAsignado" IS NULL);
CREATE POLICY gaona_web3_detalles_lectura ON public.solicitud_detalles FOR SELECT TO gaona_web_publico USING (
  EXISTS (SELECT 1 FROM public.solicitudes s WHERE s.id="idSolicitud" AND s.origen='WEB')
);
CREATE POLICY gaona_web3_detalles_alta ON public.solicitud_detalles FOR INSERT TO gaona_web_publico WITH CHECK (
  "medidasReales" IS NULL AND EXISTS (SELECT 1 FROM public.solicitudes s
    WHERE s.id="idSolicitud" AND s.origen='WEB' AND s.estado='NUEVA' AND s."idUsuarioAsignado" IS NULL)
);
CREATE POLICY gaona_web6_productos_limite ON public.productos AS RESTRICTIVE FOR SELECT TO gaona_web_publico USING (activo=true AND tipo='PRODUCTO');
CREATE POLICY gaona_web6_solicitudes_limite ON public.solicitudes AS RESTRICTIVE TO gaona_web_publico
USING (origen='WEB') WITH CHECK (origen='WEB' AND estado='NUEVA' AND "idUsuarioAsignado" IS NULL);
CREATE POLICY gaona_web6_detalles_limite ON public.solicitud_detalles AS RESTRICTIVE TO gaona_web_publico
USING (EXISTS (SELECT 1 FROM public.solicitudes s WHERE s.id="idSolicitud" AND s.origen='WEB'))
WITH CHECK ("medidasReales" IS NULL AND cantidad BETWEEN 1 AND 999
  AND EXISTS (SELECT 1 FROM public.solicitudes s WHERE s.id="idSolicitud" AND s.origen='WEB' AND s.estado='NUEVA' AND s."idUsuarioAsignado" IS NULL)
  AND EXISTS (SELECT 1 FROM public.productos p WHERE p.id="idProducto" AND p.activo=true AND p.tipo='PRODUCTO'));
CREATE FUNCTION gaona_mensajeria.validar_cliente_web() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID))
      AND pg_has_role(current_user,'gaona_web_publico','MEMBER')
      AND NOT EXISTS (SELECT 1 FROM public.solicitudes s WHERE s."idCliente"=NEW.id AND s.origen='WEB') THEN
    RAISE EXCEPTION 'El cliente web requiere una solicitud vinculada en la misma transacción' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION gaona_mensajeria.validar_cliente_web() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION gaona_mensajeria.validar_cliente_web() TO gaona_web_publico;
CREATE CONSTRAINT TRIGGER gaona_web3_cliente_vinculado AFTER INSERT ON public.clientes
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gaona_mensajeria.validar_cliente_web();
DO $$ BEGIN
  IF has_schema_privilege('gaona_web_publico','public','CREATE') OR EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND (
      has_table_privilege('gaona_web_publico',c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
      (c.relname NOT IN ('productos','categorias','clientes','solicitudes','solicitud_detalles') AND
        has_any_column_privilege('gaona_web_publico',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) OR
      (c.relname IN ('clientes','solicitudes','solicitud_detalles') AND has_table_privilege('gaona_web_publico',c.oid,'INSERT'))
    )) THEN
    RAISE EXCEPTION 'Privilegios PUBLIC o heredados exceden el alcance web; revisar con el equipo sin revocar accesos compartidos';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND p.prosecdef AND p.prorettype<>'trigger'::regtype
      AND has_schema_privilege('gaona_web_publico',n.oid,'USAGE') AND has_function_privilege('gaona_web_publico',p.oid,'EXECUTE')) THEN
    RAISE EXCEPTION 'Una funcion SECURITY DEFINER es accesible al rol web; requiere revision del equipo';
  END IF;
END $$;
COMMIT;
