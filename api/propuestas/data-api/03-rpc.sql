\ir rpc-operacion.sql
REVOKE ALL ON FUNCTION gaona_web_interno.operacion(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gaona_web_interno.operacion(text,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.gaona_web_operacion(p_accion text,p_args jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
 SELECT gaona_web_interno.operacion(p_accion,p_args);
$$;
REVOKE ALL ON FUNCTION public.gaona_web_operacion(text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.gaona_web_operacion(text,jsonb) TO authenticated;
