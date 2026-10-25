BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(713428992);
DO $$ BEGIN
  IF current_setting('gaona.web3_fk_restrict_aprobado', true) IS DISTINCT FROM 'si' THEN
    RAISE EXCEPTION 'Se requiere aprobar expresamente la conservación del historial y el bloqueo del borrado administrativo';
  END IF;
  IF current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'La propuesta requiere PostgreSQL 17 o posterior';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='gaona_mensajeria') THEN
    RAISE EXCEPTION 'El esquema privado ya existe; no instalar sobre una versión previa';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('productos','categorias','clientes','solicitudes','solicitud_detalles') AND c.relkind='r' AND c.relrowsecurity) <> 5 THEN
    RAISE EXCEPTION 'Faltan tablas compartidas o RLS revisado; esta propuesta no cambia su estructura';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE n.nspname='public' AND p.prosecdef AND p.prorettype<>'trigger'::regtype AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'Hay funciones SECURITY DEFINER públicas; revisar sus permisos antes de crear la identidad web';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.solicitudes'::regclass AND attname='id' AND atttypid='text'::regtype AND attnotnull) THEN
    RAISE EXCEPTION 'El identificador de solicitudes no coincide con el contrato Prisma revisado';
  END IF;
END $$;
CREATE SCHEMA gaona_mensajeria;
REVOKE ALL ON SCHEMA gaona_mensajeria FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE gaona_mensajeria.configuracion (
  id integer PRIMARY KEY CHECK (id=1),
  version integer NOT NULL CHECK (version=2),
  idempotencia_huella text CHECK (idempotencia_huella ~ '^[a-f0-9]{64}$'),
  acceso_huella text CHECK (acceso_huella ~ '^[a-f0-9]{64}$'),
  legado_huella text CHECK (legado_huella ~ '^[a-f0-9]{64}$')
);
CREATE TABLE gaona_mensajeria.registros_web (
  clave text PRIMARY KEY CHECK (clave ~ '^[a-f0-9]{64}$'),
  huella text NOT NULL CHECK (huella ~ '^[a-f0-9]{64}$'),
  solicitud_id text UNIQUE REFERENCES public.solicitudes(id) ON DELETE RESTRICT,
  comprobante jsonb,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  retener_hasta timestamptz NOT NULL DEFAULT now()+interval '30 days',
  origen_huella text CHECK (origen_huella ~ '^[a-f0-9]{64}$'),
  version_operacion smallint NOT NULL DEFAULT 2 CHECK (version_operacion IN (1,2))
);
CREATE INDEX registros_web_cuota ON gaona_mensajeria.registros_web(creado_en,origen_huella);
CREATE TABLE gaona_mensajeria.documentos (
  solicitud_id text PRIMARY KEY REFERENCES public.solicitudes(id) ON DELETE RESTRICT,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','generando','disponible','error','expirado')),
  pdf bytea CHECK (octet_length(pdf) BETWEEN 5 AND 2097152),
  pdf_sha256 text CHECK (pdf_sha256 ~ '^[a-f0-9]{64}$'),
  version_generador text NOT NULL DEFAULT 'pdfkit-v1',
  intentos smallint NOT NULL DEFAULT 0 CHECK (intentos BETWEEN 0 AND 3),
  reserva uuid,
  vence_reserva timestamptz,
  codigo_error text CHECK (codigo_error IN ('GENERACION_FALLIDA','PDF_INVALIDO')),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  retener_hasta timestamptz NOT NULL DEFAULT now() + interval '30 days',
  CHECK ((pdf IS NULL AND (pdf_sha256 IS NULL OR estado = 'expirado')) OR (pdf IS NOT NULL AND pdf_sha256 IS NOT NULL)),
  CHECK ((estado = 'disponible') = (pdf IS NOT NULL)),
  CHECK (estado <> 'generando' OR (reserva IS NOT NULL AND vence_reserva IS NOT NULL))
);
CREATE INDEX documentos_retencion ON gaona_mensajeria.documentos(retener_hasta);
CREATE TABLE gaona_mensajeria.correos (
  solicitud_id text PRIMARY KEY REFERENCES public.solicitudes(id) ON DELETE RESTRICT,
  canal text NOT NULL DEFAULT 'correo' CHECK (canal = 'correo'),
  destinatario text CHECK (char_length(destinatario) BETWEEN 3 AND 150 AND destinatario !~ '[[:cntrl:]]'),
  autorizacion_texto text NOT NULL,
  autorizacion_version text NOT NULL,
  autorizado_en timestamptz NOT NULL DEFAULT now(),
  estado text NOT NULL DEFAULT 'no_disponible' CHECK (estado IN ('pendiente','preparando','enviando','aceptado','error_pdf','error','no_confirmado','limitado','no_disponible')),
  intentos smallint NOT NULL DEFAULT 0 CHECK (intentos BETWEEN 0 AND 1),
  mensaje_id text NOT NULL UNIQUE CHECK (char_length(mensaje_id) <= 255 AND mensaje_id !~ '[[:cntrl:]]'),
  proveedor_id text CHECK (char_length(proveedor_id) <= 255 AND proveedor_id !~ '[[:cntrl:]]'),
  adjunto_sha256 text CHECK (adjunto_sha256 ~ '^[a-f0-9]{64}$'),
  respuesta_smtp integer CHECK (respuesta_smtp BETWEEN 200 AND 599),
  reserva uuid,
  vence_reserva timestamptz,
  codigo_error text CHECK (codigo_error IN ('EAUTH','ECONNECTION','ESOCKET','ETIMEDOUT','EDNS','ETLS','EENVELOPE','EMESSAGE','OTRO','PROCESO_INTERRUMPIDO','PDF_INVALIDO')),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CHECK (estado NOT IN ('enviando','aceptado') OR (intentos = 1 AND adjunto_sha256 IS NOT NULL)),
  CHECK (estado NOT IN ('pendiente','preparando','enviando') OR destinatario IS NOT NULL),
  CHECK (estado NOT IN ('preparando','enviando') OR (reserva IS NOT NULL AND vence_reserva IS NOT NULL))
);
CREATE INDEX correos_cuota ON gaona_mensajeria.correos(creado_en, destinatario);
CREATE INDEX correos_reservas ON gaona_mensajeria.correos(vence_reserva) WHERE estado IN ('preparando','enviando');
ALTER TABLE gaona_mensajeria.configuracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE gaona_mensajeria.registros_web ENABLE ROW LEVEL SECURITY;
ALTER TABLE gaona_mensajeria.documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE gaona_mensajeria.correos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA gaona_mensajeria FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO gaona_mensajeria.configuracion (id,version) VALUES (1,2);
COMMIT;
