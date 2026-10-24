BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(713428992);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM gaona_mensajeria.configuracion WHERE id = 1 AND version = 1) THEN
    RAISE EXCEPTION 'Se requiere la propuesta base version 1; revisar historial antes de continuar';
  END IF;
  IF to_regclass('gaona_mensajeria.correos') IS NOT NULL THEN
    RAISE EXCEPTION 'La tabla de correo ya existe; revisar diferencias antes de migrar';
  END IF;
END $$;
ALTER TABLE gaona_mensajeria.registros_web ADD COLUMN actualizado_en timestamptz NOT NULL DEFAULT now();
ALTER TABLE gaona_mensajeria.registros_web ADD COLUMN retener_hasta timestamptz NOT NULL DEFAULT now() + interval '30 days';
UPDATE gaona_mensajeria.registros_web SET retener_hasta = creado_en + interval '30 days';
ALTER TABLE gaona_mensajeria.registros_web ADD COLUMN origen_huella text CHECK (origen_huella ~ '^[a-f0-9]{64}$');
ALTER TABLE gaona_mensajeria.registros_web ADD COLUMN version_operacion smallint NOT NULL DEFAULT 1 CHECK (version_operacion IN (1, 2));
CREATE INDEX registros_web_cuota ON gaona_mensajeria.registros_web(creado_en, origen_huella);
ALTER TABLE gaona_mensajeria.configuracion ADD COLUMN idempotencia_huella text CHECK (idempotencia_huella ~ '^[a-f0-9]{64}$');
ALTER TABLE gaona_mensajeria.configuracion ADD COLUMN acceso_huella text CHECK (acceso_huella ~ '^[a-f0-9]{64}$');
ALTER TABLE gaona_mensajeria.configuracion ADD COLUMN legado_huella text CHECK (legado_huella ~ '^[a-f0-9]{64}$');
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
INSERT INTO gaona_mensajeria.documentos (solicitud_id, estado, pdf, pdf_sha256, creado_en, retener_hasta)
SELECT r.solicitud_id, CASE WHEN e.pdf IS NULL THEN 'pendiente' ELSE 'disponible' END, e.pdf, e.pdf_sha256, r.creado_en, r.retener_hasta
FROM gaona_mensajeria.registros_web r LEFT JOIN gaona_mensajeria.envios e ON e.solicitud_id = r.solicitud_id
WHERE r.solicitud_id IS NOT NULL AND r.comprobante IS NOT NULL;
CREATE TABLE gaona_mensajeria.correos (
  solicitud_id text PRIMARY KEY REFERENCES public.solicitudes(id) ON DELETE RESTRICT,
  canal text NOT NULL DEFAULT 'correo' CHECK (canal = 'correo'),
  destinatario text CHECK (char_length(destinatario) BETWEEN 3 AND 150 AND destinatario !~ '[[:cntrl:]]'),
  autorizacion_texto text NOT NULL,
  autorizacion_version text NOT NULL,
  autorizado_en timestamptz NOT NULL DEFAULT now(),
  estado text NOT NULL CHECK (estado IN ('pendiente','preparando','enviando','aceptado','error_pdf','error','no_confirmado','limitado','no_disponible')),
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
ALTER TABLE gaona_mensajeria.documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE gaona_mensajeria.correos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA gaona_mensajeria FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA gaona_mensajeria FROM PUBLIC, anon, authenticated;
ALTER TABLE gaona_mensajeria.configuracion DROP CONSTRAINT configuracion_version_check;
ALTER TABLE gaona_mensajeria.configuracion ADD CONSTRAINT configuracion_version_check CHECK (version IN (1, 2));
UPDATE gaona_mensajeria.configuracion SET version = 2 WHERE id = 1;
COMMIT;
