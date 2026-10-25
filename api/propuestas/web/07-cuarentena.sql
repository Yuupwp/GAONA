BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF current_setting('gaona.web6_cuarentena_aprobada',true) IS DISTINCT FROM 'si' THEN
    RAISE EXCEPTION 'La cuarentena de la identidad web requiere aprobacion expresa';
  END IF;
END $$;
ALTER ROLE gaona_web_publico_login NOLOGIN;
REVOKE gaona_web_publico FROM gaona_web_publico_login;
COMMIT;
