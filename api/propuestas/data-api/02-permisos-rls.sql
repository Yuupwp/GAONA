REVOKE ALL ON public.gaona_web_configuracion,public.gaona_web_registros,public.gaona_web_documentos,public.gaona_web_correos FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.gaona_web_configuracion TO authenticated;
ALTER TABLE public.gaona_web_configuracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gaona_web_configuracion FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gaona_web_registros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gaona_web_registros FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gaona_web_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gaona_web_documentos FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gaona_web_correos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gaona_web_correos FORCE ROW LEVEL SECURITY;
CREATE POLICY gaona_web_configuracion_identidad ON public.gaona_web_configuracion FOR SELECT TO authenticated USING(backend_uid=auth.uid());
CREATE POLICY gaona_web_catalogo_productos ON public.productos FOR SELECT TO authenticated
 USING(activo=true AND tipo='PRODUCTO' AND EXISTS(SELECT 1 FROM public.gaona_web_configuracion WHERE id=1 AND backend_uid=auth.uid()));
CREATE POLICY gaona_web_catalogo_categorias ON public.categorias FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.gaona_web_configuracion WHERE id=1 AND backend_uid=auth.uid()));
CREATE SCHEMA gaona_web_interno;
REVOKE ALL ON SCHEMA gaona_web_interno FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA gaona_web_interno TO authenticated;
