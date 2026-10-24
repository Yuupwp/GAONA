BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gaona_web_publico'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication) THEN
    RAISE EXCEPTION 'El grupo público no cumple los atributos esperados';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member='gaona_web_publico'::regrole) THEN
    RAISE EXCEPTION 'El grupo público no debe heredar otros roles';
  END IF;
END $$;
CREATE ROLE gaona_web_publico_login NOLOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 10;
GRANT gaona_web_publico TO gaona_web_publico_login WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;
DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO gaona_web_publico_login',current_database());
END $$;
COMMIT;
