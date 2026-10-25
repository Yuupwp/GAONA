BEGIN;
CREATE EXTENSION btree_gist WITH SCHEMA public;
CREATE TYPE public."EstadoCita" AS ENUM ('PROGRAMADA', 'REALIZADA', 'CANCELADA', 'REPROGRAMADA');
CREATE TYPE public."EstadoCotizacion" AS ENUM ('BORRADOR', 'ENVIADA', 'APROBADA', 'RECHAZADA', 'VENCIDA');
CREATE TYPE public."EstadoPedido" AS ENUM ('EN_PROCESO', 'LISTO_PARA_INSTALAR', 'ENTREGADO', 'FACTURADO', 'CERRADO', 'CANCELADO');
CREATE TYPE public."EstadoSolicitud" AS ENUM ('NUEVA', 'EN_REVISION', 'VISITA_PROGRAMADA', 'COTIZADA', 'CANCELADA');
CREATE TYPE public."MetodoPago" AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'OTRO');
CREATE TYPE public."OrigenSolicitud" AS ENUM ('WEB', 'ESCRITORIO');
CREATE TYPE public."TipoCita" AS ENUM ('MEDICION', 'ENTREGA', 'INSTALACION');
CREATE TYPE public."TipoConcepto" AS ENUM ('PRODUCTO', 'MATERIAL', 'MANO_OBRA', 'FLETE');
CREATE TYPE public."TipoMovimiento" AS ENUM ('ENTRADA', 'SALIDA', 'AJUSTE');
CREATE TYPE public."TipoPago" AS ENUM ('ANTICIPO', 'PARCIAL', 'LIQUIDACION');
CREATE TYPE public."TipoProducto" AS ENUM ('PRODUCTO', 'MATERIAL', 'HERRAMIENTA');
CREATE TABLE public."categorias" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "nombre" text NOT NULL
);
CREATE TABLE public."citas" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "tipo" "TipoCita" NOT NULL,
  "estado" "EstadoCita" DEFAULT 'PROGRAMADA'::"EstadoCita" NOT NULL,
  "idUsuario" text NOT NULL,
  "idSolicitud" text,
  "idPedido" text,
  "inicio" timestamp(3) without time zone NOT NULL,
  "fin" timestamp(3) without time zone NOT NULL,
  "direccion" text,
  "notas" text,
  "creadoEn" timestamp(3) without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."clientes" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "nombre" text NOT NULL,
  "apellido" text NOT NULL,
  "direccion" text,
  "telefono" text NOT NULL,
  "correo" text,
  "creadoEn" timestamp(3) without time zone DEFAULT now() NOT NULL,
  "actualizadoEn" timestamp(3) without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."cotizacion_detalles" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "idCotizacion" text NOT NULL,
  "idProducto" text,
  "concepto" "TipoConcepto" DEFAULT 'PRODUCTO'::"TipoConcepto" NOT NULL,
  "descripcion" text NOT NULL,
  "cantidad" numeric(10,2) DEFAULT 1 NOT NULL,
  "precioUnitario" numeric(12,2) NOT NULL,
  "subtotal" numeric(12,2) NOT NULL,
  "medidas" text
);
CREATE TABLE public."cotizaciones" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "idSolicitud" text NOT NULL,
  "idUsuario" text NOT NULL,
  "estado" "EstadoCotizacion" DEFAULT 'BORRADOR'::"EstadoCotizacion" NOT NULL,
  "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
  "iva" numeric(12,2) DEFAULT 0 NOT NULL,
  "total" numeric(12,2) DEFAULT 0 NOT NULL,
  "anticipoRequerido" numeric(12,2),
  "vigenciaHasta" timestamp(3) without time zone,
  "fechaAprobacion" timestamp(3) without time zone,
  "pdfUrl" text,
  "creadoEn" timestamp(3) without time zone DEFAULT now() NOT NULL,
  "actualizadoEn" timestamp(3) without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."entregas" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "idPedido" text NOT NULL,
  "firmaUrl" text,
  "nombreRecibe" text,
  "fechaFirma" timestamp(3) without time zone,
  "observaciones" text
);
CREATE TABLE public."facturas" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "idPedido" text NOT NULL,
  "folio" text NOT NULL,
  "monto" numeric(12,2) NOT NULL,
  "fecha" timestamp(3) without time zone DEFAULT now() NOT NULL,
  "archivoUrl" text
);
CREATE TABLE public."historial_pedidos" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "idPedido" text NOT NULL,
  "idUsuario" text NOT NULL,
  "estadoAnterior" "EstadoPedido",
  "estadoNuevo" "EstadoPedido" NOT NULL,
  "fecha" timestamp(3) without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."inventario" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "idProducto" text NOT NULL,
  "existencia" integer DEFAULT 0 NOT NULL,
  "minimo" integer DEFAULT 0 NOT NULL,
  "actualizadoEn" timestamp(3) without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."movimientos_inventario" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "idInventario" text NOT NULL,
  "idUsuario" text NOT NULL,
  "idPedido" text,
  "tipo" "TipoMovimiento" NOT NULL,
  "cantidad" integer NOT NULL,
  "motivo" text,
  "fecha" timestamp(3) without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."pagos" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "idPedido" text NOT NULL,
  "idUsuario" text NOT NULL,
  "tipo" "TipoPago" NOT NULL,
  "metodo" "MetodoPago" NOT NULL,
  "monto" numeric(12,2) NOT NULL,
  "referencia" text,
  "fecha" timestamp(3) without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."pedidos" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "idCotizacion" text NOT NULL,
  "idCliente" text NOT NULL,
  "estado" "EstadoPedido" DEFAULT 'EN_PROCESO'::"EstadoPedido" NOT NULL,
  "total" numeric(12,2) NOT NULL,
  "creadoEn" timestamp(3) without time zone DEFAULT now() NOT NULL,
  "actualizadoEn" timestamp(3) without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."productos" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "idCategoria" text NOT NULL,
  "tipo" "TipoProducto" DEFAULT 'PRODUCTO'::"TipoProducto" NOT NULL,
  "nombre" text NOT NULL,
  "descripcion" text,
  "precioDesde" numeric(12,2) NOT NULL,
  "imagenUrl" text,
  "activo" boolean DEFAULT true NOT NULL,
  "creadoEn" timestamp(3) without time zone DEFAULT now() NOT NULL,
  "actualizadoEn" timestamp(3) without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."roles" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "nombre" text NOT NULL
);
CREATE TABLE public."solicitud_detalles" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "idSolicitud" text NOT NULL,
  "idProducto" text NOT NULL,
  "cantidad" integer DEFAULT 1 NOT NULL,
  "medidasAprox" text,
  "medidasReales" text,
  "notas" text
);
CREATE TABLE public."solicitudes" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "idCliente" text NOT NULL,
  "idUsuarioAsignado" text,
  "origen" "OrigenSolicitud" DEFAULT 'WEB'::"OrigenSolicitud" NOT NULL,
  "estado" "EstadoSolicitud" DEFAULT 'NUEVA'::"EstadoSolicitud" NOT NULL,
  "descripcion" text,
  "creadoEn" timestamp(3) without time zone DEFAULT now() NOT NULL,
  "actualizadoEn" timestamp(3) without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."usuarios" (
  "id" text DEFAULT (gen_random_uuid())::text NOT NULL,
  "idRol" text NOT NULL,
  "nombre" text NOT NULL,
  "apellido" text NOT NULL,
  "usuario" text NOT NULL,
  "passwordHash" text NOT NULL,
  "correo" text NOT NULL,
  "telefono" text,
  "activo" boolean DEFAULT true NOT NULL,
  "creadoEn" timestamp(3) without time zone DEFAULT now() NOT NULL,
  "actualizadoEn" timestamp(3) without time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."categorias" ADD CONSTRAINT "categorias_pkey" PRIMARY KEY (id);
ALTER TABLE public."citas" ADD CONSTRAINT "citas_pkey" PRIMARY KEY (id);
ALTER TABLE public."clientes" ADD CONSTRAINT "clientes_pkey" PRIMARY KEY (id);
ALTER TABLE public."cotizacion_detalles" ADD CONSTRAINT "cotizacion_detalles_pkey" PRIMARY KEY (id);
ALTER TABLE public."cotizaciones" ADD CONSTRAINT "cotizaciones_pkey" PRIMARY KEY (id);
ALTER TABLE public."entregas" ADD CONSTRAINT "entregas_pkey" PRIMARY KEY (id);
ALTER TABLE public."facturas" ADD CONSTRAINT "facturas_pkey" PRIMARY KEY (id);
ALTER TABLE public."historial_pedidos" ADD CONSTRAINT "historial_pedidos_pkey" PRIMARY KEY (id);
ALTER TABLE public."inventario" ADD CONSTRAINT "inventario_pkey" PRIMARY KEY (id);
ALTER TABLE public."movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_pkey" PRIMARY KEY (id);
ALTER TABLE public."pagos" ADD CONSTRAINT "pagos_pkey" PRIMARY KEY (id);
ALTER TABLE public."pedidos" ADD CONSTRAINT "pedidos_pkey" PRIMARY KEY (id);
ALTER TABLE public."productos" ADD CONSTRAINT "productos_pkey" PRIMARY KEY (id);
ALTER TABLE public."roles" ADD CONSTRAINT "roles_pkey" PRIMARY KEY (id);
ALTER TABLE public."solicitud_detalles" ADD CONSTRAINT "solicitud_detalles_pkey" PRIMARY KEY (id);
ALTER TABLE public."solicitudes" ADD CONSTRAINT "solicitudes_pkey" PRIMARY KEY (id);
ALTER TABLE public."usuarios" ADD CONSTRAINT "usuarios_pkey" PRIMARY KEY (id);
ALTER TABLE public."categorias" ADD CONSTRAINT "categorias_nombre_key" UNIQUE (nombre);
ALTER TABLE public."entregas" ADD CONSTRAINT "entregas_idPedido_key" UNIQUE ("idPedido");
ALTER TABLE public."facturas" ADD CONSTRAINT "facturas_folio_key" UNIQUE (folio);
ALTER TABLE public."facturas" ADD CONSTRAINT "facturas_idPedido_key" UNIQUE ("idPedido");
ALTER TABLE public."inventario" ADD CONSTRAINT "inventario_idProducto_key" UNIQUE ("idProducto");
ALTER TABLE public."pedidos" ADD CONSTRAINT "pedidos_idCotizacion_key" UNIQUE ("idCotizacion");
ALTER TABLE public."roles" ADD CONSTRAINT "roles_nombre_key" UNIQUE (nombre);
ALTER TABLE public."usuarios" ADD CONSTRAINT "usuarios_correo_key" UNIQUE (correo);
ALTER TABLE public."usuarios" ADD CONSTRAINT "usuarios_usuario_key" UNIQUE (usuario);
ALTER TABLE public."citas" ADD CONSTRAINT "citas_fin_mayor_inicio" CHECK ((fin > inicio));
ALTER TABLE public."pagos" ADD CONSTRAINT "pagos_monto_check" CHECK ((monto > (0)::numeric));
ALTER TABLE public."citas" ADD CONSTRAINT "citas_sin_empalme" EXCLUDE USING gist ("idUsuario" WITH =, tsrange(inicio, fin) WITH &&) WHERE ((estado = ANY (ARRAY['PROGRAMADA'::"EstadoCita", 'REPROGRAMADA'::"EstadoCita"])));
ALTER TABLE public."citas" ADD CONSTRAINT "citas_idPedido_fkey" FOREIGN KEY ("idPedido") REFERENCES pedidos(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public."citas" ADD CONSTRAINT "citas_idSolicitud_fkey" FOREIGN KEY ("idSolicitud") REFERENCES solicitudes(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public."citas" ADD CONSTRAINT "citas_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public."cotizacion_detalles" ADD CONSTRAINT "cotizacion_detalles_idCotizacion_fkey" FOREIGN KEY ("idCotizacion") REFERENCES cotizaciones(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."cotizacion_detalles" ADD CONSTRAINT "cotizacion_detalles_idProducto_fkey" FOREIGN KEY ("idProducto") REFERENCES productos(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public."cotizaciones" ADD CONSTRAINT "cotizaciones_idSolicitud_fkey" FOREIGN KEY ("idSolicitud") REFERENCES solicitudes(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public."cotizaciones" ADD CONSTRAINT "cotizaciones_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public."entregas" ADD CONSTRAINT "entregas_idPedido_fkey" FOREIGN KEY ("idPedido") REFERENCES pedidos(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public."facturas" ADD CONSTRAINT "facturas_idPedido_fkey" FOREIGN KEY ("idPedido") REFERENCES pedidos(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public."historial_pedidos" ADD CONSTRAINT "historial_pedidos_idPedido_fkey" FOREIGN KEY ("idPedido") REFERENCES pedidos(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public."historial_pedidos" ADD CONSTRAINT "historial_pedidos_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public."inventario" ADD CONSTRAINT "inventario_idProducto_fkey" FOREIGN KEY ("idProducto") REFERENCES productos(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public."movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_idInventario_fkey" FOREIGN KEY ("idInventario") REFERENCES inventario(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public."movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_idPedido_fkey" FOREIGN KEY ("idPedido") REFERENCES pedidos(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public."movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public."pagos" ADD CONSTRAINT "pagos_idPedido_fkey" FOREIGN KEY ("idPedido") REFERENCES pedidos(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public."pagos" ADD CONSTRAINT "pagos_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public."pedidos" ADD CONSTRAINT "pedidos_idCliente_fkey" FOREIGN KEY ("idCliente") REFERENCES clientes(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public."pedidos" ADD CONSTRAINT "pedidos_idCotizacion_fkey" FOREIGN KEY ("idCotizacion") REFERENCES cotizaciones(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public."productos" ADD CONSTRAINT "productos_idCategoria_fkey" FOREIGN KEY ("idCategoria") REFERENCES categorias(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public."solicitud_detalles" ADD CONSTRAINT "solicitud_detalles_idProducto_fkey" FOREIGN KEY ("idProducto") REFERENCES productos(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public."solicitud_detalles" ADD CONSTRAINT "solicitud_detalles_idSolicitud_fkey" FOREIGN KEY ("idSolicitud") REFERENCES solicitudes(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."solicitudes" ADD CONSTRAINT "solicitudes_idCliente_fkey" FOREIGN KEY ("idCliente") REFERENCES clientes(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public."solicitudes" ADD CONSTRAINT "solicitudes_idUsuarioAsignado_fkey" FOREIGN KEY ("idUsuarioAsignado") REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public."usuarios" ADD CONSTRAINT "usuarios_idRol_fkey" FOREIGN KEY ("idRol") REFERENCES roles(id) ON UPDATE CASCADE ON DELETE RESTRICT;
CREATE INDEX citas_idpedido_idx ON public.citas USING btree ("idPedido");
CREATE INDEX citas_idsolicitud_idx ON public.citas USING btree ("idSolicitud");
CREATE INDEX citas_idusuario_inicio_fin_idx ON public.citas USING btree ("idUsuario", inicio, fin);
CREATE INDEX clientes_correo_idx ON public.clientes USING btree (correo);
CREATE INDEX clientes_telefono_idx ON public.clientes USING btree (telefono);
CREATE INDEX cotizacion_detalles_idcotizacion_idx ON public.cotizacion_detalles USING btree ("idCotizacion");
CREATE INDEX cotizaciones_estado_idx ON public.cotizaciones USING btree (estado);
CREATE INDEX cotizaciones_idsolicitud_idx ON public.cotizaciones USING btree ("idSolicitud");
CREATE INDEX historial_pedidos_idpedido_idx ON public.historial_pedidos USING btree ("idPedido");
CREATE INDEX movimientos_inventario_idinventario_idx ON public.movimientos_inventario USING btree ("idInventario");
CREATE INDEX movimientos_inventario_idpedido_idx ON public.movimientos_inventario USING btree ("idPedido");
CREATE INDEX pagos_idpedido_idx ON public.pagos USING btree ("idPedido");
CREATE INDEX pedidos_estado_idx ON public.pedidos USING btree (estado);
CREATE INDEX pedidos_idcliente_idx ON public.pedidos USING btree ("idCliente");
CREATE INDEX productos_idcategoria_idx ON public.productos USING btree ("idCategoria");
CREATE INDEX productos_nombre_idx ON public.productos USING btree (nombre);
CREATE INDEX solicitud_detalles_idproducto_idx ON public.solicitud_detalles USING btree ("idProducto");
CREATE INDEX solicitud_detalles_idsolicitud_idx ON public.solicitud_detalles USING btree ("idSolicitud");
CREATE INDEX solicitudes_estado_idx ON public.solicitudes USING btree (estado);
CREATE INDEX solicitudes_idcliente_idx ON public.solicitudes USING btree ("idCliente");
CREATE INDEX solicitudes_idusuarioasignado_idx ON public.solicitudes USING btree ("idUsuarioAsignado");
CREATE INDEX usuarios_idrol_idx ON public.usuarios USING btree ("idRol");
CREATE OR REPLACE FUNCTION public.set_actualizado_en()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW."actualizadoEn" = now();
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_clientes_upd BEFORE UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER trg_cotizaciones_upd BEFORE UPDATE ON public.cotizaciones FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER trg_inventario_upd BEFORE UPDATE ON public.inventario FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER trg_pedidos_upd BEFORE UPDATE ON public.pedidos FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER trg_productos_upd BEFORE UPDATE ON public.productos FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER trg_solicitudes_upd BEFORE UPDATE ON public.solicitudes FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER trg_usuarios_upd BEFORE UPDATE ON public.usuarios FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
ALTER TABLE public."categorias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."citas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."clientes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."cotizacion_detalles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."cotizaciones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."entregas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."facturas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."historial_pedidos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."inventario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."movimientos_inventario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."pagos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."pedidos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."productos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."solicitud_detalles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."solicitudes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."usuarios" ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
COMMIT;
