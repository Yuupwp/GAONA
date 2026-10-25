\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
LOCK TABLE public.gaona_web_correos IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='gaona_web_interno.operacion(text,jsonb)'::regprocedure AND p.prosecdef AND p.proowner=current_user::regrole AND NOT pg_has_role('authenticated',p.proowner,'MEMBER')) THEN RAISE EXCEPTION 'Propietario o RPC internos no verificados'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.gaona_web_correos'::regclass AND conname='gaona_web_correos_modo_check' AND contype='c' AND pg_get_constraintdef(oid) IN ('CHECK ((modo = ''simulado''::text))','CHECK ((modo = ANY (ARRAY[''simulado''::text, ''smtp''::text])))')) THEN RAISE EXCEPTION 'Restricción de modo no reconocida; revisar antes de instalar'; END IF;
END $$;
ALTER TABLE public.gaona_web_correos DROP CONSTRAINT gaona_web_correos_modo_check;
ALTER TABLE public.gaona_web_correos ADD CONSTRAINT gaona_web_correos_modo_check CHECK(modo IN ('simulado','smtp')) NOT VALID;
ALTER TABLE public.gaona_web_correos VALIDATE CONSTRAINT gaona_web_correos_modo_check;
\ir rpc-operacion.sql
SELECT set_config('request.jwt.claim.sub',backend_uid::text,true) FROM public.gaona_web_configuracion WHERE id=1;
SET LOCAL ROLE authenticated;
DO $$ DECLARE cfg jsonb; BEGIN
 cfg:=public.gaona_web_operacion('verificar','{}'::jsonb);
 IF cfg->>'correo_version' IS DISTINCT FROM '2' OR (cfg->>'seguridad')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Actualización SMTP no verificada'; END IF;
END $$;
RESET ROLE;
NOTIFY pgrst, 'reload schema';
COMMIT;
