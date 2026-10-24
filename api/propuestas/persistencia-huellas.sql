BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT id, version FROM gaona_mensajeria.configuracion WHERE id = 1 FOR UPDATE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM gaona_mensajeria.configuracion WHERE id = 1 AND version = 2
      AND idempotencia_huella IS NULL AND acceso_huella IS NULL AND legado_huella IS NULL) THEN
    RAISE EXCEPTION 'Se requiere version 2 sin huellas; las claves existentes no se sobrescriben';
  END IF;
END $$;
UPDATE gaona_mensajeria.configuracion SET
  idempotencia_huella = :'idempotencia_huella',
  acceso_huella = :'acceso_huella',
  legado_huella = NULLIF(:'legado_huella', '')
WHERE id = 1 AND version = 2;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM gaona_mensajeria.registros_web WHERE version_operacion = 1)
      AND EXISTS (SELECT 1 FROM gaona_mensajeria.configuracion WHERE id = 1 AND legado_huella IS NULL) THEN
    RAISE EXCEPTION 'Los registros v1 requieren la huella de su clave legada';
  END IF;
END $$;
COMMIT;
