import { Prisma } from "@prisma/client";

export type ProductoSolicitado = {
  idProducto: string;
  cantidad: number;
  medidasAprox?: string;
  notas?: string;
};

export type Estimado = ReturnType<typeof calcularEstimado>;

export function calcularEstimado(
  detalles: ProductoSolicitado[],
  catalogo: { id: string; nombre: string; precioDesde: Prisma.Decimal }[]
) {
  const productos = detalles.map((detalle) => {
    const producto = catalogo.find((p) => p.id === detalle.idProducto);
    if (!producto) throw new Error("Producto no disponible");
    const precio = new Prisma.Decimal(producto.precioDesde);
    if (!precio.isFinite() || precio.isNegative() || precio.decimalPlaces() > 2) {
      throw new Error("Precio no válido");
    }
    return {
      ...detalle,
      nombre: producto.nombre,
      precioUnitario: precio.toFixed(2),
      importe: precio.mul(detalle.cantidad).toFixed(2),
    };
  });
  const subtotal = productos.reduce((suma, p) => suma.plus(p.importe), new Prisma.Decimal(0));
  const iva = subtotal.mul("0.16").toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return {
    productos,
    subtotal: subtotal.toFixed(2),
    iva: iva.toFixed(2),
    total: subtotal.plus(iva).toFixed(2),
  };
}

export type ComprobanteSolicitud = {
  id: string;
  fecha: string;
  cliente: { nombre: string; apellido: string; telefono: string; correo?: string };
  descripcion?: string;
  estimado: Estimado;
};
