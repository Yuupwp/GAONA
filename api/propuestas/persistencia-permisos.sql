BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM gaona_mensajeria.configuracion WHERE id = 1 AND version = 2) THEN
    RAISE EXCEPTION 'Se requiere persistencia version 2 antes de conceder permisos';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN ('productos','categorias','clientes','solicitudes','solicitud_detalles') AND NOT c.relrowsecurity) THEN
    RAISE EXCEPTION 'Las tablas public requieren RLS previamente revisado; este script no cambia su activacion';
  END IF;
END $$;
CREATE ROLE gaona_web_backend NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT USAGE ON SCHEMA public, gaona_mensajeria TO gaona_web_backend;
GRANT SELECT ON gaona_mensajeria.configuracion TO gaona_web_backend;
GRANT SELECT, INSERT, UPDATE ON gaona_mensajeria.registros_web, gaona_mensajeria.documentos, gaona_mensajeria.correos, gaona_mensajeria.envios TO gaona_web_backend;
GRANT SELECT, INSERT ON gaona_mensajeria.eventos TO gaona_web_backend;
GRANT SELECT ON public.productos, public.categorias TO gaona_web_backend;
GRANT SELECT, INSERT ON public.clientes, public.solicitudes, public.solicitud_detalles TO gaona_web_backend;
GRANT USAGE ON TYPE public."OrigenSolicitud", public."EstadoSolicitud", public."TipoProducto" TO gaona_web_backend;
CREATE POLICY gaona_backend_config ON gaona_mensajeria.configuracion FOR SELECT TO gaona_web_backend USING (true);
CREATE POLICY gaona_backend_registro ON gaona_mensajeria.registros_web TO gaona_web_backend USING (true) WITH CHECK (true);
CREATE POLICY gaona_backend_documento ON gaona_mensajeria.documentos TO gaona_web_backend USING (true) WITH CHECK (true);
CREATE POLICY gaona_backend_correo ON gaona_mensajeria.correos TO gaona_web_backend USING (true) WITH CHECK (true);
CREATE POLICY gaona_backend_whatsapp ON gaona_mensajeria.envios TO gaona_web_backend USING (true) WITH CHECK (true);
CREATE POLICY gaona_backend_evento ON gaona_mensajeria.eventos TO gaona_web_backend USING (true) WITH CHECK (true);
CREATE POLICY gaona_backend_productos ON public.productos FOR SELECT TO gaona_web_backend USING (activo = true AND tipo = 'PRODUCTO');
CREATE POLICY gaona_backend_categorias ON public.categorias FOR SELECT TO gaona_web_backend USING (true);
CREATE POLICY gaona_backend_clientes_lectura ON public.clientes FOR SELECT TO gaona_web_backend USING (true);
CREATE POLICY gaona_backend_clientes_alta ON public.clientes FOR INSERT TO gaona_web_backend WITH CHECK (true);
CREATE POLICY gaona_backend_solicitudes_lectura ON public.solicitudes FOR SELECT TO gaona_web_backend USING (true);
CREATE POLICY gaona_backend_solicitudes_alta ON public.solicitudes FOR INSERT TO gaona_web_backend WITH CHECK (origen = 'WEB' AND estado = 'NUEVA' AND "idUsuarioAsignado" IS NULL);
CREATE POLICY gaona_backend_detalles_lectura ON public.solicitud_detalles FOR SELECT TO gaona_web_backend USING (true);
CREATE POLICY gaona_backend_detalles_alta ON public.solicitud_detalles FOR INSERT TO gaona_web_backend WITH CHECK (true);
COMMIT;
