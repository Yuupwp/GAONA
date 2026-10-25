DO $$ BEGIN
 IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION 'Se requiere PostgreSQL 17'; END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('productos','categorias','clientes','solicitudes','solicitud_detalles') AND c.relrowsecurity)<>5 THEN RAISE EXCEPTION 'Las cinco tablas compartidas requieren RLS existente'; END IF;
 IF has_schema_privilege('authenticated','public','CREATE') THEN RAISE EXCEPTION 'La identidad Data API tiene DDL público; revisar permisos'; END IF;
 IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename IN ('productos','categorias','clientes','solicitudes','solicitud_detalles')) THEN RAISE EXCEPTION 'Políticas de catálogo existentes: revisar compatibilidad antes de instalar'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'gaona_web_%') THEN RAISE EXCEPTION 'Objetos web existentes: revisar sin sobrescribir'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication) THEN RAISE EXCEPTION 'Identidad Data API no apta'; END IF;
 IF NOT has_column_privilege('authenticated','public.productos','id','SELECT') OR NOT has_column_privilege('authenticated','public.productos','idCategoria','SELECT') OR NOT has_column_privilege('authenticated','public.productos','tipo','SELECT') OR NOT has_column_privilege('authenticated','public.productos','nombre','SELECT') OR NOT has_column_privilege('authenticated','public.productos','descripcion','SELECT') OR NOT has_column_privilege('authenticated','public.productos','precioDesde','SELECT') OR NOT has_column_privilege('authenticated','public.productos','imagenUrl','SELECT') OR NOT has_column_privilege('authenticated','public.productos','activo','SELECT') OR NOT has_column_privilege('authenticated','public.categorias','id','SELECT') OR NOT has_column_privilege('authenticated','public.categorias','nombre','SELECT') THEN RAISE EXCEPTION 'Falta SELECT del catálogo: revisar concesiones mínimas antes de instalar; no se alteran ACL compartidas automáticamente'; END IF;
 IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='gaona_web_interno') THEN RAISE EXCEPTION 'Esquema interno existente: revisar sin sobrescribir'; END IF;
 IF current_user IN ('authenticated','anon','service_role') OR pg_has_role('authenticated',current_user,'MEMBER') OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND(rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'La instalación requiere un propietario de confianza independiente de authenticated'; END IF;
END $$;
CREATE TABLE public.gaona_web_configuracion (
 id integer PRIMARY KEY CHECK(id=1), version integer NOT NULL CHECK(version=1),
 backend_uid uuid NOT NULL, idempotencia_huella text NOT NULL CHECK(idempotencia_huella ~ '^[a-f0-9]{64}$'),
 acceso_huella text NOT NULL CHECK(acceso_huella ~ '^[a-f0-9]{64}$')
);
CREATE TABLE public.gaona_web_registros (
 clave text PRIMARY KEY CHECK(clave ~ '^[a-f0-9]{64}$'), huella text NOT NULL CHECK(huella ~ '^[a-f0-9]{64}$'),
 cliente_id text NOT NULL, solicitud_id text NOT NULL UNIQUE CHECK(solicitud_id ~ '^[a-f0-9-]{36}$'),
 origen_huella text NOT NULL CHECK(origen_huella ~ '^[a-f0-9]{64}$'),
 datos jsonb NOT NULL CHECK(jsonb_typeof(datos)='object' AND octet_length(datos::text)<=100000),
 comprobante jsonb NOT NULL CHECK(jsonb_typeof(comprobante)='object' AND comprobante->>'id'=solicitud_id),
 creado_en timestamptz NOT NULL DEFAULT now(), retener_hasta timestamptz NOT NULL DEFAULT now()+interval '30 days'
);
CREATE INDEX gaona_web_registros_cuota ON public.gaona_web_registros(creado_en,origen_huella);
CREATE TABLE public.gaona_web_documentos (
 solicitud_id text PRIMARY KEY REFERENCES public.gaona_web_registros(solicitud_id) ON DELETE RESTRICT,
 estado text NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','generando','disponible','error','expirado')),
 pdf bytea CHECK(octet_length(pdf) BETWEEN 5 AND 2097152 AND substring(pdf from 1 for 5)=convert_to('%PDF-','UTF8')),
 pdf_sha256 text CHECK(pdf_sha256 ~ '^[a-f0-9]{64}$'), intentos smallint NOT NULL DEFAULT 0 CHECK(intentos BETWEEN 0 AND 3),
 reserva uuid, vence_reserva timestamptz, retener_hasta timestamptz NOT NULL DEFAULT now()+interval '30 days',
 CHECK((estado='disponible')=(pdf IS NOT NULL)), CHECK((pdf IS NULL AND pdf_sha256 IS NULL) OR (pdf IS NOT NULL AND pdf_sha256=encode(sha256(pdf),'hex'))),
 CHECK(estado<>'generando' OR (reserva IS NOT NULL AND vence_reserva IS NOT NULL))
);
CREATE INDEX gaona_web_documentos_retencion ON public.gaona_web_documentos(retener_hasta);
CREATE TABLE public.gaona_web_correos (
 solicitud_id text PRIMARY KEY REFERENCES public.gaona_web_registros(solicitud_id) ON DELETE RESTRICT,
 destinatario text NOT NULL CHECK(length(destinatario) BETWEEN 3 AND 150 AND destinatario !~ '[[:cntrl:]]'),
 modo text NOT NULL DEFAULT 'simulado' CHECK(modo IN ('simulado','smtp')),
 estado text NOT NULL CHECK(estado IN ('pendiente','preparando','enviando','aceptado','error_pdf','error','no_confirmado','limitado','no_disponible')),
 intentos smallint NOT NULL DEFAULT 0 CHECK(intentos BETWEEN 0 AND 1), mensaje_id text NOT NULL UNIQUE CHECK(length(mensaje_id)<=255),
 adjunto_sha256 text CHECK(adjunto_sha256 ~ '^[a-f0-9]{64}$'), reserva uuid, vence_reserva timestamptz,
 codigo_error text CHECK(codigo_error IN ('EAUTH','ECONNECTION','ESOCKET','ETIMEDOUT','EDNS','ETLS','EENVELOPE','EMESSAGE','OTRO','PROCESO_INTERRUMPIDO','PDF_INVALIDO')),
 proveedor_id text CHECK(length(proveedor_id)<=255), respuesta_smtp integer CHECK(respuesta_smtp BETWEEN 200 AND 599),
 creado_en timestamptz NOT NULL DEFAULT now(),
 CHECK(estado NOT IN ('enviando','aceptado') OR(intentos=1 AND adjunto_sha256 IS NOT NULL)),
 CHECK(estado NOT IN ('preparando','enviando') OR(reserva IS NOT NULL AND vence_reserva IS NOT NULL))
);
CREATE INDEX gaona_web_correos_cuota ON public.gaona_web_correos(creado_en,destinatario);
