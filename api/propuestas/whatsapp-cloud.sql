BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE SCHEMA gaona_mensajeria;
REVOKE ALL ON SCHEMA gaona_mensajeria FROM PUBLIC, anon, authenticated;
CREATE TABLE gaona_mensajeria.configuracion (
  id integer PRIMARY KEY CHECK (id = 1),
  version integer NOT NULL CHECK (version = 1)
);
CREATE TABLE gaona_mensajeria.registros_web (
  clave text PRIMARY KEY CHECK (clave ~ '^[a-f0-9]{64}$'),
  huella text NOT NULL CHECK (huella ~ '^[a-f0-9]{64}$'),
  solicitud_id text UNIQUE REFERENCES public.solicitudes(id) ON DELETE RESTRICT,
  comprobante jsonb,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gaona_mensajeria.envios (
  id uuid PRIMARY KEY,
  solicitud_id text NOT NULL REFERENCES public.solicitudes(id) ON DELETE RESTRICT,
  canal text NOT NULL CHECK (canal = 'whatsapp'),
  destinatario text NOT NULL CHECK (destinatario ~ '^\+[1-9][0-9]{7,14}$'),
  consentimiento_texto text NOT NULL,
  consentimiento_version text NOT NULL,
  consentimiento_aceptado_en timestamptz NOT NULL DEFAULT now(),
  estado text NOT NULL CHECK (estado IN ('pendiente','preparando','enviando','aceptado','enviado','entregado','leido','error','no_confirmado','limitado')),
  pdf bytea CHECK (octet_length(pdf) <= 2097152),
  pdf_sha256 text CHECK (pdf_sha256 ~ '^[a-f0-9]{64}$'),
  media_id text,
  mensaje_id text UNIQUE,
  destinatario_proveedor text CHECK (destinatario_proveedor ~ '^\+[1-9][0-9]{7,14}$'),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (solicitud_id, canal)
);
CREATE INDEX envios_cuota ON gaona_mensajeria.envios(creado_en, destinatario);
CREATE TABLE gaona_mensajeria.eventos (
  envio_id uuid NOT NULL REFERENCES gaona_mensajeria.envios(id) ON DELETE RESTRICT,
  mensaje_id text NOT NULL,
  estado text NOT NULL CHECK (estado IN ('enviado','entregado','leido','error')),
  fecha_proveedor timestamptz NOT NULL,
  recibido_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (envio_id, mensaje_id, estado, fecha_proveedor)
);
ALTER TABLE gaona_mensajeria.configuracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE gaona_mensajeria.registros_web ENABLE ROW LEVEL SECURITY;
ALTER TABLE gaona_mensajeria.envios ENABLE ROW LEVEL SECURITY;
ALTER TABLE gaona_mensajeria.eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA gaona_mensajeria FROM PUBLIC, anon, authenticated;
INSERT INTO gaona_mensajeria.configuracion (id, version) VALUES (1, 1);
COMMIT;
