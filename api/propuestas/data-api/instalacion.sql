\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TEMP TABLE gaona_identidad_revisada(uid uuid,ih text,ph text) ON COMMIT DROP;
INSERT INTO gaona_identidad_revisada VALUES(:'backend_uid',:'idempotencia_huella',:'acceso_huella');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.users u JOIN gaona_identidad_revisada i ON i.uid=u.id WHERE u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL AND(u.banned_until IS NULL OR u.banned_until<now())) THEN RAISE EXCEPTION 'Identidad Auth no autorizada o no activa'; END IF;
END $$;
\ir 01-tablas.sql
\ir 02-permisos-rls.sql
\ir 03-rpc.sql
INSERT INTO public.gaona_web_configuracion(id,version,backend_uid,idempotencia_huella,acceso_huella)
 SELECT 1,1,uid,ih,ph FROM gaona_identidad_revisada;
SELECT set_config('request.jwt.claim.sub',uid::text,true) FROM gaona_identidad_revisada;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (public.gaona_web_operacion('verificar','{}'::jsonb)->>'seguridad')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'La instalación no satisface los controles de seguridad'; END IF;
END $$;
RESET ROLE;
NOTIFY pgrst, 'reload schema';
COMMIT;
