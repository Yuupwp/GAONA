import type { Prisma } from "@prisma/client";
import { calcularEstimado, type ComprobanteSolicitud, type ProductoSolicitado } from "./solicitud-estimado";

export type DatosSolicitud = {
  cliente: ComprobanteSolicitud["cliente"] & { direccion?: string };
  descripcion?: string;
  whatsappConsentimiento: boolean;
  productos: ProductoSolicitado[];
};

export class ErrorSolicitud extends Error {
  constructor(readonly codigo: number, readonly tipo: string, mensaje: string, readonly solicitudId?: string) { super(mensaje); }
}

export async function registrarSolicitud(db: Pick<Prisma.TransactionClient, "producto" | "solicitud">, datos: DatosSolicitud): Promise<ComprobanteSolicitud> {
  const { cliente, descripcion, productos } = datos;

  const ids = [...new Set(productos.map(p => p.idProducto))];
  const encontrados = await db.producto.findMany({
    where: { id: { in: ids }, activo: true, tipo: "PRODUCTO" },
    select: { id: true, nombre: true, precioDesde: true },
  });
  if (encontrados.length !== ids.length) throw new ErrorSolicitud(400, "PRODUCTO_NO_DISPONIBLE", "Algún producto ya no está disponible");
  const estimado = calcularEstimado(productos, encontrados);
  const solicitud = await db.solicitud.create({
    data: { origen: "WEB", descripcion, cliente: { create: cliente }, detalles: { create: productos } },
    select: { id: true, creadoEn: true },
  });
  return { id: solicitud.id, fecha: solicitud.creadoEn.toISOString(),
    cliente: { nombre: cliente.nombre, apellido: cliente.apellido, telefono: cliente.telefono, correo: cliente.correo }, descripcion, estimado };
}
